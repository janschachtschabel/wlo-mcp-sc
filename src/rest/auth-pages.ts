/**
 * rest/auth-pages.ts – the endpoints behind the access-block pages.
 *
 *   GET  /auth/public-key  → the key the page encrypts with
 *   POST /auth/issue       → verify a block's login, then list its id
 *   POST /auth/revoke      → strike an id from the list
 *   POST /auth/revoke-all  → verify a login, then strike every id of that account
 *   POST /auth/ticket      → exchange an edu-sharing ticket for a ticket block
 *
 * `/auth/issue`, `/auth/revoke-all` and `/auth/ticket` are the endpoints on
 * this server that check a credential, which makes each a guessing oracle with
 * our address as the origin. They therefore pass BOTH limiters: requests per
 * address, and distinct logins per address.
 *
 * The work itself lives in `auth/` — `access-verify.ts` decodes, limits and
 * verifies the login at the AUTHORITY (not the status code), `access-issue.ts`
 * and `access-revoke.ts` each add their one step, `ticket-exchange.ts` does
 * the same for the embedding ticket. This module keeps the HTTP shape around
 * them, including the `Retry-After` the 429 carries.
 *
 * Returns `false` for a path it does not own so the caller falls through.
 */

import { issueAccessBlock } from '../auth/access-issue.js';
import { exchangeTicket } from '../auth/ticket-exchange.js';
import { revokeAllForBlock } from '../auth/access-revoke.js';
import { decodeAccessToken } from '../auth/access-token.js';
import { currentAccessSupport } from '../auth/credential.js';
import { log } from '../logger.js';
import type { DistinctValueLimiter, RateLimiter } from '../rate-limit.js';
import { isJsonContentType, readBodyWithLimit } from '../read-body.js';
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
  /**
   * Distinct TICKETS per address — the same guard, on its own budget and its own
   * bucket space, because a ticket is a different kind of secret.
   *
   * The password budget is calibrated for a human-chosen secret with guessable
   * neighbours, where ten tries from one address is already suspicious. A ticket
   * is machine-issued and unguessable (the argument the CORS carve-out for this
   * endpoint rests on, see `isCredentialSurface`), while the address it arrives
   * from is routinely SHARED — an embedded widget on a school's portal page puts
   * a whole class behind one NAT address. On the password budget the eleventh
   * signed-in person of the day was refused: the relay-client failure this
   * project already made once on `POST /mcp`, in the same shape.
   *
   * Separate INSTANCE, not merely a larger number: sharing one would let a
   * visitor's page reloads eat the same address's `/auth/issue` budget.
   *
   * Optional, and absence falls back to `authAbuseLimiter` — the tighter of the
   * two, so an entry point that forgets to wire it over-refuses instead of
   * running the exchange unbounded.
   */
  ticketAbuseLimiter?: DistinctValueLimiter;
}

interface AuthReq extends AsyncIterable<Buffer | Uint8Array> {
  method?: string;
  url?: string;
  /** Only `content-type` is read — see the 415 below. */
  headers?: Record<string, string | string[] | undefined>;
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
  '/auth/revoke-all': 'POST',
  '/auth/ticket': 'POST',
};

function send(res: AuthRes, status: number, body: unknown): true {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(body));
  return true;
}

/** One string field of a JSON body, or null if the body is not usable. */
async function readField(req: AuthReq, maxBodyBytes: number, name: string): Promise<string | null> {
  const { tooLarge, text } = await readBodyWithLimit(req, maxBodyBytes);
  if (tooLarge || !text) return null;
  try {
    const data: unknown = JSON.parse(text);
    if (typeof data !== 'object' || data === null) return null;
    const value = (data as Record<string, unknown>)[name];
    return typeof value === 'string' && value ? value : null;
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

  // Every remaining path carries a credential in the body, and `/auth/issue`
  // checks the password inside it. Refusing a body that is not DECLARED JSON is
  // what keeps a cross-origin form out of here: it makes the request non-simple,
  // so the browser must preflight, and the preflight fails because this surface
  // sends no CORS header (see `isCredentialSurface` in http-app.ts). Without it
  // a page could spend every visitor's address on a guess — the exact thing
  // `authAbuseLimiter` is here to bound. All three access-block pages send the
  // header already. (`/auth/ticket` IS reachable cross-origin — the carve-out
  // and its reasoning live at `isCredentialSurface` — and keeps this check for
  // the same reason as its siblings: JSON-only means preflight, preflight means
  // the response stays unreadable for origins the carve-out does not cover.)
  if (!isJsonContentType(req.headers?.['content-type'])) {
    return send(res, 415, { error: 'Dieser Endpunkt erwartet einen JSON-Body (Content-Type: application/json).' });
  }

  if (parsed.pathname === '/auth/ticket') {
    const ticket = await readField(req, deps.maxBodyBytes, 'ticket');
    if (!ticket) return send(res, 400, { error: 'Es wurde kein Ticket übermittelt.' });
    const outcome = await exchangeTicket(
      ticket,
      // The ticket budget, falling back to the password one — see the field.
      { ip: deps.ip, authAbuseLimiter: deps.ticketAbuseLimiter ?? deps.authAbuseLimiter, support },
      Date.now(),
    );
    if (!outcome.ok) return sendFailure(res, outcome);
    return send(res, 200, {
      ok: true,
      block: outcome.block,
      authority: outcome.authority,
      ...(outcome.displayName ? { displayName: outcome.displayName } : {}),
    });
  }

  const token = await readField(req, deps.maxBodyBytes, 'token');
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

  // Both remaining paths check a password, so both share the failure shape —
  // including the ten-minute `Retry-After`, which belongs to the distinct-login
  // limiter's window and not to the per-request one above.
  const verifyDeps = { ip: deps.ip, authAbuseLimiter: deps.authAbuseLimiter, support };
  const now = Date.now();

  if (parsed.pathname === '/auth/revoke-all') {
    const outcome = await revokeAllForBlock(token, verifyDeps, now);
    if (!outcome.ok) return sendFailure(res, outcome);
    return send(res, 200, { revoked: outcome.revoked });
  }

  const outcome = await issueAccessBlock(token, verifyDeps, now);
  if (!outcome.ok) return sendFailure(res, outcome);
  return send(res, 200, { ok: true, label: outcome.label });
}

/** The 400/429 answer both password-checking endpoints give. */
function sendFailure(res: AuthRes, outcome: { status: 400 | 429; error: string }): true {
  if (outcome.status === 429) {
    res.writeHead(429, { ...JSON_HEADERS, 'Retry-After': '600' });
    res.end(JSON.stringify({ error: outcome.error }));
    return true;
  }
  return send(res, 400, { error: outcome.error });
}
