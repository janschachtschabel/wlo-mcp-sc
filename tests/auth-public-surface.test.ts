/**
 * auth-public-surface.test.ts – the public REST layer stays anonymous.
 *
 * `GET /api/*` and the launcher are an UNAUTHENTICATED surface: anyone on the
 * internet may call them, and the design says they "stay anonymous-only". A
 * configured service account must therefore NOT reach them — otherwise every
 * non-public record that account can see becomes world-readable without any
 * login, which is a silent authorization downgrade nothing else would catch.
 *
 * The MCP endpoint is the opposite case and is asserted here too, so the two
 * surfaces can never be confused: there the credential is the whole point.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { createHttpRequestHandler } from '../src/http-app.js';
import { createDistinctValueLimiter, createRateLimiter } from '../src/rate-limit.js';
import { streamableHttpOptions } from '../src/mcp-transport.js';
import { setServiceCredentialForTest } from '../src/auth/credential.js';

const SERVICE = { header: 'Basic ZGllbnN0OmdlaGVpbQ==', label: 'dienst', source: 'service' as const };

/** Record the Authorization header of every UPSTREAM call (loopback passes through). */
function captureUpstream(): { auths: (string | null)[]; restore: () => void } {
  const real = globalThis.fetch;
  const auths: (string | null)[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input);
    if (url.startsWith('http://127.0.0.1')) return real(input as string, init);
    auths.push(new Headers(init?.headers ?? {}).get('authorization'));
    return new Response(JSON.stringify({ nodes: [], node: {}, person: { authorityName: 'dienst' } }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return { auths, restore: () => { globalThis.fetch = real; } };
}

function startServer(): Promise<{ server: http.Server; base: string; realFetch: typeof fetch }> {
  const realFetch = globalThis.fetch;
  const server = http.createServer(createHttpRequestHandler({
    rateLimiter: createRateLimiter(0),
    apiRateLimiter: createRateLimiter(0),
    authAbuseLimiter: createDistinctValueLimiter(0),
    maxBodyBytes: 1_048_576,
    trustProxy: false,
    streamOptions: streamableHttpOptions({}),
  }));
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, base: `http://127.0.0.1:${port}`, realFetch });
    });
  });
}

const close = (s: http.Server) => new Promise<void>((r) => { s.close(() => r()); });

test('the public REST layer never carries the service credential', async () => {
  const { server, base, realFetch } = await startServer();
  const cap = captureUpstream();
  setServiceCredentialForTest(SERVICE);
  try {
    const r = await realFetch(`${base}/api/search?query=test`);
    assert.equal(r.status, 200, 'the endpoint still works');
    assert.ok(cap.auths.length > 0, 'the request did reach the repository');
    for (const auth of cap.auths) {
      assert.equal(auth, null, 'an anonymous public request must stay anonymous upstream');
    }
  } finally { setServiceCredentialForTest(null); cap.restore(); await close(server); }
});

// The other half of this rule — that /api/* also ignores a CALLER-supplied
// Authorization header — is already covered in http-app.test.ts and is not
// repeated here. This file owns the case that was missing: the configured
// SERVICE account must not reach that surface either.

test('the MCP endpoint DOES use the service credential', async () => {
  // The counterpart: the fix must not disable the service account where it is
  // wanted, which is the whole point of the "one shared account" mode.
  const { server, base, realFetch } = await startServer();
  const cap = captureUpstream();
  setServiceCredentialForTest(SERVICE);
  try {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    };
    await realFetch(`${base}/mcp`, {
      method: 'POST', headers,
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } },
      }),
    }).then(r => r.text());
    await realFetch(`${base}/mcp`, {
      method: 'POST', headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'wlo_auth_status', arguments: {} } }),
    }).then(r => r.text());
    assert.ok(
      cap.auths.some(a => a === SERVICE.header),
      'the MCP path must still authenticate with the service account',
    );
  } finally { setServiceCredentialForTest(null); cap.restore(); await close(server); }
});
