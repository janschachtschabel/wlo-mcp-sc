/**
 * oauth-endpoints.test.ts – the OAuth HTTP surface (P1/T1.2 onward).
 *
 * Sibling of `auth-endpoints.test.ts` and shaped like it: the module owns a
 * closed set of paths, hands anything else back with `false`, and is OFF —
 * answering 404, not 500 — whenever the feature it depends on is not configured.
 *
 * "Off" here has two causes and one effect. Without key material there is no
 * access block to hand out, so there is nothing for OAuth to issue; without a
 * resolvable issuer the documents would name endpoints on a host we did not
 * choose. Either way the endpoint should not exist rather than half-work.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleOAuthEndpoint } from '../src/rest/oauth-pages.js';
import { ANONYMOUS_ACCESS_TOKEN, currentAccessSupport, setAccessSupport } from '../src/auth/credential.js';
import { installFetchMock } from './fetchMock.js';
import { encodeAccessToken, loadAuthKeys } from '../src/auth/access-token.js';
import { createCodeStore, type CodeStore } from '../src/auth/oauth-codes.js';
import { MAX_REDIRECT_URIS, decodeClientId, encodeClientId } from '../src/auth/oauth-clients.js';
import { openRegistry } from '../src/auth/access-registry.js';
import { authorizationServerMetadata, protectedResourceMetadata } from '../src/auth/oauth-metadata.js';
import { createDistinctValueLimiter, createRateLimiter } from '../src/rate-limit.js';

const ISSUER = 'https://mcp.example';

/**
 * `content-type` defaults to what the consent page actually sends. POST
 * `/oauth/authorize` REQUIRES it (see the 415 test below), so a helper that
 * omitted it would exercise a request no real client makes.
 */
const req = (method: string, url: string, body?: string, contentType = 'application/json') => ({
  method,
  url,
  headers: { 'content-type': contentType } as Record<string, string | string[] | undefined>,
  async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(body); },
});

function res() {
  const out = { status: 0, body: '', headers: {} as Record<string, string> };
  return {
    out,
    json: () => (out.body ? JSON.parse(out.body) as Record<string, unknown> : null),
    writeHead(status: number, headers?: Record<string, string>) {
      out.status = status;
      out.headers = headers ?? {};
    },
    end(body?: string) { out.body = body ?? ''; },
  };
}

function deps(over: Partial<Parameters<typeof handleOAuthEndpoint>[2]> = {}) {
  return {
    ip: '198.51.100.7',
    maxBodyBytes: 1_000_000,
    rateLimiter: createRateLimiter(100),
    authAbuseLimiter: createDistinctValueLimiter(3, 600_000),
    codeStore: createCodeStore(),
    issuer: ISSUER as string | null,
    ...over,
  };
}

/** Fake upstream: the identity endpoint reports whatever authority we choose. */
function upstream(authority: string | null) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify(authority ? { person: { authorityName: authority } } : {}),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

