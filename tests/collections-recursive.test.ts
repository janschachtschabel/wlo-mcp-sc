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
