/**
 * oauth-codes.test.ts – the authorization-code store (P3/T3.1).
 *
 * This is the only state the OAuth work keeps, and it is short-lived by design:
 * a code is a one-time bearer of somebody's access block for at most a minute.
 * The properties pinned here are the ones that make that safe — single use,
 * expiry, a bound on how many can be outstanding, and unguessability.
 *
 * `now` is a parameter rather than `Date.now()` inside the module, so expiry is
 * tested by arithmetic instead of by waiting.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CODE_TTL_MS, MAX_CODES, createCodeStore } from '../src/auth/oauth-codes.js';

const RECORD = {
  clientId: 'wloc1.aaa.bbb',
  redirectUri: 'https://a.example/cb',
  challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  block: 'wlo2.chiffrat.das-wir-nicht-oeffnen',
  label: 'redakteurin',
};

test('a minted code hands back exactly what was put in', () => {
  const store = createCodeStore();
  const code = store.mint(RECORD, 1_000);
  const got = store.consume(code, 1_000);
  assert.ok(got);
  assert.equal(got.clientId, RECORD.clientId);
  assert.equal(got.redirectUri, RECORD.redirectUri);
  assert.equal(got.challenge, RECORD.challenge);
  assert.equal(got.block, RECORD.block);
  assert.equal(got.label, RECORD.label);
  assert.equal(got.expiresAt, 1_000 + CODE_TTL_MS);
});

test('a code works once — the second attempt gets nothing', () => {
  const store = createCodeStore();
  const code = store.mint(RECORD, 0);
  assert.ok(store.consume(code, 0));
  assert.equal(store.consume(code, 0), null, 'a replayed code must not open a second session');
  assert.equal(store.size(), 0);
});

test('an expired code is refused, and consuming it clears it', () => {
  const store = createCodeStore();
  const code = store.mint(RECORD, 0);
  assert.equal(store.consume(code, CODE_TTL_MS + 1), null);
  assert.equal(store.size(), 0, 'the entry is gone either way — consume removes before it judges');
});

test('a code we never minted is refused', () => {
  const store = createCodeStore();
  for (const bogus of ['', 'mcp_ac_erfunden', 'völliger unsinn']) {
    assert.equal(store.consume(bogus, 0), null, JSON.stringify(bogus));
  }
});

test('two mints never yield the same code', () => {
  const store = createCodeStore();
  const seen = new Set(Array.from({ length: 50 }, (_, i) => store.mint(RECORD, i)));
  assert.equal(seen.size, 50);
});

test('a minted code looks like one and carries real entropy', () => {
  const store = createCodeStore();
  const code = store.mint(RECORD, 0);
  assert.match(code, /^mcp_ac_[A-Za-z0-9_-]{43}$/, '32 random bytes, base64url, unpadded');
});

test('the store is bounded, and it is the oldest that goes', () => {
  // Without a bound, anyone who can reach `/oauth/authorize` could grow this map
  // until the process runs out of memory.
  const store = createCodeStore(CODE_TTL_MS, 3);
  const first = store.mint(RECORD, 0);
  const second = store.mint(RECORD, 1);
  const third = store.mint(RECORD, 2);
  const fourth = store.mint(RECORD, 3);

  assert.equal(store.size(), 3);
  assert.equal(store.consume(first, 3), null, 'the oldest was evicted');
  assert.ok(store.consume(second, 3));
  assert.ok(store.consume(third, 3));
  assert.ok(store.consume(fourth, 3));
});

test('minting sweeps out what has already expired', () => {
  const store = createCodeStore();
  const stale = store.mint(RECORD, 0);
  store.mint(RECORD, CODE_TTL_MS + 1);
  assert.equal(store.size(), 1, 'the expired entry did not survive the next mint');
  assert.equal(store.consume(stale, CODE_TTL_MS + 1), null);
});

test('the caps are real numbers the endpoints can rely on', () => {
  assert.equal(CODE_TTL_MS, 60_000);
  assert.ok(MAX_CODES >= 100);
});

test('nothing the store exposes carries a code', () => {
  // A regression guard, not a proof: codes are stored under their SHA-256, so a
  // memory dump does not hand out live codes. That property is structural — the
  // map lives in a closure and no test can reach it. What CAN regress is someone
  // later hanging the map off the returned object, and that is what this catches.
  const store = createCodeStore();
  const code = store.mint(RECORD, 0);
  const exposed = JSON.stringify(store, (_k, v: unknown) =>
    v instanceof Map ? Array.from(v.entries()) : v);
  assert.ok(!exposed.includes(code), `the store exposed a live code: ${exposed}`);
});
