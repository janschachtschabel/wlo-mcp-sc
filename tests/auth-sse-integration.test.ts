/**
 * auth-sse-integration.test.ts – the per-request credential survives the REAL
 * transport in SSE mode.
 *
 * The design named this as a risk in its own words: "SSE response mode breaks
 * ALS propagation". Production runs `MCP_SSE=1`, where the SDK converts the
 * request into a Web `Request`, answers with a `ReadableStream`, and runs the
 * tool handler somewhere inside that machinery. The unit test in
 * `auth-per-user.test.ts` exercises AsyncLocalStorage in isolation and would
 * stay green even if that propagation broke — and the failure would be silent:
 * every per-user request would quietly fall back to the service account.
 *
 * So this drives a real `node:http` server end to end. Offline: the repository
 * is faked and answers as whoever the forwarded credential claims to be.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { createHttpRequestHandler } from '../src/http-app.js';
import { createDistinctValueLimiter, createRateLimiter } from '../src/rate-limit.js';
import { streamableHttpOptions } from '../src/mcp-transport.js';
import { setServiceCredentialForTest } from '../src/auth/credential.js';

const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;

/**
 * Fake repository that mirrors the credential back as the identity, so the tool
 * result states exactly whose rights the upstream call carried. `delayMs` lets
 * one request sit in flight while another runs — that overlap is the whole
 * point of the concurrency case.
 */
function fakeRepository(delayMs: (user: string) => number) {
  const real = globalThis.fetch;
  const seen: { user: string }[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input);
    if (url.startsWith('http://127.0.0.1')) return real(input as string, init);
    const auth = new Headers(init?.headers ?? {}).get('authorization');
    const user = auth?.startsWith('Basic ')
      ? Buffer.from(auth.slice(6), 'base64').toString('utf8').split(':')[0] ?? ''
      : 'esguest';
    seen.push({ user });
    await new Promise(r => setTimeout(r, delayMs(user)));
    return new Response(JSON.stringify({ person: { authorityName: user } }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return { seen, restore: () => { globalThis.fetch = real; } };
}

function startSseServer(): Promise<{ server: http.Server; base: string; realFetch: typeof fetch }> {
  const realFetch = globalThis.fetch;
  const server = http.createServer(createHttpRequestHandler({
    rateLimiter: createRateLimiter(0),
    apiRateLimiter: createRateLimiter(0),
    authAbuseLimiter: createDistinctValueLimiter(0),
    maxBodyBytes: 1_048_576,
    trustProxy: false,
    // The production setting: real Server-Sent-Events, not a single JSON body.
    streamOptions: streamableHttpOptions({ MCP_SSE: '1' }),
  }));
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, base: `http://127.0.0.1:${port}`, realFetch });
    });
  });
}

const close = (s: http.Server) => new Promise<void>((r) => { s.close(() => r()); });

/** Parse the JSON-RPC payload out of the SSE frames of one response. */
function parseSse(raw: string): { structuredContent?: Record<string, unknown> } {
  const line = raw.split(/\r?\n/).find(l => l.startsWith('data: '));
  assert.ok(line, `no SSE data frame in response: ${raw.slice(0, 200)}`);
  return (JSON.parse(line.slice(6)) as { result?: { structuredContent?: Record<string, unknown> } }).result ?? {};
}

/** initialize + wlo_auth_status as one user, over SSE. */
async function statusAs(base: string, realFetch: typeof fetch, user: string) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'Authorization': basic(user, 'pw'),
  };
  const body = (id: number, method: string, params: unknown) =>
    JSON.stringify({ jsonrpc: '2.0', id, method, params });

  await realFetch(`${base}/mcp`, {
    method: 'POST', headers,
    body: body(1, 'initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'sse-test', version: '0.0.0' },
    }),
  }).then(r => r.text());

  const res = await realFetch(`${base}/mcp`, {
    method: 'POST', headers,
    body: body(2, 'tools/call', { name: 'wlo_auth_status', arguments: {} }),
  });
  assert.equal(res.headers.get('content-type'), 'text/event-stream', 'this must be the SSE path');
  return parseSse(await res.text()).structuredContent ?? {};
}

test('SSE: the per-user credential reaches the upstream call', async () => {
  const { server, base, realFetch } = await startSseServer();
  const repo = fakeRepository(() => 0);
  try {
    const sc = await statusAs(base, realFetch, 'anna');
    assert.equal(sc['mode'], 'user', 'the call must resolve to the per-user rung');
    assert.equal(sc['configuredAs'], 'anna');
    assert.deepEqual(repo.seen.map(s => s.user), ['anna'], 'upstream saw anna, not a guest');
  } finally { repo.restore(); await close(server); }
});

test('SSE: concurrent requests from different users never bleed', async () => {
  const { server, base, realFetch } = await startSseServer();
  // anna's upstream call is slow, so bruno and carla run entirely inside her
  // in-flight window — the interleaving that a broken context would expose.
  const repo = fakeRepository(user => (user === 'anna' ? 60 : 5));
  try {
    const [anna, bruno, carla] = await Promise.all([
      statusAs(base, realFetch, 'anna'),
      statusAs(base, realFetch, 'bruno'),
      statusAs(base, realFetch, 'carla'),
    ]);
    assert.equal(anna['configuredAs'], 'anna');
    assert.equal(bruno['configuredAs'], 'bruno');
    assert.equal(carla['configuredAs'], 'carla');
    assert.equal(anna['authority'], 'anna', 'and the identity came back for the right user');
    assert.equal(bruno['authority'], 'bruno');
    assert.equal(carla['authority'], 'carla');
  } finally { repo.restore(); await close(server); }
});

test('SSE: a per-user credential overrides the service account for that request only', async () => {
  const { server, base, realFetch } = await startSseServer();
  const repo = fakeRepository(() => 0);
  setServiceCredentialForTest({ header: basic('dienst', 'x'), label: 'dienst', source: 'service' });
  try {
    const sc = await statusAs(base, realFetch, 'anna');
    assert.equal(sc['mode'], 'user', 'the user wins over the configured service account');
    assert.equal(sc['configuredAs'], 'anna');
    assert.ok(!repo.seen.some(s => s.user === 'dienst'), 'the service account must not leak into her request');
  } finally { setServiceCredentialForTest(null); repo.restore(); await close(server); }
});
