/**
 * upstream-gate.ts – how many calls this PROCESS has open at the repository.
 *
 * Every other bound is per call: `mapPool` limits one fan-out, the rate limiter
 * one client. Nothing bounded their product — one search with the OER filter
 * starts about 25 requests at once (4 licence keys × up to 5 query variants,
 * plus side lookups), so ten people searching in the same second were 250
 * simultaneous requests against one repository (audit 2026-11-12, P-1).
 *
 * A counting gate in front of `wloFetch`, for the repository host only: FIFO, a
 * slot per call, given back when the response HEADERS arrive or the call fails.
 * A call that cannot get a slot within `GATE_MAX_WAIT_MS` (or meets a full
 * queue) is not sent; `wloFetch` answers it as a 503. Callers that THROW on a
 * non-OK answer report that as `upstream_busy`; the six read helpers that
 * degrade a non-OK answer to "empty" (`getNodeMetadata`, the two collection
 * searches, …) do so for this one too — the same as for a real 503, and the
 * subject of audit package 9.
 *
 * The limit is `WLO_UPSTREAM_CONCURRENCY` (default 24, 0 = off), sized by what
 * ONE ordinary call needs: a single OER search starts about 25 requests (an
 * estimate, not a count), so at most a straggler of it waits for the first
 * answer — while the process as a whole is bounded.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import { log } from './logger.js';
import { WLO_UPSTREAM_CONCURRENCY } from './wlo-config.js';

/**
 * How long a call waits for a slot before it is given up — much shorter than a
 * call's own timeout. Slots turn over in a fraction of a second while the
 * repository answers; a call still waiting after this long is behind a
 * repository that does not, and shedding it early is what keeps the answer
 * "busy" from arriving after the caller has stopped listening.
 */
export const GATE_MAX_WAIT_MS = 5_000;

/**
 * How many calls may wait, as a multiple of the limit. Past it a call is turned
 * away at once: a queue that only grows makes everybody wait the full bound for
 * the same answer.
 */
const QUEUE_FACTOR = 4;

interface Waiter {
  grant: () => void;
  /** Tests only: end the wait without a slot. */
  drop: () => void;
}

const bypass = new AsyncLocalStorage<true>();

/**
 * Run `fn` past the gate. For the ONE caller whose job is to measure the
 * repository rather than to use it: the readiness probe. Through the gate, our
 * own queue would answer for the repository — a full gate read as
 * "unreachable", held for half a minute, on the endpoint a client's
 * circuit-breaker watches (review of this package). One small call per probe
 * interval; it cannot become load.
 */
export function outsideUpstreamGate<T>(fn: () => T): T {
  return bypass.run(true, fn);
}

/** Whether the code running now is exempt from the gate. */
export function bypassesUpstreamGate(): boolean {
  return bypass.getStore() === true;
}

let limit = WLO_UPSTREAM_CONCURRENCY;
let maxWaitOverride: number | null = null;
let inFlight = 0;
const waiting: Waiter[] = [];

/** Tests only: a limit (and optionally a wait bound); `null` restores the configured one and clears the state. */
export function setUpstreamLimitForTest(value: number | null, opts: { maxWaitMs?: number } = {}): void {
  limit = value ?? WLO_UPSTREAM_CONCURRENCY;
  maxWaitOverride = opts.maxWaitMs ?? null;
  if (value === null) {
    // Nobody is left hanging: a waiter of a finished test ends without a slot.
    for (const w of [...waiting]) w.drop();
    inFlight = 0;
  }
}

export function upstreamGateStats(): { inFlight: number; waiting: number; limit: number } {
  return { inFlight, waiting: waiting.length, limit };
}

/**
 * Take a slot if one is free RIGHT NOW — synchronously, so that a call made
 * while the process is below its limit is sent in the same tick as before the
 * gate existed. `false` means: wait with `acquireUpstreamSlot`.
 */
export function tryAcquireUpstreamSlot(): boolean {
  if (limit <= 0) return true;
  if (inFlight >= limit) return false;
  inFlight++;
  return true;
}

/**
 * Wait for a slot. Resolves `true` with the slot taken — the caller MUST call
 * `releaseUpstreamSlot` exactly once — or `false` when none came free within
 * `maxWaitMs` or the queue is full. Rejects with the signal's reason when `signal` aborts first; in
 * both of those cases no slot is held.
 */
export function acquireUpstreamSlot(opts: {
  maxWaitMs: number; signal?: AbortSignal;
  /**
   * Wait for a slot however long it takes (bounded only by `signal`), past a
   * full queue too. For WRITES: the answer to a call that was turned away is a
   * synthetic 503, which a write path cannot tell from the repository's own —
   * and after a confirmation key was spent, a 5xx reads as "outcome open" or
   * ends a plan step as failed for a request that was never sent. Writes are
   * few; they are not what the bound protects the repository from.
   */
  patient?: boolean;
}): Promise<boolean> {
  if (limit <= 0) return Promise.resolve(true);
  if (opts.signal?.aborted) return Promise.reject(opts.signal.reason);
  if (inFlight < limit) { inFlight++; return Promise.resolve(true); }
  if (!opts.patient && waiting.length >= limit * QUEUE_FACTOR) {
    log.warn('upstream gate: queue full — call not sent', { limit, waiting: waiting.length });
    return Promise.resolve(false);
  }

  return new Promise<boolean>((resolve, reject) => {
    const leave = (): void => {
      const i = waiting.indexOf(waiter);
      if (i >= 0) waiting.splice(i, 1);
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    };
    const waiter: Waiter = { grant: () => { leave(); resolve(true); }, drop: () => { leave(); resolve(false); } };
    const onAbort = (): void => { leave(); reject(opts.signal!.reason); };
    const wait = maxWaitOverride ?? opts.maxWaitMs;
    const timer = opts.patient ? undefined : setTimeout(() => {
      leave();
      log.warn('upstream gate: no slot in time — call not sent', { limit, waiting: waiting.length, waitedMs: wait });
      resolve(false);
    }, wait);
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    waiting.push(waiter);
  });
}

/** Give a slot back; the longest waiter gets it. A no-op while the gate is off. */
export function releaseUpstreamSlot(): void {
  if (limit <= 0) return;
  const next = waiting[0];
  // Handed over directly: `inFlight` stays as it is, so a third call cannot
  // slip in between the release and the waiter's turn.
  if (next) { next.grant(); return; }
  if (inFlight > 0) inFlight--;
}
