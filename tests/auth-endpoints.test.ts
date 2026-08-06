/**
 * auth-endpoints.test.ts – issuing and revoking access blocks over HTTP (P5).
 *
 * The rule that shapes `/auth/issue` came out of the P0 probe and is easy to get
 * wrong: at this API, **a 200 is not proof of a login**. An anonymous call to
 * `/node/v1/nodes/-home-/-userhome-/children` answers 200, and the identity
 * endpoint answers 200 with `esguest`. So issuance must read the reported
 * AUTHORITY, never `res.ok` — otherwise we hand out blocks for credentials that
 * do not work, and the holder finds out days later when every tool returns
 * nothing. `200 from WLO with the guest authority is not a login` pins exactly
 * that.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleAuthEndpoint } from '../src/rest/auth-pages.js';
import { setAccessSupport } from '../src/auth/credential.js';
import { encodeAccessToken, loadAuthKeys, type AuthKeys } from '../src/auth/access-token.js';
import { openRegistry, type AccessRegistry } from '../src/auth/access-registry.js';
import { createDistinctValueLimiter, createRateLimiter } from '../src/rate-limit.js';

/** Fake upstream: the identity endpoint reports whatever authority we choose. */
function upstream(authority: string | null, status = 200) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify(authority ? { person: { authorityName: authority } } : {}),
    { status, headers: { 'content-type': 'application/json' } },
  )) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

/**
 * `content-type` defaults to what all three access-block pages actually send.
 * The endpoints REQUIRE it (see the 415 tests below), so a helper that omitted
 * it would test a request no real client makes.
 */
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
    ip: '198.51.100.7',
    maxBodyBytes: 1_000_000,
    rateLimiter: createRateLimiter(100),
    authAbuseLimiter: createDistinctValueLimiter(3, 600_000),
    ...over,
  };
}

async function support(
  t: { after: (fn: () => void) => void },
): Promise<{ keys: AuthKeys; registry: AccessRegistry; path: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'wlo-endpoints-'));
  const path = join(dir, 'registry.json');
  const registry = await openRegistry(path);
  assert.ok(registry);
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keys = loadAuthKeys({ current: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
  assert.ok(keys);
  setAccessSupport({ keys, registry });
  t.after(() => { setAccessSupport(null); rmSync(dir, { recursive: true, force: true }); });
  return { keys, registry, path };
}

const block = (keys: AuthKeys, jti = 'id-1', u = 'lehrerin', secret = 'geheim', iat = 1_754_300_000) =>
  encodeAccessToken({ v: 2, jti, u, secret, iat }, keys.publicKeyPem);

const post = (url: string, token: string) => req('POST', url, JSON.stringify({ token }));

// ── the public key ─────────────────────────────────────────────────────────

test('the public key is served so the page can encrypt', async (t) => {
  const { keys } = await support(t);
  const r = res();
  assert.equal(await handleAuthEndpoint(req('GET', '/auth/public-key'), r, deps()), true);
  assert.equal(r.out.status, 200);
  assert.equal(r.json()?.['publicKey'], keys.publicKeyPem);
});

test('with the feature switched off the endpoints do not exist', async () => {
  setAccessSupport(null);
  for (const [method, url] of [['GET', '/auth/public-key'], ['POST', '/auth/issue'], ['POST', '/auth/revoke']]) {
    const r = res();
    assert.equal(await handleAuthEndpoint(req(method!, url!, '{}'), r, deps()), true);
    assert.equal(r.out.status, 404, `${method} ${url}`);
  }
});

test('a path we do not own falls through', async (t) => {
  await support(t);
  assert.equal(await handleAuthEndpoint(req('GET', '/mcp'), res(), deps()), false);
});

test('a wrong method on a known path is 405, not 404', async (t) => {
  await support(t);
  const r = res();
  await handleAuthEndpoint(req('GET', '/auth/issue'), r, deps());
  assert.equal(r.out.status, 405);
});

/**
 * `/auth/revoke` is the path the design names for the revocation PAGE and the
 * one people guess, because it mirrors `/auth`. It is also the POST endpoint —
 * so this module owns the POST and hands the GET back to the static map, rather
 * than answering the person who came to block a compromised access with
 * `{"error":"Method not allowed. Use POST."}`.
 */
test('a GET on the revocation path is left to the page, not refused', async (t) => {
  await support(t);
  const r = res();
  assert.equal(await handleAuthEndpoint(req('GET', '/auth/revoke'), r, deps()), false);
  assert.equal(r.out.status, 0, 'nothing was written — the static branch answers');
});

/**
 * Measured before the fix: with a registry that cannot write — a full disk, a
 * volume not mounted, a permission — the rejection left `handleAuthEndpoint`,
 * node:http never awaits a handler's return value, and the caller got NO answer
 * at all. The socket stayed open until `requestTimeout`: thirty seconds of
 * "Verschlüsseln und prüfen …" right after someone typed their password, then a
 * network error that says nothing. The MCP branch has had such a boundary from
 * the start; this one had none.
 */
test('a registry that cannot write is answered, not left hanging', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'wlo-endpoints-'));
  t.after(() => { setAccessSupport(null); rmSync(dir, { recursive: true, force: true }); });
  const path = join(dir, 'registry.json');
  const registry = await openRegistry(path);
  assert.ok(registry);
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keys = loadAuthKeys({ current: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
  assert.ok(keys);
  setAccessSupport({ keys, registry });
  mkdirSync(`${path}.tmp`); // a directory where the write wants its temp file
  t.after(upstream('lehrerin'));

  const r = res();
  const handled = await handleAuthEndpoint(post('/auth/issue', block(keys)), r, deps());
  assert.equal(handled, true, 'the endpoint still owns the request');
  assert.equal(r.out.status, 500);
  assert.match(r.out.body, /Serverfehler/);
  assert.doesNotMatch(r.out.body, /EISDIR|registry\.json/, 'and leaks no internals');
});

