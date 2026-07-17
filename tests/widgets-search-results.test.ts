import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderSearchResults } from '../src/apps/widgets/search-results/render.js';

function node(id: string, title: string, nodeType: 'collection' | 'content' = 'content'): any {
  return {
    nodeId: id,
    title,
    description: 'desc',
    disciplines: ['Biologie'],
    educationalContexts: [],
    learningResourceTypes: [],
    url: `https://example.org/${id}`,
    contentUrl: '',
    previewUrl: '',
    previewIsIcon: true,
    license: '',
    publisher: '',
    nodeType,
    topicPageUrl: '',
  };
}

function payload(over: Record<string, unknown> = {}): any {
  return {
    query: 'Photosynthese',
    content: { total: 1, count: 1, results: [node('c1', 'Inhalt A')] },
    collections: { total: 1, count: 1, results: [node('s1', 'Sammlung A', 'collection')] },
    topicPages: { total: 1, count: 1, results: [node('t1', 'Themenseite A', 'collection')] },
    ...over,
  };
}

test('renderSearchResults shows all three buckets with their headings and tiles', () => {
  const html = renderSearchResults(payload(), 'de');
  assert.match(html, /Themenseiten/);
  assert.match(html, /Sammlungen/);
  assert.match(html, /Inhalte/);
  assert.match(html, /Themenseite A/);
  assert.match(html, /Sammlung A/);
  assert.match(html, /Inhalt A/);
});

test('renderSearchResults emphasizes the collections section', () => {
  const html = renderSearchResults(payload(), 'de');
  assert.match(html, /wlo-section--emphasis/);
});

test('renderSearchResults: collections render as a coll-tile row, content as detail-capable cards', () => {
  const html = renderSearchResults(payload(), 'de');
  assert.match(html, /wlo-grid--coll/, 'collection sections use the coll-row grid');
  assert.match(html, /wlo-tile--coll/, 'collection tiles use the edu-sharing block style');
  assert.match(html, /data-node-id="c1"/, 'content cards carry the detail affordance');
});

test('renderSearchResults: a selected node switches to the detail view with a back button', () => {
  const html = renderSearchResults(payload(), 'de', { selectedId: 'c1' });
  assert.match(html, /wlo-detail/, 'detail view renders');
  assert.match(html, /data-action="back"/, 'back button present');
  assert.match(html, /Inhalt A/, 'the selected node is shown');
  assert.doesNotMatch(html, /wlo-grid--coll/, 'the grid is replaced, not stacked under the detail');
  // Unknown id falls back to the grid — never a blank widget.
  assert.match(renderSearchResults(payload(), 'de', { selectedId: 'nope' }), /wlo-grid/);
});

test('renderSearchResults: the detail CTA arrow is decorative (aria-hidden)', () => {
  const html = renderSearchResults(payload(), 'de', { selectedId: 'c1' });
  assert.match(html, /<span aria-hidden="true">↗<\/span>/, 'arrow is hidden from screen readers');
  assert.doesNotMatch(html, /Inhalt öffnen ↗/, 'no bare arrow inside the accessible link text');
});

test('renderSearchResults: the detail view escapes untrusted fields', () => {
  const p = payload();
  p.content.results[0].description = '<img src=x onerror=alert(1)>';
  p.content.results[0].publisher = '<b>Evil</b>';
  const html = renderSearchResults(p, 'de', { selectedId: 'c1' });
  assert.doesNotMatch(html, /<img src=x/, 'description escaped');
  assert.doesNotMatch(html, /<b>Evil<\/b>/, 'publisher escaped');
});

test('renderSearchResults uses locale-appropriate quotes around the query', () => {
  assert.match(renderSearchResults(payload(), 'de'), /„Photosynthese“/);
  const en = renderSearchResults(payload(), 'en');
  assert.match(en, /“Photosynthese”/, 'English locale must use English quotes');
  assert.doesNotMatch(en, /„/, 'no German low-9 quote in the EN locale');
});

test('renderSearchResults omits an empty bucket entirely', () => {
  const html = renderSearchResults(payload({ topicPages: { total: 0, count: 0, results: [] } }), 'de');
  assert.doesNotMatch(html, /Themenseiten/);
  assert.match(html, /Sammlungen/);
});

test('renderSearchResults shows a localized empty state when nothing matched', () => {
  const empty = {
    query: 'zzz',
    content: { total: 0, count: 0, results: [] },
    collections: { total: 0, count: 0, results: [] },
    topicPages: { total: 0, count: 0, results: [] },
  };
  assert.match(renderSearchResults(empty as any, 'de'), /Keine Treffer gefunden/);
  assert.match(renderSearchResults(empty as any, 'en'), /No results found/);
});

test('renderSearchResults escapes the query and handles a missing payload', () => {
  assert.match(renderSearchResults(payload({ query: '<b>x</b>' }), 'de'), /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(renderSearchResults(undefined, 'de'), /Keine Treffer gefunden/);
});
