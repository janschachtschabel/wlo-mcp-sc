/**
 * auth-bearer-access.test.ts – the Bearer branch of `credentialFromHeader` (P3).
 *
 * The rule this must NOT break is older than the feature: a Bearer header is
 * never forwarded upstream, because edu-sharing ignores rather than rejects one
 * and the result would look authenticated while being anonymous. The branch
 * added here honours that — it DECODES a `wlo2.` block into a Basic credential
 * and the Bearer itself stops at this server. `produces a Basic credential`
 * below is that rule as an assertion.
 *
 * The other half is revocation: an id the registry does not list must not
 * authenticate, or the allow-list is decoration.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  credentialFromHeader,
  isUnusableAuthorization,
  isUnusableBearer,
  ANONYMOUS_ACCESS_TOKEN,
  setAccessSupport,
} from '../src/auth/credential.js';
import { encodeAccessToken, loadAuthKeys, type AccessPayload } from '../src/auth/access-token.js';
import { openRegistry, type AccessRegistry } from '../src/auth/access-registry.js';

function pkcs8(): string {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}
const KEY = pkcs8();
const FOREIGN_KEY = pkcs8();

const payload: AccessPayload = {
  v: 2,
  jti: 'listed-id',
  u: 'lehrerin',
  secret: 'geheim',
  iat: 1_754_300_000,
};

const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;

/** Install real key material and a real registry; torn down after each test. */
async function withSupport(t: { after: (fn: () => void) => void }): Promise<AccessRegistry> {
  const dir = mkdtempSync(join(tmpdir(), 'wlo-bearer-'));
  const registry = await openRegistry(join(dir, 'registry.json'));
  assert.ok(registry);
  const keys = loadAuthKeys({ current: KEY });
  assert.ok(keys);
  setAccessSupport({ keys, registry });
  t.after(() => {
    setAccessSupport(null);
    rmSync(dir, { recursive: true, force: true });
  });
  return registry;
}

const tokenFor = (p: AccessPayload = payload, key = KEY) => {
  const keys = loadAuthKeys({ current: key });
  assert.ok(keys);
  return `Bearer ${encodeAccessToken(p, keys.publicKeyPem)}`;
};

test('a listed access block authenticates as its user', async (t) => {
  const registry = await withSupport(t);
  await registry.add({ jti: payload.jti, label: payload.u, iat: payload.iat });

  const cred = credentialFromHeader(tokenFor());
  assert.ok(cred);
  assert.equal(cred.source, 'user');
  assert.equal(cred.label, 'lehrerin');
});

test('the branch produces a Basic credential — a Bearer never goes upstream', async (t) => {
  const registry = await withSupport(t);
  await registry.add({ jti: payload.jti, label: payload.u, iat: payload.iat });

  const cred = credentialFromHeader(tokenFor());
  assert.ok(cred);
  assert.match(cred.header, /^Basic /, 'edu-sharing ignores Bearer; forwarding one would look authenticated');
  assert.equal(cred.header, basic('lehrerin', 'geheim'));
});

test('a revoked block stops authenticating', async (t) => {
  const registry = await withSupport(t);
  await registry.add({ jti: payload.jti, label: payload.u, iat: payload.iat });
  const header = tokenFor();
  assert.ok(credentialFromHeader(header), 'listed to begin with');

  await registry.remove(payload.jti);
  assert.equal(credentialFromHeader(header), null, 'the allow-list is what decides');
});

test('a block whose id was never listed does not authenticate', async (t) => {
  await withSupport(t);
  assert.equal(credentialFromHeader(tokenFor()), null);
});

test('a block encrypted for a foreign key does not authenticate', async (t) => {
  const registry = await withSupport(t);
  await registry.add({ jti: payload.jti, label: payload.u, iat: payload.iat });
  assert.equal(credentialFromHeader(tokenFor(payload, FOREIGN_KEY)), null);
});

test('without configured access support every Bearer is refused', () => {
  setAccessSupport(null);
  assert.equal(credentialFromHeader(tokenFor()), null);
  assert.equal(credentialFromHeader('Bearer nonsense'), null);
});

test('Basic is unaffected by the new branch', async (t) => {
  await withSupport(t);
  const cred = credentialFromHeader(basic('anna', 'geheim'));
  assert.ok(cred);
  assert.equal(cred.source, 'user');
  assert.equal(cred.label, 'anna');
  assert.equal(cred.header, basic('anna', 'geheim'));
});

