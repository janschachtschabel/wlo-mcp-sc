/**
 * markdown.ts – A deliberately NARROW Markdown subset renderer.
 *
 * Used for material full texts and editorial compendium prose. That text comes
 * from third-party publishers and from an external conversion service, so it is
 * untrusted input: everything is escaped FIRST and only the recognised subset is
 * turned back into markup. A general-purpose parser would widen the attack
 * surface for no benefit here, and would dwarf the 7–9 kB widget bundles.
 *
 * Supported: headings (#..######), paragraphs, unordered/ordered lists,
 * blockquotes, fenced code, horizontal rules, bold, italic, inline code, and
 * http(s) links. Anything else survives as plain, escaped text.
 *
 * Pure and DOM-free: the same function renders the widget and, when needed, a
 * server-side HTML page — which a browser-only Markdown package could not.
 */

import { escapeHtml } from './escape.js';
import { safeHref } from './safe-url.js';

const emphasis = (escaped: string): string => escaped
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');

/** A link target: no whitespace, and ONE level of balanced parentheses — `…/Optik_(Physik)`. */
// The label holds no bracket (a run of `[` otherwise made the match quadratic),
// and the target no placeholder mark: a code span inside a target was restored
// INTO the `href`.
const LINK = new RegExp('\\[([^\\[\\]]*)\\]\\(((?:[^()\\s' + '\u0000' + ']|\\([^()\\s' + '\u0000' + ']*\\))+)\\)', 'g');

/**
 * Inline formatting, applied to ALREADY-ESCAPED text.
 *
 * Code spans and links are taken OUT first and put back last, so the emphasis
 * rules never see them. Applied in sequence on one string — as this was — a
 * `*` in a link target became `<em>` inside the `href`, a target with a
 * parenthesis was cut at it, and a link written inside a code span was made
 * clickable (audit 2026-11-12, F-1). None of that was unsafe — everything is
 * escaped before it gets here — it was wrong.
 *
 * The placeholder is NUL-delimited, and NUL is removed from the input first:
 * what is put back can only be what this function took out.
 */
const MARK = '\u0000';
// Built from the constant, not written as a literal: a control character inside
// a regex literal is a lint error, and rightly so.
const PLACEHOLDER = new RegExp(`${MARK}(\\d+)${MARK}`, 'g');

function inline(escaped: string): string {
  const kept: string[] = [];
  const keep = (html: string): string => `${MARK}${kept.push(html) - 1}${MARK}`;

  const text = escaped
    .split(MARK).join('')
    // Code first: its content is not reinterpreted by anything below.
    .replace(/`([^`]+)`/g, (_m, code: string) => keep(`<code>${code}</code>`))
    // Links: the target goes through the shared scheme guard, so a
    // `javascript:` or `data:` URL is dropped while the label survives. The
    // LABEL may carry emphasis; the target may not.
    .replace(LINK, (_m, label: string, href: string) => {
      const safe = safeHref(href.replace(/&amp;/g, '&'));
      return safe
        ? keep(`<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${emphasis(label)}</a>`)
        : label;
    });

  // A label can hold a code span, so a restored piece may itself hold a
  // placeholder — restored until none is left (each pass removes at least one).
  let out = emphasis(text);
  while (out.includes(MARK)) out = out.replace(PLACEHOLDER, (_m, n: string) => kept[Number(n)] ?? '');
  return out;
}

/** One list item's text, with the marker already stripped. */
const UL_ITEM = /^\s*[-*+]\s+(.*)$/;
const OL_ITEM = /^\s*\d+[.)]\s+(.*)$/;

export function renderMarkdown(src: string): string {
  const text = (src ?? '').replace(/\r\n?/g, '\n');
  if (!text.trim()) return '';

  const out: string[] = [];
  const lines = text.split('\n');
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listTag: 'ul' | 'ol' | null = null;
  let quote: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p class="wlo-md__p">${inline(escapeHtml(paragraph.join(' ')))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!listTag || !listItems.length) { listTag = null; listItems = []; return; }
    const items = listItems.map(i => `<li>${inline(escapeHtml(i))}</li>`).join('');
    out.push(`<${listTag} class="wlo-md__list">${items}</${listTag}>`);
    listTag = null;
    listItems = [];
  };
  const flushQuote = () => {
    if (!quote.length) return;
    out.push(`<blockquote class="wlo-md__quote">${inline(escapeHtml(quote.join(' ')))}</blockquote>`);
    quote = [];
  };
  const flushAll = () => { flushParagraph(); flushList(); flushQuote(); };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code: consumed verbatim so nothing inside is reinterpreted.
    if (/^\s*```/.test(line)) {
      flushAll();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      out.push(`<pre class="wlo-md__code"><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    if (!line.trim()) { flushAll(); continue; }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      // Headings start at h2: the widget's own title owns the single h1, so
      // promoting document headings would break the page outline.
      const level = Math.min(6, heading[1].length + 1);
      out.push(`<h${level} class="wlo-md__h">${inline(escapeHtml(heading[2].trim()))}</h${level}>`);
      continue;
    }

    if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) { flushAll(); out.push('<hr class="wlo-md__rule" />'); continue; }

    const ul = UL_ITEM.exec(line);
    const ol = OL_ITEM.exec(line);
    if (ul || ol) {
      flushParagraph();
      flushQuote();
      const tag = ul ? 'ul' : 'ol';
      if (listTag && listTag !== tag) flushList();
      listTag = tag;
      listItems.push((ul ?? ol)![1]);
      continue;
    }
    flushList();

    const bq = /^\s*>\s?(.*)$/.exec(line);
    if (bq) { flushParagraph(); quote.push(bq[1]); continue; }
    flushQuote();

    paragraph.push(line.trim());
  }
  flushAll();
  return out.join('');
}
