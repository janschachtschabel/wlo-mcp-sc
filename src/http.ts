/**
 * http.ts – HTTP server entry point (for Docker / self-hosted).
 * Implements MCP Streamable HTTP transport on POST /mcp.
 * Run: WLO_REPOSITORY_URL=https://redaktion.openeduhub.net/edu-sharing PORT=3000 \
 *        node dist/http.js
 *
 * This file only reads the environment, mounts the request handler from
 * http-app.ts (where the testable dispatch wiring lives), and listens.
 */

import './logger-stdout.js';
import { issuerDependsOnHostHeader } from './auth/oauth-metadata.js';
import http from 'node:http';
import { WLO_REPOSITORY_URL, resolvePositiveInt, resolveNonNegativeInt } from './wlo-api.js';
import { log } from './logger.js';
import { addressForLog } from './wlo-config.js';
import { exitOnUnusableRepositoryUrl, warnOnUnknownLogLevel } from './startup-check.js';
import { createDistinctValueLimiter, createRateLimiter } from './rate-limit.js';
import { streamableHttpOptions } from './mcp-transport.js';
import { createHttpRequestHandler } from './http-app.js';
import { createInternalHandler } from './rest/internal-port.js';
import { metricsTokenFrom, metricsTokenRejected } from './rest/metrics-route.js';
import { createClientBudgets, parseTrustedClientKeys, PROTOCOL_FACTOR } from './client-budget.js';
import { verifyConfiguredCredential } from './auth/identity.js';
import { resolveAccessSupport } from './auth/access-setup.js';
import { parseAllowedOrigins, resolveTicketOrigins } from './auth/ticket-origins.js';
import { startSkillRegistryCache } from './services/skill-registry-cache.js';
import { installGracefulShutdown, trackRequests } from './shutdown.js';
import { startReadinessProbe } from './services/upstream-readiness.js';
import { setAccessSupport } from './auth/credential.js';

const PORT = resolvePositiveInt(process.env['PORT'], 3000, 'PORT');
// Optional second listener for /health, /ready and /metrics only (`rest/internal-port.ts`). 0 = none.
const INTERNAL_PORT = resolveNonNegativeInt(process.env['INTERNAL_PORT'], 0, 'INTERNAL_PORT');

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
const MAX_BODY_BYTES = resolvePositiveInt(process.env['MAX_BODY_BYTES'], 4_194_304, 'MAX_BODY_BYTES');

// Per-IP request cap (fixed 60s window) for the MCP endpoint. One MCP call can
// fan out to ~40 upstream edu-sharing requests, so this proxy is an amplifier —
// the limit protects the (third-party) upstream from a runaway client. Set
// RATE_LIMIT_RPM=0 to disable (e.g. when a WAF / platform limiter sits in front).
const RATE_LIMIT_RPM = resolveNonNegativeInt(process.env['RATE_LIMIT_RPM'], 120, 'RATE_LIMIT_RPM');

// Separate, tighter per-IP cap for the public read-only REST surface (/api/*).
// One /api/search fans out to several upstream edu-sharing requests, so a
// stricter default (30/min) than the MCP endpoint protects the upstream from an
// anonymous public client. Set API_RATE_LIMIT_RPM=0 to disable (WAF in front).
const API_RATE_LIMIT_RPM =
  resolveNonNegativeInt(process.env['API_RATE_LIMIT_RPM'], 30, 'API_RATE_LIMIT_RPM');

// How many DISTINCT logins one client address may present within 10 minutes.
// A per-user client sends its Authorization header on every call, so the rate
// is irrelevant — but forwarding client-supplied credentials upstream makes
// this endpoint usable for guessing WLO logins from our address, and there the
// number of different logins is the giveaway. 10 leaves room for a shared
// office NAT; set 0 to disable.
const AUTH_CREDENTIAL_LIMIT =
  resolveNonNegativeInt(process.env['AUTH_CREDENTIAL_LIMIT'], 10, 'AUTH_CREDENTIAL_LIMIT');

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
const TICKET_CREDENTIAL_LIMIT =
  resolveNonNegativeInt(process.env['TICKET_CREDENTIAL_LIMIT'], 200, 'TICKET_CREDENTIAL_LIMIT');

// Which browser origins may exchange a ticket (plan 2026-11-07, R4). Unset = every
// origin, as before; a request without Origin (a server) is never refused. In
// production the same list as the chatbot's own CORS_ORIGINS. A list whose every
// entry is unusable closes the browser path instead of opening it.
const ticketOrigins = resolveTicketOrigins(process.env['TICKET_ALLOWED_ORIGINS']);
if (ticketOrigins.allRejected) {
  log.error('TICKET_ALLOWED_ORIGINS: no usable entry (need http(s) origins such as https://example.org) — '
    + 'NO browser origin may exchange a ticket until this is fixed', { entries: ticketOrigins.rejected });
} else if (ticketOrigins.rejected.length) {
  log.warn('TICKET_ALLOWED_ORIGINS: entries ignored (need http(s) origins, no wildcard)', {
    entries: ticketOrigins.rejected,
  });
}

