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
import { renderTile } from '../shared/tile.js';
import { renderDetail } from '../shared/detail.js';
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

/**
 * A flat `{total,count,results}` node list, as returned by every list tool that
 * is not `search_wlo_all` (`search_wlo_content`, `get_collection_contents`,
 * `get_related_content`).
 */
type FlatNodeList = { query?: string; total: number; count: number; results: WidgetNode[] };

/**
 * Accept both payload shapes so ONE widget serves every list tool. Which tool
 * the model happens to pick must not decide whether the user sees a rendered
 * result or a wall of text (live report 2026-07-30: the same request rendered
 * differently depending on whether `search_wlo_all` or `search_wlo_content` was
 * chosen).
 *
 * A flat list is split by `nodeType`: collection nodes belong in the band with
 * their "open its contents" action, material nodes in the grid. Dropping them
 * all into the content bucket would turn a sub-collection into a dead-end tile.
 */
function toEnvelope(payload: SearchAllPayload | FlatNodeList | undefined): SearchAllPayload | undefined {
  if (!payload) return undefined;
  if ('content' in payload) return payload;
  const results = Array.isArray(payload.results) ? payload.results : [];
  const colls = results.filter(n => n.nodeType === 'collection');
  const items = results.filter(n => n.nodeType !== 'collection');
  const bucket = (nodes: WidgetNode[]) => ({ total: nodes.length, count: nodes.length, results: nodes });
  return {
    query: payload.query ?? '',
    // `total` describes the whole upstream list; it belongs to whichever bucket
    // actually holds the results, so paging counts stay truthful.
    content: items.length ? { ...bucket(items), total: colls.length ? items.length : payload.total ?? items.length } : bucket([]),
    collections: colls.length ? { ...bucket(colls), total: items.length ? colls.length : payload.total ?? colls.length } : bucket([]),
    topicPages: bucket([]),
  };
}

export function renderSearchResults(
  input: SearchAllPayload | FlatNodeList | undefined,
  locale: Locale = 'de',
  state: SearchResultsState = {},
): string {
  const payload = toEnvelope(input);
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
    // A licence pass that removed everything is a different statement from "no
    // such material exists", and the grid cannot tell them apart on its own.
    // Only the emptied case is explained here: when results ARE shown, the user
    // sees material and the tool's text block carries the exact counts.
    const lf = payload?.content?.licenseFilter;
    const reason = lf && lf.kept === 0 && lf.checked > 0
      ? `<p class="wlo-empty__reason">${escapeHtml(t(locale, 'noResultsLicense'))} ` +
        `${lf.checked} ${escapeHtml(t(locale, 'licenseCandidatesChecked'))}. ` +
        `${escapeHtml(t(locale, 'licenseFamilyHint'))}</p>`
      : '';
    return `<div class="wlo-results"><p class="wlo-empty">${escapeHtml(t(locale, 'noResults'))}</p>${reason}</div>`;
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

  // The bar precedes the grid: without a scrollport sticky cannot hold it in
  // view, so placing it after the results hid it behind the whole list.
  return (
    `<div class="wlo-results">${heading}${band}${selectionBar}` +
    section('sectionContent', content, locale, {
      detail: true,
      selectable: state.canSelect,
      selectedIds: state.selectedIds,
    }) +
    `</div>`
  );
}
