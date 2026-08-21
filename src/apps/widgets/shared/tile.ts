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
import type { ToolFollowUpAction } from './follow-up.js';
import { safeHref } from './safe-url.js';
import { t, type Locale, type StringKey } from './strings.js';
import type { WidgetNode } from './types.js';

export interface TileOptions {
  locale?: Locale;
  /**
   * Render a "Details" button carrying `data-node-id` — STRICTLY opt-in:
   * only a widget that installs the matching click handler (search-results)
   * may set this, otherwise the card ships a dead button.
   */
  detailButton?: boolean;
  /**
   * Render a selection checkbox — opt-in for the same reason, and additionally
   * gated on the host being able to take a follow-up message: without that the
   * selection could not be used for anything.
   */
  selectable?: boolean;
  /** Current checked state of that checkbox. */
  selected?: boolean;
  /**
   * Render the action button that continues this node's flow (collections:
   * open contents / open topic page). Gated on the host being able to inject a
   * follow-up message, otherwise the button could do nothing.
   */
  followUp?: boolean;
}

const DESC_MAX = 160;

/**
 * The glyph a card shows in place of a picture — for a record the repository
 * has no preview for, and (via `data-fallback`) for a preview that fails to
 * load. Both cases must look the same, so both read it from here.
 */
export const PREVIEW_GLYPH = { content: '📄', collection: '⧉' } as const;

/** The decorative stand-in for a missing preview. Never announced. */
export function previewIcon(nodeType?: string): string {
  const glyph = nodeType === 'collection' ? PREVIEW_GLYPH.collection : PREVIEW_GLYPH.content;
  return `<span class="wlo-tile__icon" aria-hidden="true">${glyph}</span>`;
}

/** Action label per follow-up type — the button's visible text. */
const ACTION_LABEL: Readonly<Record<ToolFollowUpAction, StringKey>> = {
  contents: 'actionContents',
  topicPage: 'actionTopicPage',
  text: 'actionText',
  related: 'actionRelated',
};

/**
 * A button that continues this node's flow. It carries the id and title as data
 * attributes; the widget's main.ts turns them into a chat message via
 * `followUpPrompt`. Never an `<a>`: this triggers an action, not navigation.
 */
export function followUpButton(action: ToolFollowUpAction, node: WidgetNode, locale: Locale): string {
  const label = t(locale, ACTION_LABEL[action]);
  return (
    `<button type="button" class="wlo-tile__followup" data-follow-up="${action}" ` +
    `data-node-id="${escapeHtml(node.nodeId)}" data-node-title="${escapeHtml(node.title || '')}" ` +
    `aria-label="${escapeHtml(`${label}: ${node.title || ''}`)}">${escapeHtml(label)}</button>`
  );
}

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
    // ONE clear primary action per card: a collection with a Themenseite opens
    // that (the curated view); a plain one lists its contents. Offering both
    // would make the card ask a question instead of answering one.
    const collAction = options.followUp
      ? followUpButton(node.topicPageUrl ? 'topicPage' : 'contents', node, locale)
      : '';
    return (
      `<li class="wlo-tile wlo-tile--coll">` +
      `<div class="wlo-coll__block"><span class="wlo-coll__glyph" aria-hidden="true">⧉</span></div>` +
      `<div class="wlo-tile__body">` +
      `<h3 class="wlo-tile__title">${titleHtml}</h3>${badge}${collDesc}${collAction}` +
      `</div>` +
      `</li>`
    );
  }
  // Scheme-guard the image src too (not just hrefs): a node-derived previewUrl is
  // publisher metadata. A non-http(s) value falls back to the icon.
  const previewSrc = (!!node.previewUrl && !node.previewIsIcon) ? safeHref(node.previewUrl) : '';

  // Collections returned above — from here on this is always a content card.
  // `data-fallback` carries the glyph to swap in if the image never loads: the
  // repository redirects some previews to a publisher's thumbnail host, and a
  // blocked or dead one must leave the card clean, not broken (image-fallback.ts).
  const thumb = previewSrc
    ? `<img class="wlo-tile__img" src="${escapeHtml(previewSrc)}" alt="${escapeHtml(`${t(locale, 'previewAlt')} ${node.title || ''}`)}" loading="lazy" data-fallback="${PREVIEW_GLYPH.content}" />`
    : previewIcon(node.nodeType);

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
  //
  // The licence row is ALWAYS rendered, even when the record carries none:
  // teachers must be able to tell "free to reuse" from "no licence stated", and
  // an omitted row reads like the former while meaning the latter. Many WLO
  // records genuinely have no `ccm:commonlicense_key` (verified 2026-07-28).
  const licenseText = node.license || t(locale, 'licenseUnknown');
  const facts = [
    `<div class="wlo-facts__row"><dt>${escapeHtml(t(locale, 'licenseLabel'))}</dt><dd>${escapeHtml(licenseText)}</dd></div>`,
    node.publisher ? `<div class="wlo-facts__row"><dt>${escapeHtml(t(locale, 'sourceLabel'))}</dt><dd>${escapeHtml(node.publisher)}</dd></div>` : '',
  ].join('');
  const factsHtml = facts ? `<dl class="wlo-tile__facts">${facts}</dl>` : '';

  const detailBtn = options.detailButton
    ? `<button type="button" class="wlo-tile__details" data-node-id="${escapeHtml(node.nodeId)}" ` +
      `aria-label="${escapeHtml(`${t(locale, 'detailsFor')} ${t(locale, 'quoteOpen')}${node.title || ''}${t(locale, 'quoteClose')}`)}">${escapeHtml(t(locale, 'details'))}</button>`
    : '';

  // A native checkbox: keyboard-operable and announced correctly without any
  // ARIA gymnastics. `aria-label` names WHICH material it selects, so a screen
  // reader user hearing it out of context still knows.
  const pick = options.selectable
    ? `<label class="wlo-tile__pick">` +
      `<input type="checkbox" class="wlo-tile__pickbox" data-node-id="${escapeHtml(node.nodeId)}" ` +
      `data-node-title="${escapeHtml(node.title || '')}"${options.selected ? ' checked' : ''} ` +
      `aria-label="${escapeHtml(`${t(locale, 'selectLabel')}: ${node.title || ''}`)}" />` +
      `</label>`
    : '';

  return (
    `<li class="wlo-tile">` +
    `<div class="wlo-tile__thumb">${pick}${thumb}</div>` +
    `<div class="wlo-tile__body">` +
    `<h3 class="wlo-tile__title">${titleHtml}</h3>${desc}${chipsHtml}${factsHtml}${detailBtn}` +
    `</div>` +
    `</li>`
  );
}
