/**
 * auth-revoke-all.test.ts – ending every access of one WLO account.
 *
 * The gap this closes was found in use, not in review: over OAuth the access
 * block travels to the CLIENT and is never shown to the person, so `/auth/revoke`
 * — which needs the block — is unreachable for exactly the people most likely to
 * want it. Until this endpoint existed, an OAuth-issued access could only be
 * ended by the operator editing the registry file.
 *
 * One check carries the whole design: **the login must be verified upstream
 * before anything is removed.** The public key is published so browsers can
 * encrypt, which means anyone can build a block naming any user. Without the
 * upstream check this endpoint would let a stranger disconnect a teacher's AI
 * host by guessing their username — a denial of service with no password
 * involved. `a login WLO does not accept revokes nothing` is that test, and it
 * is the one that must never be weakened.
 *
 * The second rule follows from the first: checking a password makes this a
 * guessing oracle, so it passes the same two limiters as `/auth/issue`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleAuthEndpoint } from '../src/rest/auth-pages.js';
import { setAccessSupport } from '../src/auth/credential.js';
import { encodeAccessToken, loadAuthKeys, type AuthKeys } from '../src/auth/access-token.js';
import { openRegistry, type AccessRegistry } from '../src/auth/access-registry.js';
import { createDistinctValueLimiter, createRateLimiter } from '../src/rate-limit.js';

const PAGE = new URL('../public/auth-revoke.js', import.meta.url);

/** Fake upstream identity: `esguest` is what a rejected login looks like. */
function upstream(authority: string) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ person: { authorityName: authority } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

const req = (method: string, url: string, body?: string, contentType = 'application/json') => ({
  method,
  url,
  headers: { 'content-type': contentType } as Record<string, string | string[] | undefined>,
  async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(body); },
});

function res() {
  const out = { status: 0, body: '' };
  return {
    out,
    json: () => (out.body ? JSON.parse(out.body) as Record<string, unknown> : null),
    writeHead(status: number) { out.status = status; },
    end(body?: string) { out.body = body ?? ''; },
  };
}

function deps(over: Partial<Parameters<typeof handleAuthEndpoint>[2]> = {}) {
  return {
    ip: '198.51.100.9',
    maxBodyBytes: 1_000_000,
    rateLimiter: createRateLimiter(100),
    authAbuseLimiter: createDistinctValueLimiter(3, 600_000),
    ...over,
  };
}

