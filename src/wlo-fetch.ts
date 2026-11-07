/**
 * wlo-fetch.ts – The one way this server talks to a remote host.
 *
 * Every upstream call — the repository, Wikipedia, the text-extraction service —
 * goes through `wloFetch`, which enforces the timeout so no request can hang
 * forever, and through `withCredential`, which decides who receives the
 * operator's password. That second decision is the reason this is its own
 * module rather than a section of `wlo-config`: it is a security boundary, and
 * a security boundary should be findable by its file name.
 */

import { log } from './logger.js';
import {
  currentCredential, isCurrentCredentialRejected, markCurrentCredentialRejected, type WloCredential,
} from './auth/credential.js';
import { IDENTITY_URL, WLO_REPOSITORY_URL, WLO_FETCH_TIMEOUT_MS } from './wlo-config.js';

export const HEADERS = {
  'Accept': 'application/json',
  'Content-Type': 'application/json',
};

/**
 * ``fetch`` wrapper that enforces the upstream timeout. Every call to the
 * edu-sharing API goes through here so no request can hang forever. A
 * caller-supplied ``signal`` is respected as-is; otherwise a
 * ``WLO_FETCH_TIMEOUT_MS`` abort signal is attached.
 */
export async function wloFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const signal = init.signal ?? AbortSignal.timeout(WLO_FETCH_TIMEOUT_MS);
  const headers = withCredential(url, init.headers);
  // Only when OUR credential rides on this call: an explicit header (the login
  // probe) or a foreign host says nothing about the login in scope.
  const carriesScopedLogin = headers !== init.headers;
  // A personal login the repository already refused in this request is not
  // sent again — each attempt is another failed login against the person's
  // real WLO account, and a search fans out into several calls. The caller
  // gets the same 401 it would have got (auth review 2026-11-05).
  if (carriesScopedLogin && isCurrentCredentialRejected()) {
    return new Response(null, { status: 401, statusText: 'Unauthorized' });
  }
  const startedAt = Date.now();
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers, signal });
  } catch (err) {
    // A call that ran into the timeout is the slowest call of all — the 22 s
    // cold path is past the 20 s budget — so it is logged too, as status 0.
    const slow = slowUpstreamEntry(url, Date.now() - startedAt, 0);
    if (slow) log.warn('slow upstream', slow);
    throw err;
  }
  const slow = slowUpstreamEntry(url, Date.now() - startedAt, res.status);
  if (slow) log.warn('slow upstream', slow);
  if (carriesScopedLogin && res.status === 401 && await loginRefused(url)) markCurrentCredentialRejected();
  return res;
}

/**
 * A repository call slower than this is logged (plan 2026-11-07, S6): the first
 * request after a quiet period took 22 s in a load test while a fresh
 * connection costs only 0.1–0.3 s (measured), so the cause sits upstream — and
 * only a log naming the endpoint can show which one in production. Measured up
 * to the response HEADERS, not the body; a call that fails is logged with
 * status 0.
 */
export const SLOW_UPSTREAM_MS = 5_000;

/** The log entry for a slow call: path only — the query can carry search terms. */
export function slowUpstreamEntry(url: string, ms: number, status: number): { path: string; ms: number; status: number } | null {
  if (ms < SLOW_UPSTREAM_MS) return null;
  let path: string;
  try { path = new URL(url).pathname; } catch { path = url.split('?')[0] ?? ''; }
  return { path, ms, status };
}

/** One identity check per credential object — i.e. per request, however many 401s it collects. */
const identityChecks = new WeakMap<WloCredential, Promise<boolean>>();

/**
 * Does a 401 mean the LOGIN was refused, or a working login lacking a right?
 *
 * edu-sharing answers 401 for both (measured: wrong credentials → 401 on every
 * endpoint; a valid account on `/bulk/v1/find` → 401 "Admin rights are
 * required"). Taking every 401 for a refused password would stop a working
 * login for the rest of the request and tell its owner to sign in again, which
 * cannot help. So a 401 is confirmed against the identity endpoint, whose 401
 * is unambiguous. Anything other than a 401 there — 200, 5xx, a timeout — is
 * "not refused": failing toward the old behaviour cannot lock anyone out.
 *
 * Personal logins only (the service account is never marked); costs nothing
 * unless a 401 actually arrives.
 */
function loginRefused(url: string): Promise<boolean> {
  const cred = currentCredential();
  if (!cred || cred.source !== 'user') return Promise.resolve(false);
  if (url === IDENTITY_URL) return Promise.resolve(true);
  let check = identityChecks.get(cred);
  if (!check) {
    // Plain `fetch`, not `wloFetch`: this IS the confirmation, it must not
    // trigger one. The host is the repository by construction.
    check = fetch(IDENTITY_URL, {
      headers: { 'Accept': 'application/json', 'Authorization': cred.header },
      signal: AbortSignal.timeout(WLO_FETCH_TIMEOUT_MS),
    }).then(r => r.status === 401, () => false);
    identityChecks.set(cred, check);
  }
  return check;
}

/**
 * Whether ``url`` addresses the configured repository. The ONE definition of
 * that boundary: the credential attach below and the inline-preview fetch
 * (``services/preview-inline.ts``) both decide on it, and two near-copies of a
 * security boundary is how one of them drifts. Prefix + boundary, so a
 * look-alike host (`https://repo.example.evil.test`) cannot match.
 */
export function isRepositoryUrl(url: string): boolean {
  const base = WLO_REPOSITORY_URL;
  return url === base || url.startsWith(`${base}/`) || url.startsWith(`${base}?`);
}

/**
 * Attach the configured credential — and ONLY to the repository.
 *
 * The single place the server's identity is applied, and the single place it
 * is bounded. Wikipedia and the text-extraction service go through the same
 * `wloFetch`, so without this guard the operator's password would be sent to
 * third-party hosts.
 *
 * An `Authorization` header the caller set explicitly always wins — the login
 * probe in `auth/identity.ts` relies on being able to test a credential other
 * than the configured one.
 */
function withCredential(url: string, headers: HeadersInit | undefined): HeadersInit | undefined {
  const cred = currentCredential();
  if (!cred) return headers;
  if (!isRepositoryUrl(url)) return headers;
  const merged = new Headers(headers ?? {});
  if (merged.has('authorization')) return headers;
  merged.set('Authorization', cred.header);
  return merged;
}

/**
 * Log a non-OK upstream response before a caller degrades gracefully (returns
 * `[]`/`null`). Without this an outage is invisible — indistinguishable from a
 * legitimately empty result — so on-call can't tell "broken" from "empty".
 */
export function logUpstreamMiss(context: string, res: Response): void {
  log.warn('upstream returned non-OK', { context, status: res.status });
}
