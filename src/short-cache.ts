/**
 * short-cache.ts – remember an answer for a moment.
 *
 * For reads that many requests repeat and whose answer changes on an editorial
 * timescale, not a request's: the list of subject portals was fetched again by
 * almost every search, and the descriptions of a collection's first three
 * skills by every answer about that collection (audit 2026-11-12, P-4).
 *
 * Deliberately small, and three rules for whoever uses it:
 *
 *   - Only an ANSWER is remembered. "Could not be read" is never stored — a
 *     cached outage is a statement nobody made.
 *   - The VALUE is stored, never the promise: a promise in flight belongs to
 *     the request that started it and dies with that request's abort signal
 *     (`request-scope.ts`), which would hand the next caller somebody else's
 *     hang-up.
 *   - The KEY carries whose rights the read was made with (`sharedReadScope`,
 *     `auth/credential.ts`), and a personal login's reads are not kept at all:
 *     the repository answers by rights, so one caller's answer is not another's.
 *   - It is short (a minute by default) and bounded. What must be current — a
 *     write's read-back, a confirmation preview — does not go through here.
 */

const caches = new Set<{ clear(): void }>();

export interface ShortCache<V> {
  get(key: string, now?: number): V | undefined;
  set(key: string, value: V, now?: number): void;
  clear(): void;
}

/** How long an answer is reused unless the cache says otherwise. */
export const SHORT_CACHE_MS = 60_000;

export function shortCache<V>(max: number, ttlMs: number = SHORT_CACHE_MS): ShortCache<V> {
  const entries = new Map<string, { value: V; until: number }>();
  const cache: ShortCache<V> = {
    get(key, now = Date.now()) {
      const hit = entries.get(key);
      if (!hit) return undefined;
      if (hit.until <= now) { entries.delete(key); return undefined; }
      return hit.value;
    },
    set(key, value, now = Date.now()) {
      entries.delete(key);
      // Insertion order is age order: the oldest goes when the bound is met.
      while (entries.size >= max) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
      entries.set(key, { value, until: now + ttlMs });
    },
    clear() { entries.clear(); },
  };
  caches.add(cache);
  return cache;
}

/** Forget everything — for tests, where one file's mock must not answer another's question. */
export function clearShortCaches(): void {
  for (const cache of caches) cache.clear();
}
