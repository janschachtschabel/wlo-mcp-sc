/**
 * widgets-preview-image.test.ts – Why a tile shows no preview, and what may be
 * done about it.
 *
 * User report (ChatGPT, 2026-08-21): many tiles show no image, while the same
 * material shows one in the repository's own anonymous web UI. Measured against
 * staging on 2026-08-21 over 92 unique materials from 12 queries:
 *
 *   75/78  the preview URL resolves on the repository origin → renders today
 *    3/78  the repository 302-redirects the preview to `https://img.youtube.com`
 *          (YouTube-sourced records). CSP re-checks the HOST on a redirect, and
 *          the widget policy named the repository origin ALONE, so the browser
 *          blocked it and the card kept a broken-image box.
 *   14/92  carry `previewIsIcon: true`: the repository never rendered a preview
 *          and answers with `…/mime-types/previews/link.svg`. Nothing to fix
 *          server-side — no image field is set on those records either (0 of 8
 *          sampled) — and the widget already suppresses the placeholder.
 *
 * Two changes follow, and this file pins both: the CSP names the thumbnail
 * hosts the repository actually redirects to, and an image that fails anyway
 * degrades to the card's own icon instead of a broken-image box.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { renderDetail } from '../src/apps/widgets/shared/detail.js';
import { installImageFallback } from '../src/apps/widgets/shared/image-fallback.js';
import { renderTile } from '../src/apps/widgets/shared/tile.js';
import { widgetResourceMeta } from '../src/apps/resources.js';
import { log } from '../src/logger.js';
import { WLO_REPOSITORY_URL } from '../src/wlo-config.js';

const REPOSITORY_ORIGIN = new URL(WLO_REPOSITORY_URL).origin;
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

function node(overrides: Record<string, unknown> = {}): any {
  return {
    nodeId: 'n1',
    title: 'Photosynthese',
    description: '',
    keywords: [],
    disciplines: [],
    educationalContexts: [],
    userRoles: [],
    learningResourceTypes: [],
    url: 'https://example.org/photo',
    downloadUrl: '',
    contentUrl: '',
    previewUrl: `${REPOSITORY_ORIGIN}/edu-sharing/preview?nodeId=n1`,
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

type Csp = { connectDomains: string[]; resourceDomains: string[] };
const cspOf = (): Csp => (widgetResourceMeta() as { ui: { csp: Csp } }).ui.csp;

test('the CSP allows images from the hosts the repository redirects previews to', () => {
  const csp = cspOf();
  assert.ok(csp.resourceDomains.includes(REPOSITORY_ORIGIN), 'the repository itself, as before');
  assert.ok(
    csp.resourceDomains.includes('https://img.youtube.com'),
    'measured 2026-08-21: 3 of 78 previews 302 to this host, and CSP re-checks the host on a redirect',
  );
});

test('an image host is NOT also a connect host', () => {
  // The widget never fetches; widening `connect_domains` would hand a
  // third-party origin a channel it has no use for.
  assert.deepEqual(cspOf().connectDomains, [REPOSITORY_ORIGIN]);
});

test('the operator can change or empty the image-host list', () => {
  const before = process.env['WLO_WIDGET_IMAGE_DOMAINS'];
  try {
    process.env['WLO_WIDGET_IMAGE_DOMAINS'] = 'https://cdn.example.org, https://img.example.net';
    const custom = cspOf().resourceDomains;
    assert.ok(custom.includes('https://cdn.example.org') && custom.includes('https://img.example.net'));
    assert.ok(!custom.includes('https://img.youtube.com'), 'an explicit list replaces the default');

    // `none` = "repository only", for an operator who does not want the
    // browser talking to a third party at all.
    process.env['WLO_WIDGET_IMAGE_DOMAINS'] = 'none';
    assert.deepEqual(cspOf().resourceDomains, [REPOSITORY_ORIGIN]);

    // EMPTY is not that choice — `docker-compose.yml` writes every setting as
    // `"${VAR:-}"`, so an unconfigured container always presents an empty
    // string. Reading it as "off" would drop the default on every deployment.
    process.env['WLO_WIDGET_IMAGE_DOMAINS'] = '';
    assert.ok(cspOf().resourceDomains.includes('https://img.youtube.com'), 'empty keeps the default');

    // A typo must not become a CSP entry that silently matches nothing.
    process.env['WLO_WIDGET_IMAGE_DOMAINS'] = 'not a url, https://ok.example.org';
    const cleaned = cspOf().resourceDomains;
    assert.ok(cleaned.includes('https://ok.example.org'));
    assert.ok(!cleaned.some(d => d.includes('not a url')));
  } finally {
    if (before === undefined) delete process.env['WLO_WIDGET_IMAGE_DOMAINS'];
    else process.env['WLO_WIDGET_IMAGE_DOMAINS'] = before;
  }
});

test('a malformed entry is named once, not on every request', () => {
  // `widgetResourceMeta` runs PER REQUEST — `src/mcp-transport.ts` builds a
  // fresh server and transport for each one — and once per widget within it.
  // Warning per call turned a single typo into four log lines per request, and
  // a log that repeats at request rate stops being read, which is the one thing
  // the warning exists for. Its own raw value, so the test does not depend on
  // whether another test primed the same string first.
  const before = process.env['WLO_WIDGET_IMAGE_DOMAINS'];
  const realWarn = log.warn;
  let warnings = 0;
  log.warn = () => { warnings += 1; };
  try {
    process.env['WLO_WIDGET_IMAGE_DOMAINS'] = 'https://ok2.example.org, ::: kein URL :::';
    widgetResourceMeta();
    widgetResourceMeta();
    widgetResourceMeta();
    assert.equal(warnings, 1, 'one line for the typo, not one per call');
    // The good entry of the same list still survives the memoisation.
    assert.ok(cspOf().resourceDomains.includes('https://ok2.example.org'));
  } finally {
    log.warn = realWarn;
    if (before === undefined) delete process.env['WLO_WIDGET_IMAGE_DOMAINS'];
    else process.env['WLO_WIDGET_IMAGE_DOMAINS'] = before;
  }
});

test('a preview image carries the glyph to fall back to when it fails to load', () => {
  // The glyph travels on the element so the DOM handler needs no second copy
  // of "what does a card without a picture look like".
  assert.match(renderTile(node(), { locale: 'de' }), /<img[^>]*data-fallback="📄"/);
  assert.match(renderDetail(node(), 'de', false), /<img[^>]*data-fallback="📄"/);
  assert.match(
    renderDetail(node({ nodeType: 'collection' }), 'de', false),
    /<img[^>]*data-fallback="⧉"/,
    'a collection falls back to the collection glyph, as its no-preview path already does',
  );
});

test('a record whose preview is a generic icon still renders no image at all', () => {
  // Unchanged behaviour, pinned because it is 15 % of results: the repository
  // has no preview for these, and its `link.svg` placeholder says nothing the
  // card does not already say.
  const html = renderTile(node({ previewIsIcon: true }), { locale: 'de' });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /wlo-tile__icon/);
});

for (const rel of ['../src/apps/widgets/search-results/main.ts', '../src/apps/widgets/shared/mount.ts']) {
  test(`${rel}: installs the failed-image fallback`, () => {
    assert.match(read(rel), /installImageFallback\s*\(\s*\)/);
  });
}

/**
 * Enough DOM to run the real handler. Node has none and the project carries no
 * DOM library — adding one for three methods would cost more than it proves —
 * so the stub implements exactly what `image-fallback.ts` touches.
 *
 * It registers the listener ONLY for the capture phase, which makes the stub
 * itself the guard for that: `error` does not bubble, so a handler attached
 * without `true` would never run in a browser, and here it never runs either.
 */
