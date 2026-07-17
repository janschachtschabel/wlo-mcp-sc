import { test } from 'node:test';
import assert from 'node:assert/strict';

import { universitySubjectLabel, suggestUniversitySubjects } from '../src/vocabs-hochschule.js';
import { labelFromUri, resolveVocab } from '../src/vocabs.js';
import { resolveFacetCounts } from '../src/formatter.js';

const HSF = 'http://w3id.org/openeduhub/vocabs/hochschulfaechersystematik/';
const DISC = 'http://w3id.org/openeduhub/vocabs/discipline/';

// ── universitySubjectLabel: display-only URI → label ─────────────────────────

test('universitySubjectLabel resolves known Hochschulfächersystematik URIs', () => {
  assert.equal(universitySubjectLabel(HSF + 'n0'), 'Fachübergreifend');
  assert.equal(universitySubjectLabel(HSF + 'n37'), 'Mathematik');
  assert.equal(universitySubjectLabel(HSF + 'n135'), 'Rechtswissenschaft');
  assert.equal(universitySubjectLabel(HSF + 'n63'), 'Maschinenbau/Verfahrenstechnik');
});

test('universitySubjectLabel returns null for non-university / unknown / empty URIs', () => {
  assert.equal(universitySubjectLabel(DISC + '380'), null); // a SCHOOL subject URI
  assert.equal(universitySubjectLabel(HSF + 'n99999'), null); // unknown slug
  assert.equal(universitySubjectLabel(''), null);
});

test('universitySubjectLabel is not fooled by Object.prototype keys as slugs', () => {
  // Bracket access walks the prototype chain; without an own-property guard a
  // `.../toString` slug would return Object.prototype.toString (a function).
  for (const slug of ['toString', 'constructor', 'valueOf', 'hasOwnProperty']) {
    assert.equal(universitySubjectLabel(HSF + slug), null, `slug ${slug} must not resolve`);
  }
});

// ── labelFromUri: university URIs are labeled for display only ────────────────

test('labelFromUri labels a university-subject discipline URI via the fallback', () => {
  assert.equal(labelFromUri(HSF + 'n135', 'discipline'), 'Rechtswissenschaft');
});

test('labelFromUri still labels school-subject URIs from the local table (unchanged)', () => {
  assert.equal(labelFromUri(DISC + '380', 'discipline'), 'Mathematik');
  assert.equal(labelFromUri(DISC + '460', 'discipline'), 'Physik');
});

// ── Conflict guard: university labels must NOT leak into INPUT resolution ─────

test('resolveVocab keeps discipline INPUT school-only — no conflict with university labels', () => {
  // A shared label ("Mathematik") must still resolve to the SCHOOL subject, never
  // ambiguously to a university URI.
  const uri = resolveVocab('Mathematik', 'discipline');
  assert.equal(uri, DISC + '380');
  assert.equal(uri?.includes('hochschulfaechersystematik'), false);

  // A university-ONLY label was NOT added to the input side, so it does not resolve.
  assert.equal(resolveVocab('Rechtswissenschaft', 'discipline'), null);
  assert.equal(resolveVocab('Maschinenbau/Verfahrenstechnik', 'discipline'), null);
});

test('resolveVocab still passes a raw university URI through unchanged (filter by URI works)', () => {
  assert.equal(resolveVocab(HSF + 'n63', 'discipline'), HSF + 'n63');
});

// ── resolveFacetCounts: carries the URI + labels university subjects ─────────

test('resolveFacetCounts exposes the URI per bucket and labels university subjects', () => {
  const out = resolveFacetCounts([
    { property: 'ccm:taxonid', values: [
      { value: HSF + 'n37', count: 5 },   // university "Mathematik"
      { value: DISC + '380', count: 3 },  // school "Mathematik"
    ] },
  ]);
  assert.deepEqual(out.discipline, [
    { label: 'Mathematik', count: 5, uri: HSF + 'n37' },
    { label: 'Mathematik', count: 3, uri: DISC + '380' },
  ]);
});

// ── suggestUniversitySubjects: model-free fuzzy disambiguation (Stage 2) ──────
// Turns a free-text term into a SHORT candidate list of {uri, label} the model
// picks from — no ML, no auto-resolve. The URI is the real ccm:taxonid form, so
// the chosen one works directly as a `discipline` filter (URI pass-through).

test('suggestUniversitySubjects returns URI+label candidates for a substring term', () => {
  const out = suggestUniversitySubjects('Maschinenbau');
  const labels = out.map(o => o.label);
  assert.ok(labels.includes('Maschinenbau/Verfahrenstechnik'));
  assert.ok(labels.includes('Maschinenbau/-wesen'));
  for (const o of out) assert.match(o.uri, /\/hochschulfaechersystematik\/n\w+$/);
});

test('suggestUniversitySubjects reconstructs the exact stored taxonid URI', () => {
  const out = suggestUniversitySubjects('Maschinenbau/Verfahrenstechnik');
  assert.equal(out[0]?.uri, HSF + 'n63');   // matches the live ccm:taxonid form
  assert.equal(out[0]?.label, 'Maschinenbau/Verfahrenstechnik');
});

test('suggestUniversitySubjects tolerates a typo (Levenshtein ≤ 2)', () => {
  const out = suggestUniversitySubjects('Rechtswissenschaftt'); // trailing typo
  assert.ok(out.some(o => o.label === 'Rechtswissenschaft'));
});

test('suggestUniversitySubjects ranks an exact label first and never repeats a label', () => {
  const out = suggestUniversitySubjects('Informatik');
  assert.equal(out[0]?.label, 'Informatik');
  const labels = out.map(o => o.label);
  assert.equal(new Set(labels).size, labels.length); // deduped choice list
});

test('suggestUniversitySubjects returns [] for empty / whitespace input', () => {
  assert.deepEqual(suggestUniversitySubjects(''), []);
  assert.deepEqual(suggestUniversitySubjects('   '), []);
});

test('suggestUniversitySubjects respects the candidate limit', () => {
  const out = suggestUniversitySubjects('wissenschaft', 3);
  assert.ok(out.length <= 3);
});

test('suggestUniversitySubjects does NOT affect INPUT resolution (still school-only)', () => {
  // Stage 2 is discovery-only; the conflict-free invariant from Stage 1 holds.
  assert.equal(resolveVocab('Maschinenbau/Verfahrenstechnik', 'discipline'), null);
});
