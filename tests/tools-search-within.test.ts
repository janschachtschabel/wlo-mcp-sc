/**
 * tools-search-within.test.ts – the search_wlo_within_collection tool wrapper.
 *
 * Rewritten 2026-07-17: the previous test asserted that the tool sends a
 * `virtual:primaryparent_nodeid` ngsearch criterion. The live API rejects that
 * criterion with 400 Bad Request, so the tool was permanently broken in
 * production while this test stayed green — the mock answered a request the
 * real backend never accepts. The working scope is the collection's `/children`
 * listing with local matching (see services-search-within.test.ts).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock, makeNode, toolText } from './fetchMock.js';

test('search_wlo_within_collection: returns matches from the collection contents', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/children')) {
      return { json: { nodes: [
        makeNode('a', 'Zellteilung erklärt'),
        makeNode('b', 'Photosynthese'),
      ], pagination: { total: 2, from: 0, count: 2 } } };
    }
    return { json: {} };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_within_collection',
      arguments: { nodeId: 'coll-99', query: 'zellteilung' },
    });
    const text = toolText(result);
    assert.match(text, /Zellteilung erklärt/);
    assert.doesNotMatch(text, /Photosynthese/, 'non-matching contents are filtered out');
    assert.ok(!mock.calls.some(c => c.url.includes('/ngsearch')),
      'must not attempt the primaryparent-scoped search — the live API 400s on it');
  } finally {
    await client.close();
    mock.restore();
  }
});

test('search_wlo_within_collection: discloses a sampled search on a large collection', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/children')) {
      // 1 item returned, but the collection holds 500 → the answer is a sample.
      return { json: { nodes: [makeNode('a', 'Bruch Übung')], pagination: { total: 500, from: 0, count: 1 } } };
    }
    return { json: {} };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_within_collection',
      arguments: { nodeId: 'coll-big', query: 'bruch' },
    });
    assert.match(toolText(result), /ersten 100 von 500/, 'sampling must be visible to the caller');
  } finally {
    await client.close();
    mock.restore();
  }
});