/** Install access-block support for the duration of one test. */
async function support(t: { after: (fn: () => void) => void }): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'wlo-oauth-'));
  const registry = await openRegistry(join(dir, 'registry.json'));
  assert.ok(registry);
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keys = loadAuthKeys({ current: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
  assert.ok(keys);
  setAccessSupport({ keys, registry });
  t.after(() => { setAccessSupport(null); rmSync(dir, { recursive: true, force: true }); });
}

const AS_PATHS = ['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/mcp'];
const PR_PATHS = ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'];
const ALL = [...AS_PATHS, ...PR_PATHS];

// ── off ─────────────────────────────────────────────────────────────────────

test('without key material every discovery path answers 404, not a document', async () => {
  for (const path of ALL) {
    const r = res();
    assert.equal(await handleOAuthEndpoint(req('GET', path), r, deps()), true, `${path} is ours to answer`);
    assert.equal(r.out.status, 404, path);
  }
});

test('without a resolvable issuer the documents are withheld too', async (t) => {
  await support(t);
  for (const path of ALL) {
    const r = res();
    await handleOAuthEndpoint(req('GET', path), r, deps({ issuer: null }));
    assert.equal(r.out.status, 404, `${path} would otherwise name endpoints on a host we did not choose`);
  }
});

// ── on ──────────────────────────────────────────────────────────────────────

test('both spellings of the authorization-server path serve the same document', async (t) => {
  await support(t);
  for (const path of AS_PATHS) {
    const r = res();
    assert.equal(await handleOAuthEndpoint(req('GET', path), r, deps()), true);
    assert.equal(r.out.status, 200, path);
    assert.deepEqual(r.json(), authorizationServerMetadata(ISSUER), path);
  }
});

test('both spellings of the protected-resource path serve the same document', async (t) => {
  await support(t);
  for (const path of PR_PATHS) {
    const r = res();
    await handleOAuthEndpoint(req('GET', path), r, deps());
    assert.equal(r.out.status, 200, path);
    assert.deepEqual(r.json(), protectedResourceMetadata(ISSUER), path);
  }
});

test('a discovery document is cacheable and typed, and refuses to be sniffed', async (t) => {
  await support(t);
  const r = res();
  await handleOAuthEndpoint(req('GET', ALL[0]!), r, deps());
  assert.match(r.out.headers['Content-Type'] ?? '', /application\/json/);
  assert.match(r.out.headers['Cache-Control'] ?? '', /max-age=\d+/);
  assert.equal(r.out.headers['X-Content-Type-Options'], 'nosniff');
});

// ── the edges ───────────────────────────────────────────────────────────────

test('a discovery path is GET-only', async (t) => {
  await support(t);
  const r = res();
  assert.equal(await handleOAuthEndpoint(req('POST', ALL[0]!), r, deps()), true);
  assert.equal(r.out.status, 405);
  assert.equal(r.out.headers['Allow'], 'GET');
});

test('a path we do not own is handed back so the caller can fall through', async (t) => {
  await support(t);
  for (const path of ['/.well-known/openid-configuration', '/.well-known/', '/oauth', '/mcp']) {
    const r = res();
    assert.equal(await handleOAuthEndpoint(req('GET', path), r, deps()), false, path);
    assert.equal(r.out.status, 0, `${path} was answered when it should have fallen through`);
  }
});

test('an unparseable request target owns no route', async (t) => {
  await support(t);
  const r = res();
  assert.equal(await handleOAuthEndpoint(req('GET', '//['), r, deps()), false);
});

test('the discovery paths are rate-limited like the rest of the public surface', async (t) => {
  await support(t);
  // One request per window: the first passes, the second is over the line.
  const rateLimiter = createRateLimiter(1);
  const first = res();
  await handleOAuthEndpoint(req('GET', ALL[0]!), first, deps({ rateLimiter }));
  assert.equal(first.out.status, 200, 'the first request is served');

  const second = res();
  await handleOAuthEndpoint(req('GET', ALL[0]!), second, deps({ rateLimiter }));
  assert.equal(second.out.status, 429);
  assert.equal(second.out.headers['Retry-After'], '60');
});

// ── registration (P2/T2.2) ─────────────────────────────────────────────────

const REGISTER = '/oauth/register';

const register = async (body: unknown, over = {}) => {
  const r = res();
  const handled = await handleOAuthEndpoint(
    req('POST', REGISTER, typeof body === 'string' ? body : JSON.stringify(body)),
    r,
    deps(over),
  );
  return { handled, ...r.out, json: r.json() };
};

test('registration is refused wholesale when the feature is off', async () => {
  const r = await register({ redirect_uris: ['https://a.example/cb'] });
  assert.equal(r.handled, true);
  assert.equal(r.status, 404, 'no key material means there is nothing to register FOR');
});

test('a valid registration yields a client_id and no secret', async (t) => {
  await support(t);
  const r = await register({ redirect_uris: ['https://a.example/cb'], client_name: 'Mein Client' });
  assert.equal(r.status, 201);
  assert.match(String(r.json?.['client_id']), /^wloc1\./);
  assert.equal(r.json?.['client_name'], 'Mein Client');
  assert.deepEqual(r.json?.['redirect_uris'], ['https://a.example/cb']);
  assert.equal(r.json?.['token_endpoint_auth_method'], 'none');
  assert.deepEqual(r.json?.['grant_types'], ['authorization_code']);
  assert.deepEqual(r.json?.['response_types'], ['code']);
  // Public clients only. A secret here would be one more thing to store, and
  // there is nowhere to store it (see oauth-clients.ts).
  assert.ok(!('client_secret' in (r.json ?? {})), `no secret is issued: ${r.body}`);
});

test('the issued client_id really carries what was registered', async (t) => {
  await support(t);
  const uris = ['https://a.example/cb', 'http://localhost:1455/cb'];
  const r = await register({ redirect_uris: uris, client_name: 'Zwei Ziele' });
  const support_ = currentAccessSupport();
  assert.ok(support_);
  assert.deepEqual(
    decodeClientId(String(r.json?.['client_id']), support_.keys),
    { redirectUris: uris, name: 'Zwei Ziele' },
    'the id is the registration, not a handle to one',
  );
});

test('a registration without a usable redirect target is refused', async (t) => {
  await support(t);
  for (const body of [
    { redirect_uris: [] },
    { redirect_uris: ['http://boese.example/cb'] },
    { redirect_uris: ['javascript:alert(1)'] },
    { redirect_uris: ['https://a.example/cb#x'] },
    { redirect_uris: 'https://a.example/cb' },          // not an array
    { redirect_uris: [42] },
    {},
  ]) {
    const r = await register(body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json?.['error'], 'invalid_redirect_uri', JSON.stringify(body));
  }
});

test('more redirect targets than the cap are refused', async (t) => {
  await support(t);
  const many = Array.from({ length: MAX_REDIRECT_URIS + 1 }, (_, i) => `https://a.example/cb${i}`);
  const r = await register({ redirect_uris: many });
  assert.equal(r.status, 400);
  assert.equal(r.json?.['error'], 'invalid_redirect_uri');

  const atCap = await register({ redirect_uris: many.slice(0, MAX_REDIRECT_URIS) });
  assert.equal(atCap.status, 201, 'the cap itself is allowed');
});

test('a body that is not JSON is refused as client metadata', async (t) => {
  await support(t);
  for (const body of ['kein json', '[]', '"nur ein string"', '']) {
    const r = await register(body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json?.['error'], 'invalid_client_metadata', JSON.stringify(body));
  }
});

test('a client name is capped and flattened — it is foreign text on a consent screen', async (t) => {
  await support(t);
  const r = await register({ redirect_uris: ['https://a.example/cb'], client_name: `Böse\nZeile​${'x'.repeat(300)}` });
  assert.equal(r.status, 201);
  const name = String(r.json?.['client_name']);
  assert.ok(!/[\r\n]/.test(name), `a newline would forge a second line on the consent screen: ${name}`);
  assert.ok(!/​/.test(name), 'invisible characters are dropped');
  assert.ok(name.length <= 100, `capped, got ${name.length}`);
});

test('a missing client name falls back rather than failing', async (t) => {
  await support(t);
  const r = await register({ redirect_uris: ['https://a.example/cb'] });
  assert.equal(r.status, 201);
  assert.equal(typeof r.json?.['client_name'], 'string');
  assert.ok(String(r.json?.['client_name']).length > 0, 'the consent screen needs something to show');
});

test('registration is POST-only and rate-limited', async (t) => {
  await support(t);
  const get = res();
  await handleOAuthEndpoint(req('GET', REGISTER), get, deps());
  assert.equal(get.out.status, 405);
  assert.equal(get.out.headers['Allow'], 'POST');

  const rateLimiter = createRateLimiter(1);
  assert.equal((await register({ redirect_uris: ['https://a.example/cb'] }, { rateLimiter })).status, 201);
  assert.equal((await register({ redirect_uris: ['https://a.example/cb'] }, { rateLimiter })).status, 429);
});

// ── authorization (P3/T3.3) ────────────────────────────────────────────────

const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const REDIRECT = 'https://a.example/cb';

/** Register a client the way `/oauth/register` would, and return its id. */
function client(name = 'Mein KI-Programm', uris = [REDIRECT]): string {
  const s = currentAccessSupport();
  assert.ok(s, 'call support(t) first');
  return encodeClientId({ redirectUris: uris, name }, s.keys);
}

function authorizeUrl(over: Record<string, string> = {}): string {
  const query: Record<string, string> = {
    client_id: over['client_id'] ?? client(),
    redirect_uri: REDIRECT,
    response_type: 'code',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    state: 'xyz',
    ...over,
  };
  for (const [k, v] of Object.entries(query)) if (v === '') delete query[k];
  return `/oauth/authorize?${new URLSearchParams(query).toString()}`;
}

const getAuthorize = async (url: string, accept?: string) => {
  const r = res();
  const request = { ...req('GET', url), headers: accept ? { accept } : {} };
  const handled = await handleOAuthEndpoint(request, r, deps());
  return { handled, ...r.out, json: r.json.bind(r) };
};

/** No `Location` under any spelling — nobody is sent anywhere from a refusal. */
function assertNoRedirect(headers: Record<string, string>, body: string): void {
  for (const key of Object.keys(headers)) {
    assert.notEqual(key.toLowerCase(), 'location', `a refusal must not redirect (${key})`);
  }
  assert.ok(!body.includes('http'), `a refusal must not hand back a target: ${body}`);
}

test('a valid authorization request gets the consent page, not a redirect', async (t) => {
  await support(t);
  const r = await getAuthorize(authorizeUrl());
  assert.equal(r.status, 200);
  assert.match(r.headers['Content-Type'] ?? '', /text\/html/);
  assert.match(r.headers['Content-Security-Policy'] ?? '', /script-src 'self'/);
  assertNoRedirect(r.headers, '');
});

test('the page asks the same URL what was recognised, and gets only that', async (t) => {
  await support(t);
  const r = await getAuthorize(authorizeUrl(), 'application/json');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json(), { client_name: 'Mein KI-Programm', redirect_uri: REDIRECT });
  assert.equal(r.headers['Cache-Control'], 'no-store');
});

