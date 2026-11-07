/**
 * tools-node-details-many.test.ts – one detail tool for one id or many
 * (BOERDi wishlist item 8 / decision E3, 2026-11-06).
 *
 * Models reached for the single tool and called it again and again (58 chains
 * counted). With `nodeIds` the answer is ALWAYS a list `{results, missing}`;
 * with `nodeId` it keeps its old shape, so no existing caller changes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assertRejectsWithoutUpstream, connectedClient, installFetchMock, makeNode, toolText } from './fetchMock.js';

const KNOWN = new Set(['n-1', 'n-2', 'n-3']);

function repository() {
  return installFetchMock(url => {
    const id = /nodes\/-home-\/([^/]+)\/metadata/.exec(url)?.[1];
    if (id && KNOWN.has(id)) {
      return { json: { node: makeNode(id, `Titel ${id}`, { 'ccm:conditionsOfAccess': ['http://w3id.org/openeduhub/vocabs/conditionsOfAccess/no_login'] }) } };
    }
    if (id === 'locked') return { status: 403, json: {} };
    if (id) return { status: 404, json: {} };
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
}

interface ListAnswer {
  total: number; count: number;
  results: Array<{ nodeId: string; title: string; accessInfo?: unknown }>;
  missing?: Array<{ part: string; code: string }>;
}

test('nodeIds answers as a list, in the requested order, naming what was missing', async () => {
  const mock = repository();
  const c = await connectedClient();
  try {
    const r = await c.callTool({ name: 'get_node_details', arguments: { nodeIds: ['n-2', 'gone', 'n-1', 'n-2'] } });
    assert.notEqual(r.isError, true, toolText(r));
    const sc = r.structuredContent as unknown as ListAnswer;
    assert.deepEqual(sc.results.map(n => n.nodeId), ['n-2', 'n-1'], 'order kept, duplicates once');
    assert.deepEqual(sc.missing, [{ part: 'gone', code: 'not_found' }]);
    assert.equal(sc.count, 2);
    assert.match(toolText(r), /gone/, 'the text names the miss too');
  } finally { await c.close(); mock.restore(); }
});

test('the enrichments travel in structured content for every node', async () => {
  const mock = repository();
  const c = await connectedClient();
  try {
    const r = await c.callTool({ name: 'get_node_details', arguments: { nodeIds: ['n-1', 'n-3'], includeAccessInfo: true } });
    const sc = r.structuredContent as unknown as ListAnswer;
    assert.ok(sc.results.every(n => n.accessInfo !== undefined), JSON.stringify(sc.results));
  } finally { await c.close(); mock.restore(); }
});

test('nodeId keeps its old shape — no missing field, a list of one', async () => {
  const mock = repository();
  const c = await connectedClient();
  try {
    const r = await c.callTool({ name: 'get_node_details', arguments: { nodeId: 'n-1' } });
    const sc = r.structuredContent as unknown as ListAnswer;
    assert.equal(sc.total, 1);
    assert.equal('missing' in sc, false);
    assert.match(toolText(r), /## Titel n-1/, 'the single-record view is unchanged');
  } finally { await c.close(); mock.restore(); }
});

test('exactly one of nodeId and nodeIds', async () => {
  const mock = repository();
  const c = await connectedClient();
  try {
    for (const args of [{}, { nodeId: 'n-1', nodeIds: ['n-2'] }]) {
      const r = await c.callTool({ name: 'get_node_details', arguments: args });
      assert.equal(r.isError, true, JSON.stringify(args));
      assert.match(toolText(r), /nodeId oder nodeIds/);
    }
    assert.equal(mock.calls.length, 0, 'refused before any read');
  } finally { await c.close(); mock.restore(); }
});

test('at most fifty ids, enforced by the schema', async () => {
  const c = await connectedClient();
  try {
    await assertRejectsWithoutUpstream(c, 'get_node_details',
      { nodeIds: Array.from({ length: 51 }, (_, i) => `n-${i}`) }, '51 ids');
  } finally { await c.close(); }
});

test('get_nodes_details stays and points at the unified tool', async () => {
  const c = await connectedClient();
  try {
    const tool = (await c.listTools()).tools.find(t => t.name === 'get_nodes_details');
    assert.ok(tool);
    assert.match(tool.description ?? '', /get_node_details.*nodeIds/);
  } finally { await c.close(); }
});


test('missing says WHY per id: deleted and refused are not the same (E6, review R-C)', async () => {
  const mock = repository();
  const c = await connectedClient();
  try {
    const r = await c.callTool({ name: 'get_node_details', arguments: { nodeIds: ['n-1', 'gone', 'locked'] } });
    const sc = r.structuredContent as unknown as ListAnswer;
    assert.deepEqual(sc.missing, [{ part: 'gone', code: 'not_found' }, { part: 'locked', code: 'forbidden' }]);
    assert.match(toolText(r), /locked.*forbidden|forbidden.*locked/);
  } finally { await c.close(); mock.restore(); }
});

// ── Chatbot feedback 2026-11-07, point 9: one id, the same contract ──

test('nodeId: a miss names its code in missing, like nodeIds', async () => {
  const mock = repository();
  const c = await connectedClient();
  try {
    for (const [id, code] of [['gone', 'not_found'], ['locked', 'forbidden']] as const) {
      const r = await c.callTool({ name: 'get_node_details', arguments: { nodeId: id } });
      const s = r.structuredContent as ListAnswer;
      assert.equal(s.total, 0);
      assert.deepEqual(s.missing, [{ part: id, code }]);
    }
  } finally { await c.close(); mock.restore(); }
});

test('nodeId: the enrichments are in structuredContent in BOTH formats, not only in the JSON text', async () => {
  const mock = repository();
  const c = await connectedClient();
  try {
    for (const outputFormat of ['markdown', 'json']) {
      const r = await c.callTool({ name: 'get_node_details',
        arguments: { nodeId: 'n-1', includeAccessInfo: true, includeQualityInfo: true, includeParents: true, outputFormat } });
      const one = (r.structuredContent as { results: Array<Record<string, unknown>> }).results[0]!;
      assert.equal(typeof one['renderUrl'], 'string', `${outputFormat}: renderUrl`);
      assert.ok(one['accessInfo'], `${outputFormat}: accessInfo`);
      assert.ok('qualityInfo' in one, `${outputFormat}: qualityInfo`);
      assert.ok(Array.isArray(one['parents']), `${outputFormat}: parents`);
    }
  } finally { await c.close(); mock.restore(); }
});

test('nodeId and nodeIds together is invalid_input', async () => {
  const c = await connectedClient();
  try {
    const r = await c.callTool({ name: 'get_node_details', arguments: { nodeId: 'a', nodeIds: ['b'] } });
    assert.equal((r.structuredContent as { error?: { code?: string } }).error?.code, 'invalid_input');
  } finally { await c.close(); }
});
