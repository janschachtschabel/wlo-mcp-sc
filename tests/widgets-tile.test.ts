import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { renderTile } from '../src/apps/widgets/shared/tile.js';
import { resolveLocale, t } from '../src/apps/widgets/shared/strings.js';

/** Minimal FormattedNode fixture — only the fields the tile reads matter. */
function node(overrides: Record<string, unknown> = {}): any {
  return {
    nodeId: 'n1',
    title: 'Photosynthese',
    description: 'Wie Pflanzen Licht in chemische Energie umwandeln.',
    keywords: [],
    disciplines: ['Biologie'],
    educationalContexts: ['Sekundarstufe I'],
    userRoles: [],
    learningResourceTypes: ['Video'],
    url: 'https://example.org/photo',
    downloadUrl: '',
    contentUrl: '',
    previewUrl: 'https://redaktion.openeduhub.net/edu-sharing/preview/n1.png',
    previewIsIcon: false,
    mimeType: 'text/html',
    fileSize: 0,
    license: 'CC BY 4.0',
    publisher: 'Serlo',
    nodeType: 'content',
    topicPageUrl: '',
    ...overrides,
  };
}

/**
 * Teachers must be able to tell "free to reuse" from "no licence stated" — and
 * many WLO records genuinely carry no `ccm:commonlicense_key` (all six sampled
 * Tutory worksheets, even at the full `-all-` projection, 2026-07-28). Omitting
 * the row made those indistinguishable from an unread one, which is the one
 * reading that is unsafe to act on.
 */
test('a content tile states the licence when there is one', () => {
  const html = renderTile(node(), { locale: 'de' });
  assert.match(html, /Lizenz/, 'licence label');
  assert.match(html, /CC BY 4\.0/, 'the licence itself');
});

test('a content tile says so explicitly when NO licence is stated', () => {
  const html = renderTile(node({ license: '' }), { locale: 'de' });
  assert.match(html, /Lizenz/, 'the row must not disappear');
  assert.match(html, /nicht angegeben/i, 'and must name the gap, not leave it blank');
});

test('the missing-licence wording is localized', () => {
  const html = renderTile(node({ license: '' }), { locale: 'en' });
  assert.match(html, /not stated/i);
});

/**
 * Tiles in a row must be interchangeable in size. Live, they were not: a taller
 * preview image or a longer description pushed the licence rows and the Details
 * button to a different height in every card, so the grid read as ragged
 * (user report 2026-07-28). Portrait tiles are wanted — inconsistent ones are
 * not. The fix is structural, so it is pinned structurally.
 */
test('the preview box is a fixed portrait format, identical in every tile', () => {
  const css = readFileSync('src/apps/widgets/shared/base.css', 'utf8');
  const thumb = /\.wlo-tile__thumb\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(thumb, /aspect-ratio:\s*3\s*\/\s*4/, 'one portrait ratio for all previews');
  const img = /\.wlo-tile__img\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(img, /object-fit:\s*cover/, 'images fill the box instead of resizing it');
  assert.match(img, /width:\s*100%/);
  assert.match(img, /height:\s*100%/);
});

test('title and description are clamped to a fixed number of lines', () => {
  const css = readFileSync('src/apps/widgets/shared/base.css', 'utf8');
  const desc = /\.wlo-tile__desc\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(desc, /line-clamp:\s*3/, 'the description never grows past three lines');
  assert.match(desc, /min-height/, 'and reserves that height even when shorter');
  const title = /\.wlo-tile__title\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(title, /line-clamp:\s*2/);
});

test('the fact rows and the details button sit at the bottom of every tile', () => {
  const css = readFileSync('src/apps/widgets/shared/base.css', 'utf8');
  const body = /\.wlo-tile__body\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(body, /flex:\s*1/, 'the body fills the tile so the footer can be pushed down');
  const facts = /\.wlo-tile__facts\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(facts, /margin-top:\s*auto/, 'footer anchored to the bottom, not floating after the text');
});