// OAuth logins whose verified redirect target lies in one of these origins are an
// embedded widget's, and their block expires after 12 h (plan 2026-11-07, R1).
// Empty = no OAuth block expires — AI hosts are never affected by default.
const widgetOrigins = parseAllowedOrigins(process.env['WIDGET_OAUTH_ORIGINS']);
// No closed direction exists here: expiring every OAuth login would hit the AI
// hosts this list exists to spare. A list with nothing usable is an ERROR line.
if (widgetOrigins.rejected.length && widgetOrigins.origins.size === 0) {
  log.error('WIDGET_OAUTH_ORIGINS: no usable entry (need http(s) origins such as https://example.org) — '
    + 'widget logins do NOT expire until this is fixed', { entries: widgetOrigins.rejected });
} else if (widgetOrigins.rejected.length) {
  log.warn('WIDGET_OAUTH_ORIGINS: entries ignored (need http(s) origins, no wildcard)', {
    entries: widgetOrigins.rejected,
  });
}

// When true, derive the client IP from X-Forwarded-For (the rightmost,
// proxy-appended hop — see clientKey) instead of the socket address — required
// for correct per-client rate limiting behind a reverse proxy (nginx, …). Off by
// default because X-Forwarded-For must not be trusted when the server is directly
// exposed (no appending proxy → the whole header is client-controlled).
const TRUST_PROXY = /^(1|true|yes)$/i.test(process.env['TRUST_PROXY'] ?? '');

// MCP response mode, resolved once from the environment: JSON (default, maximal
// client compatibility) vs. real SSE streaming when MCP_SSE is truthy — the
// latter is required by ChatGPT developer mode on the self-hosted vServer, and
// the reverse proxy in front MUST NOT buffer the response (see docker-compose).
const streamOptions = streamableHttpOptions();

// Last-resort net: log an otherwise-unhandled rejection instead of letting Node's
// default terminate the server (the per-request try/catch in http-app.ts is the
// primary guard; this catches anything that escapes it).
process.on('unhandledRejection', (reason) => {
  log.error('unhandledRejection', {
    error: reason instanceof Error ? reason.message : String(reason),
  });
});

// How often the readiness probe asks the repository (ms); 0 = only on demand.
const READY_PROBE_MS = resolveNonNegativeInt(process.env['WLO_READY_PROBE_MS'], 30_000, 'WLO_READY_PROBE_MS');

// Trusted clients (plan 2026-11-07, S1): `name:rpm:key`, comma-separated. A
// chatbot backend is ONE address for all its users; with a key it is counted in
// its own bucket at its own rate. Refused entries are named, never their key.
const trustedClients = parseTrustedClientKeys(process.env['TRUSTED_CLIENT_KEYS']);
if (trustedClients.rejected.length) {
  log.warn('TRUSTED_CLIENT_KEYS: entries ignored (need name:rpm:key, rpm > 0, key >= 32 characters)', {
    names: trustedClients.rejected,
  });
}

warnOnUnknownLogLevel();
exitOnUnusableRepositoryUrl();

const metricsToken = metricsTokenFrom(process.env['METRICS_TOKEN']);
if (metricsTokenRejected(process.env['METRICS_TOKEN'])) {
  log.warn('METRICS_TOKEN is too short to be a secret (needs 16 characters) — /metrics stays off');
}

const requests = trackRequests(createHttpRequestHandler({
  rateLimiter: createRateLimiter(RATE_LIMIT_RPM),
  // Every POST, before its body is read: initialize and notifications never
  // reach edu-sharing, so they do not spend the tool budget — but they are not
  // free to flood the process either. RATE_LIMIT_RPM=0 switches both off.
  protocolLimiter: createRateLimiter(RATE_LIMIT_RPM * PROTOCOL_FACTOR),
  clientBudgets: createClientBudgets(trustedClients.clients),
  apiRateLimiter: createRateLimiter(API_RATE_LIMIT_RPM),
  authAbuseLimiter: createDistinctValueLimiter(AUTH_CREDENTIAL_LIMIT),
  ticketAbuseLimiter: createDistinctValueLimiter(TICKET_CREDENTIAL_LIMIT),
  ...(ticketOrigins.origins ? { ticketAllowedOrigins: ticketOrigins.origins } : {}),
  widgetOAuthOrigins: widgetOrigins.origins,
  maxBodyBytes: MAX_BODY_BYTES,
  trustProxy: TRUST_PROXY,
  streamOptions,
  // The origin the OAuth discovery documents name as their own. Read here and
  // passed in, like every other environment value: `auth/oauth-metadata.ts` is
  // pure so the decision it makes is testable, which this file is not.
  publicBaseUrl: process.env['WLO_PUBLIC_BASE_URL'],
  ...(metricsToken ? { metricsToken } : {}),
}));
const httpServer = http.createServer(requests.listener);

