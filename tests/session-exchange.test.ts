/**
 * session-exchange.test.ts – a repository session becomes an access block
 * (`POST /auth/session`, off unless `WLO_SESSION_EXCHANGE` is set).
 *
 * For a widget inside an edu-sharing page when this server is mounted on the
 * repository's host below `/edu-sharing`: the browser then sends the session
 * cookie along, and nobody types a password twice. The rules pinned here are
 * the ones measured against staging on 2026-11-15
 * (`scripts/session-disableguest-probe.mjs`):
 *
 *  - an unknown or ended session answers `200` as the GUEST unless the request
 *    says `DisableGuest: true` — then `401`. So the header goes on EVERY call
 *    that carries a session, and the exchange reads the authority;
 *  - a session cookie and an `Authorization` header never travel together;
 *  - the cookie goes to the repository host and nowhere else.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { exchangeSession, sessionCookiesFrom } from '../src/auth/session-exchange.js';
import { applyUpstreamAuth, sessionCredentialHeader } from '../src/auth/upstream-auth.js';
import { decodeAccessToken, encodeAccessToken, loadAuthKeys, type AuthKeys } from '../src/auth/access-token.js';
import { openRegistry, SESSION_BLOCK_TTL_S, type AccessRegistry } from '../src/auth/access-registry.js';
import { credentialFromHeader, runWithCredential, setAccessSupport } from '../src/auth/credential.js';
import { credentialKind } from '../src/auth/auth-status.js';
import { createDistinctValueLimiter, createRateLimiter } from '../src/rate-limit.js';
import { handleAuthEndpoint } from '../src/rest/auth-pages.js';
import { WLO_REPOSITORY_URL } from '../src/wlo-config.js';
import { wloFetch } from '../src/wlo-fetch.js';

const SID = 'A1B2C3D4E5F60718293A4B5C6D7E8F90';
const REPO_ORIGIN = new URL(WLO_REPOSITORY_URL).origin;

/** Fake repository: answers the identity document and records what each call carried. */
function upstream(authority: string | null, opts: { status?: number } = {}) {
  const original = globalThis.fetch;
  const calls: { url: string; headers: Headers }[] = [];
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers) });
    return new Response(
      JSON.stringify(authority ? { person: { authorityName: authority, profile: { firstName: 'Léa', lastName: 'K' } } } : {}),
      { status: opts.status ?? 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

async function support(t: { after: (fn: () => void) => void }): Promise<{ keys: AuthKeys; registry: AccessRegistry; path: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'wlo-session-'));
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

const deps = (s: { keys: AuthKeys; registry: AccessRegistry }) => ({
  ip: '198.51.100.9', authAbuseLimiter: createDistinctValueLimiter(5, 600_000), support: s,
});

// ── which cookies are taken ──────────────────────────────────────────────────

test('only the session cookie and the balancer cookie are taken from a Cookie header', () => {
  assert.deepEqual(sessionCookiesFrom(`theme=dark; JSESSIONID=${SID}; INGRESSCOOKIE=1700000000.123.45.678|abc; other=1`),
    { sessionId: SID, cookie: `JSESSIONID=${SID}; INGRESSCOOKIE=1700000000.123.45.678|abc` });
  assert.deepEqual(sessionCookiesFrom(`JSESSIONID=${SID}`), { sessionId: SID, cookie: `JSESSIONID=${SID}` });
  // Two DIFFERENT session ids are refused outright: a sibling subdomain can plant
  // a cookie with a longer path that sorts first ("cookie tossing"), and taking
  // either one would let it choose whose session the widget works with.
  assert.equal(sessionCookiesFrom(`JSESSIONID=${SID}; JSESSIONID=${'F'.repeat(32)}`), null);
  assert.equal(sessionCookiesFrom(`JSESSIONID=${SID}; JSESSIONID=${SID}`)?.sessionId, SID, 'the same one twice is one');
  assert.equal(sessionCookiesFrom(undefined), null);
  assert.equal(sessionCookiesFrom('INGRESSCOOKIE=1.2.3'), null, 'no session, nothing to exchange');
  assert.equal(sessionCookiesFrom('JSESSIONID=short'), null);
  assert.equal(sessionCookiesFrom('JSESSIONID=has space in it 0123456789'), null);
  assert.equal(sessionCookiesFrom(`JSESSIONID=${SID}\r\nX-Injected: 1`), null, 'CR/LF is header injection');
  // An unusable balancer cookie is dropped, the session still stands.
  assert.deepEqual(sessionCookiesFrom(`JSESSIONID=${SID}; INGRESSCOOKIE=a"b`), { sessionId: SID, cookie: `JSESSIONID=${SID}` });
});

// ── the exchange ─────────────────────────────────────────────────────────────

test('a live session becomes a block that carries the session, listed under the verified account', async (t) => {
  const s = await support(t);
  const up = upstream('lehrerin');
  t.after(up.restore);
  const now = 1_800_000_000_000;

  const out = await exchangeSession({ sessionId: SID, cookie: `JSESSIONID=${SID}` }, deps(s), now);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.authority, 'lehrerin');
  assert.equal(out.displayName, 'Léa K');

  // The proof was asked with the cookie, WITHOUT an Authorization header, and with the guest switched off.
  const proof = up.calls[0]!.headers;
  assert.equal(proof.get('cookie'), `JSESSIONID=${SID}`);
  assert.equal(proof.get('authorization'), null);
  assert.equal(proof.get('disableguest'), 'true');

  const payload = decodeAccessToken(out.block, s.keys);
  assert.equal(payload?.k, 'session');
  assert.equal(payload?.u, 'lehrerin');
  assert.equal(payload?.secret, `JSESSIONID=${SID}`);
  assert.equal(s.registry.has(payload!.jti, now), true);
  assert.equal(s.registry.has(payload!.jti, now + SESSION_BLOCK_TTL_S * 1000 + 1000), false, 'the block ends after twelve hours');

  // The same session again is the same entry — a page reload must not fill the list.
  const again = await exchangeSession({ sessionId: SID, cookie: `JSESSIONID=${SID}` }, deps(s), now + 5000);
  assert.equal(again.ok && decodeAccessToken(again.block, s.keys)?.jti, payload!.jti);
});

