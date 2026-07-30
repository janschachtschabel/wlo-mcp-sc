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
import { followUpButton, renderTile } from '../shared/tile.js';
import { t, type Locale, type StringKey } from '../shared/strings.js';
import type { SearchAllPayload, WidgetNode } from '../shared/types.js';

/** Ephemeral UI state owned by main.ts (see the Apps-SDK state guide). */
export interface SearchResultsState {
  selectedId?: string | null;
  /** nodeIds ticked for "use these" — only meaningful when `canSelect`. */
  selectedIds?: string[];
  /** Host can inject a follow-up message; without it selection is pointless. */
  canSelect?: boolean;
}

interface SectionOptions {
  coll?: boolean;
  detail?: boolean;
  selectable?: boolean;
  selectedIds?: string[];
  followUp?: boolean;
}

function section(titleKey: StringKey, nodes: WidgetNode[], locale: Locale, opts: SectionOptions = {}): string {
  if (nodes.length === 0) return '';
  // Collection/topic-page sections are grouped in a separated band (see below),
  // so the section itself carries no extra emphasis; only its grid differs.
  const cls = 'wlo-section';
  const gridCls = opts.coll ? 'wlo-grid wlo-grid--coll' : 'wlo-grid';
  const picked = new Set(opts.selectedIds ?? []);
  const tiles = nodes.map(n => renderTile(n, {
    locale,
    detailButton: opts.detail,
    selectable: opts.selectable,
    selected: picked.has(n.nodeId),
    followUp: opts.followUp,
  })).join('');
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
function renderDetail(node: WidgetNode, locale: Locale, canFollowUp: boolean): string {
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
    if (node) return `<div class="wlo-results">${renderDetail(node, locale, !!state.canSelect)}</div>`;
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

  // edu-sharing look: the topic-page + collection tiles sit in one lightly
  // separated band ABOVE the material grid. The band (and its divider) is
  // dropped entirely when both are empty, so content-only results show no
  // stray separator.
  // Collection and topic-page tiles were dead ends: a link out to edu-sharing
  // and nothing that continued the conversation. Each now carries the one
  // action that does (open its contents / open its Themenseite).
  const topicPagesHtml = section('sectionTopicPages', topicPages, locale, { coll: true, followUp: state.canSelect });
  const collectionsHtml = section('sectionCollections', collections, locale, { coll: true, followUp: state.canSelect });
  const band = topicPagesHtml || collectionsHtml
    ? `<div class="wlo-results__coll-band">${topicPagesHtml}${collectionsHtml}</div>`
    : '';

  // The bar only exists once something is ticked: an always-present "0 selected"
  // strip is noise. `aria-live="polite"` announces the changing count without
  // interrupting, since the number updates as boxes are ticked.
  const picked = (state.selectedIds ?? []).filter(id => content.some(n => n.nodeId === id));
  const selectionBar = state.canSelect && picked.length > 0
    ? `<div class="wlo-selection" aria-live="polite">` +
      `<span class="wlo-selection__count">${picked.length} ${escapeHtml(t(locale, 'selectionCount'))}</span>` +
      `<button type="button" class="wlo-selection__use" data-action="use-selection">${escapeHtml(t(locale, 'selectionUse'))}</button>` +
      `<button type="button" class="wlo-selection__clear" data-action="clear-selection">${escapeHtml(t(locale, 'selectionClear'))}</button>` +
      `</div>`
    : '';

  return (
    `<div class="wlo-results">${heading}${band}` +
    section('sectionContent', content, locale, {
      detail: true,
      selectable: state.canSelect,
      selectedIds: state.selectedIds,
    }) +
    selectionBar +
    `</div>`
  );
}
