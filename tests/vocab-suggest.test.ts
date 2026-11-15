import { test } from 'node:test';
import assert from 'node:assert/strict';

import { levenshtein, suggestFromEntries, suggestVocab } from '../src/vocab-suggest.js';
import { listVocab, resolveVocab } from '../src/vocabs.js';
import { LRT_CONCEPTS, resolveLrt } from '../src/vocabs-lrt.js';

test('levenshtein: identical strings → 0', () => {
  assert.equal(levenshtein('mathematik', 'mathematik'), 0);
});

test('levenshtein: empty operand → other length', () => {
  assert.equal(levenshtein('', 'abc'), 3);
  assert.equal(levenshtein('abc', ''), 3);
});

test('levenshtein: classic kitten→sitting is 3', () => {
  assert.equal(levenshtein('kitten', 'sitting'), 3);
});

test('suggestVocab: typo of an alias suggests the matching label', () => {
  // "Grundshule" is a 1-edit typo of the alias "grundschule"; the suggestion
  // must be the term the user meant, not the entry's primary label ("Primarstufe").
  const out = suggestVocab('Grundshule', 'educationalContext');
  assert.ok(out.includes('Grundschule'), `expected Grundschule in ${JSON.stringify(out)}`);
});

test('suggestVocab: typo of a primary label is suggested', () => {
  const out = suggestVocab('Matematik', 'discipline');
  assert.ok(out.includes('Mathematik'), `expected Mathematik in ${JSON.stringify(out)}`);
});

test('suggestVocab: substring match suggests the contained label', () => {
  // Edit distance is large here, but "mathematik" is contained in the input.
  const out = suggestVocab('mathematikunterricht', 'discipline');
  assert.ok(out.includes('Mathematik'), `expected Mathematik in ${JSON.stringify(out)}`);
});

test('suggestVocab: gibberish → no suggestions', () => {
  assert.deepEqual(suggestVocab('xqzptvw', 'discipline'), []);
});

test('suggestVocab: empty/blank input → no suggestions', () => {
  assert.deepEqual(suggestVocab('', 'discipline'), []);
  assert.deepEqual(suggestVocab('   ', 'discipline'), []);
});

test('suggestVocab: caps the result at three labels', () => {
  // "schule" is contained in several educationalContext labels
  // (grundschule, hochschule, berufsschule, förderschule, …) plus the exact
  // "Schule" entry — the helper must still return at most three.
  const out = suggestVocab('schule', 'educationalContext');
  assert.ok(out.length <= 3, `expected ≤3 suggestions, got ${out.length}`);
  assert.ok(out.includes('Schule'), `expected Schule in ${JSON.stringify(out)}`);
});

/**
 * The invariant a suggestion exists for: "did you mean X" is worthless if X,
 * typed back, is not recognised.
 *
 * It is not free. The display form goes through `capitalize`, which upper-cases
 * the first character of whatever term matched — so a suggestion is never
 * literally a table entry, and the round trip only holds because the resolvers
 * lowercase. That became load-bearing on 2026-08-11, when `labels[0]` was
 * changed from a lowercase matching alias to the concept's real display form.
 *
 * What this test does and does not catch, measured by injecting both:
 * making EVERY path of `resolveVocab` case-sensitive fails it on the first
 * corrected label ("Sekundarstufe I"). Making only the EXACT-match path
 * case-sensitive does NOT fail it — the fuzzy `includes` fallback still answers,
 * so exact resolution can silently degrade to fuzzy. That masking has a floor:
 * the fuzzy branch requires four characters on both sides, so a short label
 * would break outright.
 *
 * Checked over the whole tables rather than on examples, because the seven
 * entries where this can bite (a label that STARTS lowercase but contains
 * capitals, e.g. "interaktive Medien, Mixed Media z.B. H5P") are exactly the
 * ones nobody thinks to write a case for.
 */
test('every suggestion the fuzzy matcher offers resolves back to its concept', () => {
  for (const vocab of ['educationalContext', 'discipline', 'userRole', 'lrt', 'license', 'targetGroup'] as const) {
    for (const entry of listVocab(vocab)) {
      for (const term of [entry.label, ...entry.aliases]) {
        for (const suggestion of suggestVocab(term, vocab)) {
          assert.notEqual(
            resolveVocab(suggestion, vocab), null,
            `${vocab}: "${term}" suggested "${suggestion}", which does not resolve`,
          );
        }
      }
    }
  }
});

test('the same holds for the 220-concept new_lrt table, which has its own resolver', () => {
  // `ambiguous` counts as recognised, and the distinction is the point: two of
  // the 220 labels are shared by concepts that mean different things
  // ("Suchmaschine", "Stationenlernen"), and the resolver deliberately reports
  // both candidates instead of picking the earlier one. Only `unknown` means the
  // suggestion led nowhere.
  const entries = LRT_CONCEPTS.map(c => ({ label: c.label, aliases: c.aliases ?? [] }));
  for (const concept of LRT_CONCEPTS) {
    for (const suggestion of suggestFromEntries(concept.label, entries, 3)) {
      assert.notEqual(
        resolveLrt(suggestion).status, 'unknown',
        `"${concept.label}" suggested "${suggestion}", which resolveLrt does not know`,
      );
    }
  }
});
