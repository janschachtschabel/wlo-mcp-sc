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

test('the selection bar sits ABOVE the content grid, so it is reachable without scrolling past every tile', () => {
  // It used to be emitted after the grid and pinned with `position: sticky`.
  // Sticky needs a scrollport, and the widget document deliberately has none —
  // "no nested scroll (the host sizes the iframe)", base.css. So it degraded to
  // static at the very bottom: a user who ticked a box had to scroll past all
  // results to act on it (live report 2026-07-30).
  const html = renderSearchResults(payload(), 'de', { canSelect: true, selectedIds: ['c1'] });
  const bar = html.indexOf('wlo-selection');
  const firstTile = html.indexOf('Inhalt A');
  assert.ok(bar >= 0, 'the bar renders once something is ticked');
  assert.ok(bar < firstTile, `selection bar (${bar}) must precede the first content tile (${firstTile})`);
});

test('renderSearchResults renders a FLAT node list, so list tools can reuse the widget', () => {
  // get_collection_contents / get_related_content / search_wlo_content return a
  // flat `{total,count,results}` (nodeListSchema), not the search_wlo_all
  // envelope. Without this the widget rendered its empty state for them.
  const flat = {
    query: 'Bruchrechnung',
    total: 1,
    count: 1,
    results: [node('f1', 'Flacher Treffer')],
  } as any;
  const html = renderSearchResults(flat, 'de');
  assert.match(html, /Flacher Treffer/, 'the flat list renders its tiles');
  assert.doesNotMatch(html, /wlo-empty/, 'and does not fall through to the empty state');
});

test('a flat list is split by nodeType, so collections keep their band and their action', () => {
  // get_collection_contents(contentFilter:"folders") and search_wlo_collections
  // return collection nodes in the same flat shape as material nodes. Rendering
  // them as material tiles would drop the collection band AND the "Inhalte
  // anzeigen" button that continues the flow — the tile would be a dead end.
  const flat = {
    query: 'Mathematik',
    total: 2,
    count: 2,
    results: [node('s9', 'Unter-Sammlung', 'collection'), node('c9', 'Ein Material')],
  } as any;
  const html = renderSearchResults(flat, 'de', { canSelect: true });
  const band = html.indexOf('wlo-results__coll-band');
  assert.ok(band >= 0, 'the collection band is present');
  assert.ok(html.indexOf('Unter-Sammlung') > band, 'the collection renders inside the band');
  assert.ok(html.indexOf('Ein Material') > html.indexOf('Unter-Sammlung'), 'the material renders below it');
});

test('renderSearchResults shows all three buckets with their headings and tiles', () => {
  const html = renderSearchResults(payload(), 'de');
  assert.match(html, /Themenseiten/);
  assert.match(html, /Sammlungen/);
  assert.match(html, /Inhalte/);
  assert.match(html, /Themenseite A/);
  assert.match(html, /Sammlung A/);
  assert.match(html, /Inhalt A/);
});

test('renderSearchResults groups collections + topic pages in a separated band above the content', () => {
  const html = renderSearchResults(payload(), 'de');
  // edu-sharing look: the collection/topic-page tiles sit in one lightly
  // separated band ABOVE the material grid (user request 2026-07-17).
  assert.match(html, /wlo-results__coll-band/, 'collection sections live in the separated band');
  const bandIdx = html.indexOf('wlo-results__coll-band');
  const contentIdx = html.indexOf('sectionContent' /* placeholder */) >= 0 ? html.indexOf('sectionContent') : html.indexOf('Inhalte');
  assert.ok(bandIdx >= 0 && bandIdx < contentIdx, 'the band comes before the content section');
});

test('renderSearchResults renders no empty band when there are no collections or topic pages', () => {
  const html = renderSearchResults(
    payload({ collections: { total: 0, count: 0, results: [] }, topicPages: { total: 0, count: 0, results: [] } }),
    'de',
  );
  assert.doesNotMatch(html, /wlo-results__coll-band/, 'no band (and no divider) when nothing goes above the content');
  assert.match(html, /Inhalt A/, 'content still renders');
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

/**
 * The widget is the second renderer of the same envelope, and the rule the HTML
 * page was fixed under holds here too: a field in the envelope is no disclosure
 * if the renderer drops it. "Keine Treffer gefunden." over material that exists
 * — the licence pass removed it — is the misleading claim, so the empty state
 * names the reason when `content.licenseFilter` explains it.
 */
test('the empty state names the licence filter when that is what emptied it', () => {
  const emptied = {
    query: 'Optik',
    content: { total: 172, count: 0, results: [], licenseFilter: { checked: 12, kept: 0 } },
    collections: { total: 0, count: 0, results: [] },
    topicPages: { total: 0, count: 0, results: [] },
  };
  const de = renderSearchResults(emptied as any, 'de');
  assert.match(de, /Lizenz/, 'DE names the licence as the reason');
  assert.match(de, /12/, 'and how many candidates were checked');
  const en = renderSearchResults(emptied as any, 'en');
  assert.match(en, /licence/i, 'EN is localized, not the German sentence');
  assert.match(en, /12/);
});

/**
 * The count is the one interpolated value in this file that does NOT go through
 * `escapeHtml`, and it is safe only because the guard above it (`checked > 0`)
 * coerces numerically: `Number('<img …')` is NaN and NaN > 0 is false, so no
 * value carrying markup ever reaches the template. That is a real guarantee but
 * an implicit one — it lives in a condition written for a different purpose.
 *
 * This test pins it. Relax the guard (say, to also explain a shortened result
 * the way the HTML page does) and the escaping question comes back; this fails
 * first instead of the property disappearing quietly.
 */
test('a non-numeric candidate count cannot inject markup', () => {
  const hostile = {
    query: 'Optik',
    content: {
      total: 1, count: 0, results: [],
      licenseFilter: { checked: '<img src=x onerror=alert(1)>', kept: 0 },
    },
    collections: { total: 0, count: 0, results: [] },
    topicPages: { total: 0, count: 0, results: [] },
  };
  const html = renderSearchResults(hostile as any, 'de');
  assert.doesNotMatch(html, /<img/, 'no element from the payload reaches the DOM');
  assert.doesNotMatch(html, /onerror/);
});

test('the plain empty state stays plain when no licence was filtered', () => {
  const empty = {
    query: 'zzz',
    content: { total: 0, count: 0, results: [] },
    collections: { total: 0, count: 0, results: [] },
    topicPages: { total: 0, count: 0, results: [] },
  };
  assert.doesNotMatch(renderSearchResults(empty as any, 'de'), /Lizenz/);
});

test('renderSearchResults escapes the query and handles a missing payload', () => {
  assert.match(renderSearchResults(payload({ query: '<b>x</b>' }), 'de'), /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(renderSearchResults(undefined, 'de'), /Keine Treffer gefunden/);
});
