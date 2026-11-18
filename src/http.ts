/**
 * http.ts – HTTP server entry point (for Docker / self-hosted).
 * Implements MCP Streamable HTTP transport on POST /mcp.
 * Run: WLO_REPOSITORY_URL=https://redaktion.openeduhub.net/edu-sharing PORT=3000 \
 *        node dist/http.js
 *
 * This file only mounts the request handler from http-app.ts (where the
 * testable dispatch wiring lives) with the options http-options.ts builds from
 * the environment (where the testable CONFIGURATION lives), and listens. It
 * listens on import, so no test can import it — which is why neither decision
 * may be made here.
 */

import './logger-stdout.js';
import { issuerDependsOnHostHeader } from './auth/oauth-metadata.js';
import http from 'node:http';
import { WLO_REPOSITORY_URL, resolvePositiveInt, resolveNonNegativeInt } from './wlo-api.js';
import { log } from './logger.js';
import { addressForLog } from './wlo-config.js';
import { exitOnUnusableRepositoryUrl, warnOnDefaultRepository, warnOnUnknownLogLevel } from './startup-check.js';
import { createHttpRequestHandler } from './http-app.js';
import { buildHttpOptions } from './http-options.js';
import { createInternalHandler, internalPortExposure, resolveInternalBind } from './rest/internal-port.js';
import { verifyConfiguredCredential } from './auth/identity.js';
import { resolveAccessSupport } from './auth/access-setup.js';
import { startSkillRegistryCache } from './services/skill-registry-cache.js';
import { installGracefulShutdown, trackRequests } from './shutdown.js';
import { startReadinessProbe } from './services/upstream-readiness.js';
import { startBapiProxyDetection } from './services/bapi/proxy-switch.js';
import { setAccessSupport } from './auth/credential.js';

const PORT = resolvePositiveInt(process.env['PORT'], 3000, 'PORT');
// Optional second listener for /health, /ready and /metrics only (`rest/internal-port.ts`). 0 = none.
const INTERNAL_PORT = resolveNonNegativeInt(process.env['INTERNAL_PORT'], 0, 'INTERNAL_PORT');
// The interface that listener binds. Unset = every interface, as before.
const INTERNAL_BIND_ADDR = resolveInternalBind(process.env['INTERNAL_BIND_ADDR']);

// Budgets, limiters, allowed origins, the metrics token, TRUST_PROXY: all of it
// is decided in `buildHttpOptions`, which a test can call. What it has to say
// about the configuration comes back as notices.
const { options, settings, trustedClients, notices } = buildHttpOptions(process.env);
for (const notice of notices) log[notice.level](notice.message, notice.fields);

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

warnOnUnknownLogLevel();
exitOnUnusableRepositoryUrl();
warnOnDefaultRepository();

const requests = trackRequests(createHttpRequestHandler(options));
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
  && issuerDependsOnHostHeader({ configured: process.env['WLO_PUBLIC_BASE_URL'], trustProxy: settings.trustProxy })) {
  log.warn('WLO_PUBLIC_BASE_URL is not set: the OAuth address is taken from the Host header of each request. '
    + 'That is only right behind a proxy that sets the header itself — set WLO_PUBLIC_BASE_URL to pin it.');
}

if (INTERNAL_PORT && INTERNAL_PORT !== PORT) {
  const { metricsToken } = options;
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
  const exposure = internalPortExposure({
    ...(INTERNAL_BIND_ADDR ? { bindAddr: INTERNAL_BIND_ADDR } : {}),
    ...(metricsToken ? { metricsToken } : {}),
  });
  if (exposure) log.warn(exposure, { port: INTERNAL_PORT });
  const listening = () => log.info('internal port listening', {
    port: INTERNAL_PORT, ...(INTERNAL_BIND_ADDR ? { bind: INTERNAL_BIND_ADDR } : {}), paths: ['/health', '/ready', '/metrics'],
  });
  // Two calls, not one with `undefined`: an absent host is what binds every interface.
  if (INTERNAL_BIND_ADDR) internal.listen(INTERNAL_PORT, INTERNAL_BIND_ADDR, listening);
  else internal.listen(INTERNAL_PORT, listening);
} else if (INTERNAL_PORT) {
  log.warn('INTERNAL_PORT equals PORT — no second listener is opened; the three paths are on the public port anyway');
}

httpServer.listen(PORT, () => {
  log.info('WLO MCP Server listening', {
    url: `http://localhost:${PORT}/mcp`,
    repository: addressForLog(WLO_REPOSITORY_URL),
    rateLimitRpm: settings.rateLimitRpm,
    trustedClients: [...trustedClients.values()].map(c => `${c.name}:${c.rpm}`),
    apiRateLimitRpm: settings.apiRateLimitRpm,
    authCredentialLimit: settings.authCredentialLimit,
    ticketCredentialLimit: settings.ticketCredentialLimit,
    maxBodyBytes: settings.maxBodyBytes,
    mcpSseStreaming: !options.streamOptions.enableJsonResponse,
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
  // The b-api flow tools: unless the operator decided (WLO_BAPI_VIA_REPOSITORY),
  // one anonymous question to the repository whether its b-api proxy answers.
  // The tool list is built per request: requests before the answer list no flow tools; later ones do.
  void startBapiProxyDetection();
});
