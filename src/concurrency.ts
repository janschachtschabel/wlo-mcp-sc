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
      const i = next++;
      if (i >= items.length) break;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        results[i] = null;
        log.warn('mapPool item failed', { index: i, error: err instanceof Error ? err.message : String(err) });
      }
    }
  };
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}
