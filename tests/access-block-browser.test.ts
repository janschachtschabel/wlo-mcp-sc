/**
 * access-block-browser.test.ts – the browser encrypts, the server decrypts (P4).
 *
 * This is the seam most likely to break: two implementations of one wire format,
 * written in different languages against different crypto APIs. A mismatch would
 * surface as "your access block does not work" with nothing to point at.
 *
 * It is testable because `crypto.subtle` is a global in Node 20 — so the very
 * module the page loads is imported here and its output handed to the real
 * server decoder. No re-implementation, no mock: if these agree, the page and
 * the server agree.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
// The file `public/auth.html` loads, imported as-is.
import { encodeAccessBlock } from '../public/access-block.js';
import { decodeAccessToken, loadAuthKeys } from '../src/auth/access-token.js';

function keyPair() {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keys = loadAuthKeys({ current: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
  assert.ok(keys);
  return keys;
}

test('a block built in the browser opens with the server key', async () => {
  const keys = keyPair();
  const token = await encodeAccessBlock('lehrerin', 'geheim', keys.publicKeyPem);

  const payload = decodeAccessToken(token, keys);
  assert.ok(payload, 'the server must be able to open what the page produces');
  assert.equal(payload.v, 2);
  assert.equal(payload.u, 'lehrerin');
  assert.equal(payload.secret, 'geheim');
  assert.ok(payload.jti.length >= 16, 'the id must be unguessable, not a counter');
  assert.ok(Math.abs(payload.iat - Math.floor(Date.now() / 1000)) < 120, 'issued now, in seconds');
});

test('a password with umlauts, spaces and a hash survives the round trip', async () => {
  // The service account password contains '#', which already cost one probe run
  // when a naive .env parser mangled it. UTF-8 through the whole chain is not
  // an edge case here, it is the observed reality.
  const keys = keyPair();
  const secret = 'p@ss wört#123 äöüß';
  const token = await encodeAccessBlock('mürrisch', secret, keys.publicKeyPem);
  assert.equal(decodeAccessToken(token, keys)?.secret, secret);
});

test('two blocks for the same login differ and carry different ids', async () => {
  // A fresh AES key and a fresh id per block: identical output would mean a
  // reused key, and a reused id would make revoking one revoke the other.
  const keys = keyPair();
  const a = await encodeAccessBlock('lehrerin', 'geheim', keys.publicKeyPem);
  const b = await encodeAccessBlock('lehrerin', 'geheim', keys.publicKeyPem);
  assert.notEqual(a, b);
  assert.notEqual(decodeAccessToken(a, keys)?.jti, decodeAccessToken(b, keys)?.jti);
});

test('the block has the shape the server parses', async () => {
  const keys = keyPair();
  const token = await encodeAccessBlock('lehrerin', 'geheim', keys.publicKeyPem);
  const parts = token.split('.');
  assert.equal(parts.length, 4);
  assert.equal(parts[0], 'wlo2');
  assert.ok(!token.includes('geheim'), 'the secret is not readable');
  assert.ok(!/[+/=]/.test(token.slice(5)), 'base64url only — the block travels in a header');
});

test('a key that is not a public-key PEM is refused with a clear error', async () => {
  await assert.rejects(
    () => encodeAccessBlock('lehrerin', 'geheim', 'not a pem'),
    /Schl.ssel/,
    'the page shows this text, so it must name the problem in the user\'s language',
  );
});