function fakeDom(): { fire: (target: unknown) => void; restore: () => void } {
  let handler: ((event: { target: unknown }) => void) | undefined;
  const g = globalThis as any;
  const had = 'document' in g;
  const previous = g.document;
  g.document = {
    addEventListener: (type: string, fn: unknown, capture?: boolean) => {
      if (type === 'error' && capture === true) handler = fn as (event: { target: unknown }) => void;
    },
    createElement: () => ({
      className: '',
      textContent: '',
      attrs: {} as Record<string, string>,
      setAttribute(key: string, value: string) { this.attrs[key] = value; },
    }),
  };
  return {
    fire: (target) => handler?.({ target }),
    restore: () => { if (had) g.document = previous; else delete g.document; },
  };
}

function fakeImg(attrs: Record<string, string>, tagName = 'IMG'): any {
  return {
    tagName,
    replacement: null as any,
    getAttribute: (key: string) => attrs[key] ?? null,
    replaceWith(el: unknown) { this.replacement = el; },
  };
}

test('a preview that fails to load becomes the card icon — and nothing else is touched', () => {
  const dom = fakeDom();
  try {
    installImageFallback();

    const ours = fakeImg({ 'data-fallback': '📄' });
    dom.fire(ours);
    assert.equal(ours.replacement?.textContent, '📄', 'the glyph the card would have shown anyway');
    assert.equal(ours.replacement?.className, 'wlo-tile__icon');
    assert.equal(ours.replacement?.attrs['aria-hidden'], 'true', 'decoration, never announced');

    const collection = fakeImg({ 'data-fallback': '⧉' });
    dom.fire(collection);
    assert.equal(collection.replacement?.textContent, '⧉');

    // An image we did not render keeps whatever behaviour it had.
    const foreign = fakeImg({});
    dom.fire(foreign);
    assert.equal(foreign.replacement, null);

    // `error` in the capture phase also fires for scripts, stylesheets, media.
    const notAnImage = fakeImg({ 'data-fallback': '📄' }, 'SCRIPT');
    dom.fire(notAnImage);
    assert.equal(notAnImage.replacement, null);
  } finally {
    dom.restore();
  }
});
