/**
 * http-options.ts – the HTTP handler's options, built from the environment.
 *
 * Split out of `http.ts` (audit 2026-11-14, T1) because that file listens on
 * import and so could be imported by no test: an auditor removed five security
 * options from it, hard-coded `trustProxy: true`, and the suite stayed green.
 * This module opens no socket and logs nothing — what the entry point should
 * SAY comes back as `notices`, so a test can read it — and
 * `tests/http-options.test.ts` pins each option to its variable.
 */

import type { HttpAppOptions } from './http-app.js';
import { parseAllowedOrigins, resolveTicketOrigins } from './auth/ticket-origins.js';
import { createClientBudgets, parseTrustedClientKeys, PROTOCOL_FACTOR, type TrustedClient } from './client-budget.js';
import { streamableHttpOptions } from './mcp-transport.js';
import { createDistinctValueLimiter, createRateLimiter } from './rate-limit.js';
import { metricsTokenFrom, metricsTokenRejected } from './rest/metrics-route.js';
import { resolveNonNegativeInt, resolvePositiveInt, WLO_REPOSITORY_URL } from './wlo-config.js';

/** A line the entry point logs at startup. */
export interface StartupNotice {
  level: 'warn' | 'error';
  message: string;
  fields?: Record<string, unknown>;
}

export interface HttpOptionsResult {
  options: HttpAppOptions;
  /** The resolved numbers, for the "listening" line. */
  settings: {
    rateLimitRpm: number;
    apiRateLimitRpm: number;
    authCredentialLimit: number;
    ticketCredentialLimit: number;
    maxBodyBytes: number;
    trustProxy: boolean;
  };
  trustedClients: ReadonlyMap<string, TrustedClient>;
  notices: StartupNotice[];
}

