import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatNode, renderToText, renderToJson, resolveFacetCounts } from '../src/formatter.js';
import { DISPLAY_PROPS } from '../src/wlo-api.js';
import type { WloNode } from '../src/wlo-api.js';

const contentNode: WloNode = {
  ref: { id: 'node-1', repo: '-home-' },
  type: 'ccm:io',
  properties: {
    'cclom:title': ['Bruchrechnung Übungen'],
    'cclom:general_description': ['Aufgaben zur Bruchrechnung'],
    'cclom:general_keyword': ['brüche', 'mathe'],
    'ccm:taxonid': ['http://w3id.org/openeduhub/vocabs/discipline/380'],
    'ccm:taxonid_DISPLAYNAME': ['Mathematik'],
    'ccm:wwwurl': ['https://example.org/brueche'],
    'ccm:commonlicense_key': ['CC_BY_SA'],
    'ccm:oeh_publisher_combined': ['Serlo'],
  },
};

test('formatNode: fileSize is always a NUMBER, even when the live API sends a string', () => {
  // Live edu-sharing serialises `size` as a string ("82944"); the declared
  // outputSchema says z.number(), and MCP hosts (Claude) reject the whole tool
  // result when structuredContent violates the schema (live-found 2026-07-17).
  const stringSize = formatNode({ ...contentNode, size: '82944' as unknown as number });
  assert.equal(stringSize.fileSize, 82944);
  assert.equal(typeof stringSize.fileSize, 'number');

  const numberSize = formatNode({ ...contentNode, size: 1024 });
  assert.equal(numberSize.fileSize, 1024);

  const garbage = formatNode({ ...contentNode, size: 'kaputt' as unknown as number });
  assert.equal(garbage.fileSize, 0, 'unparseable size degrades to 0, never NaN/string');

  const absent = formatNode(contentNode);
  assert.equal(absent.fileSize, 0);
});

test('formatNode: maps content node fields', () => {
  const f = formatNode(contentNode);
  assert.equal(f.nodeId, 'node-1');
  assert.equal(f.title, 'Bruchrechnung Übungen');
  assert.deepEqual(f.disciplines, ['Mathematik']);
  assert.equal(f.url, 'https://example.org/brueche');
  assert.equal(f.license, 'CC BY-SA 4.0');
  assert.equal(f.publisher, 'Serlo');
  assert.equal(f.nodeType, 'content');
  assert.equal(f.topicPageUrl, '');
});

test('formatNode: fallback label resolution drops empty-string URIs (regression L5)', () => {
  const f = formatNode({
    ref: { id: 'e-1', repo: '-home-' },
    properties: {
      // No _DISPLAYNAME → URI-only fallback path; an empty-string taxonid must
      // NOT yield an empty discipline label (which would also hide a valid one
      // as the widget tile reads disciplines[0]).
      'ccm:taxonid': ['', 'http://w3id.org/openeduhub/vocabs/discipline/380'],
    },
  });
  assert.deepEqual(f.disciplines, ['Mathematik']);
});

test('formatNode: cm:title beats technical cm:name (page variants)', () => {
  const f = formatNode({
    ref: { id: 'v-1', repo: '-home-' },
    properties: {
      'cm:name': ['PAGE_VARIANT_abc-123'],
      'cm:title': ['Seiten-Variante 1'],
    },
  });
  assert.equal(f.title, 'Seiten-Variante 1');
});

test('formatNode: surfaces compendium text from ccm:oeh_collection_compendium_text', () => {
  const f = formatNode({
    ref: { id: 'coll-2', repo: '-home-' },
    type: 'ccm:map',
    isDirectory: true,
    properties: {
      'cm:name': ['Optik'],
      'ccm:oeh_collection_compendium_text': ['Die Optik ist ein Teilgebiet der Physik.'],
    },
  });
  assert.equal(f.compendiumText, 'Die Optik ist ein Teilgebiet der Physik.');
});

test('formatNode: no compendium property → compendiumText undefined', () => {
  const f = formatNode(contentNode);
  assert.equal(f.compendiumText, undefined);
});

