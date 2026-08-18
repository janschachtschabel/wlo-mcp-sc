import { test } from 'node:test';
import assert from 'node:assert/strict';

import { accessInfo, accessInfoLines } from '../src/node-access.js';

/**
 * Three fields the survey of 2026-08-17 found worth reading — and the reason
 * there is no vocabulary table behind them: the repository labels all three
 * itself through `<property>_DISPLAYNAME`, measured on real records.
 *
 * The values below are the repository's own strings, not invented ones.
 */
const COA = 'http://w3id.org/openeduhub/vocabs/conditionsOfAccess/';
const A11Y = 'http://w3id.org/openeduhub/vocabs/accessibilitySummary/';
const OER = 'http://w3id.org/openeduhub/vocabs/oer/';

test('the repository label is preferred over the URI', () => {
  const info = accessInfo({
    'ccm:conditionsOfAccess': [`${COA}no_login`],
    'ccm:conditionsOfAccess_DISPLAYNAME': ['ohne Anmeldung'],
    'ccm:accessibilitySummary': [`${A11Y}a`],
    'ccm:accessibilitySummary_DISPLAYNAME': ['A (am niedrigsten)'],
    'ccm:license_oer': [`${OER}2`],
    'ccm:license_oer_DISPLAYNAME': ['kein OER'],
  });
  assert.deepEqual(info, {
    conditionsOfAccess: 'ohne Anmeldung',
    accessibility: ['A (am niedrigsten)'],
    oerStatus: 'kein OER',
  });
});

test('accessibilitySummary is multi-valued and keeps every value', () => {
  // `multivalueFixedBadges` in the metadata set: a record may claim WCAG *and* a
  // conformance level. Collapsing that to the first would drop the level.
  const info = accessInfo({
    'ccm:accessibilitySummary': [`${A11Y}wcag`, `${A11Y}aa`],
    'ccm:accessibilitySummary_DISPLAYNAME': ['WCAG', 'AA (mittel)'],
  });
  assert.deepEqual(info.accessibility, ['WCAG', 'AA (mittel)']);
});

test('without a label the concept slug is shown, never the bare URI', () => {
  // Measured on three records, all three carried a DISPLAYNAME — but three
  // records are not the corpus. A raw URI in a rendered line is noise a reader
  // cannot use, and dropping the field would hide that the record says
  // something.
  const info = accessInfo({ 'ccm:conditionsOfAccess': [`${COA}login`] });
  assert.equal(info.conditionsOfAccess, 'login');
});

test('a field that is absent produces no key at all', () => {
  // Absent and empty must not read the same: `Zugang: —` would assert that the
  // record was asked and said nothing.
  const info = accessInfo({ 'ccm:conditionsOfAccess': [] });
  assert.deepEqual(info, {});
  assert.deepEqual(accessInfoLines(info), []);
});

test('the rendered lines name the field in the same style as the rest of the record', () => {
  const lines = accessInfoLines({
    conditionsOfAccess: 'ohne Anmeldung',
    accessibility: ['WCAG', 'AA (mittel)'],
    oerStatus: 'alles OER',
  });
  assert.deepEqual(lines, [
    'Zugang: ohne Anmeldung',
    'Barrierefreiheit: WCAG, AA (mittel)',
    'OER-Status: alles OER',
  ]);
});

/**
 * Two fields added 2026-08-18 after a second survey. The first three patterns of
 * the 2026-08-17 run matched neither, which is why they were missed: `ccm:price`
 * is on 339 687 records (58 % of the corpus) and `ccm:containsAdvertisement` on
 * 69 688.
 */
const PRICE = 'http://w3id.org/openeduhub/vocabs/price/';
const ADS = 'http://w3id.org/openeduhub/vocabs/containsAdvertisement/';

test('price is labelled by the repository, like the first three fields', () => {
  const info = accessInfo({
    'ccm:price': [`${PRICE}yes_for_additional`],
    'ccm:price_DISPLAYNAME': ['zusätzliche Inhalte / Features per Kauf möglich'],
  });
  assert.equal(info.price, 'zusätzliche Inhalte / Features per Kauf möglich');
});

test('advertising falls back to the published vocabulary when the repository is silent', () => {
  // The one field in this module the repository CANNOT label: its widget
  // declares the star scale `quality_advertisement/0…5` while the corpus stores
  // `containsAdvertisement/yes|no`. Measured 2026-08-18 on three records — all
  // three came back without a `_DISPLAYNAME`, so without this table the slug
  // "yes" is all a caller would see.
  const info = accessInfo({ 'ccm:containsAdvertisement': [`${ADS}yes`] });
  assert.equal(info.advertising, 'Ja');
  assert.equal(accessInfo({ 'ccm:containsAdvertisement': [`${ADS}no`] }).advertising, 'Nein');
});

test('the table is a fallback and never overrides the repository', () => {
  // If the metadata set is ever pointed at the right vocabulary, the repository
  // starts answering and our table must step aside without anyone editing it.
  const info = accessInfo({
    'ccm:containsAdvertisement': [`${ADS}yes`],
    'ccm:containsAdvertisement_DISPLAYNAME': ['enthält Werbung'],
  });
  assert.equal(info.advertising, 'enthält Werbung');
});

test('an advertising value in neither source still shows its slug', () => {
  // The corpus also holds star-scale leftovers in this field (28 × "5", 11 × "4",
  // measured). They are not yes/no and must not be guessed at.
  assert.equal(accessInfo({ 'ccm:containsAdvertisement': ['5'] }).advertising, '5');
});

test('the two new lines read like the rest of the record', () => {
  const lines = accessInfoLines({
    conditionsOfAccess: 'ohne Anmeldung',
    price: 'zusätzliche Inhalte / Features per Kauf möglich',
    advertising: 'Ja',
  });
  assert.deepEqual(lines, [
    'Zugang: ohne Anmeldung',
    'Kosten: zusätzliche Inhalte / Features per Kauf möglich',
    'Werbung: Ja',
  ]);
});

test('a value that names an Object property is not mistaken for a label', () => {
  // `VOCAB_FALLBACK` is an object literal, so a lookup by a repository-supplied
  // key reaches Object.prototype: a record storing `…/containsAdvertisement/
  // toString` rendered "function toString() { [native code] }" as its label.
  // The repository validates nothing (measured — it stored the literal string
  // "not json at all" for a page config and answered 200), so the stored value
  // is not guaranteed to come from the vocabulary.
  for (const key of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
    const info = accessInfo({ 'ccm:containsAdvertisement': [`${ADS}${key}`] });
    assert.equal(info.advertising, key, `"${key}" muss der Slug bleiben, keine Object-Eigenschaft`);
  }
});
