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
import { currentCredential } from './auth/credential.js';
import { WLO_REPOSITORY_URL, WLO_FETCH_TIMEOUT_MS } from './wlo-config.js';

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
export function wloFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const signal = init.signal ?? AbortSignal.timeout(WLO_FETCH_TIMEOUT_MS);
  const headers = withCredential(url, init.headers);
  return fetch(url, { ...init, headers, signal });
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
