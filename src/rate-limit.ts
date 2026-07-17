/**
 * rate-limit.ts – Tiny in-memory fixed-window rate limiter.
 *
 * Extracted from http.ts so it can be unit-tested deterministically (http.ts
 * starts the server on import and therefore can't be imported from a test).
 * State is encapsulated per limiter instance — no module-level globals.
 */

export interface RateLimiter {
  /**
   * Record a request from `ip` at time `now` (ms epoch) and return whether it
   * exceeds the configured limit for the current window. `now` is injected so
   * callers (and tests) control the clock.
   */
  check(ip: string, now: number): boolean;
}

/**
 * Resolve the client identity used as the rate-limit key. Behind a trusted
 * reverse proxy the direct socket address is the proxy, so all clients would
 * share one bucket; when `trustProxy` is true the `X-Forwarded-For` header is
 * used instead.
 *
 * We take the RIGHTMOST hop — the address the trusted proxy itself appended
 * (`$proxy_add_x_forwarded_for`), i.e. the client it actually saw. The leftmost
 * value is client-supplied and therefore spoofable (a client sending
 * `X-Forwarded-For: 9.9.9.9` would forge a fresh key per request and evade the
 * limiter), so it must not be trusted. This assumes exactly one trusted proxy in
 * front; with a chain of N trusted proxies a hop count would be needed. XFF is
 * only honored at all when the operator opts in via TRUST_PROXY.
 */
export function clientKey(
  forwardedFor: string | string[] | undefined,
  remoteAddress: string | undefined,
  trustProxy: boolean,
): string {
  if (trustProxy && forwardedFor) {
    const raw = Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor;
    const hops = raw.split(',').map(s => s.trim()).filter(Boolean);
    const last = hops[hops.length - 1];
    if (last) return last;
  }
  return remoteAddress ?? 'unknown';
}

/**
 * Create a fixed-window limiter allowing `limitRpm` requests per `windowMs`
 * per IP. `limitRpm <= 0` disables limiting (every check returns false).
 */
export function createRateLimiter(limitRpm: number, windowMs = 60_000): RateLimiter {
  const buckets = new Map<string, { count: number; windowStart: number }>();
  let lastSweep = 0;

  return {
    check(ip: string, now: number): boolean {
      if (limitRpm <= 0) return false;

      // Opportunistic sweep of expired buckets so the map can't grow unbounded.
      if (now - lastSweep > windowMs) {
        for (const [key, bucket] of buckets) {
          if (now - bucket.windowStart > windowMs) buckets.delete(key);
        }
        lastSweep = now;
      }

      const bucket = buckets.get(ip);
      if (!bucket || now - bucket.windowStart > windowMs) {
        buckets.set(ip, { count: 1, windowStart: now });
        return false;
      }
      bucket.count++;
      return bucket.count > limitRpm;
    },
  };
}
