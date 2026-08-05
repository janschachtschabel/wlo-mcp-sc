/**
 * rest/auth-pages.ts – the three endpoints behind the access-block pages.
 *
 *   GET  /auth/public-key  → the key the page encrypts with
 *   POST /auth/issue       → verify a block's login, then list its id
 *   POST /auth/revoke      → strike an id from the list
 *
 * `/auth/issue` is the one endpoint on this server that checks a password, which
 * makes it a guessing oracle with our address as the origin. It therefore passes
 * BOTH limiters: requests per address, and distinct logins per address.
 *
 * Issuance itself lives in `auth/access-issue.ts` — decode, limit, verify the
 * login at the AUTHORITY (not the status code), list the id. It was moved there
 * when `/oauth/authorize` needed the identical step; this module keeps the HTTP
 * shape around it, including the `Retry-After` the 429 carries.
 *
 * Returns `false` for a path it does not own so the caller falls through.
 */

import { issueAccessBlock } from '../auth/access-issue.js';
import { decodeAccessToken } from '../auth/access-token.js';
import { currentAccessSupport } from '../auth/credential.js';
import { log } from '../logger.js';
import type { DistinctValueLimiter, RateLimiter } from '../rate-limit.js';
import { readBodyWithLimit } from '../read-body.js';
import { parseRequestUrl } from '../request-url.js';
import { sanitizeText } from '../text-sanitize.js';

export interface AuthEndpointDeps {
  /** Client key for both limiters (already resolved through TRUST_PROXY). */
  ip: string;
  maxBodyBytes: number;
  /** Requests per address — the public-surface limiter. */
  rateLimiter: RateLimiter;
  /** Distinct logins per address — the guessing guard. */
  authAbuseLimiter: DistinctValueLimiter;
}

interface AuthReq extends AsyncIterable<Buffer | Uint8Array> {
  method?: string;
  url?: string;
}
interface AuthRes {
  writeHead: (status: number, headers?: Record<string, string>) => void;
  end: (body?: string) => void;
  /** node:http sets this; the mocks in the tests do not, which reads as false. */
  headersSent?: boolean;
}

const JSON_HEADERS = { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' };

/** Paths this module owns, with the single method each accepts. */
const ROUTES: Record<string, 'GET' | 'POST'> = {
  '/auth/public-key': 'GET',
  '/auth/issue': 'POST',
  '/auth/revoke': 'POST',
};

function send(res: AuthRes, status: number, body: unknown): true {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(body));
  return true;
}

/** The `token` field of a JSON body, or null if the body is not usable. */
async function readToken(req: AuthReq, maxBodyBytes: number): Promise<string | null> {
  const { tooLarge, text } = await readBodyWithLimit(req, maxBodyBytes);
  if (tooLarge || !text) return null;
  try {
    const data: unknown = JSON.parse(text);
    if (typeof data !== 'object' || data === null) return null;
    const token = (data as Record<string, unknown>)['token'];
    return typeof token === 'string' && token ? token : null;
  } catch {
    return null;
  }
}

/**
 * Error boundary for the three endpoints below.
 *
 * Without it a failing registry write — a full disk, a volume not mounted, a
 * permission — left the rejection to escape into `http-app.ts`, which does not
 * catch here the way the MCP branch does. node:http ignores a handler's returned
 * promise, so the caller got no response at all and the socket sat until
 * `requestTimeout`, thirty seconds after someone typed their password.
 *
 * Generic text, like every other internal failure on this server: the reason
 * goes to the log, never to the caller.
 */
export async function handleAuthEndpoint(
  req: AuthReq,
  res: AuthRes,
  deps: AuthEndpointDeps,
): Promise<boolean> {
  try {
    return await route(req, res, deps);
  } catch (err) {
    log.error('access-block endpoint failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    if (!res.headersSent) {
      res.writeHead(500, JSON_HEADERS);
      res.end(JSON.stringify({ error: 'Serverfehler. Bitte später erneut versuchen.' }));
    }
    return true;
  }
}

async function route(
  req: AuthReq,
  res: AuthRes,
  deps: AuthEndpointDeps,
): Promise<boolean> {
  const parsed = parseRequestUrl(req.url);
  if (!parsed) return false;
  const wanted = ROUTES[parsed.pathname];
  if (!wanted) return false;

  // `/auth/revoke` is also the revocation PAGE (mapped in `rest/static.ts`).
  // This module owns the POST there and hands a GET back — before the checks
  // below, so that the page stays reachable even where the feature is off, the
  // same as `/auth-revoke.html`. Someone who came to block a compromised access
  // should not meet "Method not allowed. Use POST."
  if (parsed.pathname === '/auth/revoke' && req.method === 'GET') return false;

  // Absent key material or an unreadable registry means the feature is off, and
  // an endpoint that is off should not exist rather than fail — the same shape
  // as a tool that is never registered.
  const support = currentAccessSupport();
  if (!support) return send(res, 404, { error: 'Zugänge werden auf diesem Server nicht ausgegeben.' });

  if (req.method !== wanted) {
    res.writeHead(405, { ...JSON_HEADERS, Allow: wanted });
    res.end(JSON.stringify({ error: `Method not allowed. Use ${wanted}.` }));
    return true;
  }

  if (deps.rateLimiter.check(deps.ip, Date.now())) {
    res.writeHead(429, { ...JSON_HEADERS, 'Retry-After': '60' });
    res.end(JSON.stringify({ error: 'Zu viele Anfragen. Bitte in einer Minute erneut versuchen.' }));
    return true;
  }

  if (parsed.pathname === '/auth/public-key') {
    return send(res, 200, { publicKey: support.keys.publicKeyPem });
  }

  const token = await readToken(req, deps.maxBodyBytes);
  if (!token) return send(res, 400, { error: 'Es wurde kein Zugangsblock übermittelt.' });

  if (parsed.pathname === '/auth/revoke') {
    const payload = decodeAccessToken(token, support.keys);
    if (!payload) {
      // No detail about WHY: a wrong key, a tampered block and a foreign one
      // must look identical from outside.
      return send(res, 400, { error: 'Dieser Zugangsblock ist ungültig oder gehört nicht zu diesem Server.' });
    }
    const revoked = await support.registry.remove(payload.jti);
    // Sanitized because NOTHING here has verified `u`: anyone can encrypt a
    // block against our public key, so the name is caller-chosen text on its way
    // into the operator's log — the same boundary rule `identity.ts` applies to
    // the authority name we asked for ourselves.
    log.info('access block revoked', { label: sanitizeText(payload.u), revoked });
    // 200 either way: a different answer for an id we do not carry would be an
    // oracle for probing which ids exist.
    return send(res, 200, { revoked });
  }

  const outcome = await issueAccessBlock(
    token,
    { ip: deps.ip, authAbuseLimiter: deps.authAbuseLimiter, support },
    Date.now(),
  );
  if (!outcome.ok) {
    if (outcome.status === 429) {
      res.writeHead(429, { ...JSON_HEADERS, 'Retry-After': '600' });
      res.end(JSON.stringify({ error: outcome.error }));
      return true;
    }
    return send(res, 400, { error: outcome.error });
  }
  return send(res, 200, { ok: true, label: outcome.label });
}
