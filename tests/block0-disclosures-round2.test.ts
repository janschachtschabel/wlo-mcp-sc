/**
 * Second review round, the list tools: what an answer says about itself must be
 * in the FIRST content block (some clients hand their model nothing else), the
 * JSON block and `structuredContent` must be one object as far as disclosures
 * go, and a paging limit is said on the page that reaches it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { REFILL_ROUNDS } from '../src/services/content-search.js';
import { RECURSIVE_SKIP_MAX } from '../src/services/collection-traversal.js';
import { FLAT_TREE_SKIP_MAX, listCollectionTree } from '../src/services/collection-tree-flat.js';
import { connectedClient, installFetchMock, makeNode, type MockResult } from './fetchMock.js';

type Structured = Record<string, unknown>;
const block = (result: unknown, i = 0) => (result as { content: { text: string }[] }).content[i]?.text ?? '';
const structured = (result: unknown) => (result as { structuredContent: Structured }).structuredContent;

// ── Finding 5: search_wlo_content, JSON block 0 ─────────────────────────────

test('search_wlo_content (json): block 0 carries `more`, like structuredContent', async () => {
  const WINDOW = 25;
  const mock = installFetchMock((url): MockResult => {
    if (!url.includes('/ngsearch')) return { json: {} };
    const skip = Number(new URL(url).searchParams.get('skipCount') ?? 0);
    const nodes = Array.from({ length: WINDOW }, (_, i) =>
      makeNode(`n${skip + i}`, `Optik ${skip + i}`, { 'ccm:wwwurl': [`https://example.org/${skip + i}`] }));
    return { json: { nodes, pagination: { total: 100_000, from: skip, count: nodes.length } } };
  });
  const client = await connectedClient();
  try {
    const seen = Array.from({ length: (REFILL_ROUNDS + 1) * WINDOW }, (_, i) => `n${i}`);
    const json = await client.callTool({ name: 'search_wlo_content', arguments: { query: 'Optik', excludeNodeIds: seen, outputFormat: 'json' } });
    assert.deepEqual(structured(json)['more'], { nextSkipCount: 100 });
    assert.deepEqual(JSON.parse(block(json))['more'], { nextSkipCount: 100 }, 'a client parsing block 0 alone learns it too');
  } finally { await client.close(); mock.restore(); }
});

test('search_wlo_content (json): block 0 carries `totalIsUpperBound`, like structuredContent', async () => {
  const mock = installFetchMock((url, init): MockResult => {
    if (!url.includes('/ngsearch')) return { json: {} };
    const body = JSON.parse(String(init?.body ?? '{}')) as { facets?: unknown };
    // Records match and the answer has no facet block: the exact count is unknown.
    if (body.facets) return { json: { nodes: [], pagination: { total: 343, from: 0, count: 0 } } };
    return { json: {
      nodes: [makeNode('a', 'Bruchrechnung', { 'ccm:commonlicense_key': ['CC_BY'] })],
      pagination: { total: 343, from: 0, count: 1 },
    } };
  });
  const client = await connectedClient();
  try {
    const json = await client.callTool({ name: 'search_wlo_content', arguments: { query: '', license: 'CC BY', outputFormat: 'json' } });
    assert.equal(structured(json)['totalIsUpperBound'], true);
    assert.equal(JSON.parse(block(json))['totalIsUpperBound'], true);
  } finally { await client.close(); mock.restore(); }
});

// ── Findings 8 and 10: get_collection_contents, includeSubcollections ───────

const listing = (ids: string[], total = ids.length): MockResult => ({
  json: { nodes: ids.map(id => makeNode(id, `Titel ${id}`)), pagination: { total, from: 0, count: ids.length } },
});

function tree(files: (id: string) => MockResult, folders: (id: string) => string[] | MockResult) {
  return installFetchMock((url) => {
    const u = new URL(url);
    const id = decodeURIComponent(u.pathname.match(/-home-\/([^/]+)\/children/)?.[1] ?? '');
    if (!id) return { json: {} };
    if (u.searchParams.get('filter') !== 'folders') return files(id);
    const subs = folders(id);
    return Array.isArray(subs) ? listing(subs) : subs;
  });
}

/** A sub-LISTING that does not answer: what the walk reports as `incomplete`. */
const DOWN: MockResult = { status: 503, json: {} };

test('get_collection_contents: a sub-listing that did not answer is said IN block 0 (markdown), and as a flag in JSON block 0', async () => {
  const mock = tree(
    id => (id === 'good' ? listing(['a', 'b']) : listing([])),
    id => (id === 'root' ? ['good', 'bad'] : id === 'bad' ? DOWN : []),
  );
  const client = await connectedClient();
  try {
    const args = { nodeId: 'root', includeSubcollections: true };
    const md = await client.callTool({ name: 'get_collection_contents', arguments: args });
    assert.match(block(md), /Titel a/, 'the rows are there');
    assert.match(block(md), /ließ sich gerade nicht lesen/, 'and the notice is in the same block');
    assert.equal(structured(md)['incomplete'], true);

    const json = await client.callTool({ name: 'get_collection_contents', arguments: { ...args, outputFormat: 'json' } });
    assert.equal(JSON.parse(block(json))['incomplete'], true, 'block 0 stays pure JSON and carries the flag');
  } finally { await client.close(); mock.restore(); }
});