test('a session the repository answers as GUEST, or not at all, gives no block', async (t) => {
  const s = await support(t);
  const guest = upstream('esguest');
  const refused = await exchangeSession({ sessionId: SID, cookie: `JSESSIONID=${SID}` }, deps(s), Date.now());
  guest.restore();
  assert.deepEqual([refused.ok, !refused.ok && refused.status], [false, 400]);

  const dead = upstream(null, { status: 401 });
  const gone = await exchangeSession({ sessionId: SID, cookie: `JSESSIONID=${SID}` }, deps(s), Date.now());
  dead.restore();
  assert.deepEqual([gone.ok, !gone.ok && gone.status], [false, 400]);

  const down = upstream(null, { status: 503 });
  const unreachable = await exchangeSession({ sessionId: SID, cookie: `JSESSIONID=${SID}` }, deps(s), Date.now());
  down.restore();
  assert.deepEqual([unreachable.ok, !unreachable.ok && unreachable.status], [false, 503], 'an outage is no verdict on the session');
});

// ── using the block ──────────────────────────────────────────────────────────

test('a session block sends the cookie to the repository only, never beside Authorization', async (t) => {
  const s = await support(t);
  const up = upstream('lehrerin');
  t.after(up.restore);
  const out = await exchangeSession({ sessionId: SID, cookie: `JSESSIONID=${SID}; INGRESSCOOKIE=1.2.3` }, deps(s), Date.now());
  assert.ok(out.ok);
  if (!out.ok) return;

  const cred = credentialFromHeader(`Bearer ${out.block}`);
  assert.ok(cred);
  assert.equal(credentialKind(cred), 'session');
  up.calls.length = 0;
  await runWithCredential(cred, async () => {
    await wloFetch(`${WLO_REPOSITORY_URL}/rest/node/v1/nodes/-home-/x/metadata`);
    await wloFetch('https://de.wikipedia.org/api/rest_v1/page/summary/X');
  });
  const [repo, other] = up.calls.map(c => c.headers);
  assert.equal(repo!.get('cookie'), `JSESSIONID=${SID}; INGRESSCOOKIE=1.2.3`);
  assert.equal(repo!.get('disableguest'), 'true');
  assert.equal(repo!.get('authorization'), null);
  assert.equal(other!.get('cookie'), null, 'a session never leaves for another host');
  assert.equal(other!.get('disableguest'), null);
});

