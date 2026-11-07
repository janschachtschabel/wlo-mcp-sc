/**
 * Chatbot feedback 2026-11-07, point 2: a client that reads only
 * `structuredContent` must learn that a filter did not apply — the hint used to
 * ride in the text blocks and in `_queryMeta` alone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock, makeNode } from './fetchMock.js';

function mock() {
  return installFetchMock((url) => {
    if (url.includes('/collections') || url.includes('/children')) return { json: { nodes: [], pagination: { total: 0 } } };
    return { json: { nodes: [makeNode('a', 'Optik')], pagination: { total: 1, from: 0, count: 1 } } };
  });
}

type Structured = { unresolvedFilters?: Array<{ field: string; value: string; suggestions?: string[] }> };

for (const [name, args] of [
  ['search_wlo_content', { query: 'Optik', discipline: 'Fantasiefach' }],
  ['search_wlo_all', { query: 'Optik', discipline: 'Fantasiefach' }],
  ['search_wlo_collections', { query: 'Optik', discipline: 'Fantasiefach' }],
  ['search_wlo_within_collection', { nodeId: 'c1', query: 'Optik', discipline: 'Fantasiefach' }],
] as const) {
  test(`${name}: an unresolved filter is in structuredContent`, async () => {
    const m = mock();
    const client = await connectedClient();
    try {
      const r = await client.callTool({ name, arguments: args });
      const s = r.structuredContent as Structured;
      assert.equal(s.unresolvedFilters?.[0]?.value, 'Fantasiefach');
      assert.equal(s.unresolvedFilters?.[0]?.field, 'discipline');
    } finally { await client.close(); m.restore(); }
  });
}

test('search_wlo_content: no field when every filter resolved', async () => {
  const m = mock();
  const client = await connectedClient();
  try {
    const r = await client.callTool({ name: 'search_wlo_content', arguments: { query: 'Optik' } });
    assert.equal('unresolvedFilters' in (r.structuredContent as object), false);
  } finally { await client.close(); m.restore(); }
});

test('the field is declared in the advertised outputSchema', async () => {
  const client = await connectedClient();
  try {
    const { tools } = await client.listTools();
    for (const n of ['search_wlo_content', 'search_wlo_all', 'search_wlo_collections', 'search_wlo_within_collection']) {
      const props = (tools.find(t => t.name === n)?.outputSchema as { properties?: Record<string, unknown> })?.properties ?? {};
      assert.ok('unresolvedFilters' in props, `${n} declares unresolvedFilters`);
      assert.ok('facets' in props, `${n} declares facets`);
    }
  } finally { await client.close(); }
});
