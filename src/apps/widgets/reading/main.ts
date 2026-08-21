/**
 * reading/main.ts – W5 browser entry (bundled+inlined by build.mjs).
 *
 * Renders a long text (material full text / compendium prose) and offers
 * follow-up buttons that hand the CONVERSATION a request about this exact
 * material. Deliberately NO in-widget tool calls: ChatGPT mirrors a
 * widget-initiated result back as new toolOutput and may re-mount the frame,
 * which resets local state (live 2026-07-17, browse widget). Excluded from tsc
 * (DOM globals + host bridge); behaviour pinned by source-level tests.
 */

import { renderReading, readingFollowUpPrompt, type ReadingAction, type ReadingPayload } from './render.js';
import { resolveLocale } from '../shared/strings.js';
import { announceArrival } from '../shared/announce.js';
import { createHost } from '../shared/host.js';
import { renderLoading } from '../shared/loading.js';

const host = createHost();

function payload(): ReadingPayload | undefined {
  return host.toolOutput() as ReadingPayload | undefined;
}

function paint(): void {
  const root = document.getElementById('wlo-root');
  if (!root) return;
  const locale = resolveLocale(host.locale());
  document.documentElement.lang = locale;
  // Live region first: the innerHTML swap below destroys any in-root status
  // text (see shared/announce.ts).
  const awaiting = host.awaitingOutput();
  announceArrival(awaiting, host.toolOutput() != null, locale);
  // The worst of the four empty states: with no payload the miss-reason falls
  // back to "Zu diesem Material ist kein Text hinterlegt." — a claim about the
  // material, asserted before it was read (see shared/loading.ts).
  root.innerHTML = awaiting
    ? renderLoading(locale)
    : renderReading(payload(), locale, { canFollowUp: host.canFollowUp() });
}

document.addEventListener('click', event => {
  const el = event.target as HTMLElement | null;
  const button = el?.closest?.('.wlo-reading__action');
  if (!button) return;
  const action = button.getAttribute('data-action') as ReadingAction | null;
  const nodeId = button.getAttribute('data-node-id') ?? '';
  const title = button.getAttribute('data-node-title') ?? '';
  if (!action || !nodeId) return;
  host.sendFollowUp(readingFollowUpPrompt(action, title, nodeId, resolveLocale(host.locale())));
});

host.onUpdate(paint);
paint();
