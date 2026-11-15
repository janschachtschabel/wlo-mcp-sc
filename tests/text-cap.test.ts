/**
 * text-cap.test.ts – Characterisation tests for the truncation rule extracted
 * from the private `cap()` in services/content-text.ts (P0/Task 1).
 *
 * These pin the behaviour that existed BEFORE the move, so the extraction can be
 * shown to preserve it. The word-boundary rule is the interesting part: a cut is
 * only moved back to the last space when that space sits in the last fifth —
 * otherwise a text whose only space is near the start would lose almost
 * everything.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { capText } from '../src/text-cap.js';

const MARKER = '\n\n[…gekürzt]';

test('a text at or below the cap comes back untouched', () => {
  const r = capText('kurz und knapp', 100);
  assert.deepEqual(r, { text: 'kurz und knapp', charCount: 14, truncated: false });
});

test('a text exactly at the cap is not truncated', () => {
  const text = 'x'.repeat(20);
  const r = capText(text, 20);
  assert.equal(r.truncated, false);
  assert.equal(r.text, text);
});

test('surrounding whitespace is trimmed before anything else', () => {
  const r = capText('   hallo   ', 100);
  assert.equal(r.text, 'hallo');
  assert.equal(r.charCount, 5, 'charCount counts the trimmed text');
});

test('a cut is moved back to a word boundary in the last fifth', () => {
  // maxChars 20 → the boundary must sit past index 16 to be used.
  const text = `${'x'.repeat(17)} ${'y'.repeat(20)}`;
  const r = capText(text, 20);
  assert.equal(r.text, 'x'.repeat(17) + MARKER, 'cut at the space, not mid-word');
  assert.equal(r.truncated, true);
});

test('a word boundary too early is ignored and the cut is hard', () => {
  // The only space sits at index 5, well before 0.8 * 20 — honouring it would
  // throw away three quarters of what fits.
  const text = `${'x'.repeat(5)} ${'y'.repeat(30)}`;
  const r = capText(text, 20);
  assert.equal(r.text, `${'x'.repeat(5)} ${'y'.repeat(14)}${MARKER}`);
  assert.equal(r.truncated, true);
});

test('a text without any space is cut hard', () => {
  const r = capText('a'.repeat(30), 20);
  assert.equal(r.text, 'a'.repeat(20) + MARKER);
  assert.equal(r.truncated, true);
});

test('charCount reports the FULL length, not the returned one', () => {
  const r = capText('a'.repeat(5000), 100);
  assert.equal(r.charCount, 5000, 'the caller must be able to see what it is missing');
  assert.ok(r.text.length < 200);
});
