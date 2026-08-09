import { test } from 'node:test';
import assert from 'node:assert/strict';

import { setDefaultVariant } from '../src/topic-page-config.js';
import { toStoreRef } from '../src/wlo-api.js';

/**
 * Writing `ccm:page_config` — the document that decides which variant a public
 * Themenseite renders.
 *
 * Measured on staging 2026-08-09 (docs/plans/2026-08-09-usecase-gap-tools.md,
 * P3 gate) over 28 real page-config folders:
 *
 *   {"variants":["workspace://SpacesStore/…","workspace://SpacesStore/…"]}
 *
 *   variants  28/28      default  2/28      no other key
 *
 * and the finding these tests exist for: the repository validates NOTHING.
 * `POST …/property?property=ccm:page_config` stored the literal string
 * `"not json at all"` and answered 200, and accepted the property on a `ccm:io`
 * that is not a page-config folder at all. Nothing upstream will catch a
 * malformed document — it surfaces in the page builder, on a public page.
 *
 * So the transform never builds a document, it edits one: exactly one key
 * changes and everything else survives byte-for-byte in meaning, including keys
 * this code has never seen.
 */

const REF = (id: string) => `workspace://SpacesStore/${id}`;

test('setDefaultVariant: keys this code does not know survive the edit', () => {
  const raw = JSON.stringify({
    variants: [REF('a'), REF('b')],
    someFutureKey: { nested: true },
    layout: 'wide',
  });
  const out = JSON.parse(setDefaultVariant(raw, 'b'));
  assert.deepEqual(out.someFutureKey, { nested: true });
  assert.equal(out.layout, 'wide');
});

test('setDefaultVariant: the variant list is carried through untouched, in store-ref form', () => {
  const raw = JSON.stringify({ variants: [REF('a'), REF('b')] });
  const out = JSON.parse(setDefaultVariant(raw, 'b'));
  assert.deepEqual(out.variants, [REF('a'), REF('b')]);
});

test('setDefaultVariant: default is written as a store ref, matching 28/28 documents', () => {
  const raw = JSON.stringify({ variants: [REF('a'), REF('b')] });
  const out = JSON.parse(setDefaultVariant(raw, 'b'));
  assert.equal(out.default, REF('b'));
});

test('setDefaultVariant: a store ref passed in is not wrapped twice', () => {
  const raw = JSON.stringify({ variants: [REF('a')] });
  const out = JSON.parse(setDefaultVariant(raw, REF('a')));
  assert.equal(out.default, REF('a'));
});

test('setDefaultVariant: an absent default is added (the normal case — 26/28)', () => {
  const raw = JSON.stringify({ variants: [REF('a'), REF('b')] });
  assert.equal(JSON.parse(raw).default, undefined);
  assert.equal(JSON.parse(setDefaultVariant(raw, 'a')).default, REF('a'));
});

test('setDefaultVariant: an existing default is replaced, not appended', () => {
  const raw = JSON.stringify({ variants: [REF('a'), REF('b')], default: REF('a') });
  const out = JSON.parse(setDefaultVariant(raw, 'b'));
  assert.equal(out.default, REF('b'));
  assert.equal(Object.keys(out).filter(k => k === 'default').length, 1);
});

test('setDefaultVariant: an unparseable document is refused, never replaced', () => {
  // The probe proved this state is reachable: the repository stored
  // `"not json at all"` and answered 200. Overwriting it with a document of our
  // own would silently drop whatever variant list an editor had there.
  assert.throws(() => setDefaultVariant('not json at all', 'a'), /page_config/);
});

test('setDefaultVariant: a missing document is refused — we never invent a variant list', () => {
  assert.throws(() => setDefaultVariant(undefined, 'a'), /page_config/);
  assert.throws(() => setDefaultVariant('', 'a'), /page_config/);
});

test('setDefaultVariant: a document without a variant list is refused', () => {
  // A page-config folder whose document has no `variants` is not one this tool
  // understands; adding a `default` to it would point at a list that is not there.
  assert.throws(() => setDefaultVariant(JSON.stringify({ layout: 'wide' }), 'a'), /variants/);
});

test('setDefaultVariant: refuses a variant the document does not list', () => {
  // The repository accepts any string. A `default` outside `variants[]` renders
  // nothing, and nothing upstream would have said so.
  assert.throws(() => setDefaultVariant(JSON.stringify({ variants: [REF('a')] }), 'zzz'), /zzz/);
});

test('toStoreRef: the inverse of stripStoreRef, idempotent', () => {
  assert.equal(toStoreRef('abc'), REF('abc'));
  assert.equal(toStoreRef(REF('abc')), REF('abc'));
  assert.equal(toStoreRef(''), '');
});