test('a request we do not recognise is refused before any password is asked for', async (t) => {
  await support(t);
  const cases: Array<[string, Record<string, string>]> = [
    ['an unreadable client_id', { client_id: 'wloc1.aaa.bbb' }],
    ['no client_id at all', { client_id: 'weg' }],
    ['a redirect target that was never registered', { redirect_uri: 'https://boese.example/cb' }],
    ['a redirect target that only looks close', { redirect_uri: 'https://a.example/cb/' }],
    ['PKCE downgraded to plain', { code_challenge_method: 'plain' }],
    ['no PKCE method', { code_challenge_method: '' }],
    ['a challenge of the wrong length', { code_challenge: 'zu-kurz' }],
    ['a challenge with characters outside base64url', { code_challenge: `${'a'.repeat(42)}+` }],
    ['no challenge at all', { code_challenge: '' }],
    ['a response type we do not implement', { response_type: 'token' }],
  ];
  for (const [what, over] of cases) {
    const url = over['client_id'] === 'weg'
      ? authorizeUrl({ ...over, client_id: 'x' }).replace(/client_id=x&?/, '')
      : authorizeUrl(over);
    const r = await getAuthorize(url);
    assert.equal(r.status, 400, what);
    assert.match(r.headers['Content-Type'] ?? '', /text\/html/, what);
    assertNoRedirect(r.headers, r.body);
  }
});

