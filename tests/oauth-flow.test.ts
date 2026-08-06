/**
 * oauth-flow.test.ts – the whole login, through a real server (P4/T4.2).
 *
 * Every step of this flow has its own unit test. This one exists because those
 * tests each prove that a module does what its author expected, and P3 already
 * showed what that is worth: the consent page and the consent endpoint were both
 * green and disagreed about the request body. Only walking the flow found it.
 *
 * So this walks it — a real `node:http` server, real key material, a real
 * allow-list in a temporary directory, and only WLO itself faked:
 *
 *   GET  /.well-known/oauth-protected-resource      → 200
 *   GET  /.well-known/oauth-authorization-server    → 200
 *   POST /oauth/register                            → 201, client_id
 *   POST /oauth/authorize                           → 200, redirect with code
 *   POST /oauth/token                               → 200, access_token
 *   POST /mcp   Authorization: Bearer <token>       → 200, list WITH curation
 *   POST /auth/revoke  with the same block          → 200
 *   POST /mcp   with the same token                 → 401
 *   POST /mcp   with no header                      → 200, anonymous list
 *
 * The last three lines are the point. The design promises that ONE revocation
 * ends both ways in (the pasted block and the OAuth token), which is only true
 * because the token IS the block; and anonymous reading is the property this
 * whole undertaking most easily breaks.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createHttpRequestHandler } from '../src/http-app.js';
import { setAccessSupport } from '../src/auth/credential.js';
import { encodeAccessToken, loadAuthKeys } from '../src/auth/access-token.js';
import { openRegistry } from '../src/auth/access-registry.js';
import { createDistinctValueLimiter, createRateLimiter } from '../src/rate-limit.js';
import { streamableHttpOptions } from '../src/mcp-transport.js';

const ISSUER = 'https://mcp.example';
const REDIRECT = 'http://localhost:1455/cb';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
const USER = 'redakteurin';
const JTI = 'flow-id-1';

/** The anonymous surface, as a floor — see `oauth-routing.test.ts`. */
const ANONYMOUS_TOOLS_AT_LEAST = 25;

/**
 * Fake WLO. Anything aimed at our own test server goes through untouched; every
 * other call is the identity probe, and it reports a real authority so the login
 * counts as one.
 */
function fakeWlo(authority = USER) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input);
    if (url.startsWith('http://127.0.0.1')) return real(input as string, init);
    return new Response(JSON.stringify({ person: { authorityName: authority } }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return () => { globalThis.fetch = real; };
}

const close = (s: http.Server) => new Promise<void>((r) => { s.close(() => r()); });

const LIST = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

async function listTools(base: string, authorization?: string): Promise<Response> {
  return fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
    body: LIST,
  });
}

async function toolNames(r: Response): Promise<string[]> {
  const body = await r.json() as { result?: { tools?: { name: string }[] } };
  return (body.result?.tools ?? []).map((t) => t.name);
}

