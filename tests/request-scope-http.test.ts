/**
 * tests/request-scope-http.test.ts – a client that hangs up stops the work done for it.
 *
 * The unit tests (`upstream-gate.test.ts`) prove that `wloFetch` honours the
 * request scope. This one proves the scope is actually SET, by the HTTP layer,
 * for a real tool call over a real socket — the half a unit test cannot see.
 *
 * The client speaks node:http directly so that `globalThis.fetch` can be
 * replaced by one whose upstream answers are held open.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { clientGone, createHttpRequestHandler } from '../src/http-app.js';
import { createRateLimiter, createDistinctValueLimiter } from '../src/rate-limit.js';
import { streamableHttpOptions } from '../src/mcp-transport.js';
import { stopSkillRegistryCache } from '../src/services/skill-registry-cache.js';

interface Held { url: string; signal: AbortSignal | null | undefined }

/** Upstream calls stay open until the test ends; each records the signal it was sent with. */
function holdUpstream() {
  const real = globalThis.fetch;
  const held: Held[] = [];
  let onCall: (() => void) | undefined;
  globalThis.fetch = ((input: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    held.push({ url: String(input), signal: init?.signal });
    init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
    onCall?.();
  })) as typeof fetch;
  return {
    held,
    nextCall: () => new Promise<void>(resolve => { onCall = resolve; }),
    restore: () => { globalThis.fetch = real; },
  };
}

function startServer(opts: { sse?: boolean } = {}): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer(createHttpRequestHandler({
    rateLimiter: createRateLimiter(0),
    apiRateLimiter: createRateLimiter(0),
    authAbuseLimiter: createDistinctValueLimiter(0),
    maxBodyBytes: 1_048_576,
    trustProxy: false,
    // SSE is what production runs (MCP_SSE=1); JSON is the default of the code.
    streamOptions: streamableHttpOptions(opts.sse ? { MCP_SSE: '1' } : {}),
  }));
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port })));
}

const until = async (cond: () => boolean, ms = 2_000): Promise<boolean> => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return true; await new Promise(r => setTimeout(r, 10)); }
  return cond();
};

for (const sse of [false, true]) test(`a tool call whose client hangs up has its upstream call aborted (${sse ? 'SSE' : 'JSON'} answers)`, async () => {
  stopSkillRegistryCache();
  const upstream = holdUpstream();
  const { server, port } = await startServer({ sse });
  try {
    const called = upstream.nextCall();
    const req = http.request({
      host: '127.0.0.1', port, path: '/mcp', method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    });
    req.on('error', () => { /* the client itself destroys the socket below */ });
    req.end(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'get_node_details', arguments: { nodeId: 'a1b2c3d4-0000-4000-8000-000000000000' } },
    }));
    await called;
    assert.equal(upstream.held[0]!.signal?.aborted, false, 'while the client waits, the call runs');

    req.destroy();
    assert.ok(await until(() => upstream.held.every(h => h.signal?.aborted === true)),
      'once the client is gone, nothing keeps working for it');
    const sent = upstream.held.length;
    await new Promise(r => setTimeout(r, 150));
    assert.equal(upstream.held.length, sent, 'and nothing further is started');
  } finally {
    upstream.restore();
    server.closeAllConnections();
    await new Promise<void>(r => server.close(() => r()));
    stopSkillRegistryCache();
  }
});

test('a REST read whose client hangs up is aborted too', async () => {
  const upstream = holdUpstream();
  const { server, port } = await startServer();
  try {
    const called = upstream.nextCall();
    const req = http.request({ host: '127.0.0.1', port, path: '/api/search?q=Optik', method: 'GET' });
    req.on('error', () => { /* destroyed below */ });
    req.end();
    await called;
    req.destroy();
    assert.ok(await until(() => upstream.held.every(h => h.signal?.aborted === true)));
  } finally {
    upstream.restore();
    server.closeAllConnections();
    await new Promise<void>(r => server.close(() => r()));
    stopSkillRegistryCache();
  }
});

for (const sse of [false, true]) test(`an answered request aborts nothing — \`close\` after a finished response is not a hang-up (${sse ? 'SSE' : 'JSON'})`, async () => {
  const real = globalThis.fetch;
  const signals: Array<AbortSignal | null | undefined> = [];
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    signals.push(init?.signal);
    return new Response(JSON.stringify({ node: { ref: { id: 'x' }, type: 'ccm:io', properties: { 'cclom:title': ['T'] } } }),
      { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const { server, port } = await startServer({ sse });
  try {
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1', port, path: '/mcp', method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      }, res => { res.resume(); res.on('end', () => resolve(res.statusCode ?? 0)); });
      req.on('error', reject);
      req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_node_details', arguments: { nodeId: 'x' } } }));
    });
    assert.equal(status, 200);
    await new Promise(r => setTimeout(r, 100));
    assert.ok(signals.length > 0);
    // The per-call timeout signal may fire much later; the REQUEST signal must not have.
    assert.ok(signals.every(s => s?.aborted !== true), 'no signal was aborted by the ordinary end of the response');
  } finally {
    globalThis.fetch = real;
    server.closeAllConnections();
    await new Promise<void>(r => server.close(() => r()));
    stopSkillRegistryCache();
  }
});

test('a curation tool is NOT stopped by a hang-up — over a real server, with a real login header', async () => {
  // The behaviour, not the wiring: a write and its read-back run to their end
  // whoever is still listening. `wlo_delete_content` without a key reads the
  // record for its preview — one upstream call, made inside the curation seam.
  const upstream = holdUpstream();
  const { server, port } = await startServer();
  try {
    const called = upstream.nextCall();
    const req = http.request({
      host: '127.0.0.1', port, path: '/mcp', method: 'POST',
      headers: {
        'content-type': 'application/json', accept: 'application/json, text/event-stream',
        authorization: `Basic ${Buffer.from('maria:geheim').toString('base64')}`,
      },
    });
    req.on('error', () => { /* destroyed below */ });
    req.end(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'wlo_delete_content', arguments: { nodeId: 'a1b2c3d4-0000-4000-8000-000000000000' } },
    }));
    await called;
    req.destroy();
    await new Promise(r => setTimeout(r, 200));
    assert.ok(upstream.held.length > 0);
    assert.ok(upstream.held.every(h => h.signal?.aborted !== true), 'the abort would hit the response, not the work');
  } finally {
    upstream.restore();
    server.closeAllConnections();
    await new Promise<void>(r => server.close(() => r()));
    stopSkillRegistryCache();
  }
});

test('a client that hung up BEFORE the work began is seen too — its close event will not come again', () => {
  const never = { once: () => { throw new Error('must not wait for an event that already happened'); }, writableEnded: false, destroyed: true };
  assert.equal(clientGone(never as never).aborted, true);
  // A response that was answered and then closed is not a hang-up.
  const answered = { once: () => undefined, writableEnded: true, destroyed: true };
  assert.equal(clientGone(answered as never).aborted, false);
});
