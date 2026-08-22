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
import { selectionFollowUpPrompt, type SelectedMaterial } from './selection.js';
import { followUpPrompt, type FollowUpAction } from '../shared/follow-up.js';
import { resolveLocale } from '../shared/strings.js';
import { announceArrival } from '../shared/announce.js';
import { createHost } from '../shared/host.js';
import { installImageFallback } from '../shared/image-fallback.js';
import { renderLoading } from '../shared/loading.js';
import type { SearchAllPayload } from '../shared/types.js';

const host = createHost();

const saved = host.widgetState() as { selectedId?: string | null; selectedIds?: string[] } | undefined;
let selectedId: string | null = saved?.selectedId ?? null;
/** Ticked materials, kept in widget state so a host re-mount does not lose them. */
const picked = new Map<string, string>(
  (saved?.selectedIds ?? []).map(id => [id, '']),
);
/** One-shot focus target after the next paint (null = leave focus alone). */
let focusTarget: 'detail' | string | null = null;

function persist(): void {
  host.setWidgetState({ selectedId, selectedIds: [...picked.keys()] });
}

function paint(): void {
  const root = document.getElementById('wlo-root');
  if (!root) return;
  const locale = resolveLocale(host.locale());
  document.documentElement.lang = locale;
  // The live region hears the loading→result transition; the repaint below
  // destroys any in-root status text, so this is the only reliable channel.
  const awaiting = host.awaitingOutput();
  announceArrival(awaiting, host.toolOutput() != null, locale);
  // "Keine Treffer gefunden." over a search that has not answered yet is a
  // statement about the corpus, not about the call (see shared/loading.ts).
  if (awaiting) {
    root.innerHTML = renderLoading(locale);
    focusTarget = null; // nothing to focus in a skeleton
    return;
  }
  // The widget-only result meta carries the server-inlined previews for
  // restricted records (see services/preview-inline.ts).
  const meta = host.toolMeta() as { 'wlo/previewData'?: Record<string, string> } | undefined;
  root.innerHTML = renderSearchResults(host.toolOutput() as SearchAllPayload | undefined, locale, {
    selectedId,
    selectedIds: [...picked.keys()],
    canSelect: host.canFollowUp(),
    previewData: meta?.['wlo/previewData'],
  });

  // Widget state carries only the ids, so a selection restored after a host
  // re-mount has no titles. Backfill them from the tiles now on screen; ids the
  // current payload no longer contains keep their empty title and travel as the
  // id alone, which is still actionable.
  for (const box of root.querySelectorAll('.wlo-tile__pickbox')) {
    const id = box.getAttribute('data-node-id') ?? '';
    if (id && picked.has(id) && !picked.get(id)) {
      picked.set(id, box.getAttribute('data-node-title') ?? '');
    }
  }

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
  persist();
}

/** Ticking a box must not repaint: that would destroy the checkbox's focus. */
document.addEventListener('change', (event) => {
  const box = (event.target as HTMLElement | null)?.closest?.('.wlo-tile__pickbox') as HTMLInputElement | null;
  if (!box) return;
  const id = box.getAttribute('data-node-id') ?? '';
  if (!id) return;
  if (box.checked) picked.set(id, box.getAttribute('data-node-title') ?? '');
  else picked.delete(id);
  paint();
  persist();
  // Restore focus to the box the user just used (WCAG 2.4.3); preventScroll
  // keeps the host iframe still, as elsewhere in this widget.
  const again = document.querySelector(`.wlo-tile__pickbox[data-node-id="${CSS.escape(id)}"]`) as HTMLElement | null;
  again?.focus({ preventScroll: true });
});

document.addEventListener('click', (event) => {
  const el = event.target as HTMLElement | null;

  // Continue-the-flow buttons on collection tiles and in the detail view: hand
  // the conversation a request naming the node id and the tool for the job.
  const followUp = el?.closest?.('[data-follow-up]');
  if (followUp) {
    const action = followUp.getAttribute('data-follow-up') as FollowUpAction | null;
    const id = followUp.getAttribute('data-node-id') ?? '';
    if (action && id) {
      host.sendFollowUp(followUpPrompt(
        action,
        followUp.getAttribute('data-node-title') ?? '',
        id,
        resolveLocale(host.locale()),
      ));
    }
    return;
  }

  const detailsBtn = el?.closest?.('.wlo-tile__details[data-node-id]');
  if (detailsBtn) { select(detailsBtn.getAttribute('data-node-id')); return; }
  if (el?.closest?.('[data-action="back"]')) { select(null); return; }

  if (el?.closest?.('[data-action="clear-selection"]')) {
    picked.clear();
    paint();
    persist();
    return;
  }
  if (el?.closest?.('[data-action="use-selection"]')) {
    const items: SelectedMaterial[] = [...picked].map(([nodeId, title]) => ({ nodeId, title }));
    const prompt = selectionFollowUpPrompt(items, resolveLocale(host.locale()));
    if (prompt) host.sendFollowUp(prompt);
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && selectedId) select(null);
});

installImageFallback();
host.onUpdate(paint);
paint();
