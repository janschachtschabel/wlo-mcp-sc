/**
 * services/upstream-readiness.ts – "is edu-sharing reachable right now?",
 * answered cheaply (plan 2026-11-07, S5/S6).
 *
 * `/health` only says the process runs. A chatbot's outage switch needs the
 * repository: this module probes it with the smallest real read — a one-hit
 * `ngsearch`, which also keeps the search path warm — and caches the answer.
 *
 * Three bounds make it safe to expose without a budget:
 * - at most one probe per `READY_CACHE_MS` however often it is asked;
 * - never two probes at once (single-flight);
 * - a caller waits at most `SLOW_MS`: a probe still running then answers `slow`
 *   and goes on in the background, updating the cache when it ends.
 *
 * The periodic probe (`startReadinessProbe`) is started ONLY from `http.ts`,
 * never at module load — a timer firing on import would hit the network in
 * every test (same rule as the skill-registry cache).
 */

import { outsideUpstreamGate } from '../upstream-gate.js';
import { runAnonymous } from '../auth/credential.js';
import { ngsearch } from '../wlo-api.js';
import { log } from '../logger.js';

/** How long an answer stands before the next caller probes again. */
export const READY_CACHE_MS = 30_000;
/** A probe slower than this answers `slow` — the caller is not held for the full upstream timeout. */
export const SLOW_MS = 5_000;

export interface Readiness {
  ok: boolean;
  upstream: 'ok' | 'slow' | 'unreachable';
  checkedAt: string;
  latencyMs?: number;
}

let last: { at: number; result: Readiness } | null = null;
let inFlight: Promise<Readiness> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

async function probe(startedAt: number): Promise<Readiness> {
  try {
    // ANONYMOUS, whoever triggers it (review 2026-11-07): from the timer the
    // credential chain would fall back to the service account, so a wrong
    // service password read as "repository unreachable" — and `/ready` asks
    // about the repository, not about one account's login.
    // Past the upstream gate: this call MEASURES the repository. Through the
    // gate a full queue of our own would be reported as "unreachable".
    await outsideUpstreamGate(() => runAnonymous(() => ngsearch([{ property: 'ngsearchword', values: ['*'] }], 'FILES', 1, 0)));
    const latencyMs = Date.now() - startedAt;
    const slow = latencyMs > SLOW_MS;
    return { ok: !slow, upstream: slow ? 'slow' : 'ok', checkedAt: new Date(startedAt).toISOString(), latencyMs };
  } catch (err) {
    log.warn('readiness probe failed', { error: err instanceof Error ? err.message : String(err) });
    return { ok: false, upstream: 'unreachable', checkedAt: new Date(startedAt).toISOString() };
  }
}

function startProbe(now: number): Promise<Readiness> {
  if (!inFlight) {
    const startedAt = Date.now();
    inFlight = probe(startedAt).then(result => {
      // Stamped when the answer ARRIVED (on the caller's clock `now`): a probe
      // that took long is not stale the moment it lands.
      last = { at: now + (Date.now() - startedAt), result };
      return result;
    }).finally(() => { inFlight = null; });
  }
  return inFlight;
}

/**
 * How soon to ask again after the synthetic `slow` answer. That answer is not
 * cached and the probe behind it is still in flight, so the next call can
 * already be answered differently — but only once the probe lands, and it has
 * just shown itself to take longer than `SLOW_MS`. A short wait, not the cache time.
 */
export const SLOW_RETRY_MS = 5_000;

/** An answer plus how long it stands: asking again sooner than `retryAfterMs` returns the same one. */
export interface ReadinessAnswer {
  result: Readiness;
  retryAfterMs: number;
}

/**
 * The current answer and when it can next change. The wait is counted from when
 * the answer ARRIVED — the moment the cache was stamped —, never from
 * `checkedAt`, which is when the probe STARTED.
 */
export async function readinessAnswer(now: number = Date.now()): Promise<ReadinessAnswer> {
  if (last && now - last.at < READY_CACHE_MS) return { result: last.result, retryAfterMs: last.at + READY_CACHE_MS - now };
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<ReadinessAnswer>(resolve => {
    timeout = setTimeout(() => resolve({
      result: { ok: false, upstream: 'slow', checkedAt: new Date(now).toISOString() }, retryAfterMs: SLOW_RETRY_MS,
    }), SLOW_MS);
    timeout.unref?.();
  });
  try {
    // A probe that just landed was stamped this instant: it stands for the whole cache time.
    return await Promise.race([startProbe(now).then(result => ({ result, retryAfterMs: READY_CACHE_MS })), slow]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/** The current answer: cached if fresh, else probed — but never waited on for longer than `SLOW_MS`. */
export async function readiness(now: number = Date.now()): Promise<Readiness> {
  return (await readinessAnswer(now)).result;
}

/**
 * Probe now and every `intervalMs` (`WLO_READY_PROBE_MS`, default 30 s; 0 = off).
 * The first probe is the warm-up call after a start (S6); later ones keep the
 * connection and the search path warm. Each tick probes FRESH rather than going
 * through `readiness()`: the cache would swallow every tick under 30 s, and a
 * tick landing a millisecond early would skip a whole interval. Still
 * single-flight, and never rejects (`probe` catches). Unref'd, so it never
 * holds the process.
 */
export function startReadinessProbe(intervalMs: number): void {
  if (timer || intervalMs <= 0) return;
  void startProbe(Date.now());
  timer = setInterval(() => { void startProbe(Date.now()); }, intervalMs);
  timer.unref?.();
}

export function stopReadinessProbe(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Test seam: forget the cached answer. */
export function resetReadinessForTest(): void {
  last = null;
  inFlight = null;
}
