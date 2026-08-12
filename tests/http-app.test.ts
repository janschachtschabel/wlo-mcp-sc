/**
 * http-app.test.ts – the self-hosted HTTP dispatch (deep-audit #5): the
 * 429/413/400/405/404 wiring plus the MCP POST path, driven through a REAL
 * node:http server on an ephemeral port (no upstream network — MCP initialize
 * never touches the WLO API).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';

import { createHttpRequestHandler } from '../src/http-app.js';
import type { HttpAppOptions } from '../src/http-app.js';
import { createDistinctValueLimiter, createRateLimiter } from '../src/rate-limit.js';
import { streamableHttpOptions } from '../src/mcp-transport.js';

function startServer(overrides: Partial<HttpAppOptions> = {}): Promise<{ server: http.Server; base: string }> {
  const handler = createHttpRequestHandler({
    rateLimiter: createRateLimiter(0),
    apiRateLimiter: createRateLimiter(0),
    authAbuseLimiter: createDistinctValueLimiter(0),
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

test('http dispatch: GET /health → 200 ok with the deployed widget build fingerprint', async () => {
  const { server, base } = await startServer();
  try {
    const r = await fetch(`${base}/health`);
    assert.equal(r.status, 200);
    const body = await r.json() as { status: string; widgets?: Record<string, string> };
    assert.equal(body.status, 'ok');
    // Deploy fingerprint (audit roadmap #3): the content-addressed widget
    // hashes identify the running build, so "is the fix actually deployed?"
    // is one curl instead of a byte-diff probe — two live test rounds were
    // wasted on stale builds before this existed (2026-07-17). Tolerant when
    // widgets are not built (fresh checkout): the field is present and every
    // entry, if any, is an 8-hex hash.
    assert.equal(typeof body.widgets, 'object');
    for (const [name, hash] of Object.entries(body.widgets ?? {})) {
      assert.match(hash, /^[0-9a-f]{8}$/, `${name} carries its build hash`);
    }
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

/**
 * The endpoint forwards a caller's `Authorization` header to the WLO repository,
 * which is why `authAbuseLimiter` caps how many DISTINCT logins one client may
 * present. That cap keys on the client IP — so advertising `Authorization` as a
 * cross-origin-allowed header hands an attacker a way around it: a web page can
 * make every visitor's browser send a different guess, each from its own address,
 * and read whether it worked (a write-capable login gets a longer `tools/list`).
 *
 * CORS constrains browsers and nothing else. Every real client of this endpoint —
 * an AI host's connector, curl, the stdio bridge — is not a browser, and our own
 * launcher fetches without credentials. So the header list can drop it at no cost.
 */
test('the CORS policy does not invite a browser to relay credentials here', async () => {
  const { server, base } = await startServer();
  try {
    const r = await fetch(`${base}/mcp`, { method: 'OPTIONS' });
    const allowed = r.headers.get('access-control-allow-headers') ?? '';
    assert.doesNotMatch(allowed, /authorization/i, 'cross-origin credential relay stays closed');
    assert.match(allowed, /content-type/i, 'while an ordinary JSON client still preflights');
  } finally { await close(server); }
});

/**
 * The same reasoning one endpoint further, where dropping a header is not enough.
 *
 * `/auth/issue` and `/auth/revoke-all` are the endpoints here that CHECK a WLO
 * password, and the guard against using them to guess one counts distinct logins
 * per client ADDRESS.
 * A wildcard `Access-Control-Allow-Origin` hands an attacker every visitor's
 * address: a page spends each visitor's quota on a different guess and — because
 * `*` also makes the RESPONSE readable — learns which guess worked. The credential
 * travels in the BODY here, so leaving `Authorization` out of the allowed headers
 * does nothing; the whole cross-origin invitation has to go.
 *
 * Our own pages are same-origin and need no CORS header at all, so this costs
 * nothing. The MCP and REST surfaces keep theirs: their clients are not browsers.
 */