test('DISPLAY_PROPS includes the compendium property so collection search/browse carry it inline', () => {
  // Token-efficiency decision (design doc 2026-07-15, "Internal enablers"):
  // collection search/browse bundle the compendium for orientation instead of
  // forcing a second get_compendium_text call. renderToText caps the text
  // output at 500 chars (formatter.ts) so it stays bounded; get_compendium_text
  // remains the path for the full, untruncated text.
  assert.ok(DISPLAY_PROPS.includes('ccm:oeh_collection_compendium_text'));
});

test('renderToText: renders a capped Kompendium line when compendiumText is present', () => {
  const long = 'K'.repeat(600);
  const f = formatNode({
    ref: { id: 'coll-3', repo: '-home-' },
    type: 'ccm:map',
    isDirectory: true,
    properties: {
      'cm:name': ['Optik'],
      'ccm:oeh_collection_compendium_text': [long],
    },
  });
  const text = renderToText([f]);
  assert.match(text, /Kompendium: K+…/);
  // capped, not the full 600 chars
  assert.ok(!text.includes(long));
});

test('formatNode: collection with page_config_ref gets topicPageUrl', () => {
  const f = formatNode({
    ref: { id: 'coll-1', repo: '-home-' },
    type: 'ccm:map',
    isDirectory: true,
    properties: {
      'cm:name': ['Mathematik'],
      'ccm:page_config_ref': ['workspace://SpacesStore/cfg-1'],
    },
  });
  assert.equal(f.nodeType, 'collection');
  assert.ok(f.topicPageUrl.includes('topic-pages?collectionId=coll-1'));
});

test('formatNode: DISPLAYNAME duplicates are deduped case-insensitively', () => {
  const f = formatNode({
    ref: { id: 'n-2', repo: '-home-' },
    properties: {
      'ccm:taxonid': ['http://w3id.org/openeduhub/vocabs/discipline/080', 'https://other/vocab/bio'],
      'ccm:taxonid_DISPLAYNAME': ['Biologie', 'biologie'],
    },
  });
  assert.deepEqual(f.disciplines, ['Biologie']);
});

test('renderToText: contains total, title, nodeId', () => {
  const text = renderToText([formatNode(contentNode)], 42);
  assert.match(text, /Gefundene Treffer gesamt: 42, zeige 1/);
  assert.match(text, /## Bruchrechnung Übungen/);
  assert.match(text, /nodeId: node-1/);
});

test('renderToText: empty list → empty string', () => {
  assert.equal(renderToText([]), '');
});

test('renderToJson: envelope with total/count/results', () => {
  const parsed = JSON.parse(renderToJson([formatNode(contentNode)], 42));
  assert.equal(parsed.total, 42);
  assert.equal(parsed.count, 1);
  assert.equal(parsed.results[0].nodeId, 'node-1');
});

test('resolveFacetCounts: maps known facet properties to labeled counts', () => {
  const out = resolveFacetCounts([
    { property: 'ccm:oeh_lrt_aggregated', values: [
      { value: 'http://w3id.org/openeduhub/vocabs/new_lrt_aggregated/38774279-af36-4ec2-8e70-811d5a51a6a1', count: 17878 },
    ] },
    { property: 'ccm:educationalcontext', values: [
      { value: 'http://w3id.org/openeduhub/vocabs/educationalContext/sekundarstufe_1', count: 12404 },
    ] },
    { property: 'ccm:some_unknown_prop', values: [{ value: 'x', count: 5 }] }, // ignored
  ]);
  // URI top-buckets resolve to human labels via the existing vocab, and carry
  // the concept URI so a caller can filter by it exactly.
  assert.deepEqual(out.learningResourceType, [{
    label: 'Video', count: 17878,
    uri: 'http://w3id.org/openeduhub/vocabs/new_lrt_aggregated/38774279-af36-4ec2-8e70-811d5a51a6a1',
  }]);
  assert.equal(out.educationalContext[0].count, 12404);
  assert.match(out.educationalContext[0].label, /Sekundarstufe/i);
  // Unknown facet properties are dropped, not passed through raw.
  assert.equal(out['ccm:some_unknown_prop'], undefined);
  assert.equal(out.some_unknown_prop, undefined);
});

test('resolveFacetCounts: undefined/empty input → empty object', () => {
  assert.deepEqual(resolveFacetCounts(undefined), {});
  assert.deepEqual(resolveFacetCounts([]), {});
});
