import { test } from 'node:test';
import assert from 'node:assert/strict';

import { levenshtein, suggestVocab } from '../src/vocab-suggest.js';

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
