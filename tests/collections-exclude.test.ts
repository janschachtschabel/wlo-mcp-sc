/**
 * collections-exclude.test.ts – excludeNodeIds on the DIRECT keyword path of
 * search_wlo_collections (audit Q-3): the fetch must over-provision by the
 * exclusion count (mirroring the content-search H1 fix), and a page whose
 * direct hits are ALL excluded must fall through to the tree traversal instead
 * of returning an empty result.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock, makeNode, toolText } from './fetchMock.js';
import { nodeListSchema } from '../src/apps/outputSchemas.js';

test('search_wlo_collections: excludeNodeIds does not shrink the page below maxResults (audit Q-3)', async () => {
  // Keyword pool holds three hits; the mock honours the requested maxItems, so
  // an exact-maxResults fetch (old behaviour) would return only [A, B] and the
  // exclusion of A would under-fill the page.
  const pool = [
    makeNode('A', 'Algebra Portal'),
    makeNode('B', 'Algebra Basics'),
    makeNode('C', 'Algebra Vertiefung'),
  ];
  const mock = installFetchMock((url) => {
    if (url.includes('/collections')) {
      const maxItems = Number(new URL(url).searchParams.get('maxItems') ?? '10');
      return { json: { nodes: pool.slice(0, maxItems) } };
    }
    return { json: { nodes: [] } };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_collections',
      arguments: { query: 'algebra', maxResults: 2, excludeNodeIds: ['A'] },
    });
    const sc = nodeListSchema.parse(result.structuredContent);
    assert.equal(sc.results.length, 2, 'page stays full despite the exclusion');
    assert.deepEqual(sc.results.map(r => r.nodeId).sort(), ['B', 'C']);
  } finally { await client.close(); mock.restore(); }
});

test('search_wlo_collections: all direct hits excluded → falls through to tree traversal (audit Q-3)', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/collections')) return { json: { nodes: [makeNode('A', 'Algebra Portal')] } };
    if (url.includes('/children')) {
      if (url.includes('math-parent')) return { json: { nodes: [makeNode('C', 'Algebra Grundlagen')] } };
      return { json: { nodes: [makeNode('math-parent', 'Mathematik')] } };
    }
    return { json: { nodes: [] } };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_collections',
      arguments: { query: 'algebra', excludeNodeIds: ['A'] },
    });
    const sc = nodeListSchema.parse(result.structuredContent);
    assert.ok(sc.results.some(r => r.nodeId === 'C'), 'tree-traversal result surfaced');
    assert.match(toolText(result), /collection_tree_traversal/);
  } finally { await client.close(); mock.restore(); }
});
