/**
 * search-results/main.ts – W1 browser entry (bundled+inlined by build.mjs).
 *
 * Interactive shell: renders the combined results and drives the in-widget
 * detail view (Einzelansicht). A card's "Details" button opens the detail —
 * from data already in the tool output, no extra tool call — the back button
 * or Escape closes it. Focus management per WCAG 2.4.3: opening moves focus to
 * the back button, closing restores it to the originating card button; host
 * updates (theme/locale/new output) never steal focus. The selection persists
 * via the ChatGPT widget-state extension (no-op on the standard bridge).
 */

import { renderSearchResults } from './render.js';
import { resolveLocale } from '../shared/strings.js';
import { createHost } from '../shared/host.js';
import type { SearchAllPayload } from '../shared/types.js';

const host = createHost();

let selectedId: string | null =
  ((host.widgetState() as { selectedId?: string | null } | undefined)?.selectedId) ?? null;
/** One-shot focus target after the next paint (null = leave focus alone). */
let focusTarget: 'detail' | string | null = null;

function paint(): void {
  const root = document.getElementById('wlo-root');
  if (!root) return;
  const locale = resolveLocale(host.locale());
  document.documentElement.lang = locale;
  root.innerHTML = renderSearchResults(host.toolOutput() as SearchAllPayload | undefined, locale, { selectedId });

  // preventScroll: keep the a11y focus move (WCAG 2.4.3) without the default
  // scroll-into-view, which would jerk the host iframe on open/close.
  if (focusTarget === 'detail') {
    (root.querySelector('.wlo-detail__back') as HTMLElement | null)?.focus({ preventScroll: true });
  } else if (focusTarget) {
    (root.querySelector(`.wlo-tile__details[data-node-id="${CSS.escape(focusTarget)}"]`) as HTMLElement | null)?.focus({ preventScroll: true });
  }
  focusTarget = null; // one-shot: host-driven repaints must not steal focus
}

function select(id: string | null): void {
  const restoreTo = selectedId; // the card we came from, for close-restore
  selectedId = id;
  focusTarget = id ? 'detail' : restoreTo;
  paint();
  host.setWidgetState({ selectedId });
}

document.addEventListener('click', (event) => {
  const el = event.target as HTMLElement | null;
  const detailsBtn = el?.closest?.('.wlo-tile__details[data-node-id]');
  if (detailsBtn) { select(detailsBtn.getAttribute('data-node-id')); return; }
  if (el?.closest?.('[data-action="back"]')) select(null);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && selectedId) select(null);
});

host.onUpdate(paint);
paint();
