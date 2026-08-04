/**
 * shared/detail.ts – The Einzelansicht (detail view) of ONE node.
 *
 * Moved out of `search-results/render.ts` (2026-07-30) when the topic-page
 * widget needed the same view: its swimlane cards were dead ends — an external
 * link and nothing else — while an identical card in the search results could
 * be opened, read and followed up on. Copying the view would have meant two
 * places to keep the licence row, the follow-up actions and the link handling
 * in step.
 *
 * Everything it needs is on the node, so opening a detail costs no tool call.
 * Pure `(node, locale, canFollowUp) → HTML string`; DOM-free and unit-tested.
 */

import { escapeHtml } from './escape.js';
import { safeHref } from './safe-url.js';
import { followUpButton } from './tile.js';
import { t, type Locale } from './strings.js';
import type { WidgetNode } from './types.js';

export function renderDetail(node: WidgetNode, locale: Locale, canFollowUp: boolean): string {
  const title = escapeHtml(node.title || '');
  const previewSrc = (!!node.previewUrl && !node.previewIsIcon) ? safeHref(node.previewUrl) : '';
  const thumb = previewSrc
    ? `<img class="wlo-detail__img" src="${escapeHtml(previewSrc)}" alt="${escapeHtml(`${t(locale, 'previewAlt')} ${node.title || ''}`)}" loading="lazy" />`
    : `<span class="wlo-tile__icon" aria-hidden="true">${node.nodeType === 'collection' ? '⧉' : '📄'}</span>`;

  const chips = [...(node.disciplines ?? []), ...(node.educationalContexts ?? []), ...(node.learningResourceTypes ?? [])]
    .filter(Boolean)
    .map(c => `<li class="wlo-chip">${escapeHtml(c)}</li>`)
    .join('');
  const chipsHtml = chips ? `<ul class="wlo-tile__chips" role="list">${chips}</ul>` : '';

  const desc = node.description
    ? `<p class="wlo-detail__desc">${escapeHtml(node.description)}</p>`
    : '';

  // The licence row is ALWAYS rendered, exactly as on the tile: this is the view
  // where someone decides whether they may reuse the material, and an omitted
  // row reads as "not mentioned here" while meaning "no licence stated". Many
  // WLO records genuinely carry none.
  const facts = [
    `<div class="wlo-facts__row"><dt>${escapeHtml(t(locale, 'licenseLabel'))}</dt><dd>${escapeHtml(node.license || t(locale, 'licenseUnknown'))}</dd></div>`,
    node.publisher ? `<div class="wlo-facts__row"><dt>${escapeHtml(t(locale, 'sourceLabel'))}</dt><dd>${escapeHtml(node.publisher)}</dd></div>` : '',
  ].join('');
  const factsHtml = facts ? `<dl class="wlo-tile__facts">${facts}</dl>` : '';

  const contentHref = safeHref(node.url || node.contentUrl);
  const topicHref = safeHref(node.topicPageUrl);
  // The arrow is a visual "opens externally" cue only — aria-hidden so screen
  // readers announce just the action label.
  const arrow = ' <span aria-hidden="true">↗</span>';
  const links = [
    contentHref ? `<a class="wlo-detail__cta" href="${escapeHtml(contentHref)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t(locale, 'openContent'))}${arrow}</a>` : '',
    topicHref ? `<a class="wlo-detail__cta wlo-detail__cta--secondary" href="${escapeHtml(topicHref)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t(locale, 'openTopicPage'))}${arrow}</a>` : '',
  ].join('');
  const linksHtml = links ? `<p class="wlo-detail__links">${links}</p>` : '';

  // The detail view is where someone decides what to DO with a hit. Opening the
  // material externally leaves the chat; these two continue it — reading the
  // material's text (which nothing else routed to) and finding more like it.
  const actions = canFollowUp
    ? `<p class="wlo-detail__actions">` +
      (node.nodeType === 'content' ? followUpButton('text', node, locale) : '') +
      followUpButton('related', node, locale) +
      `</p>`
    : '';

  return (
    `<article class="wlo-detail">` +
    `<button type="button" class="wlo-detail__back" data-action="back">← ${escapeHtml(t(locale, 'back'))}</button>` +
    `<div class="wlo-detail__thumb">${thumb}</div>` +
    `<h1 class="wlo-detail__title">${title}</h1>` +
    `${chipsHtml}${desc}${factsHtml}${actions}${linksHtml}` +
    `</article>`
  );
}
