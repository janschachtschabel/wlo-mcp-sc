/**
 * browse-tree.test.ts – browse_collection_tree tree walk. Pins the shared-child
 * de-duplication: when two level-1 collections both list the same level-2 child
 * (a DAG), the child is emitted under exactly one parent — deterministically,
 * not raced (regression L16).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock, makeNode, toolText } from './fetchMock.js';

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

test('browse_collection_tree: a child shared by two parents is emitted once (regression L16)', async () => {
  const folders = (nodes: ReturnType<typeof makeNode>[]) => ({ json: { nodes } });
  const mock = installFetchMock((url) => {
    const u = new URL(url);
    const m = u.pathname.match(/-home-\/([^/]+)\/children/);
    const id = m ? decodeURIComponent(m[1]!) : '';
    if (id === 'root') return folders([makeNode('A', 'Alpha'), makeNode('B', 'Beta')]);
    if (id === 'A') return folders([makeNode('C', 'Gamma')]);
    if (id === 'B') return folders([makeNode('C', 'Gamma')]); // same child C under both
    return folders([]);
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'browse_collection_tree',
      arguments: { nodeId: 'root', depth: 2 },
    });
    assert.equal(countOccurrences(toolText(result), 'Gamma'), 1,
      'the shared child must appear under exactly one parent, not both');
  } finally {
    await client.close();
    mock.restore();
  }
});

test('browse_collection_tree: a top-level entry beyond the pool width is not also emitted as a child', async () => {
  // `n-10` is a direct child of root AND listed under `n-00`. The level-1 ids
  // used to be claimed by each node's own enrichOne, which runs synchronously
  // up to its first await — so the first TREE_CONCURRENCY (10) of them were
  // claimed before any I/O and the DAG check happened to work. Number 11 is
  // only claimed once a worker frees up, i.e. AFTER n-00 has fetched and
  // filtered its children, so it appeared twice: once nested, once top-level.
  const folders = (nodes: ReturnType<typeof makeNode>[]) => ({ json: { nodes } });
  const top = Array.from({ length: 11 }, (_, i) => {
    const n = String(i).padStart(2, '0');
    return makeNode(`n-${n}`, `Portal${n}`);
  });
  const mock = installFetchMock((url) => {
    const u = new URL(url);
    const m = u.pathname.match(/-home-\/([^/]+)\/children/);
    const id = m ? decodeURIComponent(m[1]!) : '';
    if (id === 'root') return folders(top);
    if (id === 'n-00') return folders([makeNode('n-10', 'Portal10')]);
    return folders([]);
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'browse_collection_tree',
      arguments: { nodeId: 'root', depth: 2, maxResults: 20 },
    });
    assert.equal(countOccurrences(toolText(result), 'Portal10'), 1,
      'a node asked for at the top level must not also appear nested under a sibling');
  } finally {
    await client.close();
    mock.restore();
  }
});
