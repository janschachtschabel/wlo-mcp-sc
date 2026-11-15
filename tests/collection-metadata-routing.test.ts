/**
 * collection-metadata-routing.test.ts – the metadata tools on a COLLECTION
 * (chatbot feedback 2026-11-13, D1 + D2; user decision of the same day).
 *
 * The tools stay open for collections: editors maintain a collection's subject,
 * level and keywords like a record's. Two things are pinned:
 *
 *   - title and description are written where the collection view READS them
 *     (`cm:title` / `cm:description`). Measured on staging 2026-11-13
 *     (`tests/live/collection-metadata.test.ts`): `cclom:title` on a collection
 *     is stored as a second field, the collection's title stays what it was,
 *     and the node's DTO title follows the new field from then on — a later
 *     rename no longer reaches it.
 *   - submitting for review takes a single record only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { registerCurationContentTools } from '../src/tools/curation-content.js';
import { registerCurationUpdateManyTool } from '../src/tools/curation-update-many.js';
import { registerCurationSuggestionTools } from '../src/tools/curation-suggestions.js';
import { registerCurationDecisionTool } from '../src/tools/curation-decide.js';
import { desiredOn, propertyOn } from '../src/services/write/collection-fields.js';
import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { installFetchMock, toolText } from './fetchMock.js';

const MARIA: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };
const CHALLENGE = 'Bearer error="invalid_request"';

async function client(): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerCurationContentTools(server, CHALLENGE);
  registerCurationUpdateManyTool(server, CHALLENGE);
  registerCurationSuggestionTools(server, CHALLENGE);
  registerCurationDecisionTool(server, CHALLENGE);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  return c;
}

interface Proposal { id: string; propertyId: string; value: string; status: string }

/** coll (a collection), folder (a plain container), rec (a record). Writes are kept. */
function repository(proposals: Proposal[] = []) {
  const nodes: Record<string, { type: string; aspects?: string[]; properties: Record<string, string[]> }> = {
    coll: { type: 'ccm:map', aspects: ['ccm:collection'], properties: { 'cm:title': ['Optik'], 'cm:description': ['Alt'] } },
    folder: { type: 'ccm:map', properties: { 'cm:name': ['Ablage'] } },
    ref: { type: 'ccm:io', properties: { 'cclom:title': ['Linsen'] } },
    rec: { type: 'ccm:io', properties: { 'cclom:title': ['Linsen'] } },
    // What the tools wrote before 2026-11-13: a stray record title beside the collection's own.
    stray: { type: 'ccm:map', aspects: ['ccm:collection'], properties: { 'cm:title': ['Mechanik'], 'cclom:title': ['Verirrt'] } },
  };
  const writes: Array<{ id: string; props: Record<string, string[]> }> = [];
  const posted: Array<{ id: string; body: Proposal[] }> = [];
  const workflow: string[] = [];
  const mock = installFetchMock((url, init) => {
    const method = init?.method ?? 'GET';
    const sug = /\/suggestions\/v1\/-home-\/([^/?]+)/.exec(url);
    if (sug) {
      if (method === 'GET') {
        const byProperty: Record<string, Proposal[]> = {};
        for (const s of proposals) (byProperty[s.propertyId] ??= []).push(s);
        return { json: { nodeId: sug[1], suggestions: byProperty } };
      }
      if (method === 'POST') {
        const body = JSON.parse(String(init?.body ?? '[]')) as Proposal[];
        posted.push({ id: sug[1]!, body });
        return { json: body.map((b, i) => ({ ...b, id: `s-${i + 1}`, status: 'PENDING' })) };
      }
      const q = new URL(url).searchParams;
      const hit = proposals.find(x => x.id === q.get('id'));
      if (hit) hit.status = q.get('status') ?? hit.status;
      return { json: {} };
    }
    const node = /\/nodes\/-home-\/([^/?]+)\/(metadata|workflow)/.exec(url);
    if (!node) return { status: 404, json: {} };
    const id = node[1]!;
    const stored = nodes[id];
    if (!stored) return { status: 404, json: {} };
    if (node[2] === 'workflow') { workflow.push(id); return { json: {} }; }
    if (method !== 'GET') {
      const props = JSON.parse(String(init?.body ?? '{}')) as Record<string, string[]>;
      writes.push({ id, props });
      Object.assign(stored.properties, props);
      return { json: {} };
    }
    return { json: { node: { ref: { id, repo: '-home-' }, type: stored.type, aspects: stored.aspects ?? [],
      ...(id === 'ref' ? { originalId: 'rec' } : {}), properties: stored.properties } } };
  });
  return { mock, nodes, writes, posted, workflow };
}

