/**
 * rest/auth-status.ts – `GET /auth/status`: the login status in ONE request
 * (plan 2026-11-07, S4).
 *
 * `wlo_auth_status` is a full MCP tool; a chatbot that checks the login on every
 * turn paid a session for it. This endpoint answers the same payload
 * (`auth/auth-status.ts`) with the same credential rules as `/mcp`:
 *
 * - the caller's own header first, then the configured service account, then
 *   nobody — exactly the chain a tool call would run under;
 * - a Bearer we cannot open (revoked, foreign) → 401 with the OAuth challenge,
 *   like `/mcp`; an unusable Basic reads as anonymous, like `/mcp`;
 * - bounded by the protocol budget and by the distinct-login guard (it forwards
 *   the credential upstream, so it is a guessing oracle like `/mcp`);
 * - the answer is held 60 s per presented header (only an HMAC), so a chatbot asking
 *   every turn costs the repository one identity check a minute per person —
 *   but an UNKNOWN one (no authority: the repository refused or could not be
 *   reached, which `checkIdentity` cannot tell apart) only 10 s, so a blip does
 *   not show a valid login as refused for a whole minute, while a wrong
 *   password asked every turn still reaches the repository only every 10 s.
 *
 * Under `/auth*`, so it carries no CORS header (`isCredentialSurface`).
 */

import { createHmac, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  abuseBucketKey, configuredServiceCredential, credentialFromHeader, isUnusableAuthorization, isUnusableBearer,
} from '../auth/credential.js';
import { readAuthStatus, type AuthStatus } from '../auth/auth-status.js';
import type { DistinctValueLimiter, RateLimiter } from '../rate-limit.js';
import { refuseRateLimited, refuseTooManyLogins } from './rate-limited.js';

export const AUTH_STATUS_PATH = '/auth/status';
/** How long one header's answer is reused. */
export const AUTH_STATUS_CACHE_MS = 60_000;
/** How long an answer WITHOUT an authority is reused (see the module comment). */
export const AUTH_STATUS_UNKNOWN_CACHE_MS = 10_000;
const MAX_CACHED = 1000;

const cache = new Map<string, { until: number; payload: AuthStatus }>();

export interface AuthStatusDeps {
  ip: string;
  /** The budget bucket (`budgetBucket`) and its protocol limiter, if any. */
  bucket: { key: string; kind: 'client' | 'address' };
  protocolBudget?: RateLimiter;
  authAbuseLimiter: DistinctValueLimiter;
  /** The `WWW-Authenticate` value for an unusable Bearer. */
  challenge: () => string;
}

/** Per process, so a heap dump holds no dictionary-attackable hash of a login. */
const CACHE_KEY_SECRET = randomBytes(32);

/**
 * The cache key: the header the CALLER PRESENTED, not the upstream login it
 * resolves to (review 2026-11-07). Two blocks of one account open to the same
 * `Basic user:pass`, but one may carry an expiry and the other not — keyed on
 * the login, whichever came first answered for both. HMAC rather than a bare
 * hash: an unsalted SHA-256 of `Basic user:pass` is a password hash.
 */
function cacheKey(header: string | undefined, source: 'user' | 'service' | 'anonymous'): string {
  const value = source === 'user' ? `user:${header ?? ''}` : source;
  return createHmac('sha256', CACHE_KEY_SECRET).update(value).digest('hex');
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

export async function handleAuthStatus(req: IncomingMessage, res: ServerResponse, deps: AuthStatusDeps): Promise<void> {
  const now = Date.now();
  if (deps.protocolBudget?.check(deps.bucket.key, now)) {
    refuseRateLimited(res, deps.protocolBudget, deps.bucket.key, deps.bucket.kind, 'rest');
    return;
  }
  const header = req.headers['authorization'];
  const userCred = credentialFromHeader(header);
  if (!userCred && isUnusableBearer(header)) {
    send(res, 401, { error: 'The access token is invalid or has been revoked.' }, { 'WWW-Authenticate': deps.challenge() });
    return;
  }
  if (userCred) {
    const bucket = abuseBucketKey(userCred, deps.ip);
    if (deps.authAbuseLimiter.check(bucket, userCred.header, now)) {
      refuseTooManyLogins(res, deps.authAbuseLimiter, { bucket, perBlock: Boolean(userCred.jti), ip: deps.ip, shape: 'rest' });
      return;
    }
  }
  const effective = userCred ?? (isUnusableAuthorization(header) ? null : configuredServiceCredential());
  const key = cacheKey(header, userCred ? 'user' : effective ? 'service' : 'anonymous');
  const hit = cache.get(key);
  if (hit && hit.until > now) { send(res, 200, hit.payload); return; }

  const payload = await readAuthStatus(effective);
  if (cache.size >= MAX_CACHED) cache.clear();
  cache.set(key, { until: now + (payload.authority ? AUTH_STATUS_CACHE_MS : AUTH_STATUS_UNKNOWN_CACHE_MS), payload });
  send(res, 200, payload);
}

/** Test seam: forget the cached answers. */
export function resetAuthStatusCacheForTest(): void {
  cache.clear();
}
