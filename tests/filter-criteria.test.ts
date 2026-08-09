/**
 * filter-criteria.test.ts - vocabulary label to URI resolution and the hint for
 * the filters that did not resolve. Moved here with the module on 2026-08-04.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildFilterCriteria, formatUnresolvedHint } from '../src/filter-criteria.js';

test('buildFilterCriteria: resolves labels to URIs with display labels', () => {
  const { criteria, labeled } = buildFilterCriteria({
    discipline: 'Mathematik',
    educationalContext: 'Primarstufe',
    publisher: 'Serlo',
    learningResourceType: 'Arbeitsblatt',
  });
  const props = criteria.map(c => c.property).sort();
  assert.deepEqual(props, [
    'ccm:educationalcontext',
    'ccm:oeh_lrt_aggregated',
    'ccm:oeh_publisher_combined',
    'ccm:taxonid',
  ]);
  const disc = labeled.find(l => l.property === 'ccm:taxonid');
  assert.equal(disc?.label, 'Mathematik');
  assert.equal(disc?.values[0], 'http://w3id.org/openeduhub/vocabs/discipline/380');
});

test('buildFilterCriteria: resolves a licence to the repository key', () => {
  // Unlike the other vocabularies this one does NOT resolve to a URI: measured
  // 2026-08-09 on staging, `ccm:commonlicense_key` filters on the bare key
  // ("Optik" 756 hits -> 343 with CC_BY), while `virtual:license` and
  // `ccm:license` are refused with 400 DAOValidationException.
  const { criteria, labeled } = buildFilterCriteria({ license: 'CC BY 4.0' });
  assert.deepEqual(criteria, [{ property: 'ccm:commonlicense_key', values: ['CC_BY'] }]);
  assert.equal(labeled[0]?.label, 'CC BY 4.0');
});

test('buildFilterCriteria: a licence may also be given as the raw key', () => {
  const { criteria } = buildFilterCriteria({ license: 'CC_BY_SA' });
  assert.deepEqual(criteria, [{ property: 'ccm:commonlicense_key', values: ['CC_BY_SA'] }]);
});

test('buildFilterCriteria: an unknown licence is reported, never silently dropped', () => {
  const { criteria, unresolved } = buildFilterCriteria({ license: 'CC XY 9.9' });
  assert.equal(criteria.length, 0, 'nothing is sent upstream');
  assert.equal(unresolved[0]?.field, 'license');
  assert.equal(unresolved[0]?.value, 'CC XY 9.9');
});

test('buildFilterCriteria: unresolvable/missing filters are skipped', () => {
  const { criteria, labeled } = buildFilterCriteria({ discipline: 'GibtEsNicht12345' });
  assert.equal(criteria.length, 0);
  assert.equal(labeled.length, 0);
});

test('buildFilterCriteria: reports unresolvable vocab filters as `unresolved`', () => {
  const { criteria, unresolved } = buildFilterCriteria({
    discipline: 'GibtEsNicht12345',   // unresolvable → reported, silently dropped from the search
    educationalContext: 'Primarstufe', // resolvable → applied, NOT reported
  });
  assert.equal(criteria.length, 1);
  assert.deepEqual(unresolved, [{ field: 'discipline', value: 'GibtEsNicht12345' }]);
});

test('buildFilterCriteria: all-resolvable filters leave `unresolved` empty', () => {
  const { unresolved } = buildFilterCriteria({ discipline: 'Mathematik', publisher: 'Serlo' });
  assert.deepEqual(unresolved, []);
});

test('buildFilterCriteria: attaches fuzzy suggestions to an unresolvable-but-close filter', () => {
  // "Matematik" resolves to nothing (missing "h"), but is one edit from "Mathematik".
  const { criteria, unresolved } = buildFilterCriteria({ discipline: 'Matematik' });
  assert.equal(criteria.length, 0);
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].field, 'discipline');
  assert.ok(
    unresolved[0].suggestions?.includes('Mathematik'),
    `expected a Mathematik suggestion, got ${JSON.stringify(unresolved[0].suggestions)}`,
  );
});

test('formatUnresolvedHint: renders a ⚠ warning with the field, value and suggestions', () => {
  const hint = formatUnresolvedHint([
    { field: 'discipline', value: 'Matematik', suggestions: ['Mathematik'] },
  ]);
  assert.match(hint, /⚠/);
  assert.match(hint, /Matematik/);
  assert.match(hint, /discipline/);
  assert.match(hint, /Meintest du: Mathematik\?/);
});

test('formatUnresolvedHint: no suggestions → warning without a "Meintest du" line', () => {
  const hint = formatUnresolvedHint([{ field: 'discipline', value: 'GibtEsNicht12345' }]);
  assert.match(hint, /nicht erkannt/);
  assert.doesNotMatch(hint, /Meintest du/);
});

test('formatUnresolvedHint: empty list → empty string', () => {
  assert.equal(formatUnresolvedHint([]), '');
});
