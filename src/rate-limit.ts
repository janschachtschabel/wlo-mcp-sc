/**
 * rate-limit.ts – Tiny in-memory fixed-window rate limiter.
 *
 * Extracted from http.ts so it can be unit-tested deterministically (http.ts
 * starts the server on import and therefore can't be imported from a test).
 * State is encapsulated per limiter instance — no module-level globals.
 */

import { keyedDigest } from './keyed-digest.js';
import { isIP } from 'node:net';

export interface RateLimiter {
  /**
   * Record a request from `ip` at time `now` (ms epoch) and return whether it
   * exceeds the configured limit for the current window. `now` is injected so
   * callers (and tests) control the clock.
   */
  check(ip: string, now: number): boolean;
  /**
   * Seconds until `ip`'s current window ends — the honest `Retry-After` for a
   * refusal (chatbot request S2: a flat 60 told a client to wait longer than
   * needed). Never below 1. Optional so a hand-built test double stays valid;
   * callers fall back to the full window.
   */
  retryAfterSeconds?(ip: string, now: number): number;
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
    if (last) return addressUnit(last);
  }
  return remoteAddress ? addressUnit(remoteAddress) : 'unknown';
}

/**
 * The unit a client is counted in: an IPv4 address as is, an IPv6 address by
 * its /64.
 *
 * One IPv6 customer normally holds a whole /64, so keying per full address
 * handed a single client ~2^64 independent budgets — for the request limiter
 * and for the password-guessing guard alike (audit 2026-11-05).
 *
 * Two forms must NOT be cut: an IPv4 peer that Node reports as IPv4-mapped
 * (`::ffff:a.b.c.d`, the normal case on a dual-stack socket) keeps its own
 * IPv4 — a /64 cut would put every IPv4 client into ONE bucket — and loopback
 * stays loopback. Anything that is not an address passes through unchanged.
 */
function addressUnit(address: string): string {
  const host = address.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(host) !== 6) return address;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
  if (mapped) return mapped[1]!;
  if (host === '::1') return host;
  const [head = '', tail] = host.split('::');
  const left = head ? head.split(':') : [];
  const right = tail !== undefined && tail ? tail.split(':') : [];
  const groups = [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right];
  const prefix = groups.slice(0, 4).map(g => parseInt(g, 16).toString(16)).join(':');
  return `${prefix}::/64`;
}

/** Counts how many DISTINCT values one key presents within a window. */
export interface DistinctValueLimiter {
  /**
   * Record that `key` presented `value` at `now` (ms epoch) and return whether
   * that pushes it past the configured number of distinct values. Presenting a
   * value already seen in this window is always allowed.
   */
  check(key: string, value: string, now: number): boolean;
  /** Seconds until `key`'s window ends (≥ 1) — the honest `Retry-After`. Optional for test doubles. */
  retryAfterSeconds?(key: string, now: number): number;
  /** Test seam: the retained state, to prove no raw value is kept. */
  inspectForTest(): unknown;
}

/**
 * Create a limiter on the number of DISTINCT values per key per window.
 *
 * Built for one job: the MCP endpoint forwards a client-supplied `Authorization`
 * header upstream, so it can be abused as a relay for guessing WLO logins with
 * our server's address as the origin. A requests-per-minute cap is the wrong
 * instrument — a legitimate per-user client sends a header on every single call
 * and would be throttled, while an attacker rotating credentials never exceeds
 * a per-credential cap. What separates the two is how many distinct logins one
 * address presents: a real user has exactly one.
 *
 * Values are stored as a truncated KEYED digest, never in the clear and never
 * as a bare hash: this
 * state lives for a whole window, and keeping passwords in it would create the
 * very exposure the limiter exists to reduce.
 *
 * `maxDistinct <= 0` disables the limiter.
 */
export function createDistinctValueLimiter(maxDistinct: number, windowMs = 600_000): DistinctValueLimiter {
  const buckets = new Map<string, { seen: Set<string>; windowStart: number }>();
  let lastSweep = 0;

  // Keyed (`keyed-digest.ts`): a bare hash of a login is a password hash.
  const digest = (value: string) => keyedDigest(value).slice(0, 24);

  return {
    check(key: string, value: string, now: number): boolean {
      if (maxDistinct <= 0) return false;

      // Opportunistic sweep, mirroring createRateLimiter: bounded memory
      // without a timer, and expired digests do not linger.
      if (now - lastSweep > windowMs) {
        for (const [k, bucket] of buckets) {
          if (now - bucket.windowStart > windowMs) buckets.delete(k);
        }
        lastSweep = now;
      }

      const hash = digest(value);
      const bucket = buckets.get(key);
      if (!bucket || now - bucket.windowStart > windowMs) {
        buckets.set(key, { seen: new Set([hash]), windowStart: now });
        return false;
      }
      if (bucket.seen.has(hash)) return false; // the same login again is normal use
      if (bucket.seen.size >= maxDistinct) return true;
      bucket.seen.add(hash);
      return false;
    },
    retryAfterSeconds(key: string, now: number): number {
      const bucket = buckets.get(key);
      if (!bucket) return 1;
      return Math.max(1, Math.ceil((bucket.windowStart + windowMs - now) / 1000));
    },
    inspectForTest() {
      return [...buckets].map(([k, b]) => [k, [...b.seen]]);
    },
  };
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
    retryAfterSeconds(ip: string, now: number): number {
      const bucket = buckets.get(ip);
      if (!bucket) return 1;
      return Math.max(1, Math.ceil((bucket.windowStart + windowMs - now) / 1000));
    },
  };
}