test('putting a session on a call removes an Authorization header that was there', () => {
  const h = new Headers({ Authorization: 'Basic eDp5' });
  applyUpstreamAuth(h, sessionCredentialHeader(`JSESSIONID=${SID}`));
  assert.deepEqual([h.get('authorization'), h.get('cookie'), h.get('disableguest')], [null, `JSESSIONID=${SID}`, 'true']);
  const b = new Headers();
  applyUpstreamAuth(b, 'Basic eDp5');
  assert.deepEqual([b.get('authorization'), b.get('cookie'), b.get('disableguest')], ['Basic eDp5', null, null]);
});

test('a hand-made block on a listed session id is refused: wrong cookie shape, or another kind', async (t) => {
  // The public key is published, so the holder of a listed id can encrypt any
  // content under it. What may become a Cookie header is checked again, and the
  // kind must be the one the entry was listed with.
  const s = await support(t);
  const up = upstream('lehrerin');
  t.after(up.restore);
  const out = await exchangeSession({ sessionId: SID, cookie: `JSESSIONID=${SID}` }, deps(s), Date.now());
  assert.ok(out.ok);
  if (!out.ok) return;
  const real = decodeAccessToken(out.block, s.keys)!;
  const mint = (over: Record<string, unknown>) => encodeAccessToken({ ...real, ...over } as never, s.keys.publicKeyPem);
  assert.ok(credentialFromHeader(`Bearer ${out.block}`), 'the real one stands');
  for (const secret of [`JSESSIONID=${SID}; evil=1`, `JSESSIONID=${SID}\r\nX: 1`, 'other=1', `JSESSIONID=${SID}; JSESSIONID=${'F'.repeat(32)}`]) {
    assert.equal(credentialFromHeader(`Bearer ${mint({ secret })}`), null, JSON.stringify(secret));
  }
  assert.equal(credentialFromHeader(`Bearer ${mint({ k: 'ticket', secret: 'TICKET_0123456789abcdef' })}`), null, 'a session id is not a ticket id');
  const { k: _k, ...noKind } = real;
  assert.equal(credentialFromHeader(`Bearer ${encodeAccessToken({ ...noKind, secret: 'password' }, s.keys.publicKeyPem)}`), null, '…and not a password block');
});

test('the same session id under another person replaces the entry instead of leaving a block nobody can use', async (t) => {
  const s = await support(t);
  const first = upstream('lehrerin');
  const a = await exchangeSession({ sessionId: SID, cookie: `JSESSIONID=${SID}` }, deps(s), Date.now());
  first.restore();
  const second = upstream('kollege');
  t.after(second.restore);
  const b = await exchangeSession({ sessionId: SID, cookie: `JSESSIONID=${SID}` }, deps(s), Date.now());
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  assert.equal(credentialFromHeader(`Bearer ${b.block}`)?.label, 'kollege');
  assert.equal(credentialFromHeader(`Bearer ${a.block}`), null, 'the earlier person\'s block does not act for the later one');
});

// ── the endpoint ─────────────────────────────────────────────────────────────

