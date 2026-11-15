/**
 * upstream-busy.test.ts – edu-sharing itself is overloaded (plan 2026-11-07, S2b).
 *
 * A 429 or 503 from the repository is not a broken request: it is "busy, try
 * again shortly". It used to reach the caller as `upstream_error`, so a chatbot
 * could only say "that did not work". It is `upstream_busy` now, with the wait
 * the repository asked for (`Retry-After`) or a documented estimate of 10 s.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { upstreamErrorMessage } from '../src/upstream-error.js';
import { BUSY_RETRY_DEFAULT_S, failureCode, retryAfterOf } from '../src/services/failure-code.js';
import { codeOfStatus } from '../src/services/node-details.js';
import { connectedClient, installFetchMock } from './fetchMock.js';

const response = (status: number, headers: Record<string, string> = {}) =>
  new Response('', { status, statusText: status === 503 ? 'Service Unavailable' : 'Too Many Requests', headers });

test('the upstream error text carries the Retry-After the repository sent', () => {
  assert.equal(upstreamErrorMessage('ngsearch', response(503, { 'Retry-After': '12' })),
    'ngsearch failed: 503 Service Unavailable retry-after=12');
  assert.equal(upstreamErrorMessage('ngsearch', response(503)), 'ngsearch failed: 503 Service Unavailable');
  assert.equal(upstreamErrorMessage('ngsearch', response(503, { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' })),
    'ngsearch failed: 503 Service Unavailable', 'a date form is not a number of seconds — left out, not guessed');
});

test('429 and 503 are upstream_busy; the wait comes from the text or is the estimate', () => {
  assert.equal(failureCode(new Error('ngsearch failed: 503 Service Unavailable retry-after=12')), 'upstream_busy');
  assert.equal(failureCode(new Error('ngsearch failed: 429 Too Many Requests')), 'upstream_busy');
  assert.equal(retryAfterOf(new Error('ngsearch failed: 503 Service Unavailable retry-after=12')), 12);
  assert.equal(retryAfterOf(new Error('ngsearch failed: 429 Too Many Requests')), BUSY_RETRY_DEFAULT_S);
  assert.equal(BUSY_RETRY_DEFAULT_S, 10);
  assert.equal(failureCode(new Error('ngsearch failed: 500 Internal Server Error')), 'upstream_error');
  assert.equal(failureCode(new Error('ngsearch failed: 403 Forbidden')), 'forbidden');
});

test('a node read answering 429/503 is upstream_busy, not upstream_error', () => {
  assert.equal(codeOfStatus(503), 'upstream_busy');
  assert.equal(codeOfStatus(429), 'upstream_busy');
  assert.equal(codeOfStatus(500), 'upstream_error');
  assert.equal(codeOfStatus(404), 'not_found');
});

test('a search tool against a busy repository answers upstream_busy with retryAfter', async () => {
  const mock = installFetchMock(() => ({ status: 503, headers: { 'Retry-After': '7' }, text: 'busy' }));
  const c = await connectedClient();
  try {
    const r = await c.callTool({ name: 'search_wlo_content', arguments: { query: 'Optik' } });
    const error = (r.structuredContent as { error?: { code?: string; retryAfter?: number } }).error;
    assert.equal(r.isError, true);
    assert.deepEqual([error?.code, error?.retryAfter], ['upstream_busy', 7]);
  } finally { await c.close(); mock.restore(); }
});

test('get_node_details with nodeIds names a busy read as upstream_busy in missing', async () => {
  const mock = installFetchMock(() => ({ status: 503, text: 'busy' }));
  const c = await connectedClient();
  try {
    const r = await c.callTool({ name: 'get_node_details', arguments: { nodeIds: ['n-1'] } });
    assert.notEqual(r.isError, true, 'the output schema accepts the code');
    assert.deepEqual((r.structuredContent as { missing: unknown[] }).missing, [{ part: 'n-1', code: 'upstream_busy' }]);
  } finally { await c.close(); mock.restore(); }
});

test('failureFields: every coded error from failureCode carries retryAfter when busy (review)', async () => {
  const { failureFields } = await import('../src/services/failure-code.js');
  assert.deepEqual(failureFields(new Error('ngsearch failed: 503 Service Unavailable retry-after=4')),
    { code: 'upstream_busy', retryAfter: 4 });
  assert.deepEqual(failureFields(new Error('kaputt')), { code: 'upstream_error' });
});

test('a status number elsewhere in the message is not the status — a Java line number stays a 500', async () => {
  assert.equal(failureCode(new Error('HTTP 500: at org.Impl.run(Impl.java:503)')), 'upstream_error');
  assert.equal(failureCode(new Error('ngsearch failed: 500 Internal Server Error retry-after=429')), 'upstream_error');
  assert.equal(failureCode(new Error('ngsearch failed: 503 Service Unavailable')), 'upstream_busy');
  assert.equal(failureCode(new Error('HTTP 429')), 'upstream_busy');
  assert.equal(failureCode(new Error('getNodeMetadata failed: 403 Forbidden')), 'forbidden');
  assert.equal(failureCode(new Error('breadcrumb: HTTP 401')), 'forbidden');
  assert.equal(failureCode(new Error('node 403abc missing')), 'upstream_error');
});

test('wlo_health_check against a busy repository says upstream_busy with retryAfter', async () => {
  // A real 503 is a RESOLVED Response, not a throw — the earlier version of
  // this test threw, and so proved only its own idea of the upstream.
  const mock = installFetchMock(() => ({ status: 503, text: 'busy' }));
  const c = await connectedClient();
  try {
    const r = await c.callTool({ name: 'wlo_health_check', arguments: {} });
    const error = (r.structuredContent as { error?: { code?: string; retryAfter?: number } }).error;
    assert.deepEqual([error?.code, error?.retryAfter], ['upstream_busy', 10]);
  } finally { await c.close(); mock.restore(); }
});
