import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock, makeNode } from './fetchMock.js';

test('search_wlo_within_collection: returns scoped results and sends the parent criterion', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/ngsearch')) {
      return { json: { nodes: [makeNode('a', 'Zellteilung erklärt')], pagination: { total: 1, from: 0, count: 1 } } };
    }
    return { json: {} };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_within_collection',
      arguments: { nodeId: 'coll-99', query: 'zellteilung' },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    assert.match(text, /Zellteilung erklärt/);

    const call = mock.calls.find(c => c.url.includes('/ngsearch'));
    const body = JSON.parse(String(call?.init?.body ?? '{}'));
    assert.ok(body.criteria.some((c: { property: string; values: string[] }) =>
      c.property === 'virtual:primaryparent_nodeid' && c.values.includes('coll-99')));
  } finally {
    await client.close();
    mock.restore();
  }
});
