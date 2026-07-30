import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderMarkdown } from '../src/apps/widgets/shared/markdown.js';

/**
 * A deliberately NARROW Markdown subset, not a general parser. The text comes
 * from third-party publishers and an external conversion service, i.e. it is
 * untrusted: a generic renderer would widen the attack surface, and the widget
 * bundles are 7–9 kB where a Markdown package alone is a multiple of that.
 * Everything outside the subset must survive as escaped text, never as markup.
 */

test('renders headings one level down, so the widget keeps the only h1', () => {
  // WCAG outline: a page has exactly one h1, and the widget's own title owns it.
  // Emitting a document's `#` as h1 would give the page two competing top-level
  // headings and break the structure screen readers navigate by.
  const html = renderMarkdown('# Titel\n\n## Abschnitt\n\n### Unterpunkt');
  assert.doesNotMatch(html, /<h1/, 'never a second h1');
  assert.match(html, /<h2[^>]*>Titel<\/h2>/);
  assert.match(html, /<h3[^>]*>Abschnitt<\/h3>/);
  assert.match(html, /<h4[^>]*>Unterpunkt<\/h4>/);
});

test('heading levels never exceed h6', () => {
  assert.match(renderMarkdown('###### tief'), /<h6[^>]*>tief<\/h6>/);
});

test('renders paragraphs and keeps blank-line separation', () => {
  const html = renderMarkdown('Erster Absatz.\n\nZweiter Absatz.');
  const paragraphs = html.match(/<p[^>]*>/g) ?? [];
  assert.equal(paragraphs.length, 2);
});

test('renders unordered and ordered lists as real lists', () => {
  const ul = renderMarkdown('- eins\n- zwei');
  assert.match(ul, /<ul[^>]*>.*<li>eins<\/li>.*<li>zwei<\/li>.*<\/ul>/s);
  const ol = renderMarkdown('1. eins\n2. zwei');
  assert.match(ol, /<ol[^>]*>.*<li>eins<\/li>.*<\/ol>/s);
});

test('renders bold and italic inside a paragraph', () => {
  const html = renderMarkdown('Das ist **wichtig** und *betont*.');
  assert.match(html, /<strong>wichtig<\/strong>/);
  assert.match(html, /<em>betont<\/em>/);
});

test('renders blockquotes and horizontal rules', () => {
  assert.match(renderMarkdown('> Zitat'), /<blockquote[^>]*>.*Zitat.*<\/blockquote>/s);
  assert.match(renderMarkdown('---'), /<hr[^>]*\/?>/);
});

test('renders fenced code verbatim, without interpreting it', () => {
  const html = renderMarkdown('```\n**nicht fett**\n```');
  assert.match(html, /<pre[^>]*><code>/);
  assert.doesNotMatch(html, /<strong>/, 'markup inside code stays literal');
  assert.match(html, /\*\*nicht fett\*\*/);
});

// ── Safety: the whole reason for a hand-written subset ───────────────────────

test('escapes raw HTML in the source instead of emitting it', () => {
  const html = renderMarkdown('Hallo <script>alert(1)</script> Welt');
  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /&lt;script&gt;/);
});

/** Every element name the renderer actually produces. */
const ALLOWED_TAGS = new Set([
  'p', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
  'blockquote', 'pre', 'code', 'hr', 'strong', 'em', 'a',
]);

/** Element names present in the output (opening and closing). */
function tagsIn(html: string): string[] {
  return [...html.matchAll(/<\/?([a-z][a-z0-9]*)\b/gi)].map(m => m[1].toLowerCase());
}

test('an image/event-handler injection becomes inert visible text', () => {
  // The security property is "no element outside the whitelist is produced",
  // not "the word onerror never appears" — as escaped text inside a paragraph
  // it is inert, and the reader can see what the source actually contained.
  const html = renderMarkdown('<img src=x onerror="alert(1)">');
  assert.match(html, /&lt;img/, 'the tag survives only as escaped text');
  for (const tag of tagsIn(html)) {
    assert.ok(ALLOWED_TAGS.has(tag), `unexpected element <${tag}> in output`);
  }
});

test('no hostile source can produce an element outside the whitelist', () => {
  const hostile = [
    '<script>alert(1)</script>',
    '<iframe src="https://evil.test"></iframe>',
    '<svg onload=alert(1)>',
    '<style>body{display:none}</style>',
    '[x](data:text/html,<script>alert(1)</script>)',
    '# <img src=x onerror=alert(1)>',
    '> <object data="x"></object>',
    '- <embed src=x>',
  ].join('\n\n');
  for (const tag of tagsIn(renderMarkdown(hostile))) {
    assert.ok(ALLOWED_TAGS.has(tag), `unexpected element <${tag}> in output`);
  }
});

test('drops a javascript: link target but keeps its text', () => {
  const html = renderMarkdown('[klick](javascript:alert(1))');
  assert.doesNotMatch(html, /javascript:/i);
  assert.match(html, /klick/);
});

test('renders an http(s) link with a safe target', () => {
  const html = renderMarkdown('[WLO](https://wirlernenonline.de)');
  assert.match(html, /<a [^>]*href="https:\/\/wirlernenonline\.de"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /target="_blank"/);
});

test('escapes markup inside link text and headings too', () => {
  assert.doesNotMatch(renderMarkdown('# <b>fett</b>'), /<b>/);
  assert.doesNotMatch(renderMarkdown('[<b>x</b>](https://e.org)'), /<b>/);
});

test('empty input yields empty output, not a stray element', () => {
  assert.equal(renderMarkdown(''), '');
  assert.equal(renderMarkdown('   \n\n  '), '');
});
