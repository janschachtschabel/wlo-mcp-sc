import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { ThemePageInfo } from '../src/topic-page-api.js';
import { mergeThemePages, renderThemePages } from '../src/tools/topic-pages-present.js';

// Two variants of the SAME Themenseite (collection "Optik"), different target
// groups and educational contexts. Edu-context URIs are intentionally unknown
// so labelFromUri falls back to the input verbatim — deterministic labels
// without coupling the test to the vocab table.
const teacherVariant: ThemePageInfo = {
  variantId: 'v-teacher',
  variantName: 'PAGE_VARIANT_abc',
  variantTitle: 'Seiten-Variante 1',
  targetGroup: 'teacher',
  educationalContexts: ['http://ex/edu/A'],
  isTemplate: false,
  topicPageUrl: 'https://wlo/optik-teacher',
  collectionId: 'coll-optik',
  collectionName: 'Optik',
};
const learnerVariant: ThemePageInfo = {
  variantId: 'v-learner',
  variantName: 'PAGE_VARIANT_def',
  variantTitle: 'Seiten-Variante 2',
  targetGroup: 'learner',
  educationalContexts: ['http://ex/edu/B'],
  isTemplate: false,
  topicPageUrl: 'https://wlo/optik-learner',
  collectionId: 'coll-optik',
  collectionName: 'Optik',
};

const META = { type: 'text' as const, text: '{"_queryMeta":{}}' };

test('mergeThemePages: merges variants of the same collection, unions edu-contexts', () => {
  const out = mergeThemePages([teacherVariant, learnerVariant], { merge: true, sort: 'alpha', maxResults: 5 });
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'Optik');
  assert.deepEqual(out[0].variants.map(v => v.variantId).sort(), ['v-learner', 'v-teacher']);
  assert.deepEqual(out[0].educationalContexts, ['http://ex/edu/A', 'http://ex/edu/B']);
  // entry URL is the first variant's URL
  assert.equal(out[0].topicPageUrl, 'https://wlo/optik-teacher');
  // target-group slug resolved to a readable label for the renderer
  const teacher = out[0].variants.find(v => v.targetGroup === 'teacher');
  assert.equal(teacher?.targetGroupLabel, 'Lehrkräfte');
});

test('mergeThemePages: merge=false keeps variants as separate entries', () => {
  const out = mergeThemePages([teacherVariant, learnerVariant], { merge: false, sort: 'alpha', maxResults: 5 });
  assert.equal(out.length, 2);
});

test('mergeThemePages: sort=alpha orders by title', () => {
  const zebra: ThemePageInfo = { ...teacherVariant, variantId: 'z', collectionId: 'c-z', collectionName: 'Zebra' };
  const anton: ThemePageInfo = { ...teacherVariant, variantId: 'a', collectionId: 'c-a', collectionName: 'Anton' };
  const out = mergeThemePages([zebra, anton], { merge: true, sort: 'alpha', maxResults: 5 });
  assert.deepEqual(out.map(o => o.title), ['Anton', 'Zebra']);
});

test('mergeThemePages: sort=relevance preserves insertion order', () => {
  const zebra: ThemePageInfo = { ...teacherVariant, variantId: 'z', collectionId: 'c-z', collectionName: 'Zebra' };
  const anton: ThemePageInfo = { ...teacherVariant, variantId: 'a', collectionId: 'c-a', collectionName: 'Anton' };
  const out = mergeThemePages([zebra, anton], { merge: true, sort: 'relevance', maxResults: 5 });
  assert.deepEqual(out.map(o => o.title), ['Zebra', 'Anton']);
});

test('mergeThemePages: maxResults slices the presented list', () => {
  const a: ThemePageInfo = { ...teacherVariant, variantId: 'a', collectionId: 'c-a', collectionName: 'A' };
  const b: ThemePageInfo = { ...teacherVariant, variantId: 'b', collectionId: 'c-b', collectionName: 'B' };
  const c: ThemePageInfo = { ...teacherVariant, variantId: 'c', collectionId: 'c-c', collectionName: 'C' };
  const out = mergeThemePages([a, b, c], { merge: false, sort: 'alpha', maxResults: 2 });
  assert.equal(out.length, 2);
});

test('mergeThemePages: title falls back to variant title, collectionId to variantId, when no owning collection', () => {
  const noColl: ThemePageInfo = {
    ...teacherVariant,
    collectionId: undefined,
    collectionName: undefined,
    variantName: 'PAGE_VARIANT_x',
    variantTitle: 'Seiten-Variante 7',
  };
  const out = mergeThemePages([noColl], { merge: true, sort: 'alpha', maxResults: 5 });
  assert.equal(out[0].title, 'Seiten-Variante 7');
  assert.equal(out[0].collectionId, 'v-teacher');
});

test('renderThemePages: json output carries total, results and appends the meta block', () => {
  const out = mergeThemePages([teacherVariant, learnerVariant], { merge: true, sort: 'alpha', maxResults: 5 });
  const res = renderThemePages(out, META, 'json');
  assert.equal(res.content.length, 2);
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.total, out.length);
  assert.equal(parsed.results.length, out.length);
  assert.deepEqual(res.content[1], META);
});

test('renderThemePages: markdown output lists title, variant count and appends the meta block', () => {
  const out = mergeThemePages([teacherVariant, learnerVariant], { merge: true, sort: 'alpha', maxResults: 5 });
  const res = renderThemePages(out, META, 'markdown');
  const md = res.content[0].text;
  assert.match(md, /Gefundene Themenseiten: 1/);
  assert.match(md, /## Optik/);
  assert.match(md, /Varianten \(2\)/);
  assert.deepEqual(res.content[1], META);
});