const req = (headers: Record<string, string>, method = 'POST') => ({
  method, url: '/auth/session',
  headers: { 'content-type': 'application/json', ...headers } as Record<string, string | string[] | undefined>,
  async *[Symbol.asyncIterator]() { yield Buffer.from('{}'); },
});
function res() {
  const out = { status: 0, body: '' };
  return {
    out, json: () => (out.body ? JSON.parse(out.body) as Record<string, unknown> : null),
    writeHead(status: number) { out.status = status; },
    end(body?: string) { out.body = body ?? ''; },
  };
}
const endpointDeps = (over: Record<string, unknown> = {}) => ({
  ip: '198.51.100.7', maxBodyBytes: 100_000, rateLimiter: createRateLimiter(100),
  authAbuseLimiter: createDistinctValueLimiter(3, 600_000), ...over,
});

test('POST /auth/session does not exist unless the operator switched it on', async (t) => {
  await support(t);
  const up = upstream('lehrerin');
  t.after(up.restore);
  const r = res();
  await handleAuthEndpoint(req({ cookie: `JSESSIONID=${SID}`, origin: REPO_ORIGIN }), r, endpointDeps());
  assert.equal(r.out.status, 404);
  assert.equal(up.calls.length, 0, 'the cookie is not even looked at');
});

test('POST /auth/session: the session of a repository page becomes a block', async (t) => {
  const s = await support(t);
  const up = upstream('lehrerin');
  t.after(up.restore);
  const r = res();
  await handleAuthEndpoint(req({ cookie: `x=1; JSESSIONID=${SID}`, origin: REPO_ORIGIN }), r, endpointDeps({ sessionExchange: true }));
  assert.equal(r.out.status, 200);
  assert.equal(r.json()?.['authority'], 'lehrerin');
  assert.equal(decodeAccessToken(String(r.json()?.['block']), s.keys)?.k, 'session');
});

test('POST /auth/session refuses a foreign page, a request without a session, and a non-JSON body', async (t) => {
  await support(t);
  const up = upstream('lehrerin');
  t.after(up.restore);
  const on = endpointDeps({ sessionExchange: true });

  const foreign = res();
  await handleAuthEndpoint(req({ cookie: `JSESSIONID=${SID}`, origin: 'https://evil.example' }), foreign, on);
  assert.equal(foreign.out.status, 403);
  assert.equal(foreign.json()?.['code'], 'origin_not_allowed');

  const none = res();
  await handleAuthEndpoint(req({ origin: REPO_ORIGIN }), none, on);
  assert.equal(none.out.status, 400);

  const form = res();
  await handleAuthEndpoint(req({ cookie: `JSESSIONID=${SID}`, origin: REPO_ORIGIN, 'content-type': 'text/plain' }), form, on);
  assert.equal(form.out.status, 415);
  assert.equal(up.calls.length, 0, 'none of the three reached the repository');
});

test('POST /auth/session refuses a request that names no origin — no browser, no person', async (t) => {
  await support(t);
  const up = upstream('lehrerin');
  t.after(up.restore);
  const on = endpointDeps({ sessionExchange: true });
  for (const origin of [undefined, 'null']) {
    const r = res();
    await handleAuthEndpoint(req({ cookie: `JSESSIONID=${SID}`, ...(origin ? { origin } : {}) }), r, on);
    assert.equal(r.out.status, 403, String(origin));
  }
  assert.equal(up.calls.length, 0);
});

test('POST /auth/session: its own origin list, not the ticket one; GET is 405', async (t) => {
  await support(t);
  const up = upstream('lehrerin');
  t.after(up.restore);
  const page = 'https://redaktion.example.org';
  const cookie = { cookie: `JSESSIONID=${SID}`, origin: page };

  // A page listed for TICKETS may not take over sessions.
  const ticketOnly = res();
  await handleAuthEndpoint(req(cookie), ticketOnly, endpointDeps({ sessionExchange: true, ticketAllowedOrigins: new Set([page]) }));
  assert.equal(ticketOnly.out.status, 403);

  const listed = res();
  await handleAuthEndpoint(req(cookie), listed, endpointDeps({ sessionExchange: true, sessionAllowedOrigins: new Set([page]) }));
  assert.equal(listed.out.status, 200);
  // With a list, the list is the whole statement: the repository's own origin is in it or not.
  const own = res();
  await handleAuthEndpoint(req({ cookie: `JSESSIONID=${SID}`, origin: REPO_ORIGIN }), own, endpointDeps({ sessionExchange: true, sessionAllowedOrigins: new Set([page]) }));
  assert.equal(own.out.status, 403);

  const get = res();
  await handleAuthEndpoint(req(cookie, 'GET'), get, endpointDeps({ sessionExchange: true, sessionAllowedOrigins: new Set([page]) }));
  assert.equal(get.out.status, 405);
});