/**
 * On a REFUSED issuance nothing has confirmed `u` — it is whatever the caller
 * encrypted, up to `MAX_BODY_BYTES` of text of their choosing, per request, in
 * the operator's log. The project's rule for foreign text at a boundary is
 * `sanitizeText`; `identity.ts` applies it even to the authority name we asked
 * for ourselves.
 */
test('a username offered for issuance is capped and flattened before it is logged', async (t) => {
  const { keys } = await support(t);
  t.after(upstream('esguest')); // WLO refuses: nothing about `u` is verified

  const captured: string[] = [];
  const realWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown) => { captured.push(String(chunk)); return true; }) as never;
  try {
    const flood = `zeile\nzwei${'x'.repeat(4000)}`;
    await handleAuthEndpoint(post('/auth/issue', block(keys, 'id-1', flood)), res(), deps());
  } finally { process.stderr.write = realWrite; }

  const logged = captured.join('');
  assert.ok(logged.length < 600, `one refusal must not flood the log, got ${logged.length} chars`);
  assert.doesNotMatch(logged, /zeile\\nzwei/, 'and carries no line break of the caller’s choosing');
});

/**
 * `iat` inside the block comes from the BROWSER's clock — whoever built the
 * block chose it, and a wrong system time or a deliberate value lands in the
 * registry as the issue date an operator would prune or audit by. Record when
 * WE registered it instead.
 */
test('the registry records our own issue time, not the one inside the block', async (t) => {
  const { keys, path } = await support(t);
  t.after(upstream('lehrerin'));
  const before = Math.floor(Date.now() / 1000);

  await handleAuthEndpoint(post('/auth/issue', block(keys, 'id-1', 'lehrerin', 'geheim', 0)), res(), deps());

  const stored = JSON.parse(readFileSync(path, 'utf8')) as { entries: { iat: number }[] };
  assert.equal(stored.entries.length, 1);
  assert.ok(stored.entries[0]!.iat >= before, `expected our clock, got ${stored.entries[0]!.iat}`);
});

// ── T14: issuing ───────────────────────────────────────────────────────────

test('a block for working credentials is registered', async (t) => {
  const { keys, registry } = await support(t);
  const restore = upstream('lehrerin');
  t.after(restore);

  const r = res();
  await handleAuthEndpoint(post('/auth/issue', block(keys)), r, deps());
  assert.equal(r.out.status, 200);
  assert.equal(registry.has('id-1'), true, 'the id must be on the allow-list afterwards');
});

