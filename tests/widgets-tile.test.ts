import { test } from 'node:test';
import assert from 'node:assert/strict';

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

test('resolveLocale defaults to German, honours an English locale hint', () => {
  assert.equal(resolveLocale(undefined), 'de');
  assert.equal(resolveLocale('de-DE'), 'de');
  assert.equal(resolveLocale('en-US'), 'en');
  assert.equal(t('de', 'sectionCollections'), 'Sammlungen');
  assert.equal(t('en', 'sectionCollections'), 'Collections');
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
