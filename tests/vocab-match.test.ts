/**
 * vocab-match.test.ts – HOW a vocabulary value resolved, not only to what.
 *
 * BOERDi wishlist (2026-11-06): a typo like "Arbeitsblat" was taken over
 * silently, and "CC BY NC" filtered on CC BY — the freer licence, which is the
 * direction this project calls harmful. The resolver now reports exact / alias
 * / fuzzy, licences resolve exactly or not at all, and a fuzzy filter is marked
 * in the criteria `_queryMeta` carries.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { listVocab, resolveVocab, resolveVocabMatch } from '../src/vocabs.js';
import { buildFilterCriteria, resolveLicenseSelection } from '../src/filter-criteria.js';
import { connectedClient, toolText } from './fetchMock.js';

test('the resolver says how it matched', () => {
  assert.equal(resolveVocabMatch('Physik', 'discipline')?.match, 'exact', 'the main label');
  assert.equal(resolveVocabMatch('Klasse 7', 'educationalContext')?.match, 'alias');
  assert.equal(resolveVocabMatch('Lehrkraft', 'userRole')?.match, 'alias');
  assert.equal(resolveVocabMatch('Arbeitsblat', 'lrt')?.match, 'fuzzy', 'a typo is not an alias');
  const uri = 'http://w3id.org/openeduhub/vocabs/educationalContext/sekundarstufe_1';
  assert.deepEqual(resolveVocabMatch(uri, 'educationalContext'), { value: uri, match: 'exact' });
  assert.deepEqual(resolveVocabMatch('CC_BY_SA', 'license'), { value: 'CC_BY_SA', match: 'exact' }, 'the raw key');
  assert.equal(resolveVocabMatch('Quatsch', 'lrt'), null);
});

test('resolveVocab keeps answering exactly as before for every non-licence vocabulary', () => {
  for (const [input, vocab] of [['Arbeitsblat', 'lrt'], ['Klasse 7', 'educationalContext'], ['Physik', 'discipline']] as const) {
    assert.equal(resolveVocab(input, vocab), resolveVocabMatch(input, vocab)?.value);
  }
});

test('a licence resolves exactly or not at all — "CC BY NC" no longer becomes CC BY', () => {
  assert.equal(resolveVocab('CC BY NC', 'license'), null);
  assert.equal(resolveVocab('cc by nc sa', 'license'), null);
  assert.equal(resolveLicenseSelection('CC BY NC'), null);
  // What resolved before still does:
  assert.equal(resolveVocab('CC BY-NC', 'license'), 'CC_BY_NC');
  assert.equal(resolveVocab('CC BY-SA', 'license'), 'CC_BY_SA');
  assert.deepEqual(resolveLicenseSelection('OER')?.length, 4);
});

test('an unresolved licence lands in unresolved with a suggestion, and filters nothing', () => {
  const { criteria, unresolved } = buildFilterCriteria({ license: 'CC BY NC' });
  assert.equal(criteria.length, 0, 'no silent CC BY criterion');
  assert.equal(unresolved[0]?.field, 'license');
  assert.ok((unresolved[0]?.suggestions ?? []).some(s => /NC/.test(s)), JSON.stringify(unresolved));
});

test('a fuzzy filter is marked in the labelled criteria _queryMeta carries; an alias is not', () => {
  const fuzzy = buildFilterCriteria({ learningResourceType: 'Arbeitsblat' }).labeled;
  assert.equal(fuzzy[0]?.match, 'fuzzy');
  const alias = buildFilterCriteria({ educationalContext: 'Klasse 7' }).labeled;
  assert.equal(alias[0]?.match, undefined, 'only the uncertain case is flagged');
});

test('lookup_wlo_vocabulary lists every alias, not the first four', async () => {
  const entry = listVocab('educationalContext').find(e => e.aliases.length > 4)!;
  const c = await connectedClient();
  try {
    const text = toolText(await c.callTool({ name: 'lookup_wlo_vocabulary', arguments: { vocabulary: 'educationalContext' } }));
    assert.ok(text.includes(entry.aliases.at(-1)!), `the last alias of ${entry.label} is listed`);
  } finally { await c.close(); }
});

test('a licence URI is not "exact": WLO stores keys, and a URI filter matches nothing', () => {
  const uri = 'https://creativecommons.org/licenses/by-nc/4.0/';
  assert.equal(resolveVocabMatch(uri, 'license'), null);
  const { criteria, unresolved } = buildFilterCriteria({ license: uri });
  assert.equal(criteria.length, 0, 'no silent zero-hit criterion');
  assert.equal(unresolved[0]?.field, 'license');
  // Other vocabularies keep taking a URI as given.
  assert.equal(resolveVocabMatch('http://w3id.org/openeduhub/vocabs/discipline/460', 'discipline')?.match, 'exact');
});
