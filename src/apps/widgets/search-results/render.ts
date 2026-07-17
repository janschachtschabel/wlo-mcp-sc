/**
 * search-results/render.ts – W1 body: the combined search-results view.
 *
 * Pure `(SearchAllPayload, locale, state) → HTML string`, modelled on the
 * edu-sharing search page: Themenseiten/Sammlungen as colored collection-tile
 * rows, Inhalte as a card grid — and an IN-WIDGET detail view (Einzelansicht)
 * that replaces the grid when a card's "Details" button was clicked. All data
 * for the detail view is already in the structuredContent, so opening it costs
 * no tool call. Empty sections are dropped; an all-empty payload renders a
 * localized empty state. DOM-free and unit-tested; interactivity (clicks,
 * focus, state) lives in `main.ts`.
 */

import { escapeHtml } from '../shared/escape.js';
import { safeHref } from '../shared/safe-url.js';
import { renderTile } from '../shared/tile.js';
import { t, type Locale, type StringKey } from '../shared/strings.js';
import type { SearchAllPayload, WidgetNode } from '../shared/types.js';

/** Ephemeral UI state owned by main.ts (see the Apps-SDK state guide). */
export interface SearchResultsState {
  selectedId?: string | null;
}

function section(titleKey: StringKey, nodes: WidgetNode[], locale: Locale, opts: { coll?: boolean; detail?: boolean } = {}): string {
  if (nodes.length === 0) return '';
  const cls = opts.coll ? 'wlo-section wlo-section--emphasis' : 'wlo-section';
  const gridCls = opts.coll ? 'wlo-grid wlo-grid--coll' : 'wlo-grid';
  const tiles = nodes.map(n => renderTile(n, { locale, detailButton: opts.detail })).join('');
  return (
    `<section class="${cls}">` +
    `<h2 class="wlo-section__title">${escapeHtml(t(locale, titleKey))}</h2>` +
    `<ul class="${gridCls}" role="list">${tiles}</ul>` +
    `</section>`
  );
}

function allNodes(payload: SearchAllPayload | undefined): WidgetNode[] {
  return [
    ...(payload?.content?.results ?? []),
    ...(payload?.collections?.results ?? []),
    ...(payload?.topicPages?.results ?? []),
  ];
}

/** The Einzelansicht: full metadata of one hit, replacing the grid. */
function renderDetail(node: WidgetNode, locale: Locale): string {
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

  const facts = [
    node.license ? `<div class="wlo-facts__row"><dt>${escapeHtml(t(locale, 'licenseLabel'))}</dt><dd>${escapeHtml(node.license)}</dd></div>` : '',
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

  return (
    `<article class="wlo-detail">` +
    `<button type="button" class="wlo-detail__back" data-action="back">← ${escapeHtml(t(locale, 'back'))}</button>` +
    `<div class="wlo-detail__thumb">${thumb}</div>` +
    `<h1 class="wlo-detail__title">${title}</h1>` +
    `${chipsHtml}${desc}${factsHtml}${linksHtml}` +
    `</article>`
  );
}

export function renderSearchResults(
  payload: SearchAllPayload | undefined,
  locale: Locale = 'de',
  state: SearchResultsState = {},
): string {
  // Detail view first: a selected node replaces the grid entirely. An id the
  // current payload no longer contains falls through to the grid — the widget
  // must never go blank after a data refresh.
  if (state.selectedId) {
    const node = allNodes(payload).find(n => n.nodeId === state.selectedId);
    if (node) return `<div class="wlo-results">${renderDetail(node, locale)}</div>`;
  }

  const topicPages = payload?.topicPages?.results ?? [];
  const collections = payload?.collections?.results ?? [];
  const content = payload?.content?.results ?? [];

  if (topicPages.length + collections.length + content.length === 0) {
    return `<div class="wlo-results"><p class="wlo-empty">${escapeHtml(t(locale, 'noResults'))}</p></div>`;
  }

  const query = escapeHtml(payload?.query ?? '');
  // Quote marks come from the locale table: German „…“ vs English “…”.
  const heading = query
    ? `<h1 class="wlo-results__query">${escapeHtml(t(locale, 'resultsFor'))} ${t(locale, 'quoteOpen')}${query}${t(locale, 'quoteClose')}</h1>`
    : '';

  return (
    `<div class="wlo-results">${heading}` +
    section('sectionTopicPages', topicPages, locale, { coll: true }) +
    section('sectionCollections', collections, locale, { coll: true }) +
    section('sectionContent', content, locale, { detail: true }) +
    `</div>`
  );
}