test('get_collection_contents: an unanswered sub-listing over NO rows is still said in block 0', async () => {
  const mock = tree(() => listing([]), id => (id === 'root' ? ['bad'] : id === 'bad' ? DOWN : []));
  const client = await connectedClient();
  try {
    const md = await client.callTool({ name: 'get_collection_contents', arguments: { nodeId: 'root', includeSubcollections: true } });
    assert.match(block(md), /ließ sich gerade nicht lesen/);
    assert.doesNotMatch(block(md), /Sammlung ist leer/);
  } finally { await client.close(); mock.restore(); }
});

/**
 * `root` holds `n` files spread over sub-collections of 50 each — the walk reads
 * ONE page of 50 per collection, so a long list needs many collections.
 */
function longCollection(n: number) {
  const subs = Array.from({ length: n / 50 }, (_, i) => `sub-${i}`);
  return tree(
    id => (id.startsWith('sub-') ? listing(Array.from({ length: 50 }, (_, k) => `${id}-f${k}`)) : listing([])),
    id => (id === 'root' ? subs : []),
  );
}

test('get_collection_contents (recursive): the page whose NEXT offset is past the bound says so — before anyone sends it', async () => {
  const mock = longCollection(1000);
  const client = await connectedClient();
  try {
    const base = { nodeId: 'root', includeSubcollections: true, maxResults: 50 };
    const before = await client.callTool({ name: 'get_collection_contents', arguments: { ...base, skipCount: RECURSIVE_SKIP_MAX - 50 } });
    assert.equal(structured(before)['count'], 50);
    assert.equal(structured(before)['skipLimitReached'], undefined, `the next offset (${RECURSIVE_SKIP_MAX}) is still taken`);

    const last = await client.callTool({ name: 'get_collection_contents', arguments: { ...base, skipCount: RECURSIVE_SKIP_MAX } });
    assert.equal(structured(last)['count'], 50);
    assert.equal(structured(last)['skipLimitReached'], true, 'the list goes on and the next offset would not be taken');
    assert.match(block(last), new RegExp(`skipCount reicht hier nur bis ${RECURSIVE_SKIP_MAX}`), 'said in block 0');
    assert.doesNotMatch(block(last), /beginnt dort, nicht bei/, 'this page was NOT clamped — that sentence would be false');

    const json = await client.callTool({ name: 'get_collection_contents', arguments: { ...base, skipCount: RECURSIVE_SKIP_MAX, outputFormat: 'json' } });
    assert.equal(JSON.parse(block(json))['skipLimitReached'], true);
  } finally { await client.close(); mock.restore(); }
});

test('get_collection_contents (recursive): a list that ENDS on the last reachable page is an end, not a limit', async () => {
  const mock = longCollection(RECURSIVE_SKIP_MAX + 50);
  const client = await connectedClient();
  try {
    const last = await client.callTool({ name: 'get_collection_contents', arguments: { nodeId: 'root', includeSubcollections: true, maxResults: 50, skipCount: RECURSIVE_SKIP_MAX } });
    assert.equal(structured(last)['count'], 50);
    assert.equal(structured(last)['skipLimitReached'], undefined);
  } finally { await client.close(); mock.restore(); }
});

// ── Finding 10: list_collection_tree, page sizes that do not divide the bound ──

const branch = (id: string, title: string) =>
  ({ ref: { id }, type: 'ccm:map', aspects: ['ccm:collection'], properties: { 'cm:title': [title] } });

function flat(n: number) {
  const children = Array.from({ length: n }, (_, i) => branch(`c-${i}`, `Kind ${i}`));
  return installFetchMock((url): MockResult => {
    const u = new URL(url);
    const id = decodeURIComponent(u.pathname.match(/-home-\/([^/]+)\//)?.[1] ?? '');
    if (url.includes('/metadata')) return { json: { node: branch(id, `Titel ${id}`) } };
    if (!url.includes('/children')) return { json: {} };
    const all = id === 'top' ? children : [];
    const skip = Number(u.searchParams.get('skipCount') ?? 0);
    const nodes = all.slice(skip, skip + Number(u.searchParams.get('maxItems') ?? 100));
    return { json: { nodes, pagination: { total: all.length, from: skip, count: nodes.length } } };
  });
}

test('list_collection_tree: a page that steps PAST the bound still names the last offset that is taken', async () => {
  const mock = flat(900);
  try {
    const read = (skipCount: number, maxItems: number) =>
      listCollectionTree({ rootId: 'top', depth: 1, maxItems, skipCount, includeContentCounts: false });
    // 450 + 100 = 550 is refused — but 500 is taken, and reaches entries 550–599.
    const tree = await read(FLAT_TREE_SKIP_MAX - 50, 100);
    assert.deepEqual(tree.more, { nextSkipCount: FLAT_TREE_SKIP_MAX });
    assert.equal(tree.skipLimitReached, undefined, 'never beside `more`');

    const last = await read(FLAT_TREE_SKIP_MAX, 100);
    assert.equal(last.more, undefined);
    assert.equal(last.skipLimitReached, true, 'from the bound itself there is no further offset');
    assert.equal(last.items[0]!.nodeId, 'c-500');
  } finally { mock.restore(); }
});

test('list_collection_tree (tool): the overlapping last page is announced as such', async () => {
  const mock = flat(900);
  const client = await connectedClient();
  try {
    const md = await client.callTool({ name: 'list_collection_tree', arguments: { nodeId: 'top', depth: 1, skipCount: FLAT_TREE_SKIP_MAX - 50, maxItems: 100 } });
    assert.match(block(md), new RegExp(`nächste Seite mit skipCount=${FLAT_TREE_SKIP_MAX}`));
    assert.match(block(md), /50 Einträge .*wiederholen/, 'the caller is told the pages overlap');
    assert.doesNotMatch(block(md), /nicht abrufbar/);
  } finally { await client.close(); mock.restore(); }
});
