/**
 * topic-page-variant-preset.test.ts – the `variables` block of
 * `ccm:page_variant_config`: how a Themenseite is PRE-SET when a user lands on
 * it, before touching the profile selector.
 *
 * Found 2026-08-11 by inspecting raw variant configs on staging. It is the
 * mechanism behind "landing on the page, then picking Lehrkraft + Sekundarstufe
 * I": the selector's initial state is stored per variant.
 *
 * The one rule this file exists to enforce: **the preset is NOT the variant's
 * audience metadata.** Measured on the same 69 non-template staging variants —
 *
 *   ccm:page_variant_profiling_target_group : 17/69      variables intention : 25/69
 *   ccm:educationalcontext                  : 21/69      variables level     : 32/69
 *   carry BOTH: 1 (target group) / 2 (education level) — and in 3 of 3 cases
 *   the two sources DISAGREE (e.g. targetGroup "learner" beside intention
 *   "teach"; educationalcontext "elementarbereich" beside a variables list of
 *   sekundarstufe_1…erwachsenenbildung).
 *
 * Merging them would nearly double the reported coverage while making the
 * answer wrong in a way no caller could see. So it is carried as its own field,
 * named for what it is.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseVariantPreset } from '../src/topic-page-config.js';

const EC = 'http://w3id.org/openeduhub/vocabs/educationalContext';

/** Verbatim from a staging variant (2026-08-11). */
const REAL = JSON.stringify({
  structure: { swimlanes: [] },
  variables: {
    'virtual:profiling_widget_intention': 'teach',
    'virtual:profiling_widget_education_level': `${EC}/sekundarstufe_1,${EC}/sekundarstufe_2`,
  },
});

test('a real config yields the intention and the education levels', () => {
  const p = parseVariantPreset(REAL);
  assert.equal(p?.intention, 'teach');
  assert.deepEqual(p?.educationLevels, [`${EC}/sekundarstufe_1`, `${EC}/sekundarstufe_2`]);
});

test('the levels are a COMMA-separated string upstream, not an array', () => {
  // Measured: 32/32 carry them as one comma-joined string. Treating the raw
  // value as an array yields one nonsense entry holding every level at once.
  const p = parseVariantPreset(JSON.stringify({
    variables: { 'virtual:profiling_widget_education_level': `${EC}/grundschule` },
  }));
  assert.deepEqual(p?.educationLevels, [`${EC}/grundschule`]);
});

test('a variant with only one of the two carries only that one', () => {
  // 32 have the level, 25 the intention — so the partial case is the common one.
  const p = parseVariantPreset(JSON.stringify({
    variables: { 'virtual:profiling_widget_education_level': `${EC}/grundschule` },
  }));
  assert.equal(p?.intention, undefined);
  assert.deepEqual(p?.educationLevels, [`${EC}/grundschule`]);
});

test('no variables block means no preset — not an empty one', () => {
  // `undefined` and "preset with nothing in it" are different claims, and 37 of
  // 69 staging variants are the first.
  assert.equal(parseVariantPreset(JSON.stringify({ structure: { swimlanes: [] } })), undefined);
  assert.equal(parseVariantPreset(undefined), undefined);
  assert.equal(parseVariantPreset('not json at all'), undefined);
});

test('virtual:profiling_target_group is the widget\'s OPTION LIST, not a selection', () => {
  // Measured on the two staging variants that carry it: both hold the full
  // ["learner","teacher","general"]. Reading it as "this page is for learners"
  // would turn a widget configuration into an audience claim.
  const p = parseVariantPreset(JSON.stringify({
    variables: { 'virtual:profiling_target_group': ['learner', 'teacher', 'general'] },
  }));
  assert.equal(p, undefined, 'an options list alone is not a preset');
});

test('an unknown intention value is dropped rather than passed through', () => {
  // The repository validates nothing here (measured 2026-08-09 on the sibling
  // `ccm:page_config`: it stored the literal "not json at all" and answered
  // 200). Only the two values staging actually uses are accepted.
  assert.equal(parseVariantPreset(JSON.stringify({
    variables: { 'virtual:profiling_widget_intention': 'sudo rm -rf' },
  })), undefined);
});