// ── guard: one reader, one writer ────────────────────────────────────────────

test('a Cookie header is read in one place and written in one place', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const root = new URL('../src/', import.meta.url);
  const files: string[] = [];
  const walk = (dir: URL): void => {
    for (const name of readdirSync(dir)) {
      const url = new URL(name, dir);
      if (statSync(url).isDirectory()) walk(new URL(`${name}/`, dir));
      else if (name.endsWith('.ts')) files.push(url.pathname.split('/src/')[1]!);
    }
  };
  walk(root);
  const text = (f: string) => readFileSync(new URL(f, root), 'utf8');
  // Comments do not count; every spelling a header name can take does.
  const code = (f: string) => text(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  const readers = files.filter(f => /(\[|\.get\(\s*)['"`]cookie['"`]|headers\??\.cookie\b/i.test(code(f)));
  const writers = files.filter(f => /\.(set|append)\(\s*['"`]cookie['"`]|['"`]cookie['"`]\s*:/i.test(code(f)));
  assert.deepEqual(readers, ['rest/auth-pages.ts'], 'the session exchange is the only reader of a Cookie header');
  assert.deepEqual(writers, ['auth/upstream-auth.ts'], 'a cookie is put on an upstream call in one place');
});

// ── what a rollback reads, and what binds a block to its session ─────────────

test('a session entry is one an older build can read: a ticket-class entry with a marker', async (t) => {
  // An older build fails its WHOLE registry closed on a kind it does not know
  // (`isEntry`), which would switch every personal access off after one session
  // exchange and a rollback. The rule of that build, written out: `k` absent or
  // 'ticket', and fields it does not know are carried along.
  const s = await support(t);
  const up = upstream('lehrerin');
  t.after(up.restore);
  const out = await exchangeSession({ sessionId: SID, cookie: `JSESSIONID=${SID}` }, deps(s), Date.now());
  assert.ok(out.ok);
  const entries = (JSON.parse(readFileSync(s.path, 'utf8')) as { entries: Record<string, unknown>[] }).entries;
  assert.equal(entries.length, 1);
  const olderBuildAccepts = (e: Record<string, unknown>) => e['k'] === undefined || e['k'] === 'ticket';
  assert.ok(entries.every(olderBuildAccepts), JSON.stringify(entries));
  assert.equal(entries[0]!['sess'], true);
  assert.equal(s.registry.kindOf(String(entries[0]!['jti'])), 'session');

  // …and this build reads the marker only where it belongs.
  const odd = join(tmpdir(), `wlo-session-odd-${process.pid}.json`);
  t.after(() => rmSync(odd, { force: true }));
  writeFileSync(odd, JSON.stringify({ v: 1, entries: [{ jti: 'a', label: 'x', iat: 1, sess: true }] }));
  assert.equal(await openRegistry(odd), null, 'a session marker without the ticket class fails closed');
});

test('a block on a listed session id cannot carry ANOTHER session', async (t) => {
  // Whoever knows a listed session A can encrypt a block under A's id that sends
  // session B: no new right at the repository, but labelled, counted and
  // revocable as the wrong person. The id is derived from the session id, so
  // the decoder checks they belong together.
  const s = await support(t);
  const up = upstream('lehrerin');
  t.after(up.restore);
  const out = await exchangeSession({ sessionId: SID, cookie: `JSESSIONID=${SID}` }, deps(s), Date.now());
  assert.ok(out.ok);
  if (!out.ok) return;
  const real = decodeAccessToken(out.block, s.keys)!;
  const other = encodeAccessToken({ ...real, secret: `JSESSIONID=${'B'.repeat(32)}` }, s.keys.publicKeyPem);
  assert.equal(credentialFromHeader(`Bearer ${other}`), null);
  assert.ok(credentialFromHeader(`Bearer ${out.block}`), 'the real one stands');
});

test('exchanging again does not extend the twelve hours; after them, the next exchange lists anew', async (t) => {
  const s = await support(t);
  const up = upstream('lehrerin');
  t.after(up.restore);
  const t0 = 1_800_000_000_000;
  const first = await exchangeSession({ sessionId: SID, cookie: `JSESSIONID=${SID}` }, deps(s), t0);
  assert.ok(first.ok);
  if (!first.ok) return;
  const jti = decodeAccessToken(first.block, s.keys)!.jti;
  const exp0 = s.registry.expiresAt(jti);
  await exchangeSession({ sessionId: SID, cookie: `JSESSIONID=${SID}` }, deps(s), t0 + 3_600_000);
  assert.equal(s.registry.expiresAt(jti), exp0, 'an hour later: the same end');
  const later = t0 + (SESSION_BLOCK_TTL_S + 60) * 1000;
  assert.equal(s.registry.has(jti, later), false);
  await exchangeSession({ sessionId: SID, cookie: `JSESSIONID=${SID}` }, deps(s), later);
  assert.equal(s.registry.has(jti, later), true, 'listed again');
  assert.ok((s.registry.expiresAt(jti) ?? 0) > exp0!, 'with a fresh end');
});

// ── a block from an earlier listing does not come back (chatbot team, 2026-11-15, 1b) ──

test('after a revocation, the next exchange of the same session does not revive the old block', async (t) => {
  // The id is derived from the session, so a re-exchange lists the SAME id again.
  // Without a second binding, a block taken in the first hour — or the one a
  // person just revoked in another tab — worked again from that moment on.
  const s = await support(t);
  const up = upstream('lehrerin');
  t.after(up.restore);
  const now = 1_800_000_000_000;
  const first = await exchangeSession({ sessionId: SID, cookie: `JSESSIONID=${SID}` }, deps(s), now);
  assert.ok(first.ok);
  if (!first.ok) return;
  // While listed, a reload gets a block that works side by side with the first.
  const reload = await exchangeSession({ sessionId: SID, cookie: `JSESSIONID=${SID}` }, deps(s), now + 1000);
  assert.ok(reload.ok && credentialFromHeader(`Bearer ${reload.block}`));
  assert.ok(credentialFromHeader(`Bearer ${first.block}`));

  await s.registry.remove(decodeAccessToken(first.block, s.keys)!.jti);
  // Within the same SECOND as the first listing: the listing instant has milliseconds.
  const again = await exchangeSession({ sessionId: SID, cookie: `JSESSIONID=${SID}` }, deps(s), now + 500);
  assert.ok(again.ok);
  if (!again.ok) return;
  assert.ok(credentialFromHeader(`Bearer ${again.block}`), 'the new block works');
  assert.equal(credentialFromHeader(`Bearer ${first.block}`), null, 'the revoked one stays revoked');
  assert.equal(credentialFromHeader(`Bearer ${reload.block}`), null, '…and so does every block of that listing');
});

test('after the twelve hours, the next exchange does not revive the old block either', async (t) => {
  const s = await support(t);
  const up = upstream('lehrerin');
  t.after(up.restore);
  // A listing is stamped by the registry's own clock, never earlier than now —
  // so the time after the twelve hours is reached with a later caller clock.
  const old = await exchangeSession({ sessionId: SID, cookie: `JSESSIONID=${SID}` }, deps(s), Date.now());
  assert.ok(old.ok);
  if (!old.ok) return;
  const later = Date.now() + (SESSION_BLOCK_TTL_S + 60) * 1000;
  const fresh = await exchangeSession({ sessionId: SID, cookie: `JSESSIONID=${SID}` }, deps(s), later);
  assert.ok(fresh.ok && credentialFromHeader(`Bearer ${fresh.block}`));
  assert.equal(credentialFromHeader(`Bearer ${old.block}`), null);
});

test('two exchanges of the same session at once get blocks of ONE listing', async (t) => {
  // Two tabs loading together: deciding "listed or not" outside the registry's
  // serialised write let both start a listing, and the first tab's block was
  // dead on arrival.
  const s = await support(t);
  const up = upstream('lehrerin');
  t.after(up.restore);
  const now = Date.now();
  const [a, b] = await Promise.all([
    exchangeSession({ sessionId: SID, cookie: `JSESSIONID=${SID}` }, deps(s), now),
    exchangeSession({ sessionId: SID, cookie: `JSESSIONID=${SID}` }, deps(s), now + 7),
  ]);
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  assert.ok(credentialFromHeader(`Bearer ${a.block}`), 'the first tab keeps working');
  assert.ok(credentialFromHeader(`Bearer ${b.block}`));
});

test('a session block survives a restart: the listing instant reads back exactly', async (t) => {
  const s = await support(t);
  const up = upstream('lehrerin');
  t.after(up.restore);
  const out = await exchangeSession({ sessionId: SID, cookie: `JSESSIONID=${SID}` }, deps(s), Date.now() + 123);
  assert.ok(out.ok);
  if (!out.ok) return;
  const reopened = await openRegistry(s.path);
  assert.ok(reopened);
  setAccessSupport({ keys: s.keys, registry: reopened });
  assert.ok(credentialFromHeader(`Bearer ${out.block}`));
});

// ── behind a trusted forwarder (chatbot team, 2026-11-15) ────────────────────

test('POST /auth/session through a trusted forwarder: the guessing guard counts per address it names', async (t) => {
  // Every exchange arrives from the forwarder's ONE address. The distinct-session
  // guard (TICKET_CREDENTIAL_LIMIT) would cap the whole platform at one address's
  // budget; per named address it caps each person's network, as without a forwarder.
  await support(t);
  const up = upstream('lehrerin');
  t.after(up.restore);
  const guard = createDistinctValueLimiter(1, 600_000);
  const forwarder = (address: string) => ({
    limiter: createRateLimiter(100), key: 'client:boerdi', abuseBucket: `client:boerdi|ip:${address}`, address,
  });
  const on = (address: string) => endpointDeps({ sessionExchange: true, ticketAbuseLimiter: guard, trustedForwarder: forwarder(address) });
  const cookie = (sid: string) => ({ cookie: `JSESSIONID=${sid}`, origin: REPO_ORIGIN });
  const a1 = res();
  await handleAuthEndpoint(req(cookie(SID)), a1, on('203.0.113.5'));
  assert.equal(a1.out.status, 200);
  const a2 = res();
  await handleAuthEndpoint(req(cookie('B'.repeat(32))), a2, on('203.0.113.5'));
  assert.equal(a2.out.status, 429, 'the same address, a second session: over its budget of one');
  assert.equal(a2.json()?.['code'], 'too_many_logins');
  assert.ok(Number(a2.json()?.['retryAfter']) > 60, 'the wait of THAT bucket\'s ten-minute window');
  const b = res();
  await handleAuthEndpoint(req(cookie('B'.repeat(32))), b, on('198.51.100.20'));
  assert.equal(b.out.status, 200, 'another address the forwarder names has its own budget');
  const direct = res();
  await handleAuthEndpoint(req(cookie('C'.repeat(32))), direct, endpointDeps({ sessionExchange: true, ticketAbuseLimiter: guard }));
  assert.equal(direct.out.status, 200, 'and the forwarder\'s own address is a third bucket');
});

test('the forwarder\'s budget applies to /auth/session and /auth/revoke only — a password path keeps the address', async (t) => {
  await support(t);
  const up = upstream('lehrerin');
  t.after(up.restore);
  const spentAddress = createRateLimiter(1);
  spentAddress.check('198.51.100.7', Date.now());
  const deps = endpointDeps({
    sessionExchange: true, rateLimiter: spentAddress,
    trustedForwarder: { limiter: createRateLimiter(100), key: 'client:boerdi', abuseBucket: 'client:boerdi|ip:203.0.113.5', address: '203.0.113.5' },
  });
  const exchange = res();
  await handleAuthEndpoint(req({ cookie: `JSESSIONID=${SID}`, origin: REPO_ORIGIN }), exchange, deps);
  assert.equal(exchange.out.status, 200);
  const issue = res();
  await handleAuthEndpoint({ ...req({}), url: '/auth/issue' }, issue, deps);
  assert.equal(issue.out.status, 429, 'issuance checks a password: the address budget, whoever forwards');
});

// ── what the operator can see (chatbot team, third answer, 2026-11-15) ──────

/** Capture the structured log lines written while `fn` runs. */
async function captureLog(fn: () => Promise<void>): Promise<Record<string, unknown>[]> {
  const real = process.stderr.write.bind(process.stderr);
  const lines: string[] = [];
  process.stderr.write = ((chunk: unknown) => { lines.push(String(chunk)); return true; }) as typeof process.stderr.write;
  try { await fn(); } finally { process.stderr.write = real; }
  return lines.flatMap((l) => l.split('\n').filter(Boolean))
    .flatMap((l) => { try { return [JSON.parse(l) as Record<string, unknown>]; } catch { return []; } });
}

test('a session exchange logs the address it counted — as a pseudonym — and a forwarder that named none is warned about', async (t) => {
  // Pseudonyms are the default; a developer's LOG_PERSONAL_DATA=plain must not decide this test.
  const before = process.env['LOG_PERSONAL_DATA'];
  delete process.env['LOG_PERSONAL_DATA'];
  t.after(() => { if (before === undefined) delete process.env['LOG_PERSONAL_DATA']; else process.env['LOG_PERSONAL_DATA'] = before; });
  await support(t);
  const up = upstream('lehrerin');
  t.after(up.restore);
  const forwarder = (named: boolean, address = '203.0.113.5') => ({
    limiter: createRateLimiter(100), key: 'client:boerdi', named,
    abuseBucket: named ? `client:boerdi|ip:${address}` : 'client:boerdi', address: named ? address : '198.51.100.2',
  });
  const run = (named: boolean, sid: string, address?: string) => captureLog(async () => {
    await handleAuthEndpoint(req({ cookie: `JSESSIONID=${sid}`, origin: REPO_ORIGIN }), res(),
      endpointDeps({ sessionExchange: true, trustedForwarder: forwarder(named, address) }));
  });
  const named = await run(true, SID);
  const done = named.find((l) => l['message'] === 'session exchanged for an access block');
  assert.ok(done, 'the success line');
  assert.equal(typeof done['ip'], 'string');
  assert.notEqual(done['ip'], '203.0.113.5', 'a pseudonym, never the address');
  assert.ok(!named.some((l) => String(l['message']).includes('named no usable address')));
  const other = (await run(true, 'D'.repeat(32))).find((l) => l['message'] === 'session exchanged for an access block');
  assert.equal(other?.['ip'], done['ip'], 'one address, one pseudonym');
  const elsewhere = (await run(true, 'F'.repeat(32), '198.51.100.77')).find((l) => l['message'] === 'session exchanged for an access block');
  assert.ok(elsewhere?.['ip'] && elsewhere['ip'] !== done['ip'], 'and another address another — so a forwarder\'s people can be told apart');

  const unnamed = await run(false, 'E'.repeat(32));
  const warn = unnamed.find((l) => String(l['message']).includes('named no usable address'));
  assert.ok(warn, 'the operator sees that the whole client shares one bucket');
  assert.equal(warn['client'], 'client:boerdi');
  assert.ok(!JSON.stringify(unnamed).includes('198.51.100.2'), 'no address in the clear');
});
