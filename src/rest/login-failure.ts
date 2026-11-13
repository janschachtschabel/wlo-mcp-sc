/**
 * rest/login-failure.ts – the HTTP answer to a `LoginFailure`, shared by the
 * four places that prove a login over REST: `/auth/issue`, `/auth/revoke-all`,
 * `/auth/ticket` and the OAuth consent (`POST /oauth/authorize`). Each used to
 * build it itself — with a fixed `Retry-After: 600` and no `code`, and with
 * no way to say "the repository did not answer" (chatbot feedback B1/B2 and
 * its review, 2026-11-07).
 *
 * - 400 `{error}` — refused; the text is for a person.
 * - 429 `{error, code: "too_many_logins", retryAfter}` — the guessing guard,
 *   with the rest of ITS window for this address.
 * - 503 `{error, code: "upstream_unreachable", retryAfter}` — no verdict on
 *   the login; worth one retry after `retryAfter`.
 */

import { BUSY_RETRY_DEFAULT_S } from '../services/failure-code.js';
import type { LoginFailure } from '../auth/access-verify.js';
import { addressBucket } from '../auth/credential.js';
import type { DistinctValueLimiter } from '../rate-limit.js';
import { sendRateLimited, type RefusalResponse } from './rate-limited.js';

const HEADERS = { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };

export function sendLoginFailure(
  res: RefusalResponse, outcome: LoginFailure, limiter: DistinctValueLimiter, ip: string,
): true {
  if (outcome.status === 429) {
    sendRateLimited(res, limiter.retryAfterSeconds?.(addressBucket(ip), Date.now()) ?? 600, outcome.error, 'too_many_logins', 'rest');
  } else if (outcome.status === 503) {
    res.writeHead(503, { ...HEADERS, 'Retry-After': String(BUSY_RETRY_DEFAULT_S) });
    res.end(JSON.stringify({ error: outcome.error, code: 'upstream_unreachable', retryAfter: BUSY_RETRY_DEFAULT_S }));
  } else {
    res.writeHead(400, HEADERS);
    res.end(JSON.stringify({ error: outcome.error }));
  }
  return true;
}
