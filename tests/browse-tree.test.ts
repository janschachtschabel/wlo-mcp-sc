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
