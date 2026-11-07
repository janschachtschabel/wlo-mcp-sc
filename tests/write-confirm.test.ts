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

test('a token from a preview that named no redirection does not authorise one', () => {
  // The redirection changes WHICH record is edited. A preview that did not
  // mention it approved an edit to the node the user named, so carrying that
  // approval over to the original is a write to a record nobody saw — the same
  // shape as approving a title change and sending a description change.
  const plain = buildChangeSet('original-1', 'content', BEFORE, { 'cclom:title': ['Neu'] });
  const redirected = buildChangeSet('original-1', 'content', BEFORE, { 'cclom:title': ['Neu'] }, {
    redirectedFrom: 'reference-1',
  });

  assert.equal(consumeToken(mintToken(plain), redirected), 'mismatch');
  assert.equal(consumeToken(mintToken(redirected), plain), 'mismatch', 'und in beide Richtungen');
});

test('a redirection from a different reference is a mismatch', () => {
  // Two collections can reference the same record. Which one the user was
  // looking at is part of what they confirmed.
  const from = (reference: string) =>
    buildChangeSet('original-1', 'content', BEFORE, { 'cclom:title': ['Neu'] }, {
      redirectedFrom: reference,
    });
  assert.equal(consumeToken(mintToken(from('reference-1')), from('reference-2')), 'mismatch');
});

// ── Identity binding and per-identity cap (audit 2026-11-05) ────────────────

import { runWithCredential, type WloCredential } from '../src/auth/credential.js';

const ALICE: WloCredential = { header: 'Basic YQ==', label: 'alice', source: 'user' };
const BOB: WloCredential = { header: 'Basic Yg==', label: 'bob', source: 'user' };

test('a token approved by one person does not authorise the same change for another', () => {
  // The fingerprint covered the change, not who saw the preview: Bob replaying
  // Alice's token with the identical change set would have written under his
  // own rights on her approval.
  const cs = changeTitle('Gemeinsam');
  const token = runWithCredential(ALICE, () => mintToken(cs));
  assert.equal(runWithCredential(BOB, () => consumeToken(token, cs)), 'mismatch');
});

test('the same person confirming their own preview still works', () => {
  const cs = changeTitle('Eigene Änderung');
  const token = runWithCredential(ALICE, () => mintToken(cs));
  assert.equal(runWithCredential(ALICE, () => consumeToken(token, cs)), 'ok');
});

test('one identity flooding previews evicts only its own, not anyone else\'s', async () => {
  const { MAX_PENDING_PER_IDENTITY } = await import('../src/services/write/confirm.js');
  const bobsToken = runWithCredential(BOB, () => mintToken(changeTitle('Bob wartet')));
  const alicesFirst = runWithCredential(ALICE, () => mintToken(changeTitle('Alice 0')));
  for (let i = 1; i <= MAX_PENDING_PER_IDENTITY; i++) {
    runWithCredential(ALICE, () => mintToken(changeTitle(`Alice ${i}`)));
  }
  assert.equal(runWithCredential(ALICE, () => consumeToken(alicesFirst, changeTitle('Alice 0'))), 'unknown',
    'her own oldest preview made room');
  assert.equal(runWithCredential(BOB, () => consumeToken(bobsToken, changeTitle('Bob wartet'))), 'ok',
    "Bob's pending preview survived Alice's flood");
});

test('the collection a create files into is part of what the token authorises', () => {
  // BOERDi wishlist item 4: the action sentence names the collection too, but
  // `addTo` must bind ON ITS OWN — a later rewording of that sentence must not
  // turn an approval for one collection into one for another.
  const action = 'Legt einen neuen Datensatz an:';
  const into = (nodeId: string) =>
    buildChangeSet('https://example.org/x', 'content', {}, { 'cclom:title': ['T'] }, { action, addTo: { nodeId, title: 'Optik' } });
  assert.equal(consumeToken(mintToken(into('coll-a')), into('coll-b')), 'mismatch');
  const plain = buildChangeSet('https://example.org/x', 'content', {}, { 'cclom:title': ['T'] }, { action });
  assert.equal(consumeToken(mintToken(plain), into('coll-a')), 'mismatch', 'nor does a key without a filing');
});

test('the steps of a multi-step change are part of what the token authorises', () => {
  const plan = (steps: string[]) =>
    buildChangeSet('parent', 'collection', {}, {}, { action: 'Legt einen Baum an:', items: steps });
  assert.equal(consumeToken(mintToken(plan(['A: anlegen', 'A/B: anlegen'])), plan(['A: anlegen', 'A/C: anlegen'])), 'mismatch');
});

test('an expired token still answers expired after another token was minted (feedback 2026-11-07, point 5)', () => {
  // `prune` used to drop expired entries on every mint, and the expired token
  // then answered `unknown` — the code the docs promise could never be reached.
  const cs = buildChangeSet('n-tomb', 'content', { 'cclom:title': ['a'] }, { 'cclom:title': ['b'] });
  const t0 = 5_000_000;
  const token = mintToken(cs, t0);
  mintToken(cs, t0 + TOKEN_TTL_MS + 1);
  assert.equal(consumeToken(token, cs, t0 + TOKEN_TTL_MS + 2), 'expired');
  assert.equal(consumeToken(token, cs, t0 + TOKEN_TTL_MS + 3), 'unknown', 'the grave answers once');
});