const sc = (r: unknown) => (r as { structuredContent?: Record<string, unknown> }).structuredContent ?? {};
const token = (r: unknown) => String((sc(r)['confirm'] as { token?: string } | undefined)?.token ?? '');
const errorCode = (r: unknown) => (sc(r)['error'] as { code?: string } | undefined)?.code;

async function confirmed(c: Client, name: string, args: Record<string, unknown>) {
  const preview = await c.callTool({ name, arguments: args });
  const key = token(preview);
  assert.ok(key, `Vorschau ohne Schlüssel: ${toolText(preview)}`);
  return { preview, result: await c.callTool({ name, arguments: { ...args, confirmToken: key } }) };
}

test('the mapping: only a collection, only title and description', () => {
  const coll = { type: 'ccm:map', aspects: ['ccm:collection'] };
  assert.equal(propertyOn(coll, 'cclom:title'), 'cm:title');
  assert.equal(propertyOn(coll, 'cclom:general_description'), 'cm:description');
  assert.equal(propertyOn(coll, 'ccm:taxonid'), 'ccm:taxonid');
  assert.equal(propertyOn({ type: 'ccm:io' }, 'cclom:title'), 'cclom:title');
  // A plain container is not a collection: nothing is known about where it keeps a title.
  assert.equal(propertyOn({ type: 'ccm:map' }, 'cclom:title'), 'cclom:title');
  assert.deepEqual(desiredOn(coll, { 'cclom:title': ['A'], 'cclom:general_keyword': ['k'] }),
    { 'cm:title': ['A'], 'cclom:general_keyword': ['k'] });
});

test('wlo_update_content on a collection writes title and description to cm:*, other fields as they are', async () => {
  const repo = repository();
  setServiceCredentialForTest(MARIA);
  try {
    const c = await client();
    const { preview, result } = await confirmed(c, 'wlo_update_content',
      { nodeId: 'coll', title: 'Optik neu', description: 'Neu', keywords: ['Licht'] });
    assert.match(toolText(preview), /Titel/);
    assert.ok(!(result as { isError?: boolean }).isError, toolText(result));
    assert.equal(repo.writes.length, 1);
    assert.deepEqual(Object.keys(repo.writes[0]!.props).sort(), ['cclom:general_keyword', 'cm:description', 'cm:title']);
    assert.deepEqual(repo.nodes['coll']!.properties['cm:title'], ['Optik neu']);
    assert.equal(repo.nodes['coll']!.properties['cclom:title'], undefined);
  } finally { setServiceCredentialForTest(null); repo.mock.restore(); }
});

test('wlo_update_content on a collection: the title it already carries is no change', async () => {
  const repo = repository();
  setServiceCredentialForTest(MARIA);
  try {
    const c = await client();
    const r = await c.callTool({ name: 'wlo_update_content', arguments: { nodeId: 'coll', title: 'Optik' } });
    assert.equal(token(r), '', 'nothing to confirm — compared against cm:title, not an absent cclom:title');
    assert.equal(repo.writes.length, 0);
    assert.doesNotMatch(toolText(r), /nicht gefunden|keine Sammlung|kein Datensatz/, toolText(r));
  } finally { setServiceCredentialForTest(null); repo.mock.restore(); }
});

