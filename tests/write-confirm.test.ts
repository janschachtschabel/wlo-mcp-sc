/**
 * write-confirm.test.ts – the token is what makes consent mean something.
 *
 * The mismatch case is the security-relevant one. Without binding the token to
 * the change it was minted for, a preview of a harmless edit would authorise
 * any subsequent write — which is exactly the shape a prompt injection needs:
 * get an innocuous change confirmed, then send a different one with the token
 * the user already approved.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildChangeSet } from '../src/services/write/change-set.js';
import { mintToken, consumeToken, TOKEN_TTL_MS } from '../src/services/write/confirm.js';

const BEFORE = { 'cclom:title': ['Alt'] };

function changeTitle(to: string) {
  return buildChangeSet('node-1', 'content', BEFORE, { 'cclom:title': [to] });
}

test('a token authorises its own change exactly once', () => {
  const cs = changeTitle('Neu');
  const token = mintToken(cs);
  assert.equal(consumeToken(token, cs), 'ok');
  assert.equal(consumeToken(token, cs), 'unknown', 'single use — a replay is not a second write');
});

test('a token minted for one change does not authorise another', () => {
  const a = changeTitle('Harmlose Korrektur');
  const b = changeTitle('Etwas ganz anderes');
  const token = mintToken(a);
  assert.equal(consumeToken(token, b), 'mismatch');
});

test('a mismatched attempt burns the token', () => {
  // Otherwise a caller could grind against one approved token until a change
  // set happens to hash the same.
  const a = changeTitle('A');
  const b = changeTitle('B');
  const token = mintToken(a);
  assert.equal(consumeToken(token, b), 'mismatch');
  assert.equal(consumeToken(token, a), 'unknown');
});

test('a change to a different node is a mismatch, not a match', () => {
  const a = buildChangeSet('node-1', 'content', BEFORE, { 'cclom:title': ['Neu'] });
  const b = buildChangeSet('node-2', 'content', BEFORE, { 'cclom:title': ['Neu'] });
  assert.equal(consumeToken(mintToken(a), b), 'mismatch');
});

test('a deletion token does not authorise the same node as an edit', () => {
  const del = buildChangeSet('node-1', 'content', BEFORE, {}, { destructive: true });
  const edit = changeTitle('Neu');
  assert.equal(consumeToken(mintToken(del), edit), 'mismatch');
});

test('an unknown token is refused', () => {
  assert.equal(consumeToken('nicht-von-uns', changeTitle('Neu')), 'unknown');
  assert.equal(consumeToken('', changeTitle('Neu')), 'unknown');
});

test('a token expires after ten minutes', () => {
  const cs = changeTitle('Neu');
  const t0 = 1_000_000;
  const token = mintToken(cs, t0);
  assert.equal(TOKEN_TTL_MS, 10 * 60 * 1000);
  assert.equal(consumeToken(token, cs, t0 + TOKEN_TTL_MS + 1), 'expired');
});

test('a token is still valid just inside the window', () => {
  const cs = changeTitle('Neu');
  const t0 = 2_000_000;
  const token = mintToken(cs, t0);
  assert.equal(consumeToken(token, cs, t0 + TOKEN_TTL_MS - 1), 'ok');
});

test('the order fields were requested in does not change the identity', () => {
  const a = buildChangeSet('node-1', 'content', {}, {
    'cclom:title': ['T'], 'cclom:general_language': ['de'],
  });
  const b = buildChangeSet('node-1', 'content', {}, {
    'cclom:general_language': ['de'], 'cclom:title': ['T'],
  });
  assert.equal(consumeToken(mintToken(a), b), 'ok');
});

test('tokens are unguessable and unique per mint', () => {
  const cs = changeTitle('Neu');
  const tokens = new Set(Array.from({ length: 50 }, () => mintToken(cs)));
  assert.equal(tokens.size, 50, 'two mints never collide');
  for (const t of tokens) assert.ok(t.length >= 24, 'enough entropy to be unguessable');
});
