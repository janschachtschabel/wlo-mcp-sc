/**
 * search-results/render.ts – W1 body: the combined search-results view.
 *
 * Pure `SearchAllPayload → HTML string`. Three sections (Themenseiten /
 * Sammlungen / Inhalte) of shared tiles; the Sammlungen section is emphasized
 * (editorial collections are the highest-value hit). Empty sections are
 * dropped; an all-empty payload renders a localized empty state. DOM-free and
 * unit-tested; the browser entry (`main.ts`) only feeds it `toolOutput`.
 */

import { escapeHtml } from '../shared/escape.js';
import { renderTile } from '../shared/tile.js';
import { t, type Locale, type StringKey } from '../shared/strings.js';
import type { SearchAllPayload, WidgetNode } from '../shared/types.js';

function section(titleKey: StringKey, nodes: WidgetNode[], locale: Locale, emphasis = false): string {
  if (nodes.length === 0) return '';
  const cls = emphasis ? 'wlo-section wlo-section--emphasis' : 'wlo-section';
  const tiles = nodes.map(n => renderTile(n, { locale })).join('');
  return (
    `<section class="${cls}">` +
    `<h2 class="wlo-section__title">${escapeHtml(t(locale, titleKey))}</h2>` +
    `<ul class="wlo-grid" role="list">${tiles}</ul>` +
    `</section>`
  );
}

export function renderSearchResults(payload: SearchAllPayload | undefined, locale: Locale = 'de'): string {
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
    section('sectionTopicPages', topicPages, locale) +
    section('sectionCollections', collections, locale, true) +
    section('sectionContent', content, locale) +
    `</div>`
  );
}
