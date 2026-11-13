/**
 * observability.test.ts – a request can be followed, and the process can be counted.
 *
 * Audit 2026-11-12, B-5. Three things the logs and the server could not say:
 *
 *   - which log lines belong to ONE request (a search fans out into a dozen
 *     upstream calls, and two concurrent requests interleave);
 *   - how many requests, tool calls and upstream calls there were, and how they
 *     ended — without grepping JSON lines;
 *   - and the id a caller was answered with, so "it failed at 14:02" becomes a
 *     line that can be found.
 *
 * `/metrics` is OFF unless a token is configured and answers only to it: what
 * tools are called how often is not a secret, but it is nobody else's business.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { createHttpRequestHandler } from '../src/http-app.js';
import { createDistinctValueLimiter, createRateLimiter } from '../src/rate-limit.js';
import { streamableHttpOptions } from '../src/mcp-transport.js';
import { count, observe, renderMetrics, resetMetricsForTest } from '../src/metrics.js';
import { requestIdFrom, runWithRequestId } from '../src/request-id.js';
import { metricsTokenFrom } from '../src/rest/metrics-route.js';
import { log } from '../src/logger.js';
import { wloFetch } from '../src/wlo-fetch.js';
import { WLO_REPOSITORY_URL } from '../src/wlo-config.js';
import { installFetchMock } from './fetchMock.js';

const TOKEN = 'metrics-token-of-sufficient-length';

/** Capture the structured log lines written while `fn` runs. */
async function captureLog(fn: () => Promise<void> | void): Promise<Record<string, unknown>[]> {
  const real = process.stderr.write.bind(process.stderr);
  const lines: string[] = [];
  process.stderr.write = ((chunk: unknown) => { lines.push(String(chunk)); return true; }) as typeof process.stderr.write;
  try { await fn(); } finally { process.stderr.write = real; }
  return lines
    .flatMap((l) => l.split('\n').filter(Boolean))
    .flatMap((l) => { try { return [JSON.parse(l) as Record<string, unknown>]; } catch { return []; } });
}

async function serving(opts: { metricsToken?: string } = {}) {
  const server = http.createServer(createHttpRequestHandler({
    rateLimiter: createRateLimiter(0), apiRateLimiter: createRateLimiter(0),
    authAbuseLimiter: createDistinctValueLimiter(0), maxBodyBytes: 1_048_576,
    trustProxy: false, streamOptions: streamableHttpOptions({}),
    ...(opts.metricsToken ? { metricsToken: opts.metricsToken } : {}),
  }));
  const base: string = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
  });
  return { base, close: () => new Promise<void>((r) => { server.close(() => r()); }) };
}

const rpc = (method: string, params: unknown) => JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
const post = (base: string, body: string, headers: Record<string, string> = {}) => fetch(`${base}/mcp`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
  body,
});

// ── request id ───────────────────────────────────────────────────────────────

test('every response carries a request id, and the log lines of that request carry the same one', async () => {
  const s = await serving();
  try {
    let id = '';
    const lines = await captureLog(async () => {
      const res = await post(s.base, rpc('tools/list', {}));
      id = res.headers.get('x-request-id') ?? '';
      await res.text();
    });
    assert.match(id, /^[A-Za-z0-9._-]{8,64}$/);
    const line = lines.find((l) => l['msg'] === 'mcp request');
    assert.ok(line, JSON.stringify(lines));
    assert.equal(line['req'], id);

    const health = await fetch(`${s.base}/health`);
    assert.ok(health.headers.get('x-request-id'), 'every route, not only /mcp');
    assert.notEqual(health.headers.get('x-request-id'), id, 'one id per request');
  } finally { await s.close(); }
});

test('a caller\'s own X-Request-Id is adopted when it is harmless — and replaced when it is not', async () => {
  const s = await serving();
  try {
    const kept = await fetch(`${s.base}/health`, { headers: { 'X-Request-Id': 'chatbot-7f3a.42' } });
    assert.equal(kept.headers.get('x-request-id'), 'chatbot-7f3a.42');
    // The id goes into every log line: anything that is not a plain token is
    // somebody writing into our log.
    for (const hostile of ['a b', '{"level":"error"}', 'x'.repeat(65), '']) {
      const res = await fetch(`${s.base}/health`, { headers: { 'X-Request-Id': hostile } });
      const got = res.headers.get('x-request-id') ?? '';
      assert.notEqual(got, hostile);
      assert.match(got, /^[A-Za-z0-9._-]{8,64}$/);
    }
  } finally { await s.close(); }
});

test('requestIdFrom / the logger: unit', async () => {
  assert.equal(requestIdFrom('abc-12345'), 'abc-12345');
  assert.notEqual(requestIdFrom('short'), 'short', 'too short to tell requests apart');
  assert.notEqual(requestIdFrom(['a', 'b']), 'a', 'a repeated header is not a token');
  assert.match(requestIdFrom(undefined), /^[a-f0-9]{16}$/);
  const outside = await captureLog(() => { log.info('no request'); });
  assert.equal('req' in outside[0]!, false, 'stdio and startup lines carry no id');
  const inside = await captureLog(() => runWithRequestId('r-1', async () => { await Promise.resolve(); log.info('in'); }));
  assert.equal(inside[0]!['req'], 'r-1', 'kept across awaits');
  const own = await captureLog(() => runWithRequestId('r-1', () => { log.info('in', { req: 'mine' }); }));
  assert.equal(own[0]!['req'], 'r-1', 'a field cannot overwrite the id');
});

// ── metrics ──────────────────────────────────────────────────────────────────

