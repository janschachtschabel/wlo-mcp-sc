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

/** Inline formatting, applied to ALREADY-ESCAPED text. */
function inline(escaped: string): string {
  return escaped
    // Code first: its content must not be reinterpreted by the rules below.
    .replace(/`([^`]+)`/g, (_m, code: string) => `<code>${code}</code>`)
    // Links: the target goes through the shared scheme guard, so a
    // `javascript:` or `data:` URL is dropped while the label survives.
    .replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) => {
      const safe = safeHref(href.replace(/&amp;/g, '&'));
      return safe
        ? `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${label}</a>`
        : label;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
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
