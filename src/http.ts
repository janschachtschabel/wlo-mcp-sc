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
import { WLO_REPOSITORY_URL } from './wlo-api.js';
import { log } from './logger.js';
import { createRateLimiter } from './rate-limit.js';
import { streamableHttpOptions } from './mcp-transport.js';
import { createHttpRequestHandler } from './http-app.js';

const PORT = Number(process.env['PORT'] ?? 3000);

// Max buffered request-body size (bytes). MCP JSON-RPC requests are small;
// this caps a memory-exhaustion DoS vector on the self-hosted HTTP path.
const MAX_BODY_BYTES = (() => {
  const v = parseInt(process.env['MAX_BODY_BYTES'] ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 1_048_576; // 1 MB
})();

// Per-IP request cap (fixed 60s window) for the MCP endpoint. One MCP call can
// fan out to ~40 upstream edu-sharing requests, so this proxy is an amplifier —
// the limit protects the (third-party) upstream from a runaway client. Set
// RATE_LIMIT_RPM=0 to disable (e.g. when a WAF / platform limiter sits in front).
const RATE_LIMIT_RPM = (() => {
  const v = parseInt(process.env['RATE_LIMIT_RPM'] ?? '', 10);
  return Number.isFinite(v) && v >= 0 ? v : 120;
})();

// Separate, tighter per-IP cap for the public read-only REST surface (/api/*).
// One /api/search fans out to several upstream edu-sharing requests, so a
// stricter default (30/min) than the MCP endpoint protects the upstream from an
// anonymous public client. Set API_RATE_LIMIT_RPM=0 to disable (WAF in front).
const API_RATE_LIMIT_RPM = (() => {
  const v = parseInt(process.env['API_RATE_LIMIT_RPM'] ?? '', 10);
  return Number.isFinite(v) && v >= 0 ? v : 30;
})();

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
  maxBodyBytes: MAX_BODY_BYTES,
  trustProxy: TRUST_PROXY,
  streamOptions,
}));

// Bound how long a client may take to SEND a request (slow-body / slow-header
// protection) — tiny MCP JSON-RPC bodies need only a fraction of this. These
// cover the inbound request only, so they do not cut off a long-lived SSE
// RESPONSE stream.
httpServer.requestTimeout = 30_000;
httpServer.headersTimeout = 15_000;

httpServer.listen(PORT, () => {
  log.info('WLO MCP Server listening', {
    url: `http://localhost:${PORT}/mcp`,
    repository: WLO_REPOSITORY_URL,
    rateLimitRpm: RATE_LIMIT_RPM,
    apiRateLimitRpm: API_RATE_LIMIT_RPM,
    maxBodyBytes: MAX_BODY_BYTES,
    mcpSseStreaming: !streamOptions.enableJsonResponse,
  });
});
