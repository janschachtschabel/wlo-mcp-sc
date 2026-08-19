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

test('a star-scale value is LABELLED from the declared scale, not dropped', () => {
  // Corrected on 2026-08-18, the same day the first version shipped. That one
  // dropped the value, on the reasoning that a number whose direction nobody can
  // recover is worse than silence. The reasoning was right and the premise was
  // wrong: the metadata set DOES declare this scale, with captions —
  // `quality_advertisement/5` is "✰✰✰✰✰ ohne Werbung". Only the URI form comes
  // back with a `_DISPLAYNAME`, and the corpus stores both forms in the same
  // field, so the label existed all along and only the lookup was missing.
  //
  // The measurement that settles which way it reads: 5 means NO advertising.
  // "Werbung: 5" beside "Kosten: nein" says the opposite of what the record does.
  assert.equal(accessInfo({ 'ccm:containsAdvertisement': ['5'] }).advertising,
    '✰✰✰✰✰ ohne Werbung');
  assert.equal(accessInfo({ 'ccm:containsAdvertisement': ['0'] }).advertising,
    'Inhalt ist kaum von Werbung unterscheidbar');
});

test('the yes/no vocabulary still wins where the corpus uses it', () => {
  // 69 628 of 69 688 values are yes/no, which the widget does NOT declare — the
  // scale table must not shadow the fallback that covers them.
  assert.equal(accessInfo({ 'ccm:containsAdvertisement': ['http://w3id.org/openeduhub/vocabs/containsAdvertisement/no'] }).advertising, 'Nein');
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

// ── A value we cannot label is not a value we hand over (2026-08-18) ────────

test('a labelled number is kept — the label is what makes it readable', () => {
  const info = accessInfo({
    'ccm:containsAdvertisement': ['5'],
    'ccm:containsAdvertisement_DISPLAYNAME': ['sehr viel Werbung'],
  });
  assert.equal(info.advertising, 'sehr viel Werbung');
});

test('the yes/no vocabulary is unaffected — it is a word, not a number', () => {
  const info = accessInfo({ 'ccm:containsAdvertisement': ['http://w3id.org/openeduhub/vocabs/containsAdvertisement/yes'] });
  assert.equal(info.advertising, 'Ja');
});

test('a number in a field with NO declared scale is still dropped', () => {
  const info = accessInfo({
    'ccm:accessibilitySummary': [
      'http://w3id.org/openeduhub/vocabs/accessibilitySummary/a',
      '3',
    ],
    'ccm:accessibilitySummary_DISPLAYNAME': ['A (am niedrigsten)', ''],
  });
  assert.deepEqual(info.accessibility, ['A (am niedrigsten)']);
});

test('a bare boolean is dropped for the same reason a bare number is', () => {
  // Measured 2026-08-18 over the whole corpus: `ccm:price` holds `false` ×3 and
  // `true` ×1 among 339 687 values, `ccm:oeh_quality_*` a handful more. They are
  // not in the declared vocabulary (`yes`/`yes_for_additional`/`no`), so the
  // repository does not label them either — and "Kosten: false" is exactly as
  // unreadable as "Werbung: 5".
  assert.equal(accessInfo({ 'ccm:price': ['false'] }).price, undefined);
  assert.equal(accessInfo({ 'ccm:price': ['http://w3id.org/openeduhub/vocabs/price/true'] }).price, undefined);
});

test('a word that happens to look boolean-ish is kept', () => {
  // The rule is narrow on purpose: only the two literals, not everything short.
  assert.equal(accessInfo({ 'ccm:conditionsOfAccess': ['login'] }).conditionsOfAccess, 'login');
});
