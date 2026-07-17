/**
 * topic-page/render.ts – W4 body: a Themenseite's swimlanes.
 *
 * Pure `SwimlanePayload → HTML string`. Each swimlane is a section with a
 * heading and a wrapping tile grid; a lane with `hasMore` gets a "more on the
 * topic page" link to `topicPageUrl`. Swimlanes render as WRAPPING grids rather
 * than horizontal-scroll carousels so there is no nested scroll and every tile
 * is keyboard-reachable (WCAG). DOM-free and unit-tested.
 */

import { escapeHtml } from '../shared/escape.js';
import { safeHref } from '../shared/safe-url.js';
import { renderTile } from '../shared/tile.js';
import { t, type Locale } from '../shared/strings.js';
import type { SwimlanePayload } from '../shared/types.js';

export function renderTopicPage(payload: SwimlanePayload | undefined, locale: Locale = 'de'): string {
  // WLO-Themenseiten-Look: collection title as the page heading, its
  // description as intro text — the variant title is only the fallback.
  const heading = payload?.collectionTitle || payload?.variantTitle || '';
  const title = heading ? `<h1 class="wlo-topic__title">${escapeHtml(heading)}</h1>` : '';
  const desc = payload?.description
    ? `<p class="wlo-topic__desc">${escapeHtml(payload.description)}</p>`
    : '';
  const head = title || desc ? `<header class="wlo-topic__head">${title}${desc}</header>` : '';

  const swimlanes = payload?.swimlanes ?? [];
  if (swimlanes.length === 0) {
    // Keep the header over the empty state so the title says WHAT is empty.
    return `<div class="wlo-topic">${head}<p class="wlo-empty">${escapeHtml(t(locale, 'noResults'))}</p></div>`;
  }
  const topicUrl = safeHref(payload?.topicPageUrl);

  const lanes = swimlanes
    .map(lane => {
      const tiles = lane.items.map(n => renderTile(n, { locale })).join('');
      const more =
        lane.hasMore && topicUrl
          ? `<a class="wlo-topic__more" href="${escapeHtml(topicUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t(locale, 'moreOnTopicPage'))}</a>`
          : '';
      return (
        `<section class="wlo-section">` +
        `<h2 class="wlo-section__title">${escapeHtml(lane.heading || '')}</h2>` +
        `<ul class="wlo-grid" role="list">${tiles}</ul>${more}` +
        `</section>`
      );
    })
    .join('');

  return `<div class="wlo-topic">${head}${lanes}</div>`;
}
