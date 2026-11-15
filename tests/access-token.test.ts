/**
 * access-token.test.ts – the encrypted access block (P1, design
 * `docs/plans/2026-08-04-mcp-access-token-design.md`).
 *
 * The block carries a WLO credential from the user's browser to this server and
 * nowhere else. Two properties decide whether it is safe, and both are pinned
 * here rather than argued in a comment:
 *
 *  - a tampered block does not decode (AES-GCM authenticates the WHOLE payload),
 *  - and that includes the `jti`, because the `jti` is what revocation acts on.
 *    Were it outside the authenticated payload, anyone holding a revoked block
 *    could swap in an unrevoked id and keep using it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  MAX_BLOCK_CHARS,
  decodeAccessToken,
  encodeAccessToken,
  loadAuthKeys,
  type AccessPayload,
} from '../src/auth/access-token.js';

/** Two independent key pairs, generated once — RSA generation is slow. */
function pkcs8(): string {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}
const KEY_A = pkcs8();
const KEY_B = pkcs8();

const payload: AccessPayload = {
  v: 2,
  jti: 'abc123def456',
  u: 'testuser',
  secret: 'p@ssw#rd mit Umlauten äöü',
  iat: 1_754_300_000,
};

function keysOf(current: string, previous?: string) {
  const k = loadAuthKeys(previous === undefined ? { current } : { current, previous });
  assert.ok(k, 'expected the key material to load');
  return k;
}

// ── T2: loading key material ───────────────────────────────────────────────

test('a valid PKCS#8 key yields a usable key set with a derived public key', () => {
  const keys = keysOf(KEY_A);
  // Derived, never configured separately: a public key that does not match the
  // private one produces blocks nobody can open.
  assert.match(keys.publicKeyPem, /^-----BEGIN PUBLIC KEY-----/);
});

test('missing or unusable key material yields null rather than throwing at boot', () => {
  assert.equal(loadAuthKeys({}), null);
  assert.equal(loadAuthKeys({ current: '' }), null);
  assert.equal(loadAuthKeys({ current: '   ' }), null);
  assert.equal(loadAuthKeys({ current: 'not a pem at all' }), null);
});

test('an unusable PREVIOUS key fails loudly instead of silently dropping the window', () => {
  // The rotation window exists so blocks issued under the old key keep working.
  // Ignoring a malformed previous key would break exactly that, and the
  // operator would learn about it from user complaints.
  assert.equal(loadAuthKeys({ current: KEY_A, previous: 'garbage' }), null);
});

// ── T3/T4: round trip and rejection ────────────────────────────────────────

test('a block encoded for a key decodes back to the same payload', () => {
  const keys = keysOf(KEY_A);
  const token = encodeAccessToken(payload, keys.publicKeyPem);
  assert.deepEqual(decodeAccessToken(token, keys), payload);
});

test('the secret and the jti are not readable in the block', () => {
  const keys = keysOf(KEY_A);
  const token = encodeAccessToken(payload, keys.publicKeyPem);
  assert.ok(!token.includes(payload.secret));
  assert.ok(!token.includes(payload.jti));
  assert.ok(!token.includes(payload.u));
});

test('a malformed block is rejected', () => {
  const keys = keysOf(KEY_A);
  const token = encodeAccessToken(payload, keys.publicKeyPem);
  const seg = token.split('.');

  assert.equal(decodeAccessToken('', keys), null, 'empty');
  assert.equal(decodeAccessToken('wlo1.' + seg.slice(1).join('.'), keys), null, 'wrong version prefix');
  assert.equal(decodeAccessToken(seg.slice(1).join('.'), keys), null, 'no prefix');
  assert.equal(decodeAccessToken(token + '.extra', keys), null, 'too many segments');
  assert.equal(decodeAccessToken(seg.slice(0, 3).join('.'), keys), null, 'too few segments');
  assert.equal(decodeAccessToken('wlo2...', keys), null, 'empty segments');
});

test('a tampered ciphertext is rejected — the GCM tag covers the whole payload', () => {
  const keys = keysOf(KEY_A);
  const [prefix, wrapped, iv, ct] = encodeAccessToken(payload, keys.publicKeyPem).split('.');
  const bytes = Buffer.from(ct!, 'base64url');
  bytes[0] ^= 0xff;
  const tampered = [prefix, wrapped, iv, bytes.toString('base64url')].join('.');
  assert.equal(decodeAccessToken(tampered, keys), null);
});

test('the jti cannot be swapped to dodge revocation', () => {
  // Grafting the IV *and* ciphertext of a block carrying a different jti onto
  // this block's wrapped key must not yield a readable payload — otherwise a
  // revoked block could be revived with an id that is still on the list.
  //
  // Taking the ciphertext ALONE proves nothing: the IV would not match and GCM
  // fails on that account, whatever the key. Measured — a fixed-AES-key
  // mutation left that weaker version green.
  const keys = keysOf(KEY_A);
  const mine = encodeAccessToken(payload, keys.publicKeyPem).split('.');
  const other = encodeAccessToken({ ...payload, jti: 'other-id-9999' }, keys.publicKeyPem).split('.');
  const spliced = [mine[0], mine[1], other[2], other[3]].join('.');
  assert.equal(decodeAccessToken(spliced, keys), null);
});

