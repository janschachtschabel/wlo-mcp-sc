/**
 * oauth-clients.test.ts – registered clients, and the rule that decides where an
 * authorization code may ever be sent (P2/T2.1).
 *
 * This is the most security-critical file in the OAuth work. An authorization
 * code is a one-time bearer of somebody's WLO access; a redirect check that is
 * a little too generous hands it to whoever asked. So the matching rule is
 * pinned case by case here rather than described in a docstring — including the
 * cases that must FAIL, which is where a "looks about right" implementation
 * quietly differs from a correct one.
 *
 * The one deliberate loosening is RFC 8252 §7.3: a native client listens on a
 * loopback port it picks at runtime, so the port cannot be part of the match.
 * Everything else about a loopback URI still has to agree, and for any other
 * host the comparison is character for character.
 *
 * `client_id` carries its own content (AES-GCM under a key derived from the
 * server's private key) instead of living in a store — see the design. That
 * makes registrations survive a restart, which an in-memory store would not, and
 * keeps the access registry the only writer on disk.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

import {
  MAX_REDIRECT_URIS,
  decodeClientId,
  encodeClientId,
  isValidRedirectUri,
  redirectUriMatches,
} from '../src/auth/oauth-clients.js';
import { loadAuthKeys, type AuthKeys } from '../src/auth/access-token.js';

function keyMaterial(): AuthKeys {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keys = loadAuthKeys({ current: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
  assert.ok(keys);
  return keys;
}

const KEYS = keyMaterial();
const OTHER_KEYS = keyMaterial();

// ── which redirect targets may be registered at all ────────────────────────

test('https is accepted, and http only on loopback', () => {
  for (const uri of [
    'https://chatgpt.com/connector_platform_oauth_redirect',
    'https://claude.ai/api/mcp/auth_callback',
    'https://a.example/cb?x=1',
    'http://localhost:1455/oauth/callback',
    'http://127.0.0.1/cb',
    'http://[::1]:8080/cb',
  ]) {
    assert.equal(isValidRedirectUri(uri), true, uri);
  }
});

test('plain http off the loopback is refused — a code would travel in the clear', () => {
  for (const uri of ['http://a.example/cb', 'http://192.168.1.10/cb', 'http://localhost.evil.example/cb']) {
    assert.equal(isValidRedirectUri(uri), false, uri);
  }
});

test('a scheme that is not http(s) is refused', () => {
  // `javascript:` and `data:` would execute in whoever opens the redirect;
  // `file:` and custom app schemes are not something this server can reason about.
  for (const uri of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'file:///etc/passwd', 'wlo-app://cb']) {
    assert.equal(isValidRedirectUri(uri), false, uri);
  }
});

test('a fragment, credentials, or a relative reference are refused', () => {
  for (const uri of [
    'https://a.example/cb#teil',        // RFC 6749 §3.1.2: no fragment
    'https://user:pw@a.example/cb',     // userinfo hides the real host from a reader
    '/nur/ein/pfad',
    'a.example/cb',
    '',
    '   ',
  ]) {
    assert.equal(isValidRedirectUri(uri), false, JSON.stringify(uri));
  }
});

// ── the match, which is where a code is won or lost ────────────────────────

test('an identical URI matches', () => {
  assert.equal(redirectUriMatches('https://a.example/cb', 'https://a.example/cb'), true);
});

test('anything but an exact match is refused for a non-loopback host', () => {
  const registered = 'https://a.example/cb';
  for (const presented of [
    'https://a.example/cb2',          // a different path
    'https://a.example/cb/',          // …even by one character
    'https://b.example/cb',           // a different host
    'https://a.example.evil/cb',      // a suffix that reads like the real one
    'https://a.example/cb?x=1',       // an added query
    'http://a.example/cb',            // downgraded scheme
    'https://a.example:8443/cb',      // a different port — free ONLY on loopback
    'https://a.example/cb#x',
  ]) {
    assert.equal(redirectUriMatches(registered, presented), false, presented);
  }
});

test('loopback ignores the port and the loopback spelling — and nothing else', () => {
  // RFC 8252 §7.3: a native client binds a random port at runtime, and clients
  // are inconsistent about `localhost` vs `127.0.0.1` between registration and
  // callback. Both are therefore free; path, query and scheme are not.
  assert.equal(redirectUriMatches('http://localhost:1111/cb', 'http://127.0.0.1:2222/cb'), true);
  assert.equal(redirectUriMatches('http://127.0.0.1/cb', 'http://localhost:49152/cb'), true);
  assert.equal(redirectUriMatches('http://localhost:1111/cb', 'http://[::1]:2222/cb'), true);

  assert.equal(redirectUriMatches('http://localhost:1111/cb', 'http://localhost:2222/andere'), false, 'path');
  assert.equal(redirectUriMatches('http://localhost:1111/cb', 'http://localhost:2222/cb?x=1'), false, 'query');
  assert.equal(redirectUriMatches('http://localhost:1111/cb', 'https://localhost:2222/cb'), false, 'scheme');
  assert.equal(
    redirectUriMatches('http://localhost:1111/cb', 'http://localhost.evil.example:1111/cb'),
    false,
    'a host that merely starts with the loopback name is not loopback',
  );
});

test('the loosening applies only when BOTH sides are loopback', () => {
  assert.equal(redirectUriMatches('https://a.example/cb', 'http://localhost:1111/cb'), false);
  assert.equal(redirectUriMatches('http://localhost:1111/cb', 'https://a.example/cb'), false);
});

test('an unparseable URI on either side matches nothing', () => {
  assert.equal(redirectUriMatches('https://a.example/cb', 'nicht mal eine url'), false);
  assert.equal(redirectUriMatches('nicht mal eine url', 'https://a.example/cb'), false);
  assert.equal(redirectUriMatches('nicht mal eine url', 'nicht mal eine url'), false,
    'two identical unparseable strings are still not a redirect target');
});

// ── the client_id, which carries its own content ───────────────────────────

test('a client_id round-trips through the server key', () => {
  const client = { redirectUris: ['https://a.example/cb', 'http://localhost:1455/cb'], name: 'Ein Client' };
  const id = encodeClientId(client, KEYS);
  assert.match(id, /^wloc1\./, 'recognisable as ours before anything is decrypted');
  assert.deepEqual(decodeClientId(id, KEYS), client);
});

test('two registrations of the same client yield different ids', () => {
  // A fresh nonce per id: identical ciphertext for identical input would let an
  // observer tell that two clients registered the same callback.
  const client = { redirectUris: ['https://a.example/cb'], name: 'Ein Client' };
  assert.notEqual(encodeClientId(client, KEYS), encodeClientId(client, KEYS));
});

test('a tampered or foreign client_id decodes to nothing', () => {
  const id = encodeClientId({ redirectUris: ['https://a.example/cb'], name: 'X' }, KEYS);

  // One character of the ciphertext flipped — the AEAD tag must catch it, or the
  // redirect list inside could be rewritten by whoever holds an id.
  const body = id.split('.')[2]!;
  const flipped = `${id.split('.').slice(0, 2).join('.')}.${body[0] === 'A' ? 'B' : 'A'}${body.slice(1)}`;
  assert.equal(decodeClientId(flipped, KEYS), null, 'tampered');

  assert.equal(decodeClientId(id, OTHER_KEYS), null, 'minted under a different server key');

  for (const bogus of ['', 'wloc1', 'wloc1.aaa', 'wloc1.aaa.bbb', 'wloc2.aaa.bbb', 'völliger unsinn']) {
    assert.equal(decodeClientId(bogus, KEYS), null, JSON.stringify(bogus));
  }
});

test('a client_id decodes only into the shape we put in', () => {
  // The decoded value goes straight into the redirect check, so a payload of the
  // wrong shape must be refused rather than reaching it as `undefined`.
  const id = encodeClientId({ redirectUris: [], name: 'Leer' }, KEYS);
  assert.equal(decodeClientId(id, KEYS), null, 'a client with no redirect target is not a client');
});

test('the cap on redirect targets is a real number the endpoint can use', () => {
  assert.equal(typeof MAX_REDIRECT_URIS, 'number');
  assert.ok(MAX_REDIRECT_URIS >= 1 && MAX_REDIRECT_URIS <= 20);
});

test('the loopback loosening does not extend to userinfo', () => {
  // `isValidRedirectUri` rejects userinfo at REGISTRATION, and for a reason it
  // states: it hides the effective host from anyone reading the URI, the consent
  // screen included. The loopback branch compares scheme, path and query — so
  // without this the PRESENTED target could add credentials the registered one
  // never had, and `authorizationRedirect` builds the final URL from the
  // presented value.
  assert.equal(redirectUriMatches('http://localhost:1455/cb', 'http://a:b@localhost:9/cb'), false);
  assert.equal(redirectUriMatches('http://localhost:1455/cb', 'http://a@127.0.0.1:9/cb'), false);
  // The loosening itself is untouched: port and loopback spelling stay free.
  assert.equal(redirectUriMatches('http://localhost:1455/cb', 'http://127.0.0.1:9/cb'), true);
});

test('a client id whose redirect list would not pass registration is not opened', () => {
  // Defence in depth: the AEAD already proves we minted the id, and
  // `/oauth/register` validates. But `validate()` is the last gate before the
  // redirect check, and "non-empty string" is not the rule this module enforces
  // everywhere else.
  const keys = KEYS;
  const smuggled = encodeClientId(
    { redirectUris: ['http://evil.example/cb'], name: 'Schmuggler' }, keys);
  assert.equal(decodeClientId(smuggled, keys), null, 'plain http off loopback is not a redirect target');

  const fragment = encodeClientId({ redirectUris: ['https://ok.example/cb#x'], name: 'X' }, keys);
  assert.equal(decodeClientId(fragment, keys), null, 'a fragment is refused here too');
});