test('a refusal answers the page in its own language — JSON for JSON', async (t) => {
  await support(t);
  const r = await getAuthorize(authorizeUrl({ code_challenge_method: 'plain' }), 'application/json');
  assert.equal(r.status, 400);
  assert.equal(typeof r.json()?.['error'], 'string', 'the page shows this text in its status line');
});

test('authorization does not exist when access blocks are off', async () => {
  const r = await getAuthorize(authorizeUrl({ client_id: 'wloc1.aaa.bbb' }));
  assert.equal(r.handled, true);
  assert.equal(r.status, 404);
});

// ── consent (P3/T3.4) ──────────────────────────────────────────────────────

/** An access block, encrypted against this server's key as the page would. */
function accessBlock(user = 'redakteurin'): string {
  const s = currentAccessSupport();
  assert.ok(s);
  return encodeAccessToken(
    { v: 2, jti: 'id-authorize', u: user, secret: 'geheim', iat: 1_754_300_000 },
    s.keys.publicKeyPem,
  );
}

function consentBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    token: accessBlock(),
    client_id: over['client_id'] ?? client(),
    redirect_uri: REDIRECT,
    response_type: 'code',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    state: 'xyz',
    ...over,
  };
  for (const [k, v] of Object.entries(body)) if (v === undefined) delete body[k];
  return body;
}

