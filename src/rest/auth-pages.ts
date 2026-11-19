/**
 * rest/auth-pages.ts – the endpoints behind the access-block pages.
 *
 *   GET  /auth/public-key  → the key the page encrypts with
 *   POST /auth/issue       → verify a block's login, then list its id
 *   POST /auth/revoke      → strike an id from the list (block in the body, or
 *                            as `Authorization: Bearer` — self-revocation, R2)
 *   POST /auth/revoke-all  → verify a login, then strike every id of that account
 *   POST /auth/ticket      → exchange an edu-sharing ticket for a ticket block
 *   POST /auth/session     → exchange the repository session cookie for a block (off by default)
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
import { exchangeSession, sessionCookiesFrom } from '../auth/session-exchange.js';
import { exchangeTicket } from '../auth/ticket-exchange.js';
import { sessionOriginAllowed, ticketOriginAllowed } from '../auth/ticket-origins.js';
import { revokeAllForBlock } from '../auth/access-revoke.js';
import { decodeAccessToken } from '../auth/access-token.js';
import { currentAccessSupport } from '../auth/credential.js';
import { log } from '../logger.js';
import type { ForwarderBudget } from '../client-budget.js';
import type { DistinctValueLimiter, RateLimiter } from '../rate-limit.js';
import { isJsonContentType, readBodyWithLimit } from '../read-body.js';
import { parseRequestUrl } from '../request-url.js';
import { sanitizeText } from '../text-sanitize.js';
import { WLO_REPOSITORY_URL } from '../wlo-config.js';
import { sendLoginFailure } from './login-failure.js';
import { germanRetryMessage, refuseRateLimited } from './rate-limited.js';
import { logAccount } from '../log-privacy.js';

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
  /**
   * `TICKET_ALLOWED_ORIGINS`: the browser origins that may exchange a ticket.
   * Absent = every origin (today's behaviour); EMPTY = no browser origin (a
   * configured list whose every entry was unusable); a request without
   * `Origin` is server-to-server and never refused (`auth/ticket-origins.ts`).
   */
  ticketAllowedOrigins?: ReadonlySet<string>;
  /**
   * `WLO_SESSION_EXCHANGE`: whether `POST /auth/session` exists. Off by
   * default — it only makes sense where this path is reachable on the
   * repository's host below `/edu-sharing` (the browser sends the session
   * cookie nowhere else): mounted there, or owned there by a trusted backend
   * that forwards the exchange (`trustedForwarder`). A server that reads
   * cookies should do so because its operator said so.
   */
  sessionExchange?: boolean;
  /**
   * `WLO_SESSION_ALLOWED_ORIGINS`, resolved: the page origins that may ask for
   * the session exchange. Absent = the repository's own origin
   * (`sessionOriginAllowed`). Its own
   * list, not the ticket one: listing a page for tickets must not entitle it
   * to take over sessions, and setting a list here must not narrow the ticket
   * path.
   */
  sessionAllowedOrigins?: ReadonlySet<string>;
  /**
   * Present when the request carries a trusted client's key
   * (`X-WLO-Client-Key`): a backend forwarding a person's session exchange or
   * logout. On `/auth/session` and `/auth/revoke` ONLY, it replaces the address
   * budget and the address bucket of the guessing guard (`ForwarderBudget`) —
   * every exchange of such a backend arrives from its one address, and a class
   * loading at once was refused there (chatbot team, 2026-11-15). The paths
   * that check a password keep the address, whoever forwards.
   */
  trustedForwarder?: ForwarderBudget;
}

interface AuthReq extends AsyncIterable<Buffer | Uint8Array> {
  method?: string;
  url?: string;
  /** `content-type` (the 415 below), `origin` on `/auth/ticket` and `/auth/session`, `authorization` on `/auth/revoke`, `cookie` on `/auth/session` ONLY. */
  headers?: Record<string, string | string[] | undefined>;
}
interface AuthRes {
  writeHead: (status: number, headers?: Record<string, string>) => void;
  end: (body?: string) => void;
  /** node:http sets this; the mocks in the tests do not, which reads as false. */
  headersSent?: boolean;
}