test('a revoked or malformed block counts as an unusable header', async (t) => {
  const registry = await withSupport(t);
  // T10: the caller turns "unusable" into an anonymous request rather than
  // lending the shared service account — asserted at the HTTP layer in
  // http-app.test.ts. Here we pin that a rejected block reaches that path.
  assert.equal(isUnusableAuthorization(tokenFor()), true, 'not listed');
  assert.equal(isUnusableAuthorization('Bearer wlo2.aa.bb.cc'), true, 'malformed');

  await registry.add({ jti: payload.jti, label: payload.u, iat: payload.iat });
  assert.equal(isUnusableAuthorization(tokenFor()), false, 'listed blocks are usable');
});

/**
 * `isUnusableBearer` narrows `isUnusableAuthorization` to the one scheme where a
 * 401 is the right answer (P1/T1.4).
 *
 * The distinction matters because the two lead to different places. A Bearer we
 * cannot open is OUR token failing — the client should be told to authorize
 * again, and the 401 carries the pointer to where. A Basic header we cannot
 * parse is a WLO login the caller got wrong; sending them into an OAuth flow
 * would answer a question they did not ask, so that case keeps degrading to
 * anonymous exactly as before.
 */
test('only a Bearer counts as an unusable TOKEN — a broken Basic is a login problem', async (t) => {
  const registry = await withSupport(t);

  assert.equal(isUnusableBearer('Bearer nonsense'), true, 'not one of ours');
  assert.equal(isUnusableBearer(tokenFor()), true, 'decodable but not listed');
  assert.equal(isUnusableBearer(tokenFor(payload, FOREIGN_KEY)), true, 'a foreign key');
  assert.equal(isUnusableBearer('bearer nonsense'), true, 'the scheme is case-insensitive');

  assert.equal(isUnusableBearer('Basic !!!'), false, 'unusable, but not as a token');
  assert.equal(isUnusableBearer(basic('anna', 'geheim')), false);
  assert.equal(isUnusableBearer(undefined), false, 'nothing presented is not a failure');
  assert.equal(isUnusableBearer(''), false);
  assert.equal(isUnusableBearer('   '), false);

  await registry.add({ jti: payload.jti, label: payload.u, iat: payload.iat });
  assert.equal(isUnusableBearer(tokenFor()), false, 'a listed block is usable');
});

/**
 * ── Der ausdrücklich anonyme Token (2026-08-06) ────────────────────────────
 *
 * Ein Client, der die Discovery-Dokumente gefunden hat, will einen Token — er
 * kann nicht „einfach nichts schicken". Ohne einen Ausgang für „ohne eigenes
 * WLO-Konto" bleibt ihm nur Anmelden oder Abbrechen, und Abbrechen heißt nicht
 * verbunden. Der Token dafür ist eine feste Zeichenkette, und das ist kein
 * Versehen: er gewährt exakt das, was ein Aufruf ganz ohne Header bekommt. Wer
 * ihn fälscht, hat sich das Weglassen des Headers gespart.
 *
 * Was er NICHT aufweichen darf, ist die ältere Regel: ein vorgelegter Bearer,
 * den wir nicht öffnen können, ist ein 401.
 */
test('der anonyme Token ist kein unbrauchbarer Bearer', () => {
  setAccessSupport(null);
  assert.equal(isUnusableBearer(`Bearer ${ANONYMOUS_ACCESS_TOKEN}`), false,
    'ausdrücklich anonym ist eine Aussage, kein Fehler — sonst 401 bei jedem Aufruf');
  assert.equal(isUnusableAuthorization(`Bearer ${ANONYMOUS_ACCESS_TOKEN}`), false);
  // Und nur genau dieser Wert. Ein Tippfehler darf nicht anonym durchrutschen,
  // sondern muss als kaputter Token auffallen.
  assert.equal(isUnusableBearer(`Bearer ${ANONYMOUS_ACCESS_TOKEN}x`), true);
  assert.equal(isUnusableBearer('Bearer wlo-anon'), true);
});

test('er ergibt keine Zugangsdaten — er ist die Abwesenheit von welchen', () => {
  setAccessSupport(null);
  assert.equal(credentialFromHeader(`Bearer ${ANONYMOUS_ACCESS_TOKEN}`), null,
    'null heißt hier „niemand", und der Aufrufer unterscheidet das über isUnusableBearer');
});

test('er funktioniert auch dann, wenn Zugangsblöcke gar nicht eingerichtet sind', () => {
  // Kein Schlüsselmaterial nötig: es gibt nichts zu entschlüsseln. Damit bleibt
  // die Aussage auf jedem Deployment gültig, auch einem ohne Anmeldung.
  setAccessSupport(null);
  assert.equal(isUnusableBearer(`Bearer ${ANONYMOUS_ACCESS_TOKEN}`), false);
});