const postConsent = async (body: Record<string, unknown>, store?: CodeStore) => {
  const r = res();
  const handled = await handleOAuthEndpoint(
    req('POST', '/oauth/authorize', JSON.stringify(body)),
    r,
    deps(store ? { codeStore: store } : {}),
  );
  return { handled, ...r.out, json: r.json() };
};

test('a working login yields a code at the registered target', async (t) => {
  await support(t);
  t.after(upstream('redakteurin'));
  const store = createCodeStore();
  const r = await postConsent(consentBody(), store);

  assert.equal(r.status, 200, r.body);
  const redirect = String(r.json?.['redirect']);
  assert.ok(redirect.startsWith(`${REDIRECT}?`), redirect);
  const back = new URL(redirect);
  assert.match(back.searchParams.get('code') ?? '', /^mcp_ac_/);
  assert.equal(back.searchParams.get('state'), 'xyz');
  assert.equal(store.size(), 1);
});

test('the code carries the block, and the answer does not', async (t) => {
  await support(t);
  t.after(upstream('redakteurin'));
  const store = createCodeStore();
  const token = accessBlock();
  const r = await postConsent(consentBody({ token }), store);

  const code = new URL(String(r.json?.['redirect'])).searchParams.get('code')!;
  const record = store.consume(code, Date.now());
  assert.ok(record);
  assert.equal(record.block, token, 'the block waits here until /oauth/token');
  assert.equal(record.challenge, CHALLENGE);
  assert.equal(record.redirectUri, REDIRECT);
  assert.ok(!r.body.includes(token), 'the block must never travel in a URL or a body');
  assert.ok(!r.body.includes('geheim'), 'and neither must the password');
});

test('WLO refusing the login mints nothing', async (t) => {
  await support(t);
  // The guest authority: a 200 from WLO that is NOT a login.
  t.after(upstream('esguest'));
  const store = createCodeStore();
  const r = await postConsent(consentBody(), store);

  assert.equal(r.status, 400);
  assert.match(String(r.json?.['error']), /Zugangsdaten/);
  assert.equal(store.size(), 0, 'a refused login must not leave a usable code behind');
});

test('a request that fails its checks never reaches WLO and never mints', async (t) => {
  await support(t);
  // No fetch mock installed on purpose: if any of these called upstream, the
  // suite's network guard would say so.
  const store = createCodeStore();
  for (const [what, over] of [
    ['a foreign redirect target', { redirect_uri: 'https://boese.example/cb' }],
    ['PKCE downgraded to plain', { code_challenge_method: 'plain' }],
    ['an unreadable client_id', { client_id: 'wloc1.aaa.bbb' }],
    ['no block at all', { token: undefined }],
    ['an empty block', { token: '' }],
  ] as Array<[string, Record<string, unknown>]>) {
    const r = await postConsent(consentBody(over), store);
    assert.equal(r.status, 400, what);
    assert.ok(!r.body.includes('redirect'), `${what}: a refusal must not send anyone anywhere`);
    assert.equal(store.size(), 0, what);
  }
});

test('a block this server cannot open is refused like a wrong password', async (t) => {
  await support(t);
  const store = createCodeStore();
  const r = await postConsent(consentBody({ token: 'wlo2.aaa.bbb.ccc' }), store);
  assert.equal(r.status, 400);
  assert.equal(store.size(), 0);
});

test('a client that sent no state gets none back', async (t) => {
  await support(t);
  t.after(upstream('redakteurin'));
  const r = await postConsent(consentBody({ state: undefined }));
  const back = new URL(String(r.json?.['redirect']));
  assert.equal(back.searchParams.has('state'), false);
  assert.ok(back.searchParams.has('code'));
});

test('an empty state is still passed back — it is the client\'s value, not ours', async (t) => {
  await support(t);
  t.after(upstream('redakteurin'));
  const r = await postConsent(consentBody({ state: '' }));
  assert.equal(new URL(String(r.json?.['redirect'])).searchParams.get('state'), '');
});

