/**
 * tools-browse-depth3.test.ts – browse_collection_tree to depth 3, bounded
 * (BOERDi wishlist item 11, 2026-11-06).
 *
 * The chatbot compares a three-level outline with a collection, and the tree
 * stopped at two. Depth 3 multiplies: 15 branches × 10 × 10 would be 1 665
 * nodes and nested pools of 10 × 4 × 4 = 160 calls in flight. So: a fixed
 * total of 300 nodes, decided BEFORE the walk (same slice for every parent,
 * never a counter concurrent workers drain in arbitrary order), and the same
 * 40-in-flight bound depth 2 already had.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assertRejectsWithoutUpstream, connectedClient, makeNode } from './fetchMock.js';

const WIDTH = 20; // children per node, everywhere

interface TreeNode { nodeId: string; fileCount?: number; hasMoreChildren?: boolean; children?: TreeNode[] }

/** A tree WIDTH wide at every level; tracks how many calls are in flight. */
function installTree() {
  const real = globalThis.fetch;
  let inFlight = 0; let peak = 0;
  globalThis.fetch = (async (input: unknown) => {
    const url = String((input as { url?: string })?.url ?? input);
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    inFlight--;
    const parent = /nodes\/-home-\/([^/]+)\/children/.exec(url)?.[1] ?? '';
    const max = Number(new URL(url).searchParams.get('maxItems') ?? '50');
    const body = url.includes('filter=files')
      ? { nodes: [], pagination: { total: 7, from: 0, count: 0 } }
      : { nodes: Array.from({ length: Math.min(max, WIDTH) }, (_, i) => ({
          ...makeNode(`${parent}.${String(i).padStart(2, '0')}`, `${parent}.${String(i).padStart(2, '0')}`), type: 'ccm:map',
        })), pagination: { total: WIDTH, from: 0, count: Math.min(max, WIDTH) } };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { get peak() { return peak; }, restore: () => { globalThis.fetch = real; } };
}

function count(nodes: TreeNode[]): number {
  return nodes.reduce((n, x) => n + 1 + count(x.children ?? []), 0);
}
function maxDepth(nodes: TreeNode[], d = 1): number {
  return nodes.reduce((m, x) => Math.max(m, x.children?.length ? maxDepth(x.children, d + 1) : d), 0);
}

test('depth 3 reaches the third level, with counts on every level, never past 300 nodes', async () => {
  const probe = installTree();
  const c = await connectedClient();
  try {
    const r = await c.callTool({ name: 'browse_collection_tree', arguments: {
      nodeId: 'root', depth: 3, includeContentCounts: true, maxResults: 15, outputFormat: 'json',
    } });
    const sc = r.structuredContent as { results: TreeNode[]; truncated: boolean; truncatedAt?: string };
    assert.equal(maxDepth(sc.results), 3);
    assert.ok(count(sc.results) <= 300, `at most 300 nodes, got ${count(sc.results)}`);
    const third = sc.results[0]!.children![0]!.children![0]!;
    assert.equal(third.fileCount, 7, 'counts reach level 3');
    assert.equal(sc.truncated, true);
    assert.ok(sc.truncatedAt, 'names where the cut happened');
    assert.ok(probe.peak <= 40, `the 40-in-flight bound holds, saw ${probe.peak}`);
  } finally { await c.close(); probe.restore(); }
});

test('even the widest level 1 stays within 300', async () => {
  const probe = installTree();
  const c = await connectedClient();
  try {
    const r = await c.callTool({ name: 'browse_collection_tree', arguments: {
      nodeId: 'root', depth: 3, maxResults: 100, outputFormat: 'json',
    } });
    const sc = r.structuredContent as { results: TreeNode[] };
    assert.ok(count(sc.results) <= 300, `got ${count(sc.results)}`);
  } finally { await c.close(); probe.restore(); }
});

test('depth 4 is refused by the schema', async () => {
  const c = await connectedClient();
  try {
    await assertRejectsWithoutUpstream(c, 'browse_collection_tree', { nodeId: 'root', depth: 4 }, 'depth 4');
  } finally { await c.close(); }
});

test('a cut first level says so in the text, with the way out (review R-C)', async () => {
  const { installFetchMock, toolText } = await import('./fetchMock.js');
  const level1 = Array.from({ length: 4 }, (_, i) => ({ ...makeNode(`k${i}`, `Kind${i}`), type: 'ccm:map' }));
  const mock = installFetchMock((url) => {
    const u = new URL(url);
    if (!u.pathname.includes('/root/children')) return { json: { nodes: [] } };
    const max = Number(u.searchParams.get('maxItems') ?? '100');
    return { json: { nodes: level1.slice(0, max) } };
  });
  const c = await connectedClient();
  try {
    const r = await c.callTool({ name: 'browse_collection_tree', arguments: { nodeId: 'root', maxResults: 3 } });
    assert.match(toolText(r), /mehr als 3 Unterthemen.*maxResults/s);
    assert.equal((r.structuredContent as { truncatedAt?: string }).truncatedAt, 'root');
  } finally { await c.close(); mock.restore(); }
});
