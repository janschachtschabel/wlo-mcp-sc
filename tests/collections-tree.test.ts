/**
 * collections-tree.test.ts – The tree-traversal FALLBACK of
 * search_wlo_collections (used when the direct keyword-collection search
 * returns nothing). The existing structured-content test only exercises the
 * fast path (direct hits), so this pins the level-1 → level-2 expansion:
 * a level-1 collection that does NOT match the query is expanded, and the
 * matching level-2 child is surfaced with queryType `collection_tree_traversal`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock, makeNode, toolText } from './fetchMock.js';
import { nodeListSchema } from '../src/apps/outputSchemas.js';

test('search_wlo_collections falls back to tree traversal and surfaces a level-2 match', async () => {
  const mock = installFetchMock((url) => {
    // Direct keyword-collection search misses → force the fallback.
    if (url.includes('/collections')) return { json: { nodes: [] } };
    if (url.includes('/children')) {
      // Level-2 children of the "Mathematik" parent: one matches "algebra".
      if (url.includes('math-parent')) {
        return { json: { nodes: [makeNode('alg', 'Algebra Grundlagen')] } };
      }
      if (url.includes('bio-parent')) return { json: { nodes: [] } };
      // Root children = level 1: neither matches "algebra".
      return { json: { nodes: [
        makeNode('math-parent', 'Mathematik'),
        makeNode('bio-parent', 'Biologie'),
      ] } };
    }
    return { json: { nodes: [] } };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'search_wlo_collections', arguments: { query: 'algebra' } });
    assert.match(toolText(result), /Algebra Grundlagen/);
    const sc = nodeListSchema.parse(result.structuredContent);
    assert.ok(sc.results.some(r => r.nodeId === 'alg'), 'level-2 match surfaced');
    // The query-meta block records the traversal path taken.
    assert.match(toolText(result), /collection_tree_traversal/);
  } finally { await client.close(); mock.restore(); }
});

test('search_wlo_collections: a collection reachable twice appears once (audit Q-2)', async () => {
  // Collections form a DAG: "alg" matches at level 1 AND is a child of the
  // "math-parent" portal. Without de-dup it appears twice with total 2.
  const mock = installFetchMock((url) => {
    if (url.includes('/collections')) return { json: { nodes: [] } };
    if (url.includes('/children')) {
      if (url.includes('math-parent')) return { json: { nodes: [makeNode('alg', 'Algebra Grundlagen')] } };
      if (url.includes('/alg/')) return { json: { nodes: [] } };
      // Root children (level 1): the match itself plus the portal that ALSO contains it.
      return { json: { nodes: [
        makeNode('alg', 'Algebra Grundlagen'),
        makeNode('math-parent', 'Mathematik'),
      ] } };
    }
    return { json: { nodes: [] } };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'search_wlo_collections', arguments: { query: 'algebra' } });
    const sc = nodeListSchema.parse(result.structuredContent);
    assert.equal(sc.results.filter(r => r.nodeId === 'alg').length, 1, 'duplicate collapsed to one row');
    assert.equal(sc.total, 1, 'total counts unique collections');
  } finally { await client.close(); mock.restore(); }
});