test('a body that is not JSON is refused', async (t) => {
  await support(t);
  const r = res();
  await handleOAuthEndpoint(req('POST', '/oauth/authorize', 'kein json'), r, deps());
  assert.equal(r.out.status, 400);
});

test('a body over the cap is refused as too large, not merely as unreadable', async (t) => {
  await support(t);
  // 413 is what RFC 7591 asks for, and it went missing once when `too-large`
  // and `unparseable` were collapsed into the same value during a refactor.
  const huge = JSON.stringify({ redirect_uris: [REDIRECT], client_name: 'x'.repeat(500) });
  const r = await register(huge, { maxBodyBytes: 50 });
  assert.equal(r.status, 413);
  assert.equal(r.json?.['error'], 'invalid_client_metadata');
});

// ── the exchange (P4/T4.1) ─────────────────────────────────────────────────

/** RFC 7636 §4.6's own example pair — its S256 hash IS `CHALLENGE` above. */
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

const postToken = async (fields: Record<string, string>, store: CodeStore) => {
  const r = res();
  const handled = await handleOAuthEndpoint(
    req('POST', '/oauth/token', new URLSearchParams(fields).toString()),
    r,
    deps({ codeStore: store }),
  );
  return { handled, ...r.out, json: r.json() };
};

/** Walk a code out of `/oauth/authorize`, the way a client would. */
async function mintCode(store: CodeStore, over: Record<string, unknown> = {}) {
  const body = consentBody(over);
  const r = await postConsent(body, store);
  assert.equal(r.status, 200, r.body);
  return {
    code: new URL(String(r.json?.['redirect'])).searchParams.get('code')!,
    clientId: String(body['client_id']),
    redirectUri: String(body['redirect_uri']),
    block: String(body['token']),
  };
}

const exchange = (m: Awaited<ReturnType<typeof mintCode>>, over: Record<string, string> = {}) => ({
  grant_type: 'authorization_code',
  code: m.code,
  client_id: m.clientId,
  redirect_uri: m.redirectUri,
  code_verifier: VERIFIER,
  ...over,
});

test('a code becomes the access block, and nothing more', async (t) => {
  await support(t);
  t.after(upstream('redakteurin'));
  const store = createCodeStore();
  const minted = await mintCode(store);

  const r = await postToken(exchange(minted), store);
  assert.equal(r.status, 200, r.body);
  assert.equal(r.json?.['access_token'], minted.block, 'the token IS the block — no second credential exists');
  assert.equal(r.json?.['token_type'], 'Bearer');
  assert.equal(r.json?.['scope'], 'wlo');
  assert.ok(!('refresh_token' in (r.json ?? {})), 'nothing to refresh: the block does not expire on its own');
  assert.ok(!('expires_in' in (r.json ?? {})), 'we cannot honestly name a lifetime — revocation ends it');
  assert.equal(r.headers['Cache-Control'], 'no-store');
  assert.equal(store.size(), 0);
});

test('a code works once', async (t) => {
  await support(t);
  t.after(upstream('redakteurin'));
  const store = createCodeStore();
  const minted = await mintCode(store);

  assert.equal((await postToken(exchange(minted), store)).status, 200);
  const again = await postToken(exchange(minted), store);
  assert.equal(again.status, 400);
  assert.equal(again.json?.['error'], 'invalid_grant');
});

test('a wrong verifier fails — and burns the code with it', async (t) => {
  await support(t);
  t.after(upstream('redakteurin'));
  const store = createCodeStore();
  const minted = await mintCode(store);

  const wrong = await postToken(exchange(minted, { code_verifier: 'x'.repeat(43) }), store);
  assert.equal(wrong.status, 400);
  assert.equal(wrong.json?.['error'], 'invalid_grant');
  // The whole point of PKCE is that a stolen code is useless without the
  // verifier. Leaving the code alive would let the thief keep guessing.
  assert.equal(store.size(), 0, 'a failed attempt must not leave the code usable');
  assert.equal((await postToken(exchange(minted), store)).status, 400, 'not even with the right verifier');
});