async function support(t: { after: (fn: () => void) => void }): Promise<{
  keys: AuthKeys; registry: AccessRegistry;
}> {
  const dir = mkdtempSync(join(tmpdir(), 'wlo-revoke-all-'));
  const registry = await openRegistry(join(dir, 'registry.json'));
  assert.ok(registry);
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keys = loadAuthKeys({ current: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
  assert.ok(keys);
  setAccessSupport({ keys, registry });
  t.after(() => { setAccessSupport(null); rmSync(dir, { recursive: true, force: true }); });
  return { keys, registry };
}

const block = (keys: AuthKeys, u: string, secret = 'geheim') =>
  encodeAccessToken({ v: 2, jti: 'unbenutzt', u, secret, iat: 1_754_300_000 }, keys.publicKeyPem);

const post = (token: string) => req('POST', '/auth/revoke-all', JSON.stringify({ token }));

// ── the check the whole endpoint hangs on ──────────────────────────────────

test('a login WLO does not accept revokes nothing', async (t) => {
  const { keys, registry } = await support(t);
  await registry.add({ jti: 'laptop', label: 'lehrerin', iat: 1_754_300_000 });
  t.after(upstream('esguest'));

  const r = res();
  await handleAuthEndpoint(post(block(keys, 'lehrerin', 'geraten')), r, deps());

  assert.equal(r.out.status, 400);
  assert.equal(registry.has('laptop'), true, 'a guessed username must not end a stranger’s access');
});

/**
 * The same guard from the other side: the upstream answer is a 200 either way,
 * so an implementation reading `res.ok` instead of the reported authority would
 * pass the test above only by accident. Here WLO reports a real authority and
 * the removal must happen.
 */
test('a working login ends every block of that account and no other', async (t) => {
  const { keys, registry } = await support(t);
  await registry.add({ jti: 'laptop', label: 'lehrerin', iat: 1_754_300_000 });
  await registry.add({ jti: 'handy', label: 'lehrerin', iat: 1_754_300_001 });
  await registry.add({ jti: 'fremd', label: 'jemand-anders', iat: 1_754_300_002 });
  t.after(upstream('lehrerin'));

  const r = res();
  await handleAuthEndpoint(post(block(keys, 'lehrerin')), r, deps());

  assert.equal(r.out.status, 200);
  assert.equal(r.json()?.['revoked'], 2);
  assert.equal(registry.has('laptop'), false);
  assert.equal(registry.has('handy'), false);
  assert.equal(registry.has('fremd'), true, 'another account keeps its access');
});

test('an account with nothing listed is answered, not treated as an error', async (t) => {
  const { keys } = await support(t);
  t.after(upstream('lehrerin'));

  const r = res();
  await handleAuthEndpoint(post(block(keys, 'lehrerin')), r, deps());
  assert.equal(r.out.status, 200);
  assert.equal(r.json()?.['revoked'], 0);
});

// ── the surface around it ──────────────────────────────────────────────────

/**
 * Checking a password makes this endpoint the same guessing oracle `/auth/issue`
 * is, with our address as the origin — so it counts against the same
 * distinct-login limiter. Without it, a revocation endpoint would be the cheaper
 * way to run exactly the guesses issuance bounds.
 */
test('distinct logins from one address are bounded here too', async (t) => {
  const { keys } = await support(t);
  t.after(upstream('esguest'));
  const d = deps({ authAbuseLimiter: createDistinctValueLimiter(2, 600_000) });

  for (const secret of ['a', 'b']) {
    await handleAuthEndpoint(post(block(keys, 'lehrerin', secret)), res(), d);
  }
  const r = res();
  await handleAuthEndpoint(post(block(keys, 'lehrerin', 'c')), r, d);
  assert.equal(r.out.status, 429);
});

/**
 * What keeps a cross-origin page out: requiring a DECLARED JSON body makes the
 * request non-simple, so the browser must preflight, and the preflight fails
 * because this surface sends no CORS header. A `<form enctype="text/plain">`
 * would otherwise reach here from any site.
 */
test('a body that is not declared JSON is refused', async (t) => {
  const { keys } = await support(t);
  const r = res();
  await handleAuthEndpoint(
    req('POST', '/auth/revoke-all', JSON.stringify({ token: block(keys, 'lehrerin') }), 'text/plain'),
    r,
    deps(),
  );
  assert.equal(r.out.status, 415);
});

test('with the feature switched off the endpoint does not exist', async () => {
  setAccessSupport(null);
  const r = res();
  await handleAuthEndpoint(req('POST', '/auth/revoke-all', '{}'), r, deps());
  assert.equal(r.out.status, 404);
});

test('a wrong method is 405, not 404', async (t) => {
  await support(t);
  const r = res();
  await handleAuthEndpoint(req('GET', '/auth/revoke-all'), r, deps());
  assert.equal(r.out.status, 405);
});

// ── page and endpoint must agree ───────────────────────────────────────────

/**
 * The lesson from P3, where the consent page and its endpoint were each green
 * against the author's own idea of the request body and disagreed in production
 * (`response_type` was missing, so every consent failed). So the request shape
 * is taken out of the PAGE and fed to the REAL handler, rather than written
 * twice from the same assumption.
 */
test('the page posts what the endpoint accepts', async (t) => {
  const { keys, registry } = await support(t);
  await registry.add({ jti: 'laptop', label: 'lehrerin', iat: 1_754_300_000 });
  t.after(upstream('lehrerin'));

  const page = readFileSync(PAGE, 'utf8');
  const url = /fetch\('(\/auth\/revoke-all)'/.exec(page)?.[1];
  assert.ok(url, 'the page must call the endpoint this test covers');
  const field = /JSON\.stringify\(\{\s*(\w+)/.exec(page.slice(page.indexOf(url)))?.[1];
  assert.ok(field, 'the page must name the body field it sends');

  const r = res();
  await handleAuthEndpoint(
    req('POST', url, JSON.stringify({ [field]: block(keys, 'lehrerin') })),
    r,
    deps(),
  );
  assert.equal(r.out.status, 200, `the endpoint rejected the body the page sends: ${r.out.body}`);
  assert.equal(registry.has('laptop'), false);
});

/**
 * The password is encrypted in the browser on this page for the same reason it
 * is on the issuance page — and the shared module is the only implementation of
 * the wire format, so a second, hand-rolled one is the way that guarantee gets
 * lost.
 */
test('the page encrypts in the browser rather than posting a password', async () => {
  const page = readFileSync(PAGE, 'utf8');
  assert.ok(page.includes("from './access-block.js'"), 'must use the shared encoder');
  assert.ok(page.includes('encodeAccessBlock'), 'must build a block, not send credentials');
});
