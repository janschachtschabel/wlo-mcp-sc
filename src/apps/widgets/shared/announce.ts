/**
 * shared/announce.ts – The loading state's missing second half.
 *
 * `renderLoading` says "WLO-Inhalte werden geladen …" through `role="status"` —
 * and then `paint()` replaces `#wlo-root`'s innerHTML wholesale, live region
 * included, so the ARRIVAL of the result was never announced (WCAG 4.1.3): a
 * screen-reader user heard "loading" and then silence for ever, while sighted
 * users watched the skeleton become content.
 *
 * Two rules make the announcement reliable, and both are deliberate:
 *  - the region lives OUTSIDE `#wlo-root`, appended to `document.body`, so the
 *    repaint that destroys the skeleton cannot destroy it;
 *  - it is created EMPTY on the first call (i.e. while still loading) — a live
 *    region inserted together with its text is unreliably picked up by AT, one
 *    that already exists when the text lands fires dependably.
 *
 * Two things speak. The loading→result transition says "geladen" — output that
 * is already present at mount was never "loading" to the user. And a FAILURE
 * (an error result, or a grace window that expired with nothing) speaks the
 * sentence the error state shows, once, when it is entered: "Inhalte geladen"
 * over it would be false, and silence leaves the listener with "loading".
 *
 * DOM glue — excluded from the build tsconfig, like the widget entry points.
 */

import { t, type Locale } from './strings.js';

const LIVE_ID = 'wlo-live';

/** Whether the PREVIOUS paint was still waiting; undefined = first paint. */
let wasAwaiting: boolean | undefined;

/** Whether the PREVIOUS paint showed the error state. */
let wasFailed = false;

/**
 * Call at the top of every paint with the shell's current view of the host.
 * Cheap and idempotent; only a transition writes into the region.
 *
 * @param failure the error state's sentence when this paint shows it
 *                (`failureMessage`), otherwise undefined
 */
export function announceArrival(awaiting: boolean, hasOutput: boolean, locale: Locale, failure?: string): void {
  let region = document.getElementById(LIVE_ID);
  if (!region) {
    region = document.createElement('div');
    region.id = LIVE_ID;
    region.className = 'wlo-sr-only';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    document.body.appendChild(region);
  }

  const failed = !awaiting && failure !== undefined;
  // An error result HAS output (`structuredContent.error`), so the failure is
  // decided first — otherwise it would be announced as an arrival.
  const arrived = wasAwaiting === true && !awaiting && hasOutput && !failed;
  const enteredFailure = failed && !wasFailed;
  wasAwaiting = awaiting;
  wasFailed = failed;
  if (enteredFailure) region.textContent = failure;
  else if (arrived) region.textContent = t(locale, 'resultsLoaded');
}