test('a block encrypted for a different key is rejected', () => {
  const a = keysOf(KEY_A);
  const b = keysOf(KEY_B);
  const token = encodeAccessToken(payload, b.publicKeyPem);
  assert.equal(decodeAccessToken(token, a), null);
});

test('a payload of the wrong shape is rejected', () => {
  const keys = keysOf(KEY_A);
  const bad = (p: unknown) =>
    decodeAccessToken(encodeAccessToken(p as AccessPayload, keys.publicKeyPem), keys);

  assert.equal(bad({ ...payload, v: 1 }), null, 'wrong version');
  assert.equal(bad({ ...payload, jti: '' }), null, 'empty jti');
  assert.equal(bad({ ...payload, secret: '' }), null, 'empty secret');
  assert.equal(bad({ ...payload, u: '' }), null, 'empty user');
  assert.equal(bad({ v: 2, jti: 'x', u: 'y' }), null, 'missing secret');
  assert.equal(bad({ ...payload, iat: 'soon' }), null, 'iat not a number');
});

// ── Ticket blocks: the `k` discriminator ───────────────────────────────────

test('a ticket block round-trips with its kind intact', () => {
  // The kind decides which Authorization scheme `credentialFromAccessBlock`
  // builds (EDU-TICKET vs. Basic), so losing it silently would turn a ticket
  // into a nonsense password — same block, wrong wire format.
  const keys = keysOf(KEY_A);
  const ticket: AccessPayload = { ...payload, k: 'ticket', secret: 'TICKET_0123abcd' };
  const token = encodeAccessToken(ticket, keys.publicKeyPem);
  assert.deepEqual(decodeAccessToken(token, keys), ticket);
});

test('a password block stays exactly shaped as before — no `k` key appears', () => {
  // Backward compatibility is the point of an OPTIONAL discriminator: every
  // block issued before the ticket kind existed must keep decoding, and the
  // decoded object must not grow a `k: undefined` that changes deepEqual
  // comparisons and JSON round trips.
  const keys = keysOf(KEY_A);
  const decoded = decodeAccessToken(encodeAccessToken(payload, keys.publicKeyPem), keys);
  assert.deepEqual(decoded, payload);
  assert.ok(decoded && !('k' in decoded), 'no k key on a password block');
});

test('an unknown kind is rejected, not passed on as a credential', () => {
  const keys = keysOf(KEY_A);
  const bad = (p: unknown) =>
    decodeAccessToken(encodeAccessToken(p as AccessPayload, keys.publicKeyPem), keys);
  assert.equal(bad({ ...payload, k: 'basic' }), null, 'explicit basic is not a value we issue');
  assert.equal(bad({ ...payload, k: 'cookie' }), null, 'future kinds fail closed');
  assert.equal(bad({ ...payload, k: 42 }), null, 'non-string kind');
});

// ── T5: the rotation window ────────────────────────────────────────────────

test('a block issued under the previous key still decodes during rotation', () => {
  const old = keysOf(KEY_B);
  const token = encodeAccessToken(payload, old.publicKeyPem);

  const during = keysOf(KEY_A, KEY_B);
  assert.deepEqual(decodeAccessToken(token, during), payload);

  const after = keysOf(KEY_A);
  assert.equal(decodeAccessToken(token, after), null, 'window closed once previous is removed');
});

test('issuing always uses the current key, never the previous one', () => {
  const during = keysOf(KEY_A, KEY_B);
  const onlyCurrent = keysOf(KEY_A);
  // A block made with the advertised public key must open with the current key
  // alone — otherwise closing the window would strand blocks issued today.
  const token = encodeAccessToken(payload, during.publicKeyPem);
  assert.deepEqual(decodeAccessToken(token, onlyCurrent), payload);
});

test('a block far larger than any real one is refused before it is decrypted', () => {
  // Measured 2026-08-09: a real block is 573 characters, and one carrying a 1 MB
  // junk field inside its payload is 1 333 836 — and it DECODES. `validatePayload`
  // drops the junk from the returned object, but the caller keeps the string:
  // `/oauth/authorize` stores it in the authorization-code store, which bounds
  // the NUMBER of records (1 000) and not their size. With MAX_BODY_BYTES at
  // 4 MiB that is up to 4 GB held for the code's lifetime, reachable by anyone
  // holding one valid WLO account. The bound belongs here because this is the
  // one place every path decodes a block.
  const keys = keysOf(KEY_A);
  const padded = encodeAccessToken(
    { ...payload, junk: 'x'.repeat(1_000_000) } as AccessPayload & { junk: string },
    keys.publicKeyPem,
  );
  assert.ok(padded.length > MAX_BLOCK_CHARS, 'the padded block is over the bound');
  assert.equal(decodeAccessToken(padded, keys), null, 'an oversized block never decodes');
});

test('the bound leaves a real block room to grow', () => {
  // 573 characters today with an RSA-2048 key; an RSA-4096 one adds ~340. The
  // bound must not be the thing that breaks a key rotation.
  const keys = keysOf(KEY_A);
  const real = encodeAccessToken(payload, keys.publicKeyPem);
  assert.ok(real.length < MAX_BLOCK_CHARS / 4, `a real block is ${real.length} characters`);
  assert.ok(decodeAccessToken(real, keys), 'and it still decodes');
});