// Bound how long a client may take to SEND a request (slow-body / slow-header
// protection) — tiny MCP JSON-RPC bodies need only a fraction of this. These
// cover the inbound request only, so they do not cut off a long-lived SSE
// RESPONSE stream.
httpServer.requestTimeout = 30_000;
httpServer.headersTimeout = 15_000;

// A stop signal finishes the requests in hand instead of cutting them — and is
// answered at all: as PID 1 in the container Node ignores SIGTERM without a
// handler (audit 2026-11-12, B-1).
installGracefulShutdown({ server: httpServer, requests });

// Resolved BEFORE listening, not fire-and-forget like the credential probe
// below: the tool list and the /auth pages both depend on it, so a request
// arriving during the load would be answered as if the feature were off. It is
// one small local file, and a failure leaves the feature off with a loud log
// rather than stopping the server — anonymous and service-account traffic are
// unaffected by it either way.
setAccessSupport(await resolveAccessSupport({
  key: process.env['WLO_AUTH_PRIVATE_KEY'],
  previousKey: process.env['WLO_AUTH_PRIVATE_KEY_PREVIOUS'],
  registryPath: process.env['WLO_AUTH_REGISTRY_PATH'] ?? '/data/access-registry.json',
}));

// OAuth is on exactly when access blocks are. Then say where its address comes from.
if (process.env['WLO_AUTH_PRIVATE_KEY']?.trim()
  && issuerDependsOnHostHeader({ configured: process.env['WLO_PUBLIC_BASE_URL'], trustProxy: TRUST_PROXY })) {
  log.warn('WLO_PUBLIC_BASE_URL is not set: the OAuth address is taken from the Host header of each request. '
    + 'That is only right behind a proxy that sets the header itself — set WLO_PUBLIC_BASE_URL to pin it.');
}

if (INTERNAL_PORT && INTERNAL_PORT !== PORT) {
  const internal = http.createServer(createInternalHandler(metricsToken ? { metricsToken } : {}));
  internal.requestTimeout = 30_000;
  internal.headersTimeout = 15_000;
  // Never what keeps the process alive — and it keeps answering /health while
  // the public listener drains at shutdown, which is what a liveness probe wants.
  internal.unref();
  // Like any other unusable setting: stop. A process that serves the public
  // port while every probe and the scraper get "connection refused" looks
  // deployed and is not.
  internal.on('error', (err) => {
    log.error('INTERNAL_PORT could not be opened — not starting', { port: INTERNAL_PORT, error: err.message });
    process.exit(1);
  });
  internal.listen(INTERNAL_PORT, () => log.info('internal port listening', { port: INTERNAL_PORT, paths: ['/health', '/ready', '/metrics'] }));
} else if (INTERNAL_PORT) {
  log.warn('INTERNAL_PORT equals PORT — no second listener is opened; the three paths are on the public port anyway');
}

httpServer.listen(PORT, () => {
  log.info('WLO MCP Server listening', {
    url: `http://localhost:${PORT}/mcp`,
    repository: addressForLog(WLO_REPOSITORY_URL),
    rateLimitRpm: RATE_LIMIT_RPM,
    trustedClients: [...trustedClients.clients.values()].map(c => `${c.name}:${c.rpm}`),
    apiRateLimitRpm: API_RATE_LIMIT_RPM,
    authCredentialLimit: AUTH_CREDENTIAL_LIMIT,
    ticketCredentialLimit: TICKET_CREDENTIAL_LIMIT,
    maxBodyBytes: MAX_BODY_BYTES,
    mcpSseStreaming: !streamOptions.enableJsonResponse,
  });
  // Fire-and-forget: a configured service account is verified once and the
  // result logged. Not awaited — the server must accept requests immediately,
  // and a slow or unreachable repository must not delay or fail the boot.
  void verifyConfiguredCredential();
  // Same reasoning for the skill catalogue: it warms in the background and its
  // interval is unref'd, so a cold cache costs a caller the pointer line and
  // never a wait.
  startSkillRegistryCache();
  // Readiness (plan 2026-11-07, S5/S6): the first probe is the warm-up call after
  // a start, the periodic ones keep the connection and the search path warm and
  // feed GET /ready. One small search per interval; WLO_READY_PROBE_MS=0 = off.
  startReadinessProbe(READY_PROBE_MS);
});
