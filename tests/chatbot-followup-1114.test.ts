/**
 * chatbot-followup-1114.test.ts – five additive fields from the chatbot team's
 * follow-up (2026-11-14). Each says in a FIELD what until then only the German
 * text said, or was missing from the short form:
 *
 *   1. `confirm.preview.notes` — the ⚠ lines of a preview;
 *   2. `error.reason` on `ambiguous_collection` — which of the three cases;
 *   3. `wlo_update_compendium` names the collection in its first preview line;
 *   4. `find_content_by_url` codes a 404 as `not_found`;
 *   5. `search_wlo_content_many` carries an optional `previewUrl` per hit.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { searchManySchema } from '../src/tools/content-search-many.js';
import { urlLookupSchema } from '../src/tools/find-by-url.js';
import { connectedClient, installFetchMock, makeNode, strictClient, toolText, type MockResult } from './fetchMock.js';
import { fullTextOnly, installManyMock } from './searchManyMock.js';

const USER: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };

interface Confirm {
  token: string;
  preview: { notes?: string[]; target: { nodeId: string; kind: string; title: string }; fields: Array<{ name: string }> };
}

/** The ⚠ lines of a preview text, without the sign — what `preview.notes` must equal. */
const warningLines = (text: string): string[] =>
  text.split('\n').filter(l => l.startsWith('⚠ ')).map(l => l.slice(2));

async function curate(name: string, args: Record<string, unknown>, handler: Parameters<typeof installFetchMock>[0]) {
  setServiceCredentialForTest(USER);
  const mock = installFetchMock(handler);
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name, arguments: args });
    const confirm = (result.structuredContent as { confirm?: Confirm } | undefined)?.confirm;
    return { result, text: toolText(result), confirm };
  } finally {
    await client.close(); mock.restore(); setServiceCredentialForTest(null);
  }
}

const record = (properties: Record<string, string[]>, extra: Record<string, unknown> = {}): MockResult =>
  ({ json: { node: { ref: { id: 'node-1', repo: '-home-' }, type: 'ccm:io', properties, ...extra } } });

// ── 1. preview.notes ────────────────────────────────────────────────────────

test('1: an alias note of the preview text is carried as confirm.preview.notes — the same sentence', async () => {
  const { text, confirm } = await curate('wlo_update_content',
    { nodeId: 'node-1', educationalContext: 'Gymnasium' }, () => record({ 'cclom:title': ['Alt'] }));
  assert.ok(confirm, text);
  const inText = warningLines(text);
  assert.equal(inText.length, 1, text);
  assert.match(inText[0]!, /„Gymnasium“ wird als „.+“ geschrieben/);
  assert.deepEqual(confirm.preview.notes, inText);
});

test('1: a preview without a warning carries no notes key at all', async () => {
  const { text, confirm } = await curate('wlo_update_content',
    { nodeId: 'node-1', title: 'Neu' }, () => record({ 'cclom:title': ['Alt'] }));
  assert.ok(confirm, text);
  assert.deepEqual(warningLines(text), []);
  assert.ok(!('notes' in confirm.preview), JSON.stringify(confirm.preview));
});

test('1: a possible duplicate under a cleaned address reaches preview.notes of wlo_create_content', async () => {
  const { text, confirm } = await curate('wlo_create_content',
    { url: 'https://example.org/optik/?utm_source=x', title: 'Optik' }, (url, init) => {
      if (url.includes('/ngsearch')) {
        // Staging's behaviour: only the clean spelling finds the clean stored address.
        const asked = String(JSON.parse(String(init?.body ?? '{}')).criteria?.[0]?.values?.[0] ?? '');
        const nodes = asked === 'https://example.org/optik'
          ? [makeNode('rec-1', 'Optik (alt)', { 'ccm:wwwurl': ['https://example.org/optik'] })] : [];
        return { json: { nodes, pagination: { total: nodes.length, from: 0, count: nodes.length } } };
      }
      return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
    });
  assert.ok(confirm, text);
  const inText = warningLines(text);
  assert.ok(inText.some(l => l.includes('rec-1')), text);
  assert.deepEqual(confirm.preview.notes, inText);
});

// ── 2. ambiguous_collection: error.reason ───────────────────────────────────

interface Coll { id: string; title: string }
const collection = (c: Coll) => ({
  ...makeNode(c.id, c.title, { 'cm:title': [c.title] }), type: 'ccm:map', aspects: ['ccm:collection'],
});

async function byName(name: string, colls: Coll[], nameStatus?: number) {
  const mock = installFetchMock(url => {
    if (url.includes('/mds_oeh/collections')) return { json: { nodes: colls.map(collection) } };
    if (url.includes('/collection/v1/collections/-home-/search')) {
      return nameStatus ? { status: nameStatus, json: {} } : { json: { collections: [] } };
    }
    if (url.includes('/parents')) return { json: { nodes: [] } };
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'get_collection_contents', arguments: { collection: name } });
    const error = (result.structuredContent as { error?: { code?: string; reason?: string } } | undefined)?.error;
    return { result, error };
  } finally { await client.close(); mock.restore(); }
}

