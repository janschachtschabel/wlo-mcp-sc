/**
 * shared/loading.ts – What a widget shows while its tool call is still running.
 *
 * All four widgets painted at mount time and handed `host.toolOutput()` — which
 * is null until the host delivers the result — straight to their renderer. The
 * renderers did exactly what they are supposed to do with an empty payload and
 * answered "Keine Treffer gefunden." (the reading widget: "Zu diesem Material
 * ist kein Text hinterlegt.") over a call that had not finished. Both are claims
 * about the CONTENT, made before any content was seen.
 *
 * So the pending state gets its own rendering rather than borrowing the empty
 * one. Deliberately ONE shape for all four widgets: the placeholder stands in
 * for a card grid, a swimlane, a tree and a text alike, and a per-widget
 * skeleton would be four things to keep in step for a view that lasts a second.
 *
 * Pure `(locale) → HTML string`; DOM-free and unit-tested.
 */

import { escapeHtml } from './escape.js';
import { t, type Locale } from './strings.js';

/**
 * Placeholder bars. Three is enough to read as "content is coming" while
 * reserving roughly the height of a first result, so the arriving payload does
 * not jolt the host iframe.
 */
const SKELETON_BARS = 3;

export function renderLoading(locale: Locale = 'de'): string {
  return (
    // `role="status"` + `aria-live="polite"` announces the wait once, and the
    // arriving result later, without interrupting what the user is doing.
    `<div class="wlo-loading" role="status" aria-live="polite">` +
    `<p class="wlo-loading__label">${escapeHtml(t(locale, 'loading'))}</p>` +
    // The bars are decoration for the sighted reader; the sentence above is the
    // whole message for everyone else. `aria-hidden` removes the subtree from
    // the accessibility tree outright, so no role is needed on top of it.
    `<ul class="wlo-loading__bars" aria-hidden="true">` +
    Array.from({ length: SKELETON_BARS }, (_, i) => `<li class="wlo-skel wlo-skel--${i}"></li>`).join('') +
    `</ul>` +
    `</div>`
  );
}
