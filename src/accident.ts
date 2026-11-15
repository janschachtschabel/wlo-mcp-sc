/**
 * accident.ts – is this an error nobody threw on purpose?
 *
 * The one rule both surfaces answer by (`toolError` for MCP, `failureResult`
 * for REST): an accident of ours is answered with a generic sentence and
 * logged in full, because its message is internal detail; everything else
 * keeps its message and its classification.
 *
 * The smallest rule that separates the two: every error this server raises
 * deliberately, and every classified upstream failure, is a plain `Error` (or
 * a subclass of ours) — while a programming mistake surfaces as one of
 * JavaScript's own four classes.
 *
 * The exception is the network. `fetch` reports EVERY failure to connect as
 * `TypeError: fetch failed`, and a connection lost while the BODY is read as
 * `TypeError: terminated` (undici; review 2026-11-14 — an aborting stream made
 * a repository outage read as "internal error", and the client lost the
 * `upstream_error` it may retry). Both are the repository not answering.
 * `services/write/timeouts.ts` reads the same two messages.
 */
const NETWORK_TYPE_ERRORS: ReadonlySet<string> = new Set(['fetch failed', 'terminated']);

export function isAccident(err: unknown): boolean {
  if (err instanceof TypeError) return !NETWORK_TYPE_ERRORS.has(err.message);
  return err instanceof RangeError || err instanceof ReferenceError || err instanceof SyntaxError;
}

/** What a caller reads instead of an accident's own message; the detail is in the log. */
export const INTERNAL_ERROR_TEXT = 'Interner Fehler — die Einzelheiten stehen im Server-Protokoll, nicht in dieser Antwort.';
