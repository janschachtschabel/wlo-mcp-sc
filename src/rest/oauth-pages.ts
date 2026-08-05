/**
 * rest/oauth-pages.ts – the OAuth surface, as HTTP.
 *
 * Sibling of `rest/auth-pages.ts` and built the same way: a closed set of paths,
 * `false` for anything else so the caller falls through, and an error boundary
 * that turns an unexpected throw into a generic 500 with the reason in the log.
 *
 * P1 serves discovery only:
 *
 *   GET /.well-known/oauth-authorization-server[/mcp]  → RFC 8414
 *   GET /.well-known/oauth-protected-resource[/mcp]    → RFC 9728
 *
 * Both spellings of each, because clients differ on whether the resource path is
 * appended (RFC 8414 §3.1 prescribes it for an issuer WITH a path component;
 * ours has none, so the plain form is the correct one — but serving the other
 * costs nothing and a client guessing wrong would otherwise see a 404 and
 * conclude this server has no OAuth at all).
 *
 * OFF is 404, never 500, and there are two ways to be off. Without key material
 * there is no access block to hand out, so there is nothing for OAuth to issue.
 * Without a resolvable issuer the documents would name endpoints on a host we
 * did not choose (see `auth/oauth-metadata.ts`). Either way the endpoint should
 * not exist rather than half-work — the same shape as a tool that is never
 * registered.
 */

import { currentAccessSupport } from '../auth/credential.js';
import {
  authorizationServerMetadata,
  protectedResourceMetadata,
} from '../auth/oauth-metadata.js';
import { log } from '../logger.js';
import type { RateLimiter } from '../rate-limit.js';
import { parseRequestUrl } from '../request-url.js';

export interface OAuthEndpointDeps {
  /** Client key for the limiter (already resolved through TRUST_PROXY). */
  ip: string;
  /** Requests per address — the public-surface limiter. */
  rateLimiter: RateLimiter;
  /** This deployment's public origin, or null when it could not be established. */
  issuer: string | null;
}

/**
 * Async-iterable because the endpoints from P2 onward read a body; the discovery
 * paths do not. Same shape as `AuthEndpointDeps`' request, so both modules can
 * be driven by the same kind of stub.
 */
interface OAuthReq extends AsyncIterable<Buffer | Uint8Array> {
  method?: string;
  url?: string;
}
interface OAuthRes {
  writeHead: (status: number, headers?: Record<string, string>) => void;
  end: (body?: string) => void;
  /** node:http sets this; the mocks in the tests do not, which reads as false. */
  headersSent?: boolean;
}

const JSON_HEADERS = { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' };

/** Five minutes: long enough to spare the round trip, short enough that a
 *  corrected issuer reaches clients the same day. */
const METADATA_CACHE = 'max-age=300';

/** Which document each path serves. Both spellings map to the same builder. */
const DISCOVERY: Record<string, (issuer: string) => Record<string, unknown>> = {
  '/.well-known/oauth-authorization-server': authorizationServerMetadata,
  '/.well-known/oauth-authorization-server/mcp': authorizationServerMetadata,
  '/.well-known/oauth-protected-resource': protectedResourceMetadata,
  '/.well-known/oauth-protected-resource/mcp': protectedResourceMetadata,
};

function send(res: OAuthRes, status: number, body: unknown, headers: Record<string, string> = {}): true {
  res.writeHead(status, { ...JSON_HEADERS, ...headers });
  res.end(JSON.stringify(body));
  return true;
}

/**
 * Error boundary, for the reason `auth-pages.ts` documents: node:http ignores a
 * handler's returned promise, so a rejection that escapes leaves the caller with
 * no response at all until `requestTimeout`.
 */
export async function handleOAuthEndpoint(
  req: OAuthReq,
  res: OAuthRes,
  deps: OAuthEndpointDeps,
): Promise<boolean> {
  try {
    return await route(req, res, deps);
  } catch (err) {
    log.error('oauth endpoint failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    if (!res.headersSent) {
      res.writeHead(500, JSON_HEADERS);
      res.end(JSON.stringify({ error: 'Serverfehler. Bitte später erneut versuchen.' }));
    }
    return true;
  }
}

async function route(req: OAuthReq, res: OAuthRes, deps: OAuthEndpointDeps): Promise<boolean> {
  const parsed = parseRequestUrl(req.url);
  if (!parsed) return false;

  const document = DISCOVERY[parsed.pathname];
  if (!document) return false;

  if (!currentAccessSupport() || !deps.issuer) {
    return send(res, 404, { error: 'OAuth ist auf diesem Server nicht eingerichtet.' });
  }

  if (req.method !== 'GET') {
    return send(res, 405, { error: 'Method not allowed. Use GET.' }, { Allow: 'GET' });
  }

  if (deps.rateLimiter.check(deps.ip, Date.now())) {
    return send(res, 429, { error: 'Zu viele Anfragen. Bitte in einer Minute erneut versuchen.' },
      { 'Retry-After': '60' });
  }

  return send(res, 200, document(deps.issuer), { 'Cache-Control': METADATA_CACHE });
}
