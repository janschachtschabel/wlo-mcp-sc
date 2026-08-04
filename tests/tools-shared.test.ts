import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSearchUrl,
  isPlaceholderTitle,
  pickThemePageTitle,
  toolError,
} from '../src/tools/shared.js';


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
