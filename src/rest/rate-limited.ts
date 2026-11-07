/**
 * rest/rate-limited.ts – the two 429s a budget or the login guard answers with,
 * each with the rest of the window as `Retry-After` (chatbot findings B3/S2).
 * One place, so `/mcp`, `/api` and `/auth/status` cannot drift.
 *
 * The body takes the SHAPE of the surface: JSON-RPC for `/mcp`, whose clients
 * parse every answer as JSON-RPC; plain REST `{error, code, retryAfter}` for
 * `/api` and `/auth/status`, whose successful answers are plain JSON too.
 * The log names the bucket KIND, never a client's key or a block's access id.
 *
 * `/auth*` answers through here too (chatbot team feedback 2026-11-07, B1) —
 * REST shape, but with its own German text, because the access-block pages
 * show `error` to a person.
 */

import { rateLimitedBody, restRateLimitedBody } from '../client-budget.js';
import { log } from '../logger.js';
import type { DistinctValueLimiter, RateLimiter } from '../rate-limit.js';

export type RefusalShape = 'jsonrpc' | 'rest';

/** What a refusal needs of a response — node:http's, or the minimal one `/auth*` is handed. */
export interface RefusalResponse {
  writeHead(status: number, headers: Record<string, string>): unknown;
  end(body: string): unknown;
}

/** The 429 itself: header and body carry the same wait. */
export function sendRateLimited(
  res: RefusalResponse, wait: number, message: string, code: 'rate_limited' | 'too_many_logins', shape: RefusalShape,
): void {
  res.writeHead(429, {
    'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
    'Retry-After': String(wait),
  });
  res.end(shape === 'rest' ? restRateLimitedBody(wait, message, code) : rateLimitedBody(wait, message, code));
}

/** The text a PERSON reads on the `/auth*` and `/oauth*` pages. */
export function germanRetryMessage(wait: number): string {
  return `Zu viele Anfragen. Bitte in ${wait === 1 ? 'einer Sekunde' : `${wait} Sekunden`} erneut versuchen.`;
}

export function refuseRateLimited(
  res: RefusalResponse, limiter: RateLimiter, key: string, kind: 'client' | 'address',
  opts: { shape?: RefusalShape; message?: (wait: number) => string } = {},
): void {
  const wait = limiter.retryAfterSeconds?.(key, Date.now()) ?? 60;
  log.warn('rate limit reached', { bucket: kind, ...(kind === 'client' ? { client: key } : {}), retryAfter: wait });
  sendRateLimited(res, wait, opts.message?.(wait) ?? `Rate limit exceeded. Retry after ${wait}s.`, 'rate_limited',
    opts.shape ?? 'jsonrpc');
}

/**
 * The login guard refused: too many DISTINCT credentials in one bucket.
 * `scope` names which rule fired WITHOUT naming the bucket: for a block the
 * bucket is the access id, and that id is a secret (AUTH.md §4) — it must never
 * reach a log line or a response. The wait is the rest of the 10-minute window.
 */
export function refuseTooManyLogins(
  res: RefusalResponse, limiter: DistinctValueLimiter,
  opts: { bucket: string; perBlock: boolean; ip: string; shape?: RefusalShape },
): void {
  log.warn('too many distinct credentials', { ip: opts.ip, scope: opts.perBlock ? 'access-block' : 'address' });
  const wait = limiter.retryAfterSeconds?.(opts.bucket, Date.now()) ?? 600;
  sendRateLimited(res, wait, opts.perBlock
    ? 'Too many different logins for this access block.'
    : 'Too many different logins from this address.', 'too_many_logins', opts.shape ?? 'jsonrpc');
}
