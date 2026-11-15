/**
 * tools-collection-tree-metadata.test.ts – subject, level and keywords per node
 * of a tree, under the tree's ONE approval (chatbot team, S3, 2026-11-14).
 *
 * What this pins: the values are resolved strictly (name, alias or URI — never
 * a partial word), shown in the preview as labels and therefore part of the
 * key; `shared` applies to every new node and a node's own value REPLACES it;
 * an existing collection that is taken over is left untouched, and the preview
 * says so; what did not land is reported, never passed off as created-and-done.
 *
 * Offline: what is sent and how an answer is read. That the repository stores
 * these properties on a collection is measured by the live suite.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { registerCurationTreeTools } from '../src/tools/curation-tree.js';
import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { flattenTree } from '../src/services/write/collection-tree.js';
import { resolveVocab } from '../src/vocabs.js';
import { installFetchMock, toolText, type MockResult } from './fetchMock.js';

const MARIA: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };
const TOOL = 'wlo_create_collection_tree';
const PARENT = 'parent-1';
const PHYSIK = resolveVocab('Physik', 'discipline')!;
const CHEMIE = resolveVocab('Chemie', 'discipline')!;
const SEK1 = resolveVocab('Sekundarstufe I', 'educationalContext')!;
const TAXON = 'ccm:taxonid';
const LEVEL = 'ccm:educationalcontext';
const KEYWORDS = 'cclom:general_keyword';

async function client(): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerCurationTreeTools(server, 'Bearer error="invalid_request"');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  return c;
}

/** A collection repository that stores what a metadata PUT sends — unless told to drop a property. */
function repository(existing: Array<{ id: string; parent: string; title: string }> = [], drop: string[] = [], opts: { loseFirstCreate?: boolean } = {}) {
  const nodes = new Map<string, { parent: string; title: string; props: Record<string, string[]> }>([[PARENT, { parent: '-root-', title: 'Eltern', props: {} }]]);
  for (const e of existing) nodes.set(e.id, { parent: e.parent, title: e.title, props: {} });
  let seq = 0;
  const writes: Array<{ id: string; body: Record<string, string[]> }> = [];
  const mock = installFetchMock((url, init): MockResult => {
    const method = init?.method ?? 'GET';
    const create = /\/collection\/v1\/collections\/-home-\/([^/]+)\/children/.exec(url);
    if (create && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { title: string };
      const id = `c-${++seq}`;
      nodes.set(id, { parent: create[1]!, title: body.title, props: {} });
      // The create LANDS; only its answer is lost — once.
      if (opts.loseFirstCreate && seq === 1) throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
      return { json: { collection: { ref: { id } } } };
    }
    const children = /\/node\/v1\/nodes\/-home-\/([^/]+)\/children/.exec(url);
    if (children) {
      const list = [...nodes].filter(([, n]) => n.parent === children[1]).map(([id, n]) => ({
        ref: { id, repo: '-home-' }, type: 'ccm:map', aspects: ['ccm:collection'], properties: { 'cm:title': [n.title] },
      }));
      return { json: { nodes: list, pagination: { total: list.length, from: 0, count: list.length } } };
    }
    const meta = /\/nodes\/-home-\/([^/]+)\/metadata/.exec(url);
    if (meta && (method === 'PUT' || method === 'POST')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, string[]>;
      writes.push({ id: meta[1]!, body });
      const n = nodes.get(meta[1]!);
      if (n) for (const [k, v] of Object.entries(body)) if (!drop.includes(k)) n.props[k] = v;
      return { json: {} };
    }
    const read = meta ?? /\/collections\/-home-\/([^/?]+)(\?|$)/.exec(url);
    if (read && method === 'GET') {
      const n = nodes.get(read[1]!);
      if (!n) return { status: 404, json: {} };
      const props = { 'cm:title': [n.title], ...n.props };
      return { json: { node: { ref: { id: read[1], repo: '-home-' }, type: 'ccm:map', aspects: ['ccm:collection'], title: n.title, properties: props },
        collection: { ref: { id: read[1] }, title: n.title, properties: props } } };
    }
    return { json: {} };
  });
  const byTitle = (title: string) => [...nodes].find(([, n]) => n.title === title)?.[1];
  return { mock, writes, nodes, byTitle };
}

interface Answer {
  complete: boolean;
  nodes: Array<{ path: string; nodeId?: string; status: string; code?: string }>;
  confirm?: { token: string; preview: { items?: string[] } };
  error?: { code: string; reasons?: string[]; candidates?: Array<{ field: string; value: string; suggestions: string[] }> };
}
const sc = (r: unknown) => (r as { structuredContent: Answer }).structuredContent;
const cleanup = async (c: Client, mock: { restore(): void }) => { await c.close(); mock.restore(); setServiceCredentialForTest(null); };