test('a code redeemed by the wrong client, or to the wrong place, is refused', async (t) => {
  await support(t);
  t.after(upstream('redakteurin'));
  const store = createCodeStore();

  for (const over of [
    { client_id: client('Fremd') },
    { redirect_uri: 'https://a.example/anders' },
    { code_verifier: '' },
    { code: 'mcp_ac_erfunden' },
  ] as Record<string, string>[]) {
    const minted = await mintCode(store);
    const r = await postToken(exchange(minted, over), store);
    assert.equal(r.status, 400, JSON.stringify(over));
    assert.equal(r.json?.['error'], 'invalid_grant', JSON.stringify(over));
  }
});

test('a native client may come back on a different loopback port', async (t) => {
  await support(t);
  t.after(upstream('redakteurin'));
  const store = createCodeStore();
  // RFC 8252 §7.3, and the reason `redirectUriMatches` has its one loosening:
  // the port is chosen at runtime, so it cannot be part of the match.
  const minted = await mintCode(store, {
    client_id: client('Natives Programm', ['http://localhost:1455/cb']),
    redirect_uri: 'http://localhost:1455/cb',
  });
  const r = await postToken(exchange(minted, { redirect_uri: 'http://127.0.0.1:49152/cb' }), store);
  assert.equal(r.status, 200, r.body);
  assert.equal(r.json?.['access_token'], minted.block);
});

test('a grant type we do not implement is named as such', async (t) => {
  await support(t);
  const store = createCodeStore();
  const r = await postToken({ grant_type: 'refresh_token', code: 'x' }, store);
  assert.equal(r.status, 400);
  assert.equal(r.json?.['error'], 'unsupported_grant_type');
});

test('a body that is not a form is refused as a bad request', async (t) => {
  await support(t);
  const r = res();
  await handleOAuthEndpoint(req('POST', '/oauth/token', ''), r, deps());
  assert.equal(r.out.status, 400);
  assert.equal(r.json()?.['error'], 'invalid_request');
});

test('the token endpoint is POST-only', async (t) => {
  await support(t);
  const r = res();
  await handleOAuthEndpoint(req('GET', '/oauth/token'), r, deps());
  assert.equal(r.out.status, 405);
  assert.equal(r.out.headers['Allow'], 'POST');
});

test('every endpoint the discovery document names is one this server actually owns', async (t) => {
  await support(t);
  // The classic paired-config drift: the metadata is a promise to clients that
  // survives a rename of the route it points at, and the failure is silent —
  // the client follows the document into a 404 and reports "no OAuth here".
  const document = authorizationServerMetadata(ISSUER);
  for (const field of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint']) {
    const path = new URL(String(document[field])).pathname;
    const r = res();
    // An unsupported method: a path we own answers 405, a path we do not is
    // handed back for the caller to fall through.
    const handled = await handleOAuthEndpoint(req('DELETE', path), r, deps());
    assert.equal(handled, true, `${field} → ${path} is not routed here`);
    assert.equal(r.out.status, 405, `${field} → ${path}`);
  }
});

test('consent refuses a body that is not declared JSON, before any login is tried', async (t) => {
  // Same reason as `/auth/issue` (tests/auth-endpoints.test.ts): this endpoint
  // checks a WLO password, the guessing guard counts per client ADDRESS, and a
  // <form enctype="text/plain"> is a SIMPLE request whose body can be crafted to
  // parse as JSON. Requiring the header makes the request non-simple again, so
  // the browser must preflight — and the preflight fails, because /oauth/authorize
  // deliberately carries no CORS header.
  await support(t);
  const restore = upstream('lehrerin');
  t.after(restore);

  const r = res();
  await handleOAuthEndpoint(
    req('POST', '/oauth/authorize', JSON.stringify(consentBody()), 'text/plain'), r, deps());
  assert.equal(r.out.status, 415);
});

