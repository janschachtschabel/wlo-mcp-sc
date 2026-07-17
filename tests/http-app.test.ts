/**
 * http-app.test.ts – the self-hosted HTTP dispatch (deep-audit #5): the
 * 429/413/400/405/404 wiring plus the MCP POST path, driven through a REAL
 * node:http server on an ephemeral port (no upstream network — MCP initialize
 * never touches the WLO API).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { createHttpRequestHandler } from '../src/http-app.js';
import type { HttpAppOptions } from '../src/http-app.js';
import { createRateLimiter } from '../src/rate-limit.js';
import { streamableHttpOptions } from '../src/mcp-transport.js';

function startServer(overrides: Partial<HttpAppOptions> = {}): Promise<{ server: http.Server; base: string }> {
  const handler = createHttpRequestHandler({
    rateLimiter: createRateLimiter(0),
    apiRateLimiter: createRateLimiter(0),
    maxBodyBytes: 1_048_576,
    trustProxy: false,
    streamOptions: streamableHttpOptions({}), // JSON response mode
    ...overrides,
  });
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

const close = (s: http.Server) => new Promise<void>((r) => { s.close(() => r()); });

const INITIALIZE = JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dispatch-test', version: '0.0.0' } },
});

test('http dispatch: GET /health → 200 ok (no rate limit)', async () => {
  const { server, base } = await startServer();
  try {
    const r = await fetch(`${base}/health`);
    assert.equal(r.status, 200);
    assert.equal((await r.json() as { status: string }).status, 'ok');
  } finally { await close(server); }
});

test('http dispatch: OPTIONS preflight → 204 with CORS headers', async () => {
  const { server, base } = await startServer();
  try {
    const r = await fetch(`${base}/mcp`, { method: 'OPTIONS' });
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
  } finally { await close(server); }
});

test('http dispatch: GET /mcp → 405 with Allow: POST', async () => {
  const { server, base } = await startServer();
  try {
    const r = await fetch(`${base}/mcp`);
    assert.equal(r.status, 405);
    assert.equal(r.headers.get('allow'), 'POST');
  } finally { await close(server); }
});

test('http dispatch: unknown path → 404', async () => {
  const { server, base } = await startServer();
  try {
    const r = await fetch(`${base}/does-not-exist`);
    assert.equal(r.status, 404);
  } finally { await close(server); }
});

test('http dispatch: GET / serves the launcher HTML', async () => {
  const { server, base } = await startServer();
  try {
    const r = await fetch(`${base}/`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') ?? '', /text\/html/);
  } finally { await close(server); }
});

test('http dispatch: POST /mcp with invalid JSON → 400', async () => {
  const { server, base } = await startServer();
  try {
    const r = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
    assert.equal(r.status, 400);
  } finally { await close(server); }
});

test('http dispatch: POST body over maxBodyBytes → 413', async () => {
  const { server, base } = await startServer({ maxBodyBytes: 32 });
  try {
    const r = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(100) });
    assert.equal(r.status, 413);
  } finally { await close(server); }
});

test('http dispatch: second MCP request over the per-IP limit → 429 with Retry-After', async () => {
  const { server, base } = await startServer({ rateLimiter: createRateLimiter(1) });
  try {
    const first = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
    assert.equal(first.status, 400, 'first request passes the limiter');
    const second = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
    assert.equal(second.status, 429);
    assert.equal(second.headers.get('retry-after'), '60');
  } finally { await close(server); }
});

test('http dispatch: POST /mcp initialize → 200 JSON result (Accept normalized)', async () => {
  const { server, base } = await startServer();
  try {
    // Plain Accept (fetch default */*) — the handler must normalize it so the
    // SDK's both-types requirement cannot 406 a simple JSON client.
    const r = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: INITIALIZE,
    });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') ?? '', /application\/json/);
    const body = await r.json() as { result?: { serverInfo?: { name?: string } } };
    assert.ok(body.result?.serverInfo?.name, 'initialize must return serverInfo');
  } finally { await close(server); }
});