// `no-store`: a block, a public key and a refusal are answers to THIS request; the session path in
// particular runs through the repository's ingress, whose caches are not ours.
const JSON_HEADERS = { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };

/** Paths this module owns, with the single method each accepts. */
const ROUTES: Record<string, 'GET' | 'POST'> = {
  '/auth/public-key': 'GET',
  '/auth/issue': 'POST',
  '/auth/revoke': 'POST',
  '/auth/revoke-all': 'POST',
  '/auth/ticket': 'POST',
  '/auth/session': 'POST',
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
  // Off like an endpoint that does not exist — before the method, the budget
  // and above all before the cookie is looked at.
  if (parsed.pathname === '/auth/session' && !deps.sessionExchange) {
    return send(res, 404, { error: 'Die Übernahme einer WLO-Sitzung ist auf diesem Server nicht eingeschaltet.' });
  }

  if (req.method !== wanted) {
    res.writeHead(405, { ...JSON_HEADERS, Allow: wanted });
    res.end(JSON.stringify({ error: `Method not allowed. Use ${wanted}.` }));
    return true;
  }

  const forwarder = parsed.pathname === '/auth/session' || parsed.pathname === '/auth/revoke'
    ? deps.trustedForwarder : undefined;
  const budget = forwarder
    ? { limiter: forwarder.limiter, key: forwarder.key, kind: 'client' as const }
    : { limiter: deps.rateLimiter, key: deps.ip, kind: 'address' as const };
  if (budget.limiter.check(budget.key, Date.now())) {
    // The shared REST 429 (`code`, `retryAfter`, the rest of the window), with
    // the German text the pages show a person.
    refuseRateLimited(res, budget.limiter, budget.key, budget.kind, { shape: 'rest', message: germanRetryMessage });
    return true;
  }

  // A foreign page is refused before its body is read: the list is the
  // operator's statement of which pages embed the widget. AFTER the address
  // budget, on purpose — `Origin` is free to forge, and a refusal that cost
  // nothing would be an unbounded supply of warning lines.
  if (parsed.pathname === '/auth/ticket') {
    const raw = req.headers?.['origin'];
    const origin = Array.isArray(raw) ? raw[0] : raw;
    if (!ticketOriginAllowed(origin, deps.ticketAllowedOrigins)) {
      log.warn('ticket exchange from an origin not in TICKET_ALLOWED_ORIGINS refused', { origin: sanitizeText(origin ?? '') });
      return send(res, 403, { error: 'Diese Seite darf keine Anmeldung übernehmen.', code: 'origin_not_allowed' });
    }
  }

  // The session exchange answers a page of the REPOSITORY and nobody else: the
  // cookie comes along because this path is mounted on that host, so the page
  // that may ask is one of that host — or, when the operator set `WLO_SESSION_ALLOWED_ORIGINS`, one in that
  // list, which then replaces the host's origin. A browser names its origin on every POST; a request without one is
  // no browser, and no browser means no session of a person to take over.
  if (parsed.pathname === '/auth/session') {
    const raw = req.headers?.['origin'];
    const origin = Array.isArray(raw) ? raw[0] : raw;
    if (!sessionOriginAllowed(origin, deps.sessionAllowedOrigins, WLO_REPOSITORY_URL)) {
      log.warn('session exchange from a page that is not the repository refused', { origin: sanitizeText(origin ?? '') });
      return send(res, 403, { error: 'Diese Seite darf keine Anmeldung übernehmen.', code: 'origin_not_allowed' });
    }
  }

  if (parsed.pathname === '/auth/public-key') {
    return send(res, 200, { publicKey: support.keys.publicKeyPem });
  }

  // Self-revocation (plan 2026-11-07, R2): the block as `Authorization: Bearer`,
  // from the chatbot backend when a person logs out. Possession is the proof —
  // whoever holds the block may end it, which is no new right. Ahead of the 415
  // because it needs no body: the header alone makes the request
  // preflight-bound, and `/auth*` answers no foreign origin, so what the JSON
  // rule secures below is already secured here.
  const bearer = /^Bearer\s+(\S+)\s*$/i.exec(String(req.headers?.['authorization'] ?? ''))?.[1];
  if (parsed.pathname === '/auth/revoke' && bearer) {
    const payload = decodeAccessToken(bearer, support.keys);
    const revoked = payload ? await support.registry.remove(payload.jti) : false;
    if (payload) log.info('access block revoked', { label: logAccount(payload.u), revoked, via: 'bearer' });
    // One answer for unreadable, foreign, unlisted and already revoked: logging
    // out is idempotent, and telling the cases apart helps only someone who
    // does not hold the block.
    return send(res, 200, { revoked });
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

  if (parsed.pathname === '/auth/session') {
    // The ONE place on this server that reads a `Cookie` header, and it takes
    // two named cookies out of it (`upstream-auth.ts`). The body carries nothing.
    const cookie = req.headers?.['cookie'];
    const session = sessionCookiesFrom(cookie);
    if (!session) {
      // Two different session cookies are refused on purpose (cookie tossing);
      // if the repository host ever set a second one on another path, every
      // signed-in person would meet this — so it is told apart in the log,
      // without a value.
      if (typeof cookie === 'string' && (cookie.match(/(?:^|;)\s*JSESSIONID=/g) ?? []).length > 1) {
        log.warn('session exchange refused — the request carried more than one JSESSIONID');
      }
      return send(res, 400, { error: 'Es kam keine WLO-Sitzung mit. Bitte in WLO anmelden.' });
    }
    const limiter = deps.ticketAbuseLimiter ?? deps.authAbuseLimiter;
    // The one thing an operator must see from a forwarder: every person it
    // forwards now shares ONE bucket (a proxy dropped its X-Forwarded-For, or it
    // sent no X-WLO-Client-Address). The client's name only — no address.
    if (forwarder && !forwarder.named) {
      log.warn('session exchange from a trusted client that named no usable address — its people share one bucket', { client: forwarder.key });
    }
    const outcome = await exchangeSession(session, {
      ip: forwarder?.address ?? deps.ip, authAbuseLimiter: limiter, support,
      ...(forwarder ? { bucket: forwarder.abuseBucket } : {}),
    }, Date.now());
    if (!outcome.ok) return sendLoginFailure(res, outcome, limiter, deps.ip, forwarder?.abuseBucket);
    return send(res, 200, {
      ok: true,
      block: outcome.block,
      authority: outcome.authority,
      ...(outcome.displayName ? { displayName: outcome.displayName } : {}),
    });
  }

  if (parsed.pathname === '/auth/ticket') {
    const ticket = await readField(req, deps.maxBodyBytes, 'ticket');
    if (!ticket) return send(res, 400, { error: 'Es wurde kein Ticket übermittelt.' });
    // The ticket budget, falling back to the password one — see the field.
    const ticketLimiter = deps.ticketAbuseLimiter ?? deps.authAbuseLimiter;
    const outcome = await exchangeTicket(ticket, { ip: deps.ip, authAbuseLimiter: ticketLimiter, support }, Date.now());
    if (!outcome.ok) return sendLoginFailure(res, outcome, ticketLimiter, deps.ip);
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
    log.info('access block revoked', { label: logAccount(payload.u), revoked });
    // 200 either way: a different answer for an id we do not carry would be an
    // oracle for probing which ids exist.
    return send(res, 200, { revoked });
  }

  // Both remaining paths check a password, so both share the failure shape —
  // including a `Retry-After` from the distinct-login limiter's ten-minute
  // window, not from the per-request one above.
  const verifyDeps = { ip: deps.ip, authAbuseLimiter: deps.authAbuseLimiter, support };
  const now = Date.now();

  if (parsed.pathname === '/auth/revoke-all') {
    const outcome = await revokeAllForBlock(token, verifyDeps, now);
    if (!outcome.ok) return sendLoginFailure(res, outcome, deps.authAbuseLimiter, deps.ip);
    return send(res, 200, { revoked: outcome.revoked });
  }

  const outcome = await issueAccessBlock(token, verifyDeps, now);
  if (!outcome.ok) return sendLoginFailure(res, outcome, deps.authAbuseLimiter, deps.ip);
  return send(res, 200, { ok: true, label: outcome.label });
}

