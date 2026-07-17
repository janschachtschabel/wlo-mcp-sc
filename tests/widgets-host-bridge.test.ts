import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rpcToolCall, parseInbound, settleCallResponse } from '../src/apps/widgets/shared/host-bridge.js';

test('rpcToolCall builds a JSON-RPC 2.0 tools/call request', () => {
  assert.deepEqual(rpcToolCall(7, 'browse_collection_tree', { nodeId: 'n1' }), {
    jsonrpc: '2.0',
    id: 7,
    method: 'tools/call',
    params: { name: 'browse_collection_tree', arguments: { nodeId: 'n1' } },
  });
});

test('parseInbound classifies a ui/notifications/tool-result and extracts the output', () => {
  const out = parseInbound({ method: 'ui/notifications/tool-result', params: { structuredContent: { results: [1] } } });
  assert.equal(out.kind, 'tool-result');
  assert.deepEqual((out as { output: unknown }).output, { results: [1] });
});

test('parseInbound classifies a JSON-RPC call response by id', () => {
  const r = parseInbound({ jsonrpc: '2.0', id: 3, result: { structuredContent: { results: [] } } });
  assert.equal(r.kind, 'call-response');
  assert.equal((r as { id: number }).id, 3);
});

test('settleCallResponse resolves with the result when there is no error', () => {
  let resolved: unknown;
  let rejected: unknown;
  settleCallResponse({ result: { structuredContent: { results: [1] } } },
    { resolve: r => { resolved = r; }, reject: e => { rejected = e; } });
  assert.deepEqual(resolved, { structuredContent: { results: [1] } });
  assert.equal(rejected, undefined);
});

test('settleCallResponse rejects with an Error when the response carries a JSON-RPC error', () => {
  let resolved: unknown;
  let rejected: unknown;
  settleCallResponse({ error: { code: -32000, message: 'boom' } },
    { resolve: r => { resolved = r; }, reject: e => { rejected = e; } });
  assert.equal(resolved, undefined);
  assert.ok(rejected instanceof Error);
  assert.match((rejected as Error).message, /boom/);
});

test('parseInbound returns unknown for unrelated/garbage messages', () => {
  assert.equal(parseInbound(null).kind, 'unknown');
  assert.equal(parseInbound({ foo: 'bar' }).kind, 'unknown');
  assert.equal(parseInbound('nope').kind, 'unknown');
});