test('2: ambiguous_collection names its case — several, none, unverified', async () => {
  const twins = await byName('Energie', [{ id: 'a', title: 'Energie' }, { id: 'b', title: 'Energie' }]);
  assert.deepEqual([twins.error?.code, twins.error?.reason], ['ambiguous_collection', 'several']);
  assert.match(toolText(twins.result), /Mehrere Sammlungen tragen den Titel/);

  const nothing = await byName('Genetik', [{ id: 'c', title: 'Molekulargenetik' }]);
  assert.deepEqual([nothing.error?.code, nothing.error?.reason], ['ambiguous_collection', 'none']);
  assert.match(toolText(nothing.result), /Keine Sammlung trägt genau den Titel/);

  // One equal title, but one of the two indexes did not answer.
  const open = await byName('Optik', [{ id: 'd', title: 'Optik' }], 503);
  assert.deepEqual([open.error?.code, open.error?.reason], ['ambiguous_collection', 'unverified']);
  assert.match(toolText(open.result), /wurde gefunden, aber nicht übernommen/);
});

// ── 3. wlo_update_compendium names the collection ───────────────────────────

const COMPENDIUM_COLLECTION = (): MockResult => ({ json: { node: {
  ref: { id: 'coll-1', repo: '-home-' }, type: 'ccm:map', aspects: ['ccm:collection'],
  properties: { 'cm:title': ['Bruchrechnung'] },
} } });

test('3: the compendium preview opens with the collection, before the field line', async () => {
  const { text, confirm } = await curate('wlo_update_compendium',
    { nodeId: 'coll-1', text: '# Überblick' }, COMPENDIUM_COLLECTION);
  assert.ok(confirm, text);
  const lines = text.split('\n');
  // Line 0 is the fixed lead-in, line 1 blank; the change set starts at line 2.
  assert.equal(lines[2], 'Sammlung: „Bruchrechnung“ (coll-1)', text);
  assert.match(lines[3]!, /→ „# Überblick“$/);
  // The structured target keeps the kind it always had.
  assert.deepEqual(confirm.preview.target, { nodeId: 'coll-1', kind: 'compendium', title: 'Bruchrechnung' });
});

test('3: the key of the compendium preview still performs the write', async () => {
  setServiceCredentialForTest(USER);
  const stored: Record<string, string[]> = { 'cm:title': ['Bruchrechnung'] };
  const mock = installFetchMock((url, init) => {
    if ((init?.method ?? 'GET') !== 'GET' && url.includes('/property')) {
      stored['ccm:oeh_collection_compendium_text'] = JSON.parse(String(init?.body ?? 'null')) as string[];
      return { json: {} };
    }
    return { json: { node: { ref: { id: 'coll-1', repo: '-home-' }, type: 'ccm:map', aspects: ['ccm:collection'], properties: stored } } };
  });
  const client = await connectedClient();
  try {
    const args = { nodeId: 'coll-1', text: '# Überblick' };
    const preview = await client.callTool({ name: 'wlo_update_compendium', arguments: args });
    const token = (preview.structuredContent as { confirm: Confirm }).confirm.token;
    const done = await client.callTool({ name: 'wlo_update_compendium', arguments: { ...args, confirmToken: token } });
    assert.notEqual(done.isError, true, toolText(done));
    assert.deepEqual(stored['ccm:oeh_collection_compendium_text'], ['# Überblick']);
  } finally {
    await client.close(); mock.restore(); setServiceCredentialForTest(null);
  }
});

// ── 4. find_content_by_url: 404 → not_found ─────────────────────────────────

test('4: a search answered 404 is not_found for that entry — and the answer fits the advertised schema', async () => {
  const mock = installFetchMock(() => ({ status: 404, json: {} }));
  // The strict client validates the answer against the published output schema.
  const client = await strictClient();
  try {
    const result = await client.callTool({ name: 'find_content_by_url', arguments: { urls: ['https://example.org/x'] } });
    assert.notEqual(result.isError, true, toolText(result));
    const { results } = urlLookupSchema.parse(result.structuredContent);
    assert.equal(results[0]!.error?.code, 'not_found');
    assert.match(toolText(result), /not_found/);
  } finally { await client.close(); mock.restore(); }
});

// ── 5. search_wlo_content_many: previewUrl ──────────────────────────────────

test('5: a hit carries previewUrl when the record has a preview, and no key when it has none', async () => {
  const mock = installManyMock(fullTextOnly({ optik: { nodes: [
    { ...makeNode('o1', 'Optik'), preview: { url: 'https://repo.example/preview?nodeId=o1', isIcon: false } },
    makeNode('o2', 'Optik im Alltag'),
  ] } }));
  const client = await strictClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_content_many', arguments: { queries: [{ id: 'a', query: 'Optik' }] },
    });
    assert.notEqual(result.isError, true, toolText(result));
    const hits = searchManySchema.strict().parse(result.structuredContent).results['a']!.results;
    assert.equal(hits.find(h => h.nodeId === 'o1')?.previewUrl, 'https://repo.example/preview?nodeId=o1');
    assert.ok(!('previewUrl' in hits.find(h => h.nodeId === 'o2')!), 'absent, not empty');
    assert.doesNotMatch(toolText(result), /repo\.example\/preview/, 'not in the markdown text');
  } finally { await client.close(); mock.restore(); }
});
