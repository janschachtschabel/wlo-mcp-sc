/**
 * http.ts – HTTP server entry point (for Docker / self-hosted).
 * Implements MCP Streamable HTTP transport on POST /mcp.
 * Run: WLO_REPOSITORY_URL=https://redaktion.openeduhub.net/edu-sharing PORT=3000 \
 *        node dist/http.js
 *
 * This file only reads the environment, mounts the request handler from
 * http-app.ts (where the testable dispatch wiring lives), and listens.
 */

import http from 'node:http';
import { WLO_REPOSITORY_URL, resolvePositiveInt, resolveNonNegativeInt } from './wlo-api.js';
import { log } from './logger.js';
import { createDistinctValueLimiter, createRateLimiter } from './rate-limit.js';
import { streamableHttpOptions } from './mcp-transport.js';
import { createHttpRequestHandler } from './http-app.js';
import { verifyConfiguredCredential } from './auth/identity.js';
import { resolveAccessSupport } from './auth/access-setup.js';
import { setAccessSupport } from './auth/credential.js';

const PORT = resolvePositiveInt(process.env['PORT'], 3000, 'PORT');

// Max buffered request-body size (bytes). MCP JSON-RPC requests are small;
// this caps a memory-exhaustion DoS vector on the self-hosted HTTP path.
// Bytes, not a human size: `1MB` is refused with a warning rather than read as
// `1` — which would answer every request with 413 (see resolvePositiveInt).
const MAX_BODY_BYTES = resolvePositiveInt(process.env['MAX_BODY_BYTES'], 1_048_576, 'MAX_BODY_BYTES');

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

const httpServer = http.createServer(createHttpRequestHandler({
  rateLimiter: createRateLimiter(RATE_LIMIT_RPM),
  apiRateLimiter: createRateLimiter(API_RATE_LIMIT_RPM),
  authAbuseLimiter: createDistinctValueLimiter(AUTH_CREDENTIAL_LIMIT),
  maxBodyBytes: MAX_BODY_BYTES,
  trustProxy: TRUST_PROXY,
  streamOptions,
  // The origin the OAuth discovery documents name as their own. Read here and
  // passed in, like every other environment value: `auth/oauth-metadata.ts` is
  // pure so the decision it makes is testable, which this file is not.
  publicBaseUrl: process.env['WLO_PUBLIC_BASE_URL'],
}));

// Bound how long a client may take to SEND a request (slow-body / slow-header
// protection) — tiny MCP JSON-RPC bodies need only a fraction of this. These
// cover the inbound request only, so they do not cut off a long-lived SSE
// RESPONSE stream.
httpServer.requestTimeout = 30_000;
httpServer.headersTimeout = 15_000;

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

httpServer.listen(PORT, () => {
  log.info('WLO MCP Server listening', {
    url: `http://localhost:${PORT}/mcp`,
    repository: WLO_REPOSITORY_URL,
    rateLimitRpm: RATE_LIMIT_RPM,
    apiRateLimitRpm: API_RATE_LIMIT_RPM,
    authCredentialLimit: AUTH_CREDENTIAL_LIMIT,
    maxBodyBytes: MAX_BODY_BYTES,
    mcpSseStreaming: !streamOptions.enableJsonResponse,
  });
  // Fire-and-forget: a configured service account is verified once and the
  // result logged. Not awaited — the server must accept requests immediately,
  // and a slow or unreachable repository must not delay or fail the boot.
  void verifyConfiguredCredential();
});
