/**
 * upstream-error.ts – the text of a failed repository call, as the ONE format
 * `services/failure-code.ts` reads back (plan 2026-11-07, S2b).
 *
 * A leaf module because the repository clients (`wlo-search.ts`, `wlo-node.ts`)
 * write it and must not import from `services/`. The text carries the status
 * and, when the repository sent one, its `Retry-After` in seconds — the wait a
 * caller should honour when edu-sharing itself is busy (429/503).
 */

/** `<label> failed: <status> <statusText>[ retry-after=<s>]`. */
export function upstreamErrorMessage(label: string, res: Response): string {
  const base = `${label} failed: ${res.status} ${res.statusText}`;
  // Only the delta-seconds form: the HTTP-date form would need our clock to
  // agree with theirs, and a guessed wait is worse than the documented estimate.
  const raw = res.headers.get('retry-after')?.trim() ?? '';
  return /^\d+$/.test(raw) ? `${base} retry-after=${raw}` : base;
}

/**
 * A status with which the repository ANSWERED and said no: not signed in, not
 * permitted, not there. Not an outage — asking again changes nothing — and so
 * never reported as "did not answer" (chatbot feedback 2026-11-13, D6). 429 and
 * 5xx are the opposite case: no verdict at all.
 */
export function isRefusal(status: number): boolean {
  return status === 401 || status === 403 || status === 404;
}