test('the access-block surface is not offered to cross-origin pages', async () => {
  const { server, base } = await startServer();
  try {
    for (const path of ['/auth/issue', '/auth/revoke', '/auth/revoke-all', '/auth/public-key']) {
      const pre = await fetch(`${base}${path}`, { method: 'OPTIONS' });
      assert.equal(pre.headers.get('access-control-allow-origin'), null, `${path} preflight`);
      const r = await fetch(`${base}${path}`, { method: 'POST' });
      assert.equal(r.headers.get('access-control-allow-origin'), null, `${path} response`);
    }
    const page = await fetch(`${base}/auth`);
    assert.equal(page.headers.get('access-control-allow-origin'), null, 'the page itself either');

    const mcp = await fetch(`${base}/mcp`, { method: 'OPTIONS' });
    assert.equal(mcp.headers.get('access-control-allow-origin'), '*', 'MCP keeps its wildcard');

    // `/auth/ticket` is the ONE exception on this surface: its only real client
    // is a widget on a foreign origin, and what travels in its body is a
    // repository-ISSUED ticket (high-entropy, machine-made), not a password a
    // page could make visitors guess. Without CORS the endpoint cannot serve
    // its one purpose; the distinct-value limiter still bounds validation
    // attempts per address.
    const ticket = await fetch(`${base}/auth/ticket`, { method: 'OPTIONS' });
    assert.equal(ticket.headers.get('access-control-allow-origin'), '*', '/auth/ticket preflight passes');
  } finally { await close(server); }
});

/**
 * `routes.ts` and `static.ts` both compare the NORMALIZED pathname; the dispatch
 * in `http-app.ts` compared `req.url` verbatim, which carries the query string.
 * A client whose configured endpoint has any parameter appended therefore got a
 * 404 reading "Not found. Use POST /mcp" — for a request that did exactly that.
 */
test('a query string on the MCP endpoint does not turn it into an unknown path', async () => {
  const { server, base } = await startServer();
  try {
    const r = await fetch(`${base}/mcp?v=1`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: INITIALIZE,
    });
    assert.equal(r.status, 200, 'the path is what identifies the endpoint');
    const wrongMethod = await fetch(`${base}/mcp?v=1`);
    assert.equal(wrongMethod.status, 405, 'and the method guard still recognises it');
  } finally { await close(server); }
});

test('a cache-busting query on /health still reaches the health check', async () => {
  const { server, base } = await startServer();
  try {
    const r = await fetch(`${base}/health?t=12345`);
    assert.equal(r.status, 200);
    assert.equal(((await r.json()) as { status: string }).status, 'ok');
  } finally { await close(server); }
});

/**
 * Both public HTML surfaces embed repository-supplied text. The escaping is the
 * control; a CSP is the second one, and the widget resources already ship theirs.
 */
