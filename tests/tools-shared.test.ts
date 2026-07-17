import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFilterCriteria,
  buildSearchUrl,
  formatUnresolvedHint,
  isPlaceholderTitle,
  mapPool,
  pickThemePageTitle,
  toolError,
} from '../src/tools/shared.js';

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

test('buildSearchUrl: only whitelisted filter props end up in the URL', () => {
  const url = buildSearchUrl('https://repo.example/edu-sharing', 'algebra', [
    { property: 'ccm:taxonid', values: ['uri-1'] },
    { property: 'nodeId', values: ['should-not-appear'] },
  ]);
  assert.ok(url.startsWith('https://repo.example/edu-sharing/components/search?'));
  assert.match(url, /q=algebra/);
  assert.match(url, /ccm%3Ataxonid/);
  assert.doesNotMatch(url, /should-not-appear/);
});

test('isPlaceholderTitle: PAGE_VARIANT names and UUIDs are placeholders', () => {
  assert.equal(isPlaceholderTitle('PAGE_VARIANT_123'), true);
  assert.equal(isPlaceholderTitle('d41d8cd9-8f00-b204-e980-0998ecf8427e'), true);
  assert.equal(isPlaceholderTitle(''), true);
  assert.equal(isPlaceholderTitle('Mathematik'), false);
});

test('pickThemePageTitle: collection name > variant title > generic fallback', () => {
  const base = {
    variantId: 'v1', variantName: 'PAGE_VARIANT_abc', targetGroup: '',
    educationalContexts: [], isTemplate: false, topicPageUrl: '',
  };
  assert.equal(pickThemePageTitle({ ...base, collectionName: 'Physik', variantTitle: 'Variante 1' }), 'Physik');
  assert.equal(pickThemePageTitle({ ...base, variantTitle: 'Seiten-Variante 1' }), 'Seiten-Variante 1');
  assert.equal(pickThemePageTitle({ ...base }), 'Themenseite');
});

test('mapPool: keeps order and caps concurrency', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const items = Array.from({ length: 20 }, (_, i) => i);
  const results = await mapPool(items, 3, async (i) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise(r => setTimeout(r, 5));
    inFlight--;
    return i * 2;
  });
  assert.deepEqual(results, items.map(i => i * 2));
  assert.ok(maxInFlight <= 3, `max in-flight was ${maxInFlight}`);
});

test('mapPool: one failing item becomes null and does not abort the batch', async () => {
  const items = [0, 1, 2, 3, 4];
  const results = await mapPool(items, 2, async (i) => {
    if (i === 2) throw new Error('boom on item 2');
    return i * 10;
  });
  assert.deepEqual(results, [0, 10, null, 30, 40]);
});

test('toolError: returns an isError result and logs the failure to stderr', () => {
  const real = process.stderr.write.bind(process.stderr);
  const captured: string[] = [];
  process.stderr.write = ((chunk: any) => { captured.push(String(chunk)); return true; }) as any;
  let result: ReturnType<typeof toolError>;
  try {
    result = toolError('Fehler bei der Inhaltssuche', new Error('ngsearch failed: 500'));
  } finally {
    process.stderr.write = real;
  }
  assert.equal(result.isError, true);
  assert.equal(result.content[0].type, 'text');
  assert.equal(result.content[0].text, 'Fehler bei der Inhaltssuche: ngsearch failed: 500');
  // The failure is logged server-side (structured), not silently returned.
  assert.equal(captured.length, 1);
  const logged = JSON.parse(captured[0]);
  assert.equal(logged.level, 'error');
  assert.equal(logged.context, 'Fehler bei der Inhaltssuche');
  assert.equal(logged.error, 'ngsearch failed: 500');
});

test('toolError: stringifies non-Error throwables', () => {
  const real = process.stderr.write.bind(process.stderr);
  process.stderr.write = (() => true) as any;
  let result: ReturnType<typeof toolError>;
  try {
    result = toolError('Kontext', 'plain string failure');
  } finally {
    process.stderr.write = real;
  }
  assert.equal(result.content[0].text, 'Kontext: plain string failure');
});
