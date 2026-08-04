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
