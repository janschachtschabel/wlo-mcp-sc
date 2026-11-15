/**
 * tools-collections.test.ts – behaviour of the collection tools that is not
 * covered by the structuredContent contract tests.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock, makeNode, toolText } from './fetchMock.js';

test('searching a collection that holds only sub-collections explains the empty result', async () => {
  // Live: {nodeId: Mathematik-Portal, query:"Bruch"} answered "Gefundene
  // Treffer gesamt: 0" and nothing else — indistinguishable from "collection
  // does not exist" or "there is nothing". The matching runs over DIRECT files,
  // and a portal node has none; its children are sub-collections (audit
  // 2026-07-30).
  // Live shape (Mathematik portal, 2026-07-30): the direct listing is NOT
  // empty — 15 entries — none of which match the query, while 11 sub-
  // collections sit below. An earlier version of this test mocked
  // collectionTotal=0 and so validated the assumption instead of reality.
  const mock = installFetchMock((url) => {
    if (url.includes('folders')) {
      return {
        json: {
          nodes: [makeNode('sub-1', 'Algebra'), makeNode('sub-2', 'Geometrie')],
          pagination: { total: 11, from: 0, count: 2 },
        },
      };
    }
    return {
      json: {
        nodes: [makeNode('other-1', 'Etwas völlig anderes')],
        pagination: { total: 15, from: 0, count: 1 },
      },
    };
  });
  const client = await connectedClient();
  try {
    const r = await client.callTool({ name: 'search_wlo_within_collection', arguments: { nodeId: 'portal-1', query: 'Bruch' } });
    const text = toolText(r);
    assert.match(text, /Unter-Sammlung/i, 'the answer says WHY it is empty');
    assert.match(text, /get_collection_contents/, 'and names the way forward');
  } finally { await client.close(); mock.restore(); }
});