test('a client walks in unknown and walks out with an access it can lose again', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'wlo-oauth-flow-'));
  const registry = await openRegistry(join(dir, 'registry.json'));
  assert.ok(registry);
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keys = loadAuthKeys({ current: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
  assert.ok(keys);
  setAccessSupport({ keys, registry });
  t.after(() => { setAccessSupport(null); rmSync(dir, { recursive: true, force: true }); });
  t.after(fakeWlo());

  const server = http.createServer(createHttpRequestHandler({
    rateLimiter: createRateLimiter(0),
    apiRateLimiter: createRateLimiter(0),
    authAbuseLimiter: createDistinctValueLimiter(0),
    maxBodyBytes: 1_048_576,
    trustProxy: false,
    streamOptions: streamableHttpOptions({}),
    publicBaseUrl: ISSUER,
  }));
  const base: string = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });

  try {
    // 1–2. Discovery: how a client learns any of the rest exists.
    for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-authorization-server']) {
      const r = await fetch(`${base}${path}`);
      assert.equal(r.status, 200, path);
      const doc = await r.json() as Record<string, unknown>;
      assert.ok(String(doc['issuer'] ?? doc['resource']).startsWith(ISSUER), path);
    }

    // 3. Registration, open by design and granting nothing on its own.
    const registered = await fetch(`${base}/oauth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: 'Testprogramm' }),
    });
    assert.equal(registered.status, 201);
    const clientId = String((await registered.json() as Record<string, unknown>)['client_id']);

    // 4. Consent. The block is what the browser page would have produced.
    const block = encodeAccessToken(
      { v: 2, jti: JTI, u: USER, secret: 'geheim', iat: 1_754_300_000 },
      keys.publicKeyPem,
    );
    const consent = await fetch(`${base}/oauth/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: block,
        client_id: clientId,
        redirect_uri: REDIRECT,
        response_type: 'code',
        code_challenge: CHALLENGE,
        code_challenge_method: 'S256',
        state: 'zustand-42',
      }),
    });
    assert.equal(consent.status, 200, await consent.clone().text());
    const redirect = new URL(String((await consent.json() as Record<string, unknown>)['redirect']));
    assert.equal(redirect.searchParams.get('state'), 'zustand-42');
    const code = redirect.searchParams.get('code');
    assert.ok(code, 'no code in the redirect');

    // 5. The exchange — on a DIFFERENT loopback port, as a native client would
    //    (RFC 8252 §7.3), so the one loosening in the redirect rule is exercised
    //    by the flow and not only by its unit test.
    const token = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        redirect_uri: 'http://127.0.0.1:49152/cb',
        code_verifier: VERIFIER,
      }).toString(),
    });
    assert.equal(token.status, 200, await token.clone().text());
    assert.equal(token.headers.get('cache-control'), 'no-store');
    const issued = await token.json() as Record<string, unknown>;
    assert.equal(issued['token_type'], 'Bearer');
    assert.equal(issued['access_token'], block, 'the token IS the block — there is no second credential');

    const authorization = `Bearer ${String(issued['access_token'])}`;

    // 6. The token actually works, and brings the write surface with it.
    const asUser = await listTools(base, authorization);
    assert.equal(asUser.status, 200);
    const userTools = await toolNames(asUser);
    assert.ok(
      userTools.length > ANONYMOUS_TOOLS_AT_LEAST,
      `a user identity should also bring the curation tools, got ${userTools.length}`,
    );

    // 7–8. One revocation ends BOTH ways in. This is the promise the design
    //      makes, and it only holds because the token is the block.
    const revoked = await fetch(`${base}/auth/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: block }),
    });
    assert.equal(revoked.status, 200);
    assert.equal((await revoked.json() as Record<string, unknown>)['revoked'], true);

    const afterRevoke = await listTools(base, authorization);
    assert.equal(afterRevoke.status, 401, 'a revoked block must not keep working as an OAuth token');
    assert.match(afterRevoke.headers.get('www-authenticate') ?? '', /error="invalid_token"/);

    // 9. And none of this touched the anonymous surface.
    const anonymous = await listTools(base);
    assert.equal(anonymous.status, 200, 'anonymous reading is requirement number one');
    assert.ok((await toolNames(anonymous)).length >= ANONYMOUS_TOOLS_AT_LEAST);
  } finally {
    await close(server);
  }
});

test('a code cannot be redeemed twice, even across a real server', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'wlo-oauth-flow2-'));
  const registry = await openRegistry(join(dir, 'registry.json'));
  assert.ok(registry);
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keys = loadAuthKeys({ current: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
  assert.ok(keys);
  setAccessSupport({ keys, registry });
  t.after(() => { setAccessSupport(null); rmSync(dir, { recursive: true, force: true }); });
  t.after(fakeWlo());

  const server = http.createServer(createHttpRequestHandler({
    rateLimiter: createRateLimiter(0),
    apiRateLimiter: createRateLimiter(0),
    authAbuseLimiter: createDistinctValueLimiter(0),
    maxBodyBytes: 1_048_576,
    trustProxy: false,
    streamOptions: streamableHttpOptions({}),
    publicBaseUrl: ISSUER,
  }));
  const base: string = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });

  try {
    const registered = await fetch(`${base}/oauth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [REDIRECT] }),
    });
    const clientId = String((await registered.json() as Record<string, unknown>)['client_id']);
    const block = encodeAccessToken(
      { v: 2, jti: 'flow-id-2', u: USER, secret: 'geheim', iat: 1_754_300_000 },
      keys.publicKeyPem,
    );
    const consent = await fetch(`${base}/oauth/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: block, client_id: clientId, redirect_uri: REDIRECT, response_type: 'code',
        code_challenge: CHALLENGE, code_challenge_method: 'S256',
      }),
    });
    const code = new URL(String((await consent.json() as Record<string, unknown>)['redirect']))
      .searchParams.get('code')!;

    const form = () => new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_verifier: VERIFIER,
    }).toString();
    const post = () => fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form(),
    });

    assert.equal((await post()).status, 200);
    const second = await post();
    assert.equal(second.status, 400);
    assert.equal((await second.json() as Record<string, unknown>)['error'], 'invalid_grant');
  } finally {
    await close(server);
  }
});

test('ohne eigenes Konto verbinden — durch den ganzen Ablauf, gegen einen echten Server', async (t) => {
  // Der Fall, für den das gebaut wurde (gemessen 2026-08-06 bei claude.ai): der
  // Client findet die Discovery, will einen Token und kann nicht „einfach nichts
  // schicken". Ohne diesen Ausgang bleibt ihm nur Anmelden oder Abbrechen.
  //
  // Die beiden Zeilen am Schluss sind die eigentliche Zusicherung: der Token
  // führt NICHT zu 401 (das wäre ein Fehler bei jedem Aufruf), und er liefert
  // dieselbe Liste wie ein Aufruf ganz ohne Header.
  const dir = mkdtempSync(join(tmpdir(), 'wlo-oauth-anon-'));
  const registry = await openRegistry(join(dir, 'registry.json'));
  assert.ok(registry);
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keys = loadAuthKeys({ current: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
  assert.ok(keys);
  setAccessSupport({ keys, registry });
  t.after(() => { setAccessSupport(null); rmSync(dir, { recursive: true, force: true }); });
  t.after(fakeWlo());

  const server = http.createServer(createHttpRequestHandler({
    rateLimiter: createRateLimiter(0),
    apiRateLimiter: createRateLimiter(0),
    authAbuseLimiter: createDistinctValueLimiter(0),
    maxBodyBytes: 1_048_576,
    trustProxy: false,
    streamOptions: streamableHttpOptions({}),
    publicBaseUrl: ISSUER,
  }));
  const base: string = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });

  try {
    const registered = await fetch(`${base}/oauth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: 'Anon-Client' }),
    });
    assert.equal(registered.status, 201);
    const clientId = String((await registered.json() as Record<string, unknown>)['client_id']);

    // Der dritte Knopf: kein Benutzername, kein Passwort, kein Zugangsblock.
    const consent = await fetch(`${base}/oauth/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        anonymous: true,
        client_id: clientId,
        redirect_uri: REDIRECT,
        response_type: 'code',
        code_challenge: CHALLENGE,
        code_challenge_method: 'S256',
      }),
    });
    const consentBody = await consent.json() as Record<string, unknown>;
    assert.equal(consent.status, 200, JSON.stringify(consentBody));
    const code = new URL(String(consentBody['redirect'])).searchParams.get('code')!;

    const token = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_verifier: VERIFIER,
      }).toString(),
    });
    const tokenBody = await token.json() as Record<string, unknown>;
    assert.equal(token.status, 200, JSON.stringify(tokenBody));
    const access = String(tokenBody['access_token']);

    const connected = await listTools(base, `Bearer ${access}`);
    assert.equal(connected.status, 200, 'kein 401 — sonst scheitert jeder Aufruf der Verbindung');
    const withToken = await toolNames(connected);
    const withoutHeader = await toolNames(await listTools(base));
    assert.deepEqual(withToken.sort(), withoutHeader.sort(),
      'anonym verbunden heißt: genau wie ohne Header, nicht weniger und nicht mehr');
  } finally {
    await close(server);
  }
});
