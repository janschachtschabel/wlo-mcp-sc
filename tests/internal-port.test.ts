/**
 * internal-port.test.ts – the operator's paths on their own port (D10).
 *
 * `/health`, `/ready`, `/metrics` and nothing else: no MCP, no REST, no auth
 * pages. An addition — the public port keeps answering the three.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { createHttpRequestHandler } from '../src/http-app.js';
import { createInternalHandler } from '../src/rest/internal-port.js';
import { createDistinctValueLimiter, createRateLimiter } from '../src/rate-limit.js';
import { streamableHttpOptions } from '../src/mcp-transport.js';
import { renderMetrics, resetMetricsForTest } from '../src/metrics.js';

async function listening(handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }) };
}

test('the internal port answers /health like the public one', async () => {
  const internal = await listening(createInternalHandler());
  const pub = await listening(createHttpRequestHandler({
    rateLimiter: createRateLimiter(0), apiRateLimiter: createRateLimiter(0), authAbuseLimiter: createDistinctValueLimiter(0),
    maxBodyBytes: 1_048_576, trustProxy: false, streamOptions: streamableHttpOptions({}),
  }));
  try {
    const a = await fetch(`${internal.base}/health`);
    const b = await fetch(`${pub.base}/health`);
    assert.equal(a.status, 200);
    assert.deepEqual(await a.json(), await b.json(), 'one function answers both');
  } finally { await internal.close(); await pub.close(); }
});

test('the internal port serves /metrics without a token — unless one is configured', async () => {
  const open = await listening(createInternalHandler());
  try {
    const r = await fetch(`${open.base}/metrics`);
    assert.equal(r.status, 200);
    assert.match(await r.text(), /^wlo_build_info\{/m);
  } finally { await open.close(); }

  const token = 'a-token-of-sixteen-chars';
  const guarded = await listening(createInternalHandler({ metricsToken: token }));
  try {
    assert.equal((await fetch(`${guarded.base}/metrics`)).status, 401);
    assert.equal((await fetch(`${guarded.base}/metrics`, { headers: { authorization: `Bearer ${token}` } })).status, 200);
  } finally { await guarded.close(); }
});

test('the internal port serves NOTHING else — no MCP, no REST, no access pages', async () => {
  const internal = await listening(createInternalHandler());
  try {
    for (const [method, path] of [['POST', '/mcp'], ['GET', '/mcp'], ['GET', '/api/search?q=x'], ['GET', '/auth'],
      ['GET', '/'], ['POST', '/health'], ['GET', '/.well-known/oauth-authorization-server'], ['GET', '//[']] as const) {
      const r = await fetch(`${internal.base}${path}`, { method });
      assert.equal(r.status, 404, `${method} ${path}`);
    }
  } finally { await internal.close(); }
});

test('probes on the internal port are not counted as requests', async () => {
  resetMetricsForTest();
  const internal = await listening(createInternalHandler());
  try {
    await fetch(`${internal.base}/health`);
    await fetch(`${internal.base}/nope`);
    assert.doesNotMatch(renderMetrics(), /wlo_http_requests_total/);
  } finally { await internal.close(); }
});