test('the launcher HTML declares a content security policy', async () => {
  const { server, base } = await startServer();
  try {
    const csp = (await fetch(`${base}/`)).headers.get('content-security-policy') ?? '';
    assert.match(csp, /default-src 'none'/, 'nothing loads unless named');
    assert.match(csp, /frame-ancestors 'none'/, 'and it cannot be framed');
    assert.match(csp, /connect-src 'self'/, 'its own API test call still works');
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

test('the public REST layer does NOT adopt a caller-supplied Authorization header', async () => {
  // /api/* is a deliberately anonymous public surface. Accepting credentials
  // there would turn it into an authenticated API by accident — without the
  // rate-limiting, logging and scoping decisions that would need. Only the MCP
  // endpoint reads the header (auth-per-user.test.ts covers that path).
  const { credentialFromHeader, currentCredential, setServiceCredentialForTest } =
    await import('../src/auth/credential.js');
  const { server, base } = await startServer();
  const seen: (string | null)[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    if (String(input).startsWith(base)) return originalFetch(input as string, init);
    // Upstream call from inside the REST handler: record what identity applied.
    seen.push(currentCredential()?.label ?? null);
    return new Response(JSON.stringify({ nodes: [], pagination: { total: 0, from: 0, count: 0 } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  setServiceCredentialForTest(null);
  try {
    const header = credentialFromHeader('Basic ' + Buffer.from('fremd:x').toString('base64'));
    assert.ok(header, 'the header itself is well-formed — the point is that REST ignores it');
    await fetch(`${base}/api/search?q=test`, { headers: { Authorization: header.header } });
    for (const label of seen) {
      assert.equal(label, null, 'no caller identity reached the upstream call');
    }
  } finally {
    globalThis.fetch = originalFetch;
    await close(server);
  }
});

test('http dispatch: rotating credentials from one address is refused as relay abuse', async () => {
  // The MCP endpoint forwards a client-supplied Basic header upstream, so it
  // could be used to guess WLO logins with our address as the origin. One
  // distinct login per address is normal; a stream of them is not.
  const { server, base } = await startServer({
    authAbuseLimiter: createDistinctValueLimiter(2, 600_000),
  });
  try {
    const post = (user: string) => fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Basic ${Buffer.from(`${user}:pw`).toString('base64')}`,
      },
      body: INITIALIZE,
    });
    assert.equal((await post('anna')).status, 200);
    assert.equal((await post('bruno')).status, 200);
    assert.equal((await post('carla')).status, 429, 'the third distinct login is refused');
    assert.equal((await post('anna')).status, 200, 'an already-seen login still works');
  } finally { await close(server); }
});

test('http dispatch: one user making many calls is NOT treated as abuse', async () => {
  // The regression this guard must never cause: a per-user client sends its
  // header on every single tool call.
  const { server, base } = await startServer({
    authAbuseLimiter: createDistinctValueLimiter(2, 600_000),
  });
  try {
    for (let i = 0; i < 25; i++) {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Authorization': `Basic ${Buffer.from('anna:pw').toString('base64')}`,
        },
        body: INITIALIZE,
      });
      assert.equal(r.status, 200, `call ${i} must pass`);
    }
  } finally { await close(server); }
});

test('http dispatch: anonymous MCP calls are untouched by the credential guard', async () => {
  const { server, base } = await startServer({
    authAbuseLimiter: createDistinctValueLimiter(1, 600_000),
  });
  try {
    for (let i = 0; i < 5; i++) {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
        body: INITIALIZE,
      });
      assert.equal(r.status, 200, `anonymous call ${i}`);
    }
  } finally { await close(server); }
});

test('an Authorization header we cannot use does NOT borrow the service account', async () => {
  // Presenting a header means "act as me". A scheme we refuse used to fall
  // through to `configuredServiceCredential()`, so the caller quietly acted as a
  // shared identity with rights they never asked for — and with
  // WLO_ALLOW_SERVICE_WRITES set, could have written under it. Anonymous is the
  // honest downgrade: the request still works, the rights do not lie.
  //
  // The header here is `Digest` since 2026-08-05, not `Bearer`. An unusable
  // BEARER is now refused outright with 401 (it is one of OUR tokens failing, so
  // the client is told where to get a new one — see oauth-routing.test.ts). That
  // is strictly stronger than this rule: a refused request forwards nothing at
  // all. `Digest` is the case that still reaches the downgrade, so it is what
  // keeps this rule under test rather than merely stated.
  const { setServiceCredentialForTest } = await import('../src/auth/credential.js');
  const { server, base } = await startServer();
  const realFetch = globalThis.fetch;
  const auths: (string | null)[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input);
    if (url.startsWith(base)) return realFetch(input as string, init);
    auths.push(new Headers(init?.headers ?? {}).get('authorization'));
    return new Response(JSON.stringify({ person: { authorityName: 'esguest' } }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  setServiceCredentialForTest({ header: 'Basic ZGllbnN0OngK', label: 'dienst', source: 'service' });
  try {
    const r = await realFetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': 'Digest nicht-verwendbar',
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'wlo_auth_status', arguments: {} },
      }),
    });
    const body = await r.json() as { result?: { structuredContent?: { mode?: string } } };
    assert.equal(body.result?.structuredContent?.mode, 'anonymous', 'not the shared account');
    assert.ok(auths.length > 0, 'the identity probe did run');
    for (const a of auths) assert.equal(a, null, 'no credential reached the repository');
  } finally {
    setServiceCredentialForTest(null);
    globalThis.fetch = realFetch;
    await close(server);
  }
});

test('a REVOKED access block is refused outright and borrows nothing', async () => {
  // Same rule as the test above, from the input that matters most: this block
  // DECODES cleanly and is refused only by the allow-list. That is the
  // revocation path, and a revoked user silently acting as the shared account
  // would be the worst possible outcome of pressing "revoke".
  //
  // Since 2026-08-05 the answer is a 401 rather than an anonymous 200: a block
  // that was valid and now is not is precisely the case where "fetch a new one"
  // is useful, and the 401 carries the pointer to where. The rule this test
  // exists for is satisfied more strongly than before — the request is never
  // served, so nothing is borrowed and nothing reaches the repository.
  const { setServiceCredentialForTest, setAccessSupport } = await import('../src/auth/credential.js');
  const { encodeAccessToken, loadAuthKeys } = await import('../src/auth/access-token.js');
  const { openRegistry } = await import('../src/auth/access-registry.js');
  const { generateKeyPairSync } = await import('node:crypto');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keys = loadAuthKeys({ current: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
  assert.ok(keys);
  const dir = mkdtempSync(join(tmpdir(), 'wlo-revoked-'));
  const registry = await openRegistry(join(dir, 'registry.json'));
  assert.ok(registry);
  // Deliberately never added — an id the list does not carry is exactly what a
  // revoked block looks like on the next request.
  const block = encodeAccessToken(
    { v: 2, jti: 'revoked-id', u: 'lehrerin', secret: 'geheim', iat: 1_754_300_000 },
    keys.publicKeyPem,
  );

  const { server, base } = await startServer();
  const realFetch = globalThis.fetch;
  const auths: (string | null)[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input);
    if (url.startsWith(base)) return realFetch(input as string, init);
    auths.push(new Headers(init?.headers ?? {}).get('authorization'));
    return new Response(JSON.stringify({ person: { authorityName: 'esguest' } }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  setServiceCredentialForTest({ header: 'Basic ZGllbnN0OngK', label: 'dienst', source: 'service' });
  setAccessSupport({ keys, registry });
  try {
    const r = await realFetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${block}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'wlo_auth_status', arguments: {} },
      }),
    });
    assert.equal(r.status, 401, 'a revoked block is refused, not quietly downgraded');
    assert.match(r.headers.get('www-authenticate') ?? '', /error="invalid_token"/);
    assert.deepEqual(auths, [], 'nothing at all was sent upstream — no shared account, no revoked login');
  } finally {
    setAccessSupport(null);
    setServiceCredentialForTest(null);
    globalThis.fetch = realFetch;
    await close(server);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('issuing a block works inside the handler-wide anonymous scope', async () => {
  // The unit tests for /auth/issue call the handler directly. In production it
  // runs inside `runAnonymous`, and issuance has to open its OWN credential
  // scope in there to verify the login. If that nesting did not work, every
  // issuance would fail with "credentials not accepted" — and no unit test
  // would show it, because none of them enters the anonymous scope.
  const { setAccessSupport } = await import('../src/auth/credential.js');
  const { encodeAccessToken, loadAuthKeys } = await import('../src/auth/access-token.js');
  const { openRegistry } = await import('../src/auth/access-registry.js');
  const { generateKeyPairSync } = await import('node:crypto');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keys = loadAuthKeys({ current: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
  assert.ok(keys);
  const dir = mkdtempSync(join(tmpdir(), 'wlo-issue-'));
  const registry = await openRegistry(join(dir, 'registry.json'));
  assert.ok(registry);

  const { server, base } = await startServer();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input);
    if (url.startsWith(base)) return realFetch(input as string, init);
    // The identity probe — answering with a real authority means "logged in".
    return new Response(JSON.stringify({ person: { authorityName: 'lehrerin' } }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  setAccessSupport({ keys, registry });
  try {
    const token = encodeAccessToken(
      { v: 2, jti: 'through-http', u: 'lehrerin', secret: 'geheim', iat: 1_754_300_000 },
      keys.publicKeyPem,
    );
    const r = await realFetch(`${base}/auth/issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    assert.equal(r.status, 200);
    assert.equal(registry.has('through-http'), true, 'the id reached the allow-list');
  } finally {
    setAccessSupport(null);
    globalThis.fetch = realFetch;
    await close(server);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('no Authorization header at all still resolves to the service account', async () => {
  // The counterpart of the test above: the fallback itself is intended, and
  // removing it would take the MCP endpoint's rights away from every ordinary
  // caller.
  const { setServiceCredentialForTest } = await import('../src/auth/credential.js');
  const { server, base } = await startServer();
  const realFetch = globalThis.fetch;
  const auths: (string | null)[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input);
    if (url.startsWith(base)) return realFetch(input as string, init);
    auths.push(new Headers(init?.headers ?? {}).get('authorization'));
    return new Response(JSON.stringify({ person: { authorityName: 'dienst' } }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  setServiceCredentialForTest({ header: 'Basic ZGllbnN0OngK', label: 'dienst', source: 'service' });
  try {
    const r = await realFetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'wlo_auth_status', arguments: {} },
      }),
    });
    const body = await r.json() as { result?: { structuredContent?: { mode?: string } } };
    assert.equal(body.result?.structuredContent?.mode, 'service');
    assert.ok(auths.includes('Basic ZGllbnN0OngK'));
  } finally {
    setServiceCredentialForTest(null);
    globalThis.fetch = realFetch;
    await close(server);
  }
});

test('http dispatch: headers we never forward do not consume the credential budget', async () => {
  // The guard exists because a BASIC header is relayed upstream. A Bearer token
  // is refused by credentialFromHeader and never leaves this server, so it is
  // not a guessing attempt — and a host rotating such tokens must not be locked
  // out for something it did not do.
  //
  // What each rotation gets is a 401 (since 2026-08-05: an unusable token of
  // ours, with the pointer to where a new one is issued). The assertion is that
  // it is never a **429** — that would be the lockout this guard exists to
  // prevent, and it would arrive from the third token onwards.
  const { server, base } = await startServer({
    authAbuseLimiter: createDistinctValueLimiter(2, 600_000),
  });
  try {
    for (let i = 0; i < 6; i++) {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Authorization': `Bearer token-${i}`,
        },
        body: INITIALIZE,
      });
      // 401 = "this token is no good"; 429 would be the lockout, and would
      // arrive from the third distinct token onwards if the budget counted them.
      assert.equal(r.status, 401, `rotating bearer token ${i}: refused as a token, never as abuse`);
    }
  } finally { await close(server); }
});

/**
 * A request target node:http accepts but `new URL()` refuses.
 *
 * `fetch` cannot express this — it normalises the target — so this goes over a
 * raw socket. `GET //[` is a valid origin-form target for llhttp (it reads as
 * the authority form) and an invalid URL for WHATWG parsing.
 *
 * Before the fix: the parse threw inside `resolveStaticRoute`, the rejection
 * escaped the handler (node:http never awaits its return value), and the client
 * got NO response at all — the socket stayed open until `requestTimeout`, and a
 * process-level `unhandledRejection` line was the only trace. Unauthenticated
 * and not rate limited, since neither limiter covers the static fall-through.
 */
function rawRequest(port: number, target: string, timeoutMs = 2000): Promise<string> {
  return new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write(`GET ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
    });
    let buf = '';
    const timer = setTimeout(() => { sock.destroy(); resolve('(no response)'); }, timeoutMs);
    sock.on('data', (d) => { buf += d.toString(); });
    sock.on('close', () => { clearTimeout(timer); resolve(buf.split('\r\n')[0] || '(empty)'); });
    sock.on('error', () => { clearTimeout(timer); resolve('(socket error)'); });
  });
}

test('http dispatch: an unparseable request target is answered, not left hanging', async () => {
  const { server, base } = await startServer();
  const port = Number(new URL(base).port);
  try {
    for (const target of ['//[', '//[bad]x', '//user@[::1]x']) {
      const status = await rawRequest(port, target);
      assert.match(status, /^HTTP\/1\.1 400 /, `${target} must get a 400, not silence`);
    }
  } finally { await close(server); }
});

/**
 * The OAuth discovery surface, as reached through the real dispatch (P1/T1.3).
 *
 * No access support is installed here, so the documents are correctly withheld —
 * what this pins is that the paths REACH `rest/oauth-pages.ts` at all (a 404 with
 * its German body, not the dispatch's generic `Not found. Use POST /mcp`).
 */
test('http dispatch: a discovery path reaches the OAuth module even when the feature is off', async () => {
  const { server, base } = await startServer();
  try {
    for (const path of [
      '/.well-known/oauth-authorization-server',
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/mcp',
    ]) {
      const r = await fetch(`${base}${path}`);
      assert.equal(r.status, 404, path);
      const body = await r.json() as { error?: string };
      assert.match(body.error ?? '', /OAuth/, `${path} was answered by the 404 fall-through instead`);
    }
  } finally { await close(server); }
});

/**
 * CORS, and the two surfaces that must not get it.
 *
 * The discovery documents NEED the wildcard: they are public, secret-free, and
 * clients fetch them cross-origin. `/oauth/authorize` must not have it, for the
 * reason `/auth*` must not — from P3 it checks a WLO password, and both abuse
 * limiters count per client ADDRESS, so a wildcard origin would let a page spend
 * every visitor's quota on a guess and read which one worked.
 *
 * Pinned NOW, one package before the endpoint exists, because the alternative is
 * needing the exception exactly when nobody is thinking about it any more.
 */
test('http dispatch: discovery is cross-origin readable, the authorize path is not', async () => {
  const { server, base } = await startServer();
  try {
    const discovery = await fetch(`${base}/.well-known/oauth-authorization-server`);
    assert.equal(discovery.headers.get('access-control-allow-origin'), '*', 'clients fetch this cross-origin');

    for (const path of ['/oauth/authorize', '/auth', '/auth/issue']) {
      const r = await fetch(`${base}${path}`);
      assert.equal(
        r.headers.get('access-control-allow-origin'),
        null,
        `${path} must not be readable from a foreign page`,
      );
    }
  } finally { await close(server); }
});
