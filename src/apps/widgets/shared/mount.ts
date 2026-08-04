/**
 * shared/mount.ts – Bootstrap for a widget that shows tiles and can open ONE of
 * them in the Einzelansicht.
 *
 * Was `mountSimpleWidget` (render + repaint, nothing else) until the topic-page
 * widget needed the detail view its cards had always lacked. Rather than copy
 * the ~40 lines of select/back/Escape/focus handling out of
 * `search-results/main.ts`, the shell lives here.
 *
 * What it owns:
 *   - the resolved locale on `<html lang>` (WCAG 3.1.2 — the shell ships
 *     `lang="de"` at build time, the copy follows the host),
 *   - which node is open, persisted through a host re-mount,
 *   - focus on open/close (WCAG 2.4.3): opening moves focus to the back button,
 *     closing restores it to the card it came from, and a host-driven repaint
 *     never steals focus,
 *   - routing a follow-up button to a chat message — widgets never call tools
 *     themselves (a widget-initiated result is mirrored back as new toolOutput
 *     and re-mounts the frame, resetting local state; live 2026-07-17).
 *
 * `search-results/main.ts` still has its own copy of this loop because it also
 * owns the multi-select; folding it in here is a separate change.
 */

import type { Locale } from './strings.js';
import { resolveLocale } from './strings.js';
import { createHost } from './host.js';
import { followUpPrompt, type FollowUpAction } from './follow-up.js';

/** What the render callback needs to know about the shell's state. */
export interface TileWidgetState {
  /** nodeId whose detail view replaces the list, or null for the list. */
  selectedId: string | null;
  /** Whether the host can take an injected message — gates every button. */
  canFollowUp: boolean;
}

export function mountTileWidget(
  render: (output: unknown, locale: Locale, state: TileWidgetState) => string,
): void {
  const host = createHost();
  const saved = host.widgetState() as { selectedId?: string | null } | undefined;
  let selectedId: string | null = saved?.selectedId ?? null;
  /** One-shot focus target for the next paint (null = leave focus alone). */
  let focusTarget: 'detail' | string | null = null;

  function paint(): void {
    const root = document.getElementById('wlo-root');
    if (!root) return;
    const locale = resolveLocale(host.locale());
    document.documentElement.lang = locale;
    root.innerHTML = render(host.toolOutput(), locale, { selectedId, canFollowUp: host.canFollowUp() });

    // preventScroll: keep the focus move without the default scroll-into-view,
    // which jerks the host iframe.
    if (focusTarget === 'detail') {
      (root.querySelector('.wlo-detail__back') as HTMLElement | null)?.focus({ preventScroll: true });
    } else if (focusTarget) {
      (root.querySelector(`.wlo-tile__details[data-node-id="${CSS.escape(focusTarget)}"]`) as HTMLElement | null)
        ?.focus({ preventScroll: true });
    }
    focusTarget = null;
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
    if (el?.closest?.('[data-action="back"]')) select(null);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && selectedId) select(null);
  });

  host.onUpdate(paint);
  paint();
}
