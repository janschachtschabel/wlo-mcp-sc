/**
 * Read tools name WHY they refused (review of the 2026-11-07 changes, finding 3).
 * The net in `apps/tool-defaults.ts` gives an uncoded error `refused`; where a
 * tool knows the cause — a missing argument, a record that is not there, an
 * unreachable repository — it says so itself.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock } from './fetchMock.js';

const codeOf = (r: unknown) =>
  (r as { structuredContent?: { error?: { code?: string } } }).structuredContent?.error?.code;

function repository() {
  return installFetchMock((url) => {
    if (/nodes\/-home-\/locked\/metadata/.test(url)) return { status: 403, json: {} };
    if (/\/metadata/.test(url)) return { status: 404, json: {} };
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
}

for (const [name, args, code] of [
  ['browse_collection_tree', {}, 'invalid_input'],
  ['get_compendium_text', {}, 'invalid_input'],
  ['get_topic_page_content', {}, 'invalid_input'],
  ['get_node_collections', { nodeId: 'weg' }, 'not_found'],
  ['fetch', { id: 'weg' }, 'not_found'],
  ['fetch', { id: 'locked' }, 'forbidden'],
] as const) {
  test(`${name} ${JSON.stringify(args)} → ${code}`, async () => {
    const mock = repository();
    const c = await connectedClient();
    try {
      assert.equal(codeOf(await c.callTool({ name, arguments: args })), code);
    } finally { await c.close(); mock.restore(); }
  });
}

test('wlo_health_check with an unreachable repository → upstream_error', async () => {
  const mock = installFetchMock(() => { throw new Error('ECONNREFUSED'); });
  const c = await connectedClient();
  try {
    assert.equal(codeOf(await c.callTool({ name: 'wlo_health_check', arguments: {} })), 'upstream_error');
  } finally { await c.close(); mock.restore(); }
});
