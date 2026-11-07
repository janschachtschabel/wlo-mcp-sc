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