test('resolveLocale defaults to German, honours an English locale hint', () => {
  assert.equal(resolveLocale(undefined), 'de');
  assert.equal(resolveLocale('de-DE'), 'de');
  assert.equal(resolveLocale('en-US'), 'en');
  assert.equal(t('de', 'sectionCollections'), 'Sammlungen');
  assert.equal(t('en', 'sectionCollections'), 'Collections');
});

test('a collection renders as an edu-sharing style tile (colored block, badge, no thumb img)', () => {
  const coll = node({ nodeType: 'collection', title: 'Bruchrechnung', topicPageUrl: 'https://example.org/tp', previewUrl: '', previewIsIcon: true });
  const html = renderTile(coll, { locale: 'de' });
  assert.match(html, /wlo-tile--coll/, 'collection variant class');
  assert.match(html, /aria-hidden="true"/, 'the glyph is decorative');
  assert.doesNotMatch(html, /<img/, 'collections use the colored block, not a thumbnail');
  assert.match(html, /Themenseite/, 'topic-page badge when the collection has one');
  const plain = renderTile(node({ nodeType: 'collection', topicPageUrl: '' }), { locale: 'de' });
  assert.doesNotMatch(plain, /wlo-badge/, 'no badge without a topic page');
});

test('detailButton is strictly opt-in and carries the node id + accessible name', () => {
  const withBtn = renderTile(node(), { locale: 'de', detailButton: true });
  assert.match(withBtn, /<button[^>]*data-node-id="n1"/, 'details button carries the node id');
  assert.match(withBtn, /Details zu\s*[^<]*Photosynthese/, 'accessible name names the item');
  const without = renderTile(node(), { locale: 'de' });
  assert.doesNotMatch(without, /data-node-id=/, 'no dead button in widgets without a handler');
});

test('renderTile shows a real thumbnail with meaningful German alt text', () => {
  const html = renderTile(node());
  assert.match(html, /^<li /, 'tile is a list item (wrapped by a <ul> container)');
  assert.match(html, /<img[^>]+src="https:\/\/redaktion\.openeduhub\.net\/edu-sharing\/preview\/n1\.png"/);
  assert.match(html, /alt="Vorschaubild: Photosynthese"/);
  assert.match(html, /loading="lazy"/);
});

test('renderTile uses a decorative placeholder (no img) for an icon-only preview', () => {
  const html = renderTile(node({ previewIsIcon: true }));
  assert.doesNotMatch(html, /<img/, 'no <img> when the preview is a generic icon');
  assert.match(html, /aria-hidden="true"/, 'placeholder is hidden from assistive tech');
});

test('renderTile links the title to the resource with a safe target', () => {
  const html = renderTile(node());
  assert.match(html, /<a[^>]+href="https:\/\/example\.org\/photo"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, />Photosynthese</);
});

test('renderTile renders discipline / level / type as chips', () => {
  const html = renderTile(node());
  assert.match(html, /Biologie/);
  assert.match(html, /Sekundarstufe I/);
  assert.match(html, /Video/);
});

test('renderTile escapes markup in every interpolated field (XSS guard)', () => {
  const html = renderTile(node({ title: '<script>alert(1)</script>', publisher: '"><img src=x>' }));
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.match(html, /&lt;script&gt;/);
});

test('renderTile drops a dangerous URL scheme (no javascript: href)', () => {
  const html = renderTile(node({ url: 'javascript:alert(1)', contentUrl: '', topicPageUrl: '' }));
  assert.doesNotMatch(html, /href="javascript:/i, 'no javascript: href');
  assert.doesNotMatch(html, /<a /, 'a dangerous-only URL yields no link element');
  assert.match(html, />Photosynthese</, 'title still rendered as text');
});

test('renderTile truncates an over-long description', () => {
  const long = 'x'.repeat(400);
  const html = renderTile(node({ description: long }));
  assert.ok(!html.includes('x'.repeat(400)), 'full 400-char description is not emitted verbatim');
  assert.match(html, /…/, 'truncation ellipsis present');
});

test('renderTile falls back to plain text when no open link exists', () => {
  const html = renderTile(node({ url: '', contentUrl: '', topicPageUrl: '' }));
  assert.doesNotMatch(html, /<a /, 'no link element without a target URL');
  assert.match(html, />Photosynthese</);
});
