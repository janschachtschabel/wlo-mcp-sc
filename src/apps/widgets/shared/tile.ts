/**
 * tile.ts – The shared OER card (W3), reused by W1/W2/W4.
 *
 * Pure function `WidgetNode → HTML string`. Every interpolated field is
 * escaped (the data comes from an external backend). Returns an `<li>` so a
 * caller MUST wrap tiles in a `<ul>` — this gives screen readers real list
 * semantics. Accessibility floor: a real thumbnail carries meaningful German
 * alt text; a generic mediatype icon is decorative (`aria-hidden`); the title
 * is the single primary action (one link, ≤2 actions per card); metadata is
 * plain text (never colour-only). DOM-free (bundled into the browser widget and
 * unit-tested in Node).
 */

import { escapeHtml } from './escape.js';
import { safeHref } from './safe-url.js';
import { t, type Locale } from './strings.js';
import type { WidgetNode } from './types.js';

export interface TileOptions {
  locale?: Locale;
  /**
   * Render a "Details" button carrying `data-node-id` — STRICTLY opt-in:
   * only a widget that installs the matching click handler (search-results)
   * may set this, otherwise the card ships a dead button.
   */
  detailButton?: boolean;
}

const DESC_MAX = 160;

/** Truncate at a word boundary near the limit, appending an ellipsis. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}

export function renderTile(node: WidgetNode, options: TileOptions = {}): string {
  const locale = options.locale ?? 'de';
  const title = escapeHtml(node.title || '');
  const href = safeHref(node.url || node.contentUrl || node.topicPageUrl);

  // Collections render as the edu-sharing style tile: a colored block with a
  // decorative stack glyph instead of a thumbnail, the name below, and a
  // text+icon badge (never colour-only) when the collection has a Themenseite.
  if (node.nodeType === 'collection') {
    const titleHtml = href
      ? `<a class="wlo-tile__link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${title}</a>`
      : `<span class="wlo-tile__link">${title}</span>`;
    const badge = node.topicPageUrl
      ? `<span class="wlo-badge"><span aria-hidden="true">🌐</span> ${escapeHtml(t(locale, 'badgeTopicPage'))}</span>`
      : '';
    const collDesc = node.description
      ? `<p class="wlo-tile__desc">${escapeHtml(truncate(node.description, 90))}</p>`
      : '';
    return (
      `<li class="wlo-tile wlo-tile--coll">` +
      `<div class="wlo-coll__block"><span class="wlo-coll__glyph" aria-hidden="true">⧉</span></div>` +
      `<div class="wlo-tile__body">` +
      `<h3 class="wlo-tile__title">${titleHtml}</h3>${badge}${collDesc}` +
      `</div>` +
      `</li>`
    );
  }
  // Scheme-guard the image src too (not just hrefs): a node-derived previewUrl is
  // publisher metadata. A non-http(s) value falls back to the icon.
  const previewSrc = (!!node.previewUrl && !node.previewIsIcon) ? safeHref(node.previewUrl) : '';

  // Collections returned above — from here on this is always a content card.
  const thumb = previewSrc
    ? `<img class="wlo-tile__img" src="${escapeHtml(previewSrc)}" alt="${escapeHtml(`${t(locale, 'previewAlt')} ${node.title || ''}`)}" loading="lazy" />`
    : `<span class="wlo-tile__icon" aria-hidden="true">📄</span>`;

  const titleHtml = href
    ? `<a class="wlo-tile__link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${title}</a>`
    : `<span class="wlo-tile__link">${title}</span>`;

  const desc = node.description
    ? `<p class="wlo-tile__desc">${escapeHtml(truncate(node.description, DESC_MAX))}</p>`
    : '';

  const chips = [node.disciplines?.[0], node.educationalContexts?.[0], node.learningResourceTypes?.[0]]
    .filter((c): c is string => !!c)
    .map(c => `<li class="wlo-chip">${escapeHtml(c)}</li>`)
    .join('');
  const chipsHtml = chips ? `<ul class="wlo-tile__chips" role="list">${chips}</ul>` : '';

  // edu-sharing style labelled fact rows (license / source) instead of a
  // joined one-liner — plain text, never colour-only.
  const facts = [
    node.license ? `<div class="wlo-facts__row"><dt>${escapeHtml(t(locale, 'licenseLabel'))}</dt><dd>${escapeHtml(node.license)}</dd></div>` : '',
    node.publisher ? `<div class="wlo-facts__row"><dt>${escapeHtml(t(locale, 'sourceLabel'))}</dt><dd>${escapeHtml(node.publisher)}</dd></div>` : '',
  ].join('');
  const factsHtml = facts ? `<dl class="wlo-tile__facts">${facts}</dl>` : '';

  const detailBtn = options.detailButton
    ? `<button type="button" class="wlo-tile__details" data-node-id="${escapeHtml(node.nodeId)}" ` +
      `aria-label="${escapeHtml(`${t(locale, 'detailsFor')} ${t(locale, 'quoteOpen')}${node.title || ''}${t(locale, 'quoteClose')}`)}">${escapeHtml(t(locale, 'details'))}</button>`
    : '';

  return (
    `<li class="wlo-tile">` +
    `<div class="wlo-tile__thumb">${thumb}</div>` +
    `<div class="wlo-tile__body">` +
    `<h3 class="wlo-tile__title">${titleHtml}</h3>${desc}${chipsHtml}${factsHtml}${detailBtn}` +
    `</div>` +
    `</li>`
  );
}
