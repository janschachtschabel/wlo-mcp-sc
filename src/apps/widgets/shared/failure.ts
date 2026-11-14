/**
 * shared/failure.ts – What a widget shows when its tool call FAILED.
 *
 * The third state beside loading and empty. A failed call still delivers
 * something — `structuredContent: { error: { code, message, retryAfter? } }`
 * from the server's `toolError` / `codedErrorResult`, or the bare result with
 * `isError: true` from a host that forwards it whole — and the renderers, which
 * look for results, found none and answered "Keine Treffer gefunden.". An
 * outage read as "nothing in the catalogue". A host that never delivers at all
 * ended in the same sentence once the grace window closed.
 *
 * So the shells ask `failureOf` BEFORE their renderer runs, exactly as they ask
 * `awaitingOutput()` before it: "failed" is never inferred from an empty value.
 *
 * Nothing from the payload is printed. The server's `message` is the sentence
 * the model already has in the chat, and it can carry repository text; the
 * widget says only what it knows itself — that the call failed, and how long to
 * wait when the server said so.
 *
 * Pure `(…) → value | HTML string`; DOM-free and unit-tested.
 */

import { escapeHtml } from './escape.js';
import { t, type Locale } from './strings.js';

export interface WidgetFailure {
  /** `error`: the tool answered with an error. `timeout`: nothing arrived. */
  kind: 'error' | 'timeout';
  /** The server's error code, when it sent one (e.g. `upstream_busy`). */
  code?: string;
  /** Seconds the server asked the caller to wait before trying again. */
  retryAfter?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Is this tool output a failure?
 *
 * @param output   what the host delivered (`host.toolOutput()`)
 * @param timedOut whether the wait for a first result expired (`host.timedOut()`)
 * @returns the failure, or null for a result (an EMPTY one included) and for
 *          "nothing yet" inside the grace window
 */
export function failureOf(output: unknown, timedOut: boolean): WidgetFailure | null {
  if (output == null) return timedOut ? { kind: 'timeout' } : null;
  if (!isRecord(output)) return null;

  const error = output['error'];
  if (isRecord(error)) {
    const failure: WidgetFailure = { kind: 'error' };
    if (typeof error['code'] === 'string' && error['code']) failure.code = error['code'];
    const wait = error['retryAfter'];
    if (typeof wait === 'number' && Number.isFinite(wait) && wait > 0) failure.retryAfter = Math.ceil(wait);
    return failure;
  }
  return output['isError'] === true ? { kind: 'error' } : null;
}

/** The one sentence for a failure — shown, and spoken by the live region. */
export function failureMessage(locale: Locale, failure: WidgetFailure): string {
  if (failure.kind === 'timeout') return t(locale, 'loadTimedOut');
  // An answer, not an outage: "the request failed, try again" over a record
  // that does not exist or that this login may not read never comes true.
  return t(locale, failure.code !== undefined && REFUSAL_CODES.has(failure.code) ? 'loadRefused' : 'loadFailed');
}

/** The server's codes for "asked and answered: not there, or not for this login" (`services/failure-code.ts`). */
const REFUSAL_CODES: ReadonlySet<string> = new Set(['not_found', 'node_not_found', 'forbidden', 'access_denied']);

export function renderError(locale: Locale, failure: WidgetFailure): string {
  const retry = failure.retryAfter !== undefined
    ? `<p class="wlo-error__hint">${escapeHtml(t(locale, 'retryIn').replace('{n}', String(failure.retryAfter)))}</p>`
    : '';
  // No live-region role here: `#wlo-root` is replaced wholesale on every paint,
  // so the persistent region outside it speaks (see shared/announce.ts) — a
  // second one would announce the same sentence twice.
  return (
    `<div class="wlo-error">` +
    `<p class="wlo-error__message">${escapeHtml(failureMessage(locale, failure))}</p>` +
    retry +
    `</div>`
  );
}
