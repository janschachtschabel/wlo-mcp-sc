/**
 * rest/ready.ts – `GET /ready`: is the repository reachable? (plan 2026-11-07, S5)
 *
 * `/health` answers "the process runs"; this answers "it can do its job".
 * 200 `{status: "ready", upstream: "ok", …}` or 503 `{status: "not_ready",
 * upstream: "unreachable" | "slow", retryAfter, …}` with `Retry-After` (the rest
 * of the 30 s the answer is held, or 5 s while a slow probe is in flight). No budget: the answer comes from
 * `services/upstream-readiness.ts`, which asks the repository at most once per
 * 30 s however often this is called.
 */

import type { ServerResponse } from 'node:http';

import { READY_CACHE_MS, readinessAnswer } from '../services/upstream-readiness.js';

export const READY_PATH = '/ready';

/** `now` is the caller's clock — a parameter so a test can age a cached answer without sleeping. */
export async function handleReady(res: ServerResponse, now: number = Date.now()): Promise<void> {
  const { result: r, retryAfterMs } = await readinessAnswer(now);
  // Not ready: `Retry-After` is when asking again can return something else —
  // the rest of the time the cached answer stands (counted from its ARRIVAL,
  // not from `checkedAt`, the probe's start), or a short wait while a slow
  // probe is still in flight. Whole seconds, at least 1, at most the cache time.
  const wait = Math.min(READY_CACHE_MS / 1000, Math.max(1, Math.ceil(retryAfterMs / 1000)));
  res.writeHead(r.ok ? 200 : 503, {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    ...(r.ok ? {} : { 'Retry-After': String(wait) }),
  });
  res.end(JSON.stringify({ status: r.ok ? 'ready' : 'not_ready', ...r, ...(r.ok ? {} : { retryAfter: wait }) }));
}
