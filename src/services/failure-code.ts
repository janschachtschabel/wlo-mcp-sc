/**
 * services/failure-code.ts – an upstream failure as a CODE, never the
 * repository's own text (BOERDi wishlist rule, E6: English identifiers).
 *
 * Shared by every bundling answer that names its missing parts
 * (`get_collection_overview`, `count_wlo_content_matches`), so the same failure
 * reads the same everywhere.
 */

import { isOutcomeOpen, isUpstreamTimeout } from './write/timeouts.js';

/**
 * `upstream_busy` (plan 2026-11-07, S2b): the repository answered 429 or 503 —
 * "busy, try again shortly", not "broken". A caller can say so and wait
 * `retryAfterOf(err)` seconds instead of reporting a failure.
 */
export type FailureCode = 'timeout' | 'forbidden' | 'not_found' | 'upstream_busy' | 'upstream_error';

/**
 * The wait when the repository named none. An estimate, and documented as one:
 * edu-sharing is not known to send `Retry-After` (not measured).
 */
export const BUSY_RETRY_DEFAULT_S = 10;

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * The HTTP status a failure message carries, read from the POSITION every
 * message of ours puts it in — `<label> failed: <status>` (`upstream-error.ts`)
 * or `HTTP <status>` (write path, breadcrumb). Never any three-digit run: a
 * repository body quoted after it can hold `Impl.java:503`, and the
 * `retry-after=429` suffix counts seconds (review 2026-11-07).
 */
export function failureStatus(err: unknown): number | null {
  return statusOf(messageOf(err));
}

function statusOf(message: string): number | null {
  const m = /(?:\bfailed: |\bHTTP )(\d{3})\b/.exec(message);
  return m ? Number(m[1]) : null;
}

export function failureCode(err: unknown): FailureCode {
  if (isUpstreamTimeout(err)) return 'timeout';
  const status = statusOf(messageOf(err));
  if (status === 429 || status === 503) return 'upstream_busy';
  // A 404 is an ANSWER — the thing is not there — and no outage (review of D6, 2026-11-13):
  // as `upstream_error` it read like a 5xx, and a client retried what never comes.
  if (status === 404) return 'not_found';
  return status === 401 || status === 403 ? 'forbidden' : 'upstream_error';
}

/**
 * The code of a WRITE that threw: `timeout` for every "sent, no answer" — a
 * timeout and a lost connection alike (`isOutcomeOpen`) — else `failureCode`.
 * The batch steps used `failureCode`, which knows timeouts only, so a reset was
 * `upstream_error` there and `timeout` in every other write tool.
 */
export function writeFailureCode(err: unknown): FailureCode {
  return isOutcomeOpen(err) ? 'timeout' : failureCode(err);
}

/** Seconds to wait for a busy repository: its own `Retry-After` (see `upstream-error.ts`), else the estimate. */
export function retryAfterOf(err: unknown): number {
  const sent = /\bretry-after=(\d+)\b/.exec(messageOf(err));
  return sent ? Math.max(1, Number(sent[1])) : BUSY_RETRY_DEFAULT_S;
}

/**
 * The fields an error answer carries for `err`: its code and, when the
 * repository is busy, the wait. The ONE place that pairs them — three tools
 * built their own error from `failureCode` and dropped `retryAfter` (review of
 * plan 2026-11-07, phase 2).
 */
export function failureFields(err: unknown): { code: FailureCode; retryAfter?: number } {
  const code = failureCode(err);
  return code === 'upstream_busy' ? { code, retryAfter: retryAfterOf(err) } : { code };
}