async function run(c: Client, args: Record<string, unknown>) {
  const preview = await c.callTool({ name: TOOL, arguments: { parentCollectionId: PARENT, ...args } });
  assert.notEqual(preview.isError, true, toolText(preview));
  const done = await c.callTool({ name: TOOL, arguments: { parentCollectionId: PARENT, ...args, confirmToken: sc(preview).confirm!.token } });
  return { preview, done };
}

// ── the rule (no I/O) ───────────────────────────────────────────────────────

test('flattenTree: shared values reach every node; a node\'s own value replaces the shared one, an empty list switches it off', () => {
  const flat = flattenTree([
    { title: 'Optik', children: [{ title: 'Linsen', discipline: 'Chemie' }, { title: 'Licht', keywords: [] }] },
  ], { discipline: 'Physik', keywords: ['Lehrplan'] });
  assert.ok(flat.ok);
  const extra = Object.fromEntries(flat.items.map(i => [i.key, i.extra]));
  assert.deepEqual(extra['Optik'], { [TAXON]: [PHYSIK], [KEYWORDS]: ['Lehrplan'] });
  assert.deepEqual(extra['Optik/Linsen'], { [TAXON]: [CHEMIE], [KEYWORDS]: ['Lehrplan'] });
  assert.deepEqual(extra['Optik/Licht'], { [TAXON]: [PHYSIK] });
});

test('flattenTree: a node without any metadata carries no "extra" at all', () => {
  const flat = flattenTree([{ title: 'Optik' }]);
  assert.ok(flat.ok);
  assert.equal('extra' in flat.items[0]!, false);
});

test('flattenTree: a partial word is refused with candidates — once, however many nodes share it', () => {
  const flat = flattenTree([{ title: 'A' }, { title: 'B' }, { title: 'C', educationalContext: 'Sekundarstufe I' }], { discipline: 'Wirtschaft' });
  assert.equal(flat.ok, false);
  if (flat.ok) return;
  assert.equal(flat.reasons.length, 1);
  assert.match(flat.reasons[0]!, /^shared: /);
  assert.equal(flat.candidates[0]!.field, 'discipline');
  assert.ok(flat.candidates[0]!.suggestions.length > 0);
});

// ── the tool ────────────────────────────────────────────────────────────────

test('the preview shows every value as a label, per node — and writes nothing', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, writes } = repository();
  const c = await client();
  try {
    const r = await c.callTool({ name: TOOL, arguments: {
      parentCollectionId: PARENT, shared: { discipline: 'Physik', educationalContext: 'Sek I' },
      tree: [{ title: 'Optik', keywords: ['Licht', 'Linse'], children: [{ title: 'Linsen', discipline: ['Physik', 'Chemie'] }] }],
    } });
    assert.equal(writes.length, 0);
    const [optik, linsen] = sc(r).confirm!.preview.items!;
    assert.equal(optik, 'Optik: anlegen — Fach: „Physik“ — Bildungsstufe: „Sekundarstufe I“ — Schlagwörter: „Licht“, „Linse“');
    assert.equal(linsen, 'Optik/Linsen: anlegen — Fach: „Physik“, „Chemie“ — Bildungsstufe: „Sekundarstufe I“');
    // No address of a vocabulary in a sentence a person has to check.
    assert.doesNotMatch(toolText(r), /w3id\.org/);
  } finally { await cleanup(c, mock); }
});

test('one approval creates the tree and writes each node\'s metadata — resolved, on the node it belongs to', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, byTitle } = repository();
  const c = await client();
  try {
    const { done } = await run(c, {
      shared: { discipline: 'Physik', educationalContext: 'Sekundarstufe I' },
      tree: [{ title: 'Optik', description: 'Licht und Sehen', children: [{ title: 'Linsen', discipline: 'Chemie', keywords: ['Brennweite'] }] }],
    });
    const a = sc(done);
    assert.equal(a.complete, true);
    assert.deepEqual(a.nodes.map(n => n.status), ['created', 'created']);
    assert.deepEqual(byTitle('Optik')!.props, { 'cm:description': ['Licht und Sehen'], [TAXON]: [PHYSIK], [LEVEL]: [SEK1] });
    assert.deepEqual(byTitle('Linsen')!.props, { [TAXON]: [CHEMIE], [LEVEL]: [SEK1], [KEYWORDS]: ['Brennweite'] });
  } finally { await cleanup(c, mock); }
});

test('the metadata is part of the approval: the key with another subject is not this plan', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, nodes } = repository();
  const c = await client();
  try {
    const args = { parentCollectionId: PARENT, tree: [{ title: 'Optik' }] };
    const preview = await c.callTool({ name: TOOL, arguments: { ...args, shared: { discipline: 'Physik' } } });
    const r = await c.callTool({ name: TOOL, arguments: { ...args, shared: { discipline: 'Chemie' }, confirmToken: sc(preview).confirm!.token } });
    assert.equal(r.isError, true);
    assert.equal(nodes.size, 1, 'nothing was created');
  } finally { await cleanup(c, mock); }
});

