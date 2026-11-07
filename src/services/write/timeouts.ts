/**
 * services/write/timeouts.ts – did a write give up waiting, or get refused?
 *
 * Moved here from `tools/curation-shared.ts` (2026-11-06) so a service that
 * reports an outcome (`create-filing.ts`) can make the same distinction without
 * importing from the tool layer.
 */

/**
 * Did this call give up waiting rather than get an answer?
 *
 * The distinction decides what may be said afterwards. A refusal from the
 * repository means nothing happened; an abort means the request was in flight
 * when we stopped listening — measured 2026-08-02, a timed-out create had
 * already produced the record. Reporting the second as a failure states
 * something we do not know.
 */
export function isUpstreamTimeout(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const { name, message } = err as { name?: unknown; message?: unknown };
  if (name === 'TimeoutError' || name === 'AbortError') return true;
  return typeof message === 'string' && /abort|timeout|timed out/i.test(message);
}