test('wlo_update_content on a record still writes cclom:title', async () => {
  const repo = repository();
  setServiceCredentialForTest(MARIA);
  try {
    const c = await client();
    await confirmed(c, 'wlo_update_content', { nodeId: 'rec', title: 'Linsen neu' });
    assert.deepEqual(Object.keys(repo.writes[0]!.props), ['cclom:title']);
  } finally { setServiceCredentialForTest(null); repo.mock.restore(); }
});

test('wlo_update_contents routes a collection the same way', async () => {
  const repo = repository();
  setServiceCredentialForTest(MARIA);
  try {
    const c = await client();
    const { result } = await confirmed(c, 'wlo_update_contents',
      { items: [{ nodeId: 'coll', title: 'Optik neu' }, { nodeId: 'rec', title: 'Linsen neu' }] });
    assert.ok(!(result as { isError?: boolean }).isError, toolText(result));
    assert.deepEqual(repo.writes.find(w => w.id === 'coll')!.props, { 'cm:title': ['Optik neu'] });
    assert.deepEqual(repo.writes.find(w => w.id === 'rec')!.props, { 'cclom:title': ['Linsen neu'] });
  } finally { setServiceCredentialForTest(null); repo.mock.restore(); }
});

test('wlo_suggest_metadata files a collection title proposal under cm:title', async () => {
  const repo = repository();
  setServiceCredentialForTest(MARIA);
  try {
    const c = await client();
    const { result } = await confirmed(c, 'wlo_suggest_metadata',
      { nodeId: 'coll', suggestions: [{ field: 'title', value: 'Optik neu', reason: 'klarer' }] });
    assert.ok(!(result as { isError?: boolean }).isError, toolText(result));
    assert.deepEqual(repo.posted[0]!.body.map(b => b.propertyId), ['cm:title']);
  } finally { setServiceCredentialForTest(null); repo.mock.restore(); }
});

test('wlo_decide_suggestion: an older cclom:title proposal on a collection is accepted into cm:title', async () => {
  const proposals = [{ id: 's-9', propertyId: 'cclom:title', value: 'Optik neu', status: 'PENDING' }];
  const repo = repository(proposals);
  setServiceCredentialForTest(MARIA);
  try {
    const c = await client();
    const { result } = await confirmed(c, 'wlo_decide_suggestion', { nodeId: 'coll', suggestionId: 's-9', decision: 'accept' });
    assert.ok(!(result as { isError?: boolean }).isError, toolText(result));
    assert.deepEqual(repo.writes[0]!.props, { 'cm:title': ['Optik neu'] });
    assert.equal(proposals[0]!.status, 'ACCEPTED');
  } finally { setServiceCredentialForTest(null); repo.mock.restore(); }
});

for (const [id, code] of [['coll', 'is_a_collection'], ['folder', 'is_a_folder']] as const) {
  test(`wlo_submit_content refuses ${id} with ${code}, before any key`, async () => {
    const repo = repository();
    setServiceCredentialForTest(MARIA);
    try {
      const c = await client();
      const r = await c.callTool({ name: 'wlo_submit_content', arguments: { nodeId: id } });
      assert.equal((r as { isError?: boolean }).isError, true);
      assert.equal(errorCode(r), code);
      assert.equal(token(r), '');
      assert.deepEqual(repo.workflow, []);
    } finally { setServiceCredentialForTest(null); repo.mock.restore(); }
  });
}

test('wlo_submit_content still takes a record', async () => {
  const repo = repository();
  setServiceCredentialForTest(MARIA);
  try {
    const c = await client();
    const r = await c.callTool({ name: 'wlo_submit_content', arguments: { nodeId: 'rec' } });
    assert.ok(token(r), toolText(r));
  } finally { setServiceCredentialForTest(null); repo.mock.restore(); }
});

// ── review of D2 ─────────────────────────────────────────────────────────────