test('the metrics text: counters with labels, escaped, with HELP and TYPE', () => {
  resetMetricsForTest();
  count('wlo_http_requests_total', { route: 'mcp', status: '200' });
  count('wlo_http_requests_total', { route: 'mcp', status: '200' });
  count('wlo_http_requests_total', { route: 'api', status: '429' });
  count('wlo_tool_calls_total', { tool: 'we"ird\\na\nme', outcome: 'ok' });
  observe('wlo_tool_duration_seconds', { tool: 'search_wlo_all' }, 0.25);
  observe('wlo_tool_duration_seconds', { tool: 'search_wlo_all' }, 0.5);
  const text = renderMetrics();
  assert.match(text, /^# HELP wlo_http_requests_total .+$/m);
  assert.match(text, /^# TYPE wlo_http_requests_total counter$/m);
  assert.match(text, /^wlo_http_requests_total\{route="mcp",status="200"\} 2$/m);
  assert.match(text, /^wlo_http_requests_total\{route="api",status="429"\} 1$/m);
  assert.ok(text.includes('tool="we\\"ird\\\\na\\nme"'), text);
  assert.match(text, /^wlo_tool_duration_seconds_sum\{tool="search_wlo_all"\} 0\.75$/m);
  assert.match(text, /^wlo_tool_duration_seconds_count\{tool="search_wlo_all"\} 2$/m);
  assert.ok(text.endsWith('\n'));
});

test('/metrics does not exist without a token, and answers only to the token', async () => {
  const off = await serving();
  try { assert.equal((await fetch(`${off.base}/metrics`)).status, 404); }
  finally { await off.close(); }

  const on = await serving({ metricsToken: TOKEN });
  try {
    const none = await fetch(`${on.base}/metrics`);
    assert.equal(none.status, 401);
    assert.match(none.headers.get('www-authenticate') ?? '', /Bearer/);
    assert.equal((await fetch(`${on.base}/metrics`, { headers: { Authorization: `Bearer ${TOKEN}x` } })).status, 401);
    assert.equal((await fetch(`${on.base}/metrics`, { headers: { Authorization: `Basic ${TOKEN}` } })).status, 401);
    assert.equal((await fetch(`${on.base}/metrics`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` } })).status, 404,
      'GET only');
    const ok = await fetch(`${on.base}/metrics`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('content-type') ?? '', /^text\/plain; version=0\.0\.4/);
    const text = await ok.text();
    assert.match(text, /^wlo_build_info\{version="[^"]+"\} 1$/m);
    assert.match(text, /^process_uptime_seconds \d/m);
    assert.match(text, /^wlo_upstream_in_flight \d+$/m);
  } finally { await on.close(); }
});

test('a token too short to be a secret switches /metrics off rather than on', () => {
  assert.equal(metricsTokenFrom(undefined), undefined);
  assert.equal(metricsTokenFrom('   '), undefined);
  assert.equal(metricsTokenFrom('short'), undefined);
  assert.equal(metricsTokenFrom(` ${TOKEN} `), TOKEN);
});

test('requests and tool calls are counted — by route and outcome, never by caller', async () => {
  resetMetricsForTest();
  const s = await serving({ metricsToken: TOKEN });
  try {
    await (await post(s.base, rpc('tools/list', {}))).text();
    await (await post(s.base, rpc('tools/call', { name: 'lookup_wlo_vocabulary', arguments: { vocabulary: 'license' } }))).text();
    await (await fetch(`${s.base}/health`)).text();
    await (await fetch(`${s.base}/gibt-es-nicht`)).text();
    // The counter is written when the response closes; give the event a turn.
    await new Promise((r) => setTimeout(r, 20));
    const text = await (await fetch(`${s.base}/metrics`, { headers: { Authorization: `Bearer ${TOKEN}` } })).text();
    assert.match(text, /^wlo_http_requests_total\{route="mcp",status="200"\} 2$/m, text);
    assert.match(text, /^wlo_http_requests_total\{route="health",status="200"\} 1$/m);
    assert.match(text, /^wlo_http_requests_total\{route="other",status="404"\} 1$/m);
    assert.match(text, /^wlo_tool_calls_total\{tool="lookup_wlo_vocabulary",outcome="ok"\} 1$/m);
    assert.match(text, /^wlo_tool_duration_seconds_count\{tool="lookup_wlo_vocabulary"\} 1$/m);
    assert.doesNotMatch(text, /gibt-es-nicht/, 'a path a caller made up is not a label');
  } finally { await s.close(); }
});

test('upstream calls are counted by how they ended', async () => {
  resetMetricsForTest();
  let n = 0;
  const mock = installFetchMock(() => {
    n++;
    if (n === 1) return { json: {} };
    if (n === 2) return { status: 503, json: {} };
    throw new TypeError('fetch failed');
  });
  try {
    await wloFetch(`${WLO_REPOSITORY_URL}/rest/a`);
    await wloFetch(`${WLO_REPOSITORY_URL}/rest/b`);
    await assert.rejects(wloFetch(`${WLO_REPOSITORY_URL}/rest/c`));
    await wloFetch('https://de.wikipedia.org/x').catch(() => undefined);
    const text = renderMetrics();
    assert.match(text, /^wlo_upstream_requests_total\{outcome="2xx"\} 1$/m, text);
    assert.match(text, /^wlo_upstream_requests_total\{outcome="5xx"\} 1$/m);
    assert.match(text, /^wlo_upstream_requests_total\{outcome="error"\} 1$/m, 'only the repository is counted');
  } finally { mock.restore(); }
});
