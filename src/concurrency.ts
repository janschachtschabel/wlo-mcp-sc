/**
 * concurrency.ts – bounded fan-out.
 *
 * Lived in `tools/shared.ts` until 2026-08-04, because that is where the first
 * caller needed it. Four `services/` modules then imported it from there, which
 * pointed the dependency the wrong way round: a service reached up into the MCP
 * tool layer for a primitive that has nothing to do with MCP. Moving it to a
 * leaf module is what lets `services/collection-traversal.ts` bound its fan-out
 * without importing `tools/` at all.
 */

import { currentRequestSignal, isClientGone } from './request-scope.js';
import { log } from './logger.js';

/**
 * Run an async mapper over `items` with a bounded number of concurrent
 * in-flight tasks (worker-pool). Keeps result order. Used to fan out the
 * per-variant enrichment in search_wlo_topic_pages Mode C WITHOUT firing
 * 100+ simultaneous upstream fetches (which risks connection exhaustion and
 * upstream throttling) — a controlled pool is both stable and, combined with
 * caching, fast.
 *
 * **Fault tolerance (explicit contract):** if `fn` rejects for a single item,
 * that slot is set to `null` and the batch keeps going — one transient upstream
 * error must not discard every other successfully-resolved item. Callers
 * therefore receive `(R | null)[]` and must filter out the nulls. The failure
 * is logged so it is not silently lost.
 */
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (true) {
      // The client of this request is gone: the remaining items are not started
      // (each would fail at once in `wloFetch`, with a warning apiece).
      if (currentRequestSignal()?.aborted) break;
      const i = next++;
      if (i >= items.length) break;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        results[i] = null;
        if (!isClientGone(err)) log.warn('mapPool item failed', { index: i, error: err instanceof Error ? err.message : String(err) });
      }
    }
  };
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}

/**
 * A bound SHARED by several fan-outs: at most `limit` tasks run at once, however
 * many callers hand tasks in. `mapPool` cannot do this — it bounds ONE list, and
 * the batch search (`services/content-search-many.ts`) runs several searches
 * whose requests must share one ceiling.
 *
 * FIFO. A task whose `signal` aborts while it WAITS leaves the queue at once,
 * rejecting with the signal's reason — it does not hold its caller until a slot
 * frees. One whose signal has aborted by the time its turn comes is not started
 * and passes its slot on.
 */
export function createLimiter(limit: number): <T>(task: () => Promise<T>, signal?: AbortSignal) => Promise<T> {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async (task, signal) => {
    // A waiter is handed the slot of the task that finished: `active` stays as
    // it is, so a newcomer cannot slip in between.
    if (active >= limit) {
      // Rejecting here is outside the `try`: a waiter that left never held a slot.
      await new Promise<void>((resolve, reject) => {
        if (signal?.aborted) { reject(signal.reason); return; }
        const turn = () => { signal?.removeEventListener('abort', leave); resolve(); };
        const leave = () => { waiting.splice(waiting.indexOf(turn), 1); reject(signal!.reason); };
        waiting.push(turn);
        signal?.addEventListener('abort', leave, { once: true });
      });
    } else active++;
    try {
      if (signal?.aborted) throw signal.reason;
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}
