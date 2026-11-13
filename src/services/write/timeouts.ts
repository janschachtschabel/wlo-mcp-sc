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

/**
 * Network failures that prove the request never LEFT: no connection was made,
 * so nothing can have been done with it.
 */
const NEVER_SENT = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT',
  'ERR_INVALID_URL', 'EPROTO',
  // TLS never completed: no request was sent over it.
  'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_SSL_WRONG_VERSION_NUMBER',
]);

/**
 * Did the CONNECTION fail after the request may have gone out?
 *
 * The same situation as a timeout, reached another way: the request was sent,
 * the socket died (`ECONNRESET`, "other side closed", "socket hang up"), no
 * answer came. Only timeouts were recognised, so a reset was reported as a
 * failure — and a client that creates again on "failed" makes a duplicate; in a
 * collection tree every child of the node then failed with it (audit
 * 2026-11-12, K-4).
 *
 * `fetch` reports every network failure as `TypeError: fetch failed` with the
 * reason in `cause`. A cause that proves the request never left (`NEVER_SENT`)
 * is a refusal; any other — including one we do not know — is open, which is
 * the safe side for a write. The list is per REQUEST: a multi-step write whose
 * first request landed and whose second was refused has still written (see
 * `createCollection`). And "open" is not "retry for ever": the plan runner
 * gives an open step a bounded number of tries (`MAX_OPEN_TRIES`).
 */
export function isConnectionLost(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const { message, cause, code } = err as { message?: unknown; cause?: unknown; code?: unknown };
  const causeCode = typeof cause === 'object' && cause !== null ? (cause as { code?: unknown }).code : undefined;
  const named = typeof causeCode === 'string' ? causeCode : typeof code === 'string' ? code : '';
  if (named) {
    if (/^(ECONNRESET|EPIPE|ECONNABORTED|ETIMEDOUT|UND_ERR_SOCKET|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT)$/.test(named)) return true;
  }
  if (typeof message !== 'string') return false;
  // Whole words, case-sensitive: a refusal that merely CONTAINS the letters is not a lost connection.
  if (/socket hang up|other side closed|\b(ECONNRESET|EPIPE)\b/.test(message)) return true;
  // A fetch failure whose cause names nothing we can place: open.
  return message === 'fetch failed' && !NEVER_SENT.has(named);
}

/**
 * May the request have been carried out although no answer arrived? The ONE
 * question every write path asks before it says "failed".
 */
export function isOutcomeOpen(err: unknown): boolean {
  return isUpstreamTimeout(err) || isConnectionLost(err);
}