test('a collection is NAMED by its own title in what a person confirms — not by a stray record title', async () => {
  const repo = repository();
  setServiceCredentialForTest(MARIA);
  try {
    const c = await client();
    const many = toolText(await c.callTool({ name: 'wlo_update_contents', arguments: { items: [{ nodeId: 'stray', keywords: ['Kraft'] }] } }));
    assert.match(many, /„Mechanik“/);
    assert.doesNotMatch(many, /Verirrt/);
    const one = toolText(await c.callTool({ name: 'wlo_suggest_metadata',
      arguments: { nodeId: 'stray', suggestions: [{ field: 'keywords', value: 'Kraft', reason: 'fehlt' }] } }));
    assert.match(one, /„Mechanik“/);
    assert.doesNotMatch(one, /Verirrt/);
  } finally { setServiceCredentialForTest(null); repo.mock.restore(); }
});

test('wlo_update_content: a file onto a collection is refused — metadata alone is not', async () => {
  const repo = repository();
  setServiceCredentialForTest(MARIA);
  try {
    const c = await client();
    const r = await c.callTool({ name: 'wlo_update_content', arguments: { nodeId: 'coll', content: '# Text', contentFormat: 'markdown' } });
    assert.equal((r as { isError?: boolean }).isError, true);
    assert.equal(errorCode(r), 'is_a_collection');
    assert.equal(token(r), '');
  } finally { setServiceCredentialForTest(null); repo.mock.restore(); }
});

test('wlo_submit_content takes a REFERENCE to a record — a collection listing hands those out', async () => {
  const repo = repository();
  setServiceCredentialForTest(MARIA);
  try {
    const c = await client();
    assert.ok(token(await c.callTool({ name: 'wlo_submit_content', arguments: { nodeId: 'ref' } })));
  } finally { setServiceCredentialForTest(null); repo.mock.restore(); }
});

// ── Z2 (chatbot feedback 2026-11-13): the preview names what it changes ──────

test('the preview of a metadata change opens with WHAT is changed — kind, title, id', async () => {
  const repo = repository();
  setServiceCredentialForTest(MARIA);
  try {
    const c = await client();
    const record = await c.callTool({ name: 'wlo_update_content', arguments: { nodeId: 'rec', keywords: ['Licht'] } });
    // The first line of the PREVIEW — after the tool's own lead-in sentence.
    assert.ok(toolText(record).split('\n').filter(l => l.trim()).slice(0, 2).includes('Datensatz: „Linsen“ (rec)'), toolText(record));
    const collection = await c.callTool({ name: 'wlo_update_content', arguments: { nodeId: 'stray', keywords: ['Kraft'] } });
    assert.ok(toolText(collection).split('\n').filter(l => l.trim()).slice(0, 2).includes('Sammlung: „Mechanik“ (stray)'), toolText(collection));
    const target = (sc(collection)['confirm'] as { preview: { target: Record<string, unknown> } }).preview.target;
    assert.deepEqual({ kind: target['kind'], title: target['title'] }, { kind: 'collection', title: 'Mechanik' });
  } finally { setServiceCredentialForTest(null); repo.mock.restore(); }
});

test('the preview shows a content type by its NAME, old and new — not as an address', async () => {
  const repo = repository();
  repo.nodes['rec']!.properties['ccm:oeh_lrt'] = ['http://w3id.org/openeduhub/vocabs/new_lrt/cd1686cd-43f0-45b2-b22e-b4d125b8be31'];
  setServiceCredentialForTest(MARIA);
  try {
    const c = await client();
    const r = await c.callTool({ name: 'wlo_update_content', arguments: { nodeId: 'rec', contentType: 'Arbeitsblatt' } });
    const text = toolText(r);
    assert.match(text, /Inhaltstyp: „Positionspapier“ → „Arbeitsblatt“/, text);
    assert.doesNotMatch(text.split('\n').find(l => l.startsWith('Inhaltstyp'))!, /w3id\.org/, text);
  } finally { setServiceCredentialForTest(null); repo.mock.restore(); }
});