test('an existing collection that is taken over stays untouched, and the preview says which values are NOT set there', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, writes, byTitle } = repository([{ id: 'old-1', parent: PARENT, title: 'Optik' }]);
  const c = await client();
  try {
    const { preview, done } = await run(c, {
      shared: { discipline: 'Physik' },
      tree: [{ title: 'Optik', description: 'neu', children: [{ title: 'Linsen' }] }],
    });
    assert.equal(sc(preview).confirm!.preview.items![0],
      'Optik: vorhanden (old-1), wird übernommen — bleibt unverändert, dort NICHT gesetzt: Beschreibung, Fach');
    assert.deepEqual(sc(done).nodes.map(n => n.status), ['existing', 'created']);
    assert.ok(!writes.some(w => w.id === 'old-1'), 'no write reached the existing collection');
    assert.deepEqual(byTitle('Linsen')!.props, { [TAXON]: [PHYSIK] });
  } finally { await cleanup(c, mock); }
});

test('a value the repository did not keep: the collection is there, and the step says it is not fully confirmed', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock } = repository([], [TAXON]);
  const c = await client();
  try {
    const { done } = await run(c, { tree: [{ title: 'Optik', discipline: 'Physik', keywords: ['Licht'] }] });
    const node = sc(done).nodes[0]!;
    assert.equal(node.status, 'unverified');
    assert.equal(node.code, 'not_visible');
    assert.ok(node.nodeId, 'the id is not lost');
  } finally { await cleanup(c, mock); }
});

test('an unknown subject refuses the call before any read, with candidates', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock } = repository();
  const c = await client();
  try {
    const r = await c.callTool({ name: TOOL, arguments: { parentCollectionId: PARENT, tree: [{ title: 'Optik', discipline: 'Wirtschaft' }] } });
    assert.equal(r.isError, true);
    assert.equal(sc(r).error!.code, 'invalid_input');
    assert.equal(sc(r).error!.candidates![0]!.field, 'discipline');
    assert.equal(mock.calls.length, 0);
  } finally { await cleanup(c, mock); }
});

test('a tree without metadata sends what it always sent: no metadata write for a node without description', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, writes } = repository();
  const c = await client();
  try {
    await run(c, { tree: [{ title: 'Optik' }] });
    assert.equal(writes.length, 0);
  } finally { await cleanup(c, mock); }
});

// ── review of package 2 (2026-11-14) ────────────────────────────────────────

test('a create whose answer never came is FINISHED on the next call — description and metadata written, not passed off as "existing"', async () => {
  setServiceCredentialForTest(MARIA);
  const repo = repository([], [], { loseFirstCreate: true });
  const c = await client();
  try {
    const args = { parentCollectionId: PARENT, tree: [{ title: 'Optik', description: 'Licht', discipline: 'Physik' }] };
    const preview = await c.callTool({ name: TOOL, arguments: args });
    const a = sc(await c.callTool({ name: TOOL, arguments: { ...args, confirmToken: sc(preview).confirm!.token } }));
    assert.equal(a.complete, false);
    assert.equal(a.nodes[0]!.status, 'pending');
    const b = sc(await c.callTool({ name: TOOL, arguments: { ...args, continuationToken: (a as unknown as { continuationToken: string }).continuationToken } }));
    assert.equal(b.nodes[0]!.status, 'created');
    assert.deepEqual(repo.byTitle('Optik')!.props, { 'cm:description': ['Licht'], [TAXON]: [PHYSIK] });
    assert.equal([...repo.nodes.values()].filter(n => n.title === 'Optik').length, 1, 'not created twice');
  } finally { await cleanup(c, repo.mock); }
});

test('a refused shared value is named as shared — not as the first node\'s mistake', () => {
  const flat = flattenTree([{ title: 'A' }, { title: 'B', discipline: 'Mathe-Kram' }], { discipline: 'Wirtschaft' });
  assert.equal(flat.ok, false);
  if (flat.ok) return;
  assert.match(flat.reasons[0]!, /^shared: /);
  assert.match(flat.reasons[1]!, /^„B“: /);
});

test('an unknown key in shared, an empty label and a changed shared on a continuation are refused', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, nodes } = repository();
  const c = await client();
  try {
    for (const bad of [{ shared: { userRole: 'Lehrer' } }, { shared: { discipline: '' } }, { shared: { discipline: [''] } }]) {
      const r = await c.callTool({ name: TOOL, arguments: { parentCollectionId: PARENT, tree: [{ title: 'Optik' }], ...bad } }).catch(() => ({ isError: true }));
      assert.equal((r as { isError?: boolean }).isError, true, JSON.stringify(bad));
    }
    assert.equal(nodes.size, 1);
  } finally { await cleanup(c, mock); }
});
