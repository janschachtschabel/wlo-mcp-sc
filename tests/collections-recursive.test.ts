import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock, makeNode } from './fetchMock.js';

function resultsOf(result: unknown): Array<{ nodeId: string }> {
  const parts = (result as { content?: Array<{ text?: string }> }).content ?? [];
  return JSON.parse(parts[0]!.text as string).results;
}

/**
 * Route the /children endpoint by nodeId (path) + filter (query). Two sub-
 * collections share node `n2` so the recursive walk must de-duplicate it.
 */
function installTwoSubcollectionsSharingANode() {
  const asNodes = (ids: string[]) => ({
    json: { nodes: ids.map(id => makeNode(id, `Titel ${id}`)), pagination: { total: ids.length, from: 0, count: ids.length } },
  });
  return installFetchMock((url) => {
    const u = new URL(url);
    const m = u.pathname.match(/-home-\/([^/]+)\/children/);
    const nodeId = m ? decodeURIComponent(m[1]!) : '';
    const filter = u.searchParams.get('filter');
    if (filter === 'folders') return asNodes(nodeId === 'root' ? ['subA', 'subB'] : []);
    // filter === 'files'
    if (nodeId === 'subA') return asNodes(['n1', 'n2']);
    if (nodeId === 'subB') return asNodes(['n2', 'n3']); // n2 also lives in subA
    return asNodes([]); // root has no direct files
  });
}

test('get_collection_contents: recursive mode returns a shared node only once (regression M2)', async () => {
  const mock = installTwoSubcollectionsSharingANode();
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'get_collection_contents',
      arguments: { nodeId: 'root', includeSubcollections: true, contentFilter: 'files', outputFormat: 'json' },
    });
    const ids = resultsOf(result).map(r => r.nodeId).sort();
    assert.deepEqual(ids, ['n1', 'n2', 'n3'], 'n2 (referenced in two sub-collections) must appear exactly once');
  } finally {
    await client.close();
    mock.restore();
  }
});

/**
 * A wide subtree that yields no result rows: every sub-collection is empty, so
 * the row counter never reaches maxResults and only a visit cap can stop the
 * walk. This is the realistic shape too — a curated tree where the same
 * references recur is de-duplicated into the same standstill.
 */
function installWideEmptySubtree(subCount: number) {
  const subs = Array.from({ length: subCount }, (_, i) => `sub-${i}`);
  const asNodes = (ids: string[]) => ({
    json: { nodes: ids.map(id => makeNode(id, `Titel ${id}`)), pagination: { total: ids.length, from: 0, count: ids.length } },
  });
  return installFetchMock((url) => {
    const u = new URL(url);
    const nodeId = decodeURIComponent(u.pathname.match(/-home-\/([^/]+)\/children/)?.[1] ?? '');
    if (u.searchParams.get('filter') === 'folders') return asNodes(nodeId === 'root' ? subs : []);
    return asNodes([]);
  });
}

test('get_collection_contents: recursive mode stops at the visit cap instead of crawling the whole subtree', async () => {
  // Without a cap the walk runs until the queue empties — two sequential
  // upstream calls per collection, continuing long after the caller has given
  // up. (This used to name "the client's own 30 s request timeout"; that number
  // came from `httpServer.requestTimeout`, which measured 2026-08-17 bounds
  // RECEIVING a request, not the work on it.)
  const mock = installWideEmptySubtree(200);
  const client = await connectedClient();
  try {
    await client.callTool({
      name: 'get_collection_contents',
      arguments: { nodeId: 'root', includeSubcollections: true, contentFilter: 'files', outputFormat: 'json' },
    });
    const visited = new Set(
      mock.calls
        .map(c => new URL(c.url).pathname.match(/-home-\/([^/]+)\/children/)?.[1])
        .filter((id): id is string => !!id),
    );
    // 50 = RECURSIVE_VISIT_MAX (root + 49 sub-collections). Uncapped: 201.
    assert.equal(visited.size, 50, 'the walk must stop at the visit cap');
  } finally {
    await client.close();
    mock.restore();
  }
});