test('200 from WLO with the guest authority is not a login', async (t) => {
  const { keys, registry } = await support(t);
  const restore = upstream('esguest'); // exactly what wrong/absent credentials yield
  t.after(restore);

  const r = res();
  await handleAuthEndpoint(post('/auth/issue', block(keys)), r, deps());
  assert.equal(r.out.status, 400, 'res.ok is not the test — the authority is');
  assert.equal(registry.has('id-1'), false, 'nothing may be registered for a login that does not work');
  assert.match(String(r.json()?.['error']), /Zugangsdaten/, 'and the page must be able to say why');
});

test('a rejected login is not registered and says so in German', async (t) => {
  const { keys, registry } = await support(t);
  const restore = upstream(null, 401);
  t.after(restore);

  const r = res();
  await handleAuthEndpoint(post('/auth/issue', block(keys)), r, deps());
  assert.equal(r.out.status, 400);
  assert.equal(registry.has('id-1'), false);
});

test('a block we cannot open is refused without touching the registry', async (t) => {
  const { registry } = await support(t);
  const r = res();
  await handleAuthEndpoint(post('/auth/issue', 'wlo2.aa.bb.cc'), r, deps());
  assert.equal(r.out.status, 400);
  assert.equal(registry.has('id-1'), false);
});

test('a malformed body is refused', async (t) => {
  await support(t);
  for (const body of ['not json', '{}', JSON.stringify({ token: 42 })]) {
    const r = res();
    await handleAuthEndpoint(req('POST', '/auth/issue', body), r, deps());
    assert.equal(r.out.status, 400, body);
  }
});

test('no response ever carries the password back', async (t) => {
  const { keys } = await support(t);
  const restore = upstream('lehrerin');
  t.after(restore);
  const r = res();
  await handleAuthEndpoint(post('/auth/issue', block(keys, 'id-9', 'lehrerin', 'streng-geheim')), r, deps());
  assert.ok(!r.out.body.includes('streng-geheim'));
});

// ── T15: revoking ──────────────────────────────────────────────────────────

test('revoking a listed block removes it', async (t) => {
  const { keys, registry } = await support(t);
  await registry.add({ jti: 'id-1', label: 'lehrerin', iat: 1 });

  const r = res();
  await handleAuthEndpoint(post('/auth/revoke', block(keys)), r, deps());
  assert.equal(r.out.status, 200);
  assert.equal(r.json()?.['revoked'], true);
  assert.equal(registry.has('id-1'), false);
});

test('revoking an unlisted block reports honestly instead of erroring', async (t) => {
  // 200 with `revoked: false`, not 404: a distinct answer for "this id exists"
  // would turn the endpoint into an oracle for guessing ids.
  const { keys } = await support(t);
  const r = res();
  await handleAuthEndpoint(post('/auth/revoke', block(keys, 'never-listed')), r, deps());
  assert.equal(r.out.status, 200);
  assert.equal(r.json()?.['revoked'], false);
});

test('revoking needs a block we can open', async (t) => {
  await support(t);
  const r = res();
  await handleAuthEndpoint(post('/auth/revoke', 'wlo2.xx.yy.zz'), r, deps());
  assert.equal(r.out.status, 400);
});

// ── T16: the brute-force guard ─────────────────────────────────────────────

test('issuing is rate limited per address', async (t) => {
  const { keys } = await support(t);
  const restore = upstream('lehrerin');
  t.after(restore);
  const d = deps({ rateLimiter: createRateLimiter(2) });

  const codes: number[] = [];
  for (let i = 0; i < 4; i++) {
    const r = res();
    await handleAuthEndpoint(post('/auth/issue', block(keys, `id-${i}`)), r, d);
    codes.push(r.out.status);
  }
  assert.ok(codes.includes(429), `expected a 429 among ${codes.join(',')}`);
});