export function buildHttpOptions(env: NodeJS.ProcessEnv): HttpOptionsResult {
  const notices: StartupNotice[] = [];

  // Max buffered request-body size (bytes). MCP JSON-RPC requests are small;
  // this caps a memory-exhaustion DoS vector on the self-hosted HTTP path.
  // Bytes, not a human size: `1MB` is refused with a warning rather than read as
  // `1` — which would answer every request with 413 (see resolvePositiveInt).
  // Raised from 1 MB to 4 MB on 2026-08-06, deliberately and not as a side
  // effect: `wlo_create_content` now accepts an image as base64 inside the
  // JSON-RPC body (capped at 2 MB decoded, ~2.7 MB encoded), so the old limit
  // refused a call the tool is meant to serve — and refused it in the transport,
  // before the tool could say anything useful. This widens a memory-exhaustion
  // vector by the same factor; it is bounded, per request, and the operator can
  // set it back where uploads are not wanted.
  const maxBodyBytes = resolvePositiveInt(env['MAX_BODY_BYTES'], 4_194_304, 'MAX_BODY_BYTES');

  // Per-IP request cap (fixed 60s window) for the MCP endpoint. One MCP call can
  // fan out to ~40 upstream edu-sharing requests, so this proxy is an amplifier —
  // the limit protects the (third-party) upstream from a runaway client. Set
  // RATE_LIMIT_RPM=0 to disable (e.g. when a WAF / platform limiter sits in front).
  const rateLimitRpm = resolveNonNegativeInt(env['RATE_LIMIT_RPM'], 120, 'RATE_LIMIT_RPM');

  // Separate, tighter per-IP cap for the public read-only REST surface (/api/*).
  // One /api/search fans out to several upstream edu-sharing requests, so a
  // stricter default (30/min) than the MCP endpoint protects the upstream from an
  // anonymous public client. Set API_RATE_LIMIT_RPM=0 to disable (WAF in front).
  const apiRateLimitRpm = resolveNonNegativeInt(env['API_RATE_LIMIT_RPM'], 30, 'API_RATE_LIMIT_RPM');

  // How many DISTINCT logins one client address may present within 10 minutes.
  // A per-user client sends its Authorization header on every call, so the rate
  // is irrelevant — but forwarding client-supplied credentials upstream makes
  // this endpoint usable for guessing WLO logins from our address, and there the
  // number of different logins is the giveaway. 10 leaves room for a shared
  // office NAT; set 0 to disable.
  const authCredentialLimit = resolveNonNegativeInt(env['AUTH_CREDENTIAL_LIMIT'], 10, 'AUTH_CREDENTIAL_LIMIT');

  // The same guard for `/auth/ticket`, on its own budget and its own buckets.
  //
  // Twenty times the password budget, and the reason it may be that much higher is
  // what the endpoint's CORS carve-out already rests on: a ticket is machine-issued
  // and unguessable, so the number of DIFFERENT ones an address presents says
  // nothing about an attack — while the address is routinely shared, because an
  // embedded widget on a portal page puts a whole school behind one NAT address.
  // Ten refused the eleventh signed-in person of the day.
  //
  // 200 is deliberately not "unlimited": the bucket retains one digest per
  // distinct ticket for the whole ten-minute window, so this is what bounds that
  // state per address. Note it is the looser of the two bounds either way — the
  // per-address REQUEST limit (API_RATE_LIMIT_RPM, 30/min) already caps an address
  // at ~300 attempts in the same window, so this is a backstop, not the primary
  // guard. Set 0 to disable.
  const ticketCredentialLimit =
    resolveNonNegativeInt(env['TICKET_CREDENTIAL_LIMIT'], 200, 'TICKET_CREDENTIAL_LIMIT');

  // Which browser origins may exchange a ticket (plan 2026-11-07, R4). Unset = every
  // origin, as before; a request without Origin (a server) is never refused. In
  // production the same list as the chatbot's own CORS_ORIGINS. A list whose every
  // entry is unusable closes the browser path instead of opening it.
  const ticketOrigins = resolveTicketOrigins(env['TICKET_ALLOWED_ORIGINS']);
  if (ticketOrigins.allRejected) {
    notices.push({
      level: 'error',
      message: 'TICKET_ALLOWED_ORIGINS: no usable entry (need http(s) origins such as https://example.org) — '
        + 'NO browser origin may exchange a ticket until this is fixed',
      fields: { entries: ticketOrigins.rejected },
    });
  } else if (ticketOrigins.rejected.length) {
    notices.push({
      level: 'warn',
      message: 'TICKET_ALLOWED_ORIGINS: entries ignored (need http(s) origins, no wildcard)',
      fields: { entries: ticketOrigins.rejected },
    });
  }

  // `POST /auth/session` (2026-11-15): takes over the repository session of a
  // person whose browser sends the session cookie HERE — which it only does
  // when this server is mounted on the repository's host below `/edu-sharing`.
  // Off unless set; said at startup, because a server that reads cookies should
  // be seen to.
  const sessionExchange = /^(1|true|yes)$/i.test(env['WLO_SESSION_EXCHANGE'] ?? '');
  // Who may ask. Unset: the repository's own origin. A list whose every entry is
  // unusable closes the path (like the ticket list) instead of opening it.
  const sessionOrigins = resolveTicketOrigins(env['WLO_SESSION_ALLOWED_ORIGINS']);
  if (sessionExchange) {
    const repositoryOrigin = new URL(WLO_REPOSITORY_URL).origin;
    notices.push({
      level: 'warn',
      message: 'WLO_SESSION_EXCHANGE: POST /auth/session takes over a repository session — meant for a mount on the '
        + 'repository host below /edu-sharing. Only a page of the origins named here may ask; if the address in the '
        + 'browser differs, set WLO_SESSION_ALLOWED_ORIGINS. The requests arrive through the repository\'s ingress: '
        + 'TRUST_PROXY must fit that chain, or every person shares one address in the limiters',
      fields: { origins: sessionOrigins.origins ? [...sessionOrigins.origins] : [repositoryOrigin] },
    });
    if (sessionOrigins.rejected.length) {
      notices.push({
        level: sessionOrigins.allRejected ? 'error' : 'warn',
        message: 'WLO_SESSION_ALLOWED_ORIGINS: entries ignored (need http(s) origins, no wildcard)'
          + (sessionOrigins.allRejected ? ' — NO page may exchange a session until this is fixed' : ''),
        fields: { entries: sessionOrigins.rejected },
      });
    }
  } else if (sessionOrigins.origins || sessionOrigins.rejected.length) {
    notices.push({
      level: 'warn',
      message: 'WLO_SESSION_ALLOWED_ORIGINS is set but WLO_SESSION_EXCHANGE is not — POST /auth/session does not exist '
        + 'and the list has no effect',
    });
  }

  // OAuth logins whose verified redirect target lies in one of these origins are an
  // embedded widget's, and their block expires after 12 h (plan 2026-11-07, R1).
  // Empty = no OAuth block expires — AI hosts are never affected by default.
  const widgetOrigins = parseAllowedOrigins(env['WIDGET_OAUTH_ORIGINS']);
  // No closed direction exists here: expiring every OAuth login would hit the AI
  // hosts this list exists to spare. A list with nothing usable is an ERROR line.
  if (widgetOrigins.rejected.length && widgetOrigins.origins.size === 0) {
    notices.push({
      level: 'error',
      message: 'WIDGET_OAUTH_ORIGINS: no usable entry (need http(s) origins such as https://example.org) — '
        + 'widget logins do NOT expire until this is fixed',
      fields: { entries: widgetOrigins.rejected },
    });
  } else if (widgetOrigins.rejected.length) {
    notices.push({
      level: 'warn',
      message: 'WIDGET_OAUTH_ORIGINS: entries ignored (need http(s) origins, no wildcard)',
      fields: { entries: widgetOrigins.rejected },
    });
  }

  // When true, derive the client IP from X-Forwarded-For (the rightmost,
  // proxy-appended hop — see clientKey) instead of the socket address — required
  // for correct per-client rate limiting behind a reverse proxy (nginx, …). Off by
  // default because X-Forwarded-For must not be trusted when the server is directly
  // exposed (no appending proxy → the whole header is client-controlled).
  const trustProxy = /^(1|true|yes)$/i.test(env['TRUST_PROXY'] ?? '');

  // Trusted clients (plan 2026-11-07, S1): `name:rpm:key`, comma-separated. A
  // chatbot backend is ONE address for all its users; with a key it is counted in
  // its own bucket at its own rate. Refused entries are named, never their key.
  const trustedClients = parseTrustedClientKeys(env['TRUSTED_CLIENT_KEYS']);
  if (trustedClients.rejected.length) {
    notices.push({
      level: 'warn',
      message: 'TRUSTED_CLIENT_KEYS: entries ignored (need name:rpm:key, rpm > 0, key >= 32 characters)',
      fields: { names: trustedClients.rejected },
    });
  }

  const metricsToken = metricsTokenFrom(env['METRICS_TOKEN']);
  if (metricsTokenRejected(env['METRICS_TOKEN'])) {
    notices.push({
      level: 'warn',
      message: 'METRICS_TOKEN is too short to be a secret (needs 16 characters) — /metrics stays off',
    });
  }

  const options: HttpAppOptions = {
    rateLimiter: createRateLimiter(rateLimitRpm),
    // Every POST, before its body is read: initialize and notifications never
    // reach edu-sharing, so they do not spend the tool budget — but they are not
    // free to flood the process either. RATE_LIMIT_RPM=0 switches both off.
    protocolLimiter: createRateLimiter(rateLimitRpm * PROTOCOL_FACTOR),
    clientBudgets: createClientBudgets(trustedClients.clients),
    apiRateLimiter: createRateLimiter(apiRateLimitRpm),
    authAbuseLimiter: createDistinctValueLimiter(authCredentialLimit),
    ticketAbuseLimiter: createDistinctValueLimiter(ticketCredentialLimit),
    ...(ticketOrigins.origins ? { ticketAllowedOrigins: ticketOrigins.origins } : {}),
    ...(sessionExchange ? { sessionExchange } : {}),
    ...(sessionExchange && sessionOrigins.origins ? { sessionAllowedOrigins: sessionOrigins.origins } : {}),
    widgetOAuthOrigins: widgetOrigins.origins,
    maxBodyBytes,
    trustProxy,
    // MCP response mode: JSON (default, maximal client compatibility) vs. real
    // SSE streaming when MCP_SSE is truthy — the latter is required by ChatGPT
    // developer mode on the self-hosted vServer, and the reverse proxy in front
    // MUST NOT buffer the response (see docker-compose).
    streamOptions: streamableHttpOptions(env),
    // The origin the OAuth discovery documents name as their own. Read here and
    // passed in, like every other environment value: `auth/oauth-metadata.ts` is
    // pure so the decision it makes is testable.
    publicBaseUrl: env['WLO_PUBLIC_BASE_URL'],
    ...(metricsToken ? { metricsToken } : {}),
  };

  return {
    options,
    settings: { rateLimitRpm, apiRateLimitRpm, authCredentialLimit, ticketCredentialLimit, maxBodyBytes, trustProxy },
    trustedClients: trustedClients.clients,
    notices,
  };
}