test('get_collection_contents: recursive mode honors skipCount instead of silently dropping it', async () => {
  // Regression (deep-audit): the recursive branch ignored skipCount while
  // _queryMeta still reported it — page 2 repeated page 1.
  const mock = installTwoSubcollectionsSharingANode();
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'get_collection_contents',
      arguments: { nodeId: 'root', includeSubcollections: true, contentFilter: 'files', outputFormat: 'json', maxResults: 2, skipCount: 1 },
    });
    const ids = resultsOf(result).map(r => r.nodeId);
    assert.deepEqual(ids, ['n2', 'n3'], 'page 2 must continue after the first row, not repeat it');
  } finally {
    await client.close();
    mock.restore();
  }
});

/**
 * Audit 2026-11-12, P-3. The walk read one collection after the other — two
 * requests each, up to a hundred in series, which against a repository
 * answering in 300 ms is half a minute for one tool call. The collections of
 * one level are independent of each other, so they are read together; the
 * ORDER of the result is that of the tree, whichever answer came first.
 */
test('P-3: the collections of one level are read together — and the result keeps the order of the tree', async () => {
  const { collectRecursiveContents } = await import('../src/services/collection-traversal.js');
  const subs = Array.from({ length: 12 }, (_, i) => `sub-${String(i).padStart(2, '0')}`);
  const real = globalThis.fetch;
  let inFlight = 0;
  let most = 0;
  globalThis.fetch = (async (input: unknown) => {
    const url = new URL(String(input));
    const id = decodeURIComponent(url.pathname.match(/-home-\/([^/]+)\/children/)?.[1] ?? '');
    inFlight++;
    most = Math.max(most, inFlight);
    // Later collections answer FIRST, so an order taken from arrival would be reversed.
    await new Promise(r => setTimeout(r, id === 'root' ? 5 : 40 - Number(id.slice(4)) * 3));
    inFlight--;
    const folders = url.searchParams.get('filter') === 'folders';
    const nodes = folders
      ? (id === 'root' ? subs.map(s => ({ ref: { id: s }, properties: { 'cm:name': [s] } })) : [])
      : (id === 'root' ? [] : [{ ref: { id: `file-of-${id}` }, properties: { 'cclom:title': [`Datei ${id}`] } }]);
    return new Response(JSON.stringify({ nodes, pagination: { total: nodes.length, from: 0, count: nodes.length } }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const out = await collectRecursiveContents('root', 1000, new Set(), undefined);
    assert.ok(most > 2, `the level was read one request at a time (most in flight: ${most})`);
    assert.deepEqual(out.nodes.map(n => n.nodeId), subs.map(s => `file-of-${s}`), 'tree order, not arrival order');
    assert.equal(out.totalHits, 12);
  } finally {
    globalThis.fetch = real;
  }
});

test('P-3: a walk that has enough stops asking — a wide level is not read to its end for one row', async () => {
  const { collectRecursiveContents } = await import('../src/services/collection-traversal.js');
  const mock = installFetchMock((url) => {
    const u = new URL(url);
    const id = decodeURIComponent(u.pathname.match(/-home-\/([^/]+)\/children/)?.[1] ?? '');
    const folders = u.searchParams.get('filter') === 'folders';
    const nodes = folders
      ? (id === 'root' ? Array.from({ length: 40 }, (_, i) => ({ ref: { id: `s${i}` }, properties: {} })) : [])
      : (id === 'root' ? [] : [{ ref: { id: `f-${id}` }, properties: { 'cclom:title': ['x'] } }]);
    return { json: { nodes, pagination: { total: nodes.length, from: 0, count: nodes.length } } };
  });
  try {
    const out = await collectRecursiveContents('root', 3, new Set(), undefined);
    assert.equal(out.nodes.length, 3);
    const read = new Set(mock.calls.map(c => new URL(c.url).pathname.match(/-home-\/([^/]+)\/children/)?.[1]));
    assert.ok(read.size <= 1 + 8, `read ${read.size} collections for three rows`);
    assert.equal(out.totalHits, 3, 'and what the rest of a group answered is not counted — as the serial walk never asked');
  } finally {
    mock.restore();
  }
});
