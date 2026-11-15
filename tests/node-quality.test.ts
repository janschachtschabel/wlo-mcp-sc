/**
 * node-quality.test.ts – the fields the 2026-08-17 survey wrote off, read the
 * way the 2026-08-18 re-measurement showed they can be.
 *
 * The corpus stores TWO forms in the same field: the declared URI and a bare
 * digit. Only the first comes back with a `_DISPLAYNAME`. Every assertion below
 * uses a value measured on staging, not an invented one.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { qualityInfo, qualityLines } from '../src/node-quality.js';

test('a bare digit is labelled from the declared scale', () => {
  // 12 of 34 values in this field are stored exactly like this.
  const info = qualityInfo({ 'ccm:oeh_quality_didactics': ['4'] });
  assert.equal(info.didactics, '✰✰✰✰ moderne, gute Methodik');
});

test('the URI form yields the same label — one entry serves both', () => {
  const info = qualityInfo({
    'ccm:oeh_quality_didactics': ['http://w3id.org/openeduhub/vocabs/quality_didactics/4'],
  });
  assert.equal(info.didactics, '✰✰✰✰ moderne, gute Methodik');
});

test("the record's own label wins over our table", () => {
  // The instance knows its own wording; the table is a fallback for the digit
  // form, not a second source of truth.
  const info = qualityInfo({
    'ccm:oeh_quality_didactics': ['4'],
    'ccm:oeh_quality_didactics_DISPLAYNAME': ['Vom Repository benannt'],
  });
  assert.equal(info.didactics, 'Vom Repository benannt');
});

test('every scale has its own wording — a position is not a number', () => {
  // Measured: the same digit means something different per field, which is why
  // one shared 0–5 table would have been wrong.
  assert.equal(qualityInfo({ 'ccm:oeh_quality_language': ['3'] }).language, '✰✰✰ angemessen');
  assert.equal(qualityInfo({ 'ccm:oeh_quality_medial': ['3'] }).medial, '✰✰✰ Medial passend');
  assert.equal(qualityInfo({ 'ccm:oeh_quality_neutralness': ['3'] }).neutralness,
    '✰✰✰ ideologisch eingefärbt, aber transparent');
});

test('a verdict field is named, whichever form it is stored in', () => {
  assert.equal(qualityInfo({ 'ccm:oeh_quality_correctness': ['no_auto_findings'] }).correctness,
    'keine Auffälligkeiten gefunden (Maschine)');
  assert.equal(qualityInfo({
    'ccm:oeh_quality_copyright_law': ['http://w3id.org/openeduhub/vocabs/quality/no_human_findings'],
  }).copyrightLaw, 'keine Auffälligkeiten gefunden (Mensch)');
});

test('a value no source names is dropped, never printed raw', () => {
  // `false` ×1 and `true` ×1 are in the corpus of these fields. A bare token
  // beside "✰✰✰ gute Methodik" reads as a rating on some other scale.
  assert.deepEqual(qualityInfo({ 'ccm:oeh_quality_copyright_law': ['false'] }), {});
  assert.deepEqual(qualityInfo({ 'ccm:oeh_quality_didactics': ['9'] }), {});
});

test('an absent field produces no key and no line', () => {
  assert.deepEqual(qualityInfo({}), {});
  assert.deepEqual(qualityInfo({ 'ccm:oeh_quality_didactics': [] }), {});
  assert.deepEqual(qualityLines({}), []);
});

test('the login field is read too, now that it can be written', () => {
  // It was left out until 2026-08-19 because `ccm:conditionsOfAccess` states the
  // same fact three-valued and on 198 699 records instead of 72 787, and
  // printing one fact twice invites a contradiction. Writing it changed the
  // balance: a field a caller can SET and cannot READ BACK cannot be checked —
  // and if the two ever do disagree, hiding one of them is the worse outcome,
  // not the better one.
  assert.equal(qualityInfo({ 'ccm:oeh_quality_login': ['1'] }).login, 'Ohne Login zugänglich');
  assert.equal(qualityInfo({ 'ccm:oeh_quality_login': ['0'] }).login, 'Zugang nur mit Login');
});

test('the lines read like the rest of the record', () => {
  const lines = qualityLines(qualityInfo({
    'ccm:oeh_quality_correctness': ['no_auto_findings'],
    'ccm:oeh_quality_didactics': ['4'],
    'ccm:oeh_quality_protection_of_minors': ['no_human_findings'],
  }));
  assert.deepEqual(lines, [
    'Sachrichtigkeit: keine Auffälligkeiten gefunden (Maschine)',
    'Didaktik: ✰✰✰✰ moderne, gute Methodik',
    'Jugendschutz: keine Auffälligkeiten gefunden (Mensch)',
  ]);
});

test('a value naming an Object property is not mistaken for a label', () => {
  // The repository validates nothing, and both lookups are object literals.
  for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.deepEqual(qualityInfo({ 'ccm:oeh_quality_correctness': [key] }), {},
      `"${key}" darf keine Beschriftung erzeugen`);
  }
});

test('a caption is rendered without the whitespace the repository stores', () => {
  // The repository's caption for this position begins with a space, which leaked
  // straight into the line as "Aktualität:  0-A …". Trimming at the accessor
  // fixes the rendered line and the caption round-trip (see write-fields) in one
  // place, because every consumer goes through it.
  const line = qualityLines(qualityInfo({ 'ccm:oeh_quality_currentness': ['0'] }))[0];
  assert.equal(line, 'Aktualität: 0-A veralteter Inhalt');
});