test('a stream of DIFFERENT logins from one address is refused as guessing', async (t) => {
  // /auth/issue verifies credentials against WLO, so without this it is a
  // password-guessing oracle with our address as the origin.
  const { keys } = await support(t);
  const restore = upstream('esguest'); // every attempt fails, as when guessing
  t.after(restore);
  const d = deps({ authAbuseLimiter: createDistinctValueLimiter(2, 600_000) });

  const codes: number[] = [];
  for (let i = 0; i < 5; i++) {
    const r = res();
    await handleAuthEndpoint(post('/auth/issue', block(keys, `id-${i}`, `user${i}`, `pw${i}`)), r, d);
    codes.push(r.out.status);
  }
  assert.ok(codes.includes(429), `expected a 429 among ${codes.join(',')}`);
});

test('a body that is not declared JSON is refused before anything is read', async (t) => {
  // The guessing guard on /auth/issue counts per client ADDRESS. A cross-origin
  // `fetch` cannot reach here — no CORS header is sent, so the preflight fails —
  // but a plain <form enctype="text/plain"> is a SIMPLE request that needs no
  // preflight, and its body can be crafted to be valid JSON. Without this check
  // a page could make every visitor submit a guess from their own address, and
  // the author would read the outcome by presenting the block at /mcp later.
  // That turns a per-address cap into no cap at all.
  //
  // Requiring the header is what makes the request non-simple again.
  const { keys } = await support(t);
  const restore = upstream('lehrerin');
  t.after(restore);

  for (const path of ['/auth/issue', '/auth/revoke']) {
    const r = res();
    const body = JSON.stringify({ token: block(keys) });
    await handleAuthEndpoint(req('POST', path, body, 'text/plain'), r, deps());
    assert.equal(r.out.status, 415, `${path} refuses a text/plain body`);
  }
});

test('a missing content-type is refused too, and the charset parameter is allowed', async (t) => {
  const { keys } = await support(t);
  const restore = upstream('lehrerin');
  t.after(restore);
  const body = JSON.stringify({ token: block(keys) });

  const missing = res();
  await handleAuthEndpoint(req('POST', '/auth/revoke', body, ''), missing, deps());
  assert.equal(missing.out.status, 415, 'absent is not "close enough"');

  // `fetch` sends the charset on a string body in some runtimes; refusing that
  // would break the very pages this server ships.
  const charset = res();
  await handleAuthEndpoint(
    req('POST', '/auth/revoke', body, 'application/json; charset=utf-8'), charset, deps());
  assert.equal(charset.out.status, 200, 'a parameter after the type is still JSON');
});

/**
 * What revocation actually requires — pinned because the registry's own comment
 * claimed something stronger until 2026-08-06 ("revoking a block requires
 * holding it"), and the cap it argues for rests on this being understood right.
 *
 * Anyone can build a block: the public key is published so the browser can
 * encrypt with it. So what `/auth/revoke` proves is knowledge of the access ID,
 * not possession of the original block. That is deliberate — a compromised block
 * must be revocable by whoever notices — but it means the ID is the secret, and
 * a single log line or response field carrying one would turn this into "anyone
 * can end anyone's access". The last two assertions are that boundary.
 */
test('revocation is authenticated by the access id, and the id never leaks', async (t) => {
  const { keys, registry } = await support(t);
  const restore = upstream('lehrerin');
  t.after(restore);

  const issued = res();
  await handleAuthEndpoint(post('/auth/issue', block(keys, 'id-geheim')), issued, deps());
  assert.equal(issued.out.status, 200);
  assert.equal(registry.has('id-geheim'), true);
  // The issuance answer carries the label and nothing that identifies the block.
  assert.doesNotMatch(issued.out.body, /id-geheim/, 'the access id must not be handed back');

  // A DIFFERENT block, built by anyone against the published key, carrying the
  // same id — and it revokes.
  const forged = encodeAccessToken(
    { v: 2, jti: 'id-geheim', u: 'jemand-anders', secret: 'x', iat: 1 }, keys.publicKeyPem);
  const revoked = res();
  await handleAuthEndpoint(post('/auth/revoke', forged), revoked, deps());
  assert.equal(revoked.json()?.['revoked'], true);
  assert.equal(registry.has('id-geheim'), false);
});