test('the endpoints that carry no credential are left alone', async (t) => {
  // Deliberate asymmetry, not an oversight. /oauth/register grants nothing on
  // its own and /oauth/token is form-encoded by RFC 6749 §4.1.3 and useless
  // without a code — so requiring a content type there would only risk breaking
  // a conforming client for no gain.
  await support(t);

  const registered = res();
  await handleOAuthEndpoint(
    req('POST', '/oauth/register', JSON.stringify({ redirect_uris: [REDIRECT] }), 'text/plain'),
    registered, deps());
  assert.equal(registered.out.status, 201, 'registration still works without the header');

  const token = res();
  await handleOAuthEndpoint(
    req('POST', '/oauth/token', 'grant_type=authorization_code&code=nope',
      'application/x-www-form-urlencoded'),
    token, deps());
  assert.equal(token.out.status, 400, 'the token endpoint reaches its own check, not a 415');
  assert.equal(token.json()?.['error'], 'invalid_grant');
});

test('a verifier outside the length RFC 7636 prescribes is refused', async (t) => {
  // §4.1: 43–128 characters, and the floor is the point. A verifier that is
  // merely WRONG already fails the hash comparison, so the length rule only
  // bites where the client CHOSE a short one and registered the matching
  // challenge — exactly the case the RFC bounds, because whoever intercepted the
  // redirect holds both the code and the challenge and can then search the
  // verifier. So the challenges below are the real S256 of the short and the
  // over-long verifier: without the check these exchanges succeed.
  await support(t);
  t.after(upstream('redakteurin'));
  const store = createCodeStore();

  const cases = [
    { verifier: 'x'.repeat(20), challenge: '1PwdtmVEZQfcUbDJOS3ZZJKRWBv-G0jiQbKwgDKztkc' },
    { verifier: 'y'.repeat(129), challenge: 'NRUrsFucSjtDpN2KcC6J5sOajH-3vJk4l1GC11h-yYY' },
  ];
  for (const { verifier, challenge } of cases) {
    const minted = await mintCode(store, { code_challenge: challenge });
    const r = await postToken(exchange(minted, { code_verifier: verifier }), store);
    assert.equal(r.status, 400, `${verifier.length} characters`);
    // Same message as every other failure: which check refused is what a holder
    // of a stolen code would like to learn.
    assert.equal(r.json?.['error'], 'invalid_grant', `${verifier.length} characters`);
  }

  // The ordinary case stays usable — 43 is what every standard client sends.
  const ok = await postToken(exchange(await mintCode(store)), store);
  assert.equal(ok.status, 200, ok.body);
});

test('ohne eigenes Konto verbinden: Code ohne Anmeldung, Token ist der anonyme', async (t) => {
  // Der dritte Ausgang der Zustimmungsseite. Kein Passwort, kein Zugangsblock,
  // kein Eintrag in der Positivliste — und trotzdem ein Code, den der Client
  // eintauschen kann. Nur so kommt ein Client, der die Discovery gefunden hat,
  // überhaupt in den Zustand „verbunden", ohne sich anzumelden.
  await support(t);
  // Jeder Aufruf nach oben wäre hier ein Fehler: es gibt keine Zugangsdaten zu
  // prüfen. Das ist die tragende Zusicherung, nicht der Antworttext.
  const restore = installFetchMock((url) => { throw new Error(`unerwarteter Aufruf: ${url}`); });
  t.after(restore.restore);
  const store = createCodeStore();

  const body = consentBody({ token: undefined, anonymous: true });
  const r = await postConsent(body, store);
  assert.equal(r.status, 200, r.body);
  const code = new URL(String(r.json?.['redirect'])).searchParams.get('code')!;

  const token = await postToken({
    grant_type: 'authorization_code',
    code,
    client_id: String(body['client_id']),
    redirect_uri: REDIRECT,
    code_verifier: VERIFIER,
  }, store);
  assert.equal(token.status, 200, token.body);
  assert.equal(token.json?.['access_token'], ANONYMOUS_ACCESS_TOKEN);
});

test('ohne „anonymous" bleibt ein fehlender Zugangsblock ein Fehler', async (t) => {
  // Die Absicht muss dastehen. Ein Aufruf, der den Block schlicht vergessen hat,
  // darf nicht stillschweigend als anonyme Verbindung enden.
  await support(t);
  const r = await postConsent(consentBody({ token: undefined }), createCodeStore());
  assert.equal(r.status, 400);
  assert.match(String(r.json?.['error']), /Zugangsblock/);
});
