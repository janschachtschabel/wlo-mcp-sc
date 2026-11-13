/**
 * http-app.ts – the self-hosted HTTP request handler, extracted from http.ts
 * so the dispatch wiring (CORS/health/REST/MCP/429/413/400/405/404 order) is
 * testable: http.ts starts listening on import and therefore cannot be
 * imported from a test. http.ts stays the thin entry point that reads the
 * environment and mounts this handler.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './server.js';
import {
  abuseBucketKey,
  configuredServiceCredential,
  credentialFromHeader,
  isUnusableAuthorization,
  isUnusableBearer,
  runAnonymous,
  runWithCredential,
} from './auth/credential.js';
import { resolveWriteMode, ALLOW_SERVICE_WRITES } from './services/write/credential-gate.js';
import { ClientGoneError, runWithRequestSignal } from './request-scope.js';
import { requestIdFrom, runWithRequestId, traceFrom } from './request-id.js';
import { count } from './metrics.js';
import { METRICS_PATH, handleMetrics } from './rest/metrics-route.js';
import { log } from './logger.js';
import type { DistinctValueLimiter, RateLimiter } from './rate-limit.js';
import { clientKey } from './rate-limit.js';
import { CREDENTIAL_BODY_MAX_BYTES, readBodyWithLimit } from './read-body.js';
import { parseRequestUrl } from './request-url.js';
import type { streamableHttpOptions } from './mcp-transport.js';
import { createCodeStore } from './auth/oauth-codes.js';
import { bearerChallenge, resolveIssuer } from './auth/oauth-metadata.js';
import { ticketOriginAllowed } from './auth/ticket-origins.js';
import { handleAuthEndpoint } from './rest/auth-pages.js';
import { handleOAuthEndpoint } from './rest/oauth-pages.js';
import { handleRestRequest } from './rest/routes.js';
import { handleUploadRequest, UPLOAD_PATH, uploadTimeoutMs } from './rest/upload-route.js';
import { batchUploadEnabled, sharedUploadSlots } from './services/write/upload-slot.js';
import { handleStaticRequest } from './rest/static.js';
import { widgetBuildIds } from './apps/resources.js';
import { AUTH_STATUS_PATH, handleAuthStatus } from './rest/auth-status.js';
import { handleReady, READY_PATH } from './rest/ready.js';
import { refuseRateLimited, refuseTooManyLogins } from './rest/rate-limited.js';
import {
  budgetBucket, CLIENT_KEY_HEADER, countToolCalls, type ClientBudgets, type TrustedClient,
} from './client-budget.js';
import { SERVER_VERSION } from './version.js';

export interface HttpAppOptions {
  /**
   * Per-address TOOL budget of the MCP endpoint (RATE_LIMIT_RPM): counts each
   * `tools/call`, the only message that reaches edu-sharing. Also the OAuth
   * connector's budget.
   */
  rateLimiter: RateLimiter;
  /**
   * Per-address bound on EVERY POST to the MCP endpoint, checked before the body
   * is read (`PROTOCOL_FACTOR` × RATE_LIMIT_RPM in `http.ts`). Absent = no bound.
   */
  protocolLimiter?: RateLimiter;
  /** Trusted clients (`TRUSTED_CLIENT_KEYS`), each with its own two budgets. */
  clientBudgets?: ClientBudgets;
  /** Tighter per-IP limiter for the public REST surface (API_RATE_LIMIT_RPM). */
  apiRateLimiter: RateLimiter;
  /** Cap on DISTINCT logins one IP may present (AUTH_CREDENTIAL_LIMIT). */
  authAbuseLimiter: DistinctValueLimiter;
  /**
   * Cap on DISTINCT tickets one IP may exchange (TICKET_CREDENTIAL_LIMIT), on
   * its own bucket space. Higher than the password budget and separate from it —
   * the reasoning lives with the field in `rest/auth-pages.ts`. Absent falls
   * back to `authAbuseLimiter`, the tighter of the two.
   */
  ticketAbuseLimiter?: DistinctValueLimiter;
  /**
   * `TICKET_ALLOWED_ORIGINS` (plan 2026-11-07, R4). Present: `/auth/ticket`
   * refuses any other browser origin (403, `rest/auth-pages.ts`) AND its CORS
   * answer mirrors only a listed one, so a foreign browser already fails at the
   * preflight — an EMPTY set (configured, every entry unusable) admits none.
   * Absent: the wildcard, as before.
   */
  ticketAllowedOrigins?: ReadonlySet<string>;
  /** `METRICS_TOKEN`. Present: `GET /metrics` answers to this Bearer token. Absent: the path does not exist. */
  metricsToken?: string;
  /** `WIDGET_OAUTH_ORIGINS` (R1): OAuth logins redirecting there expire after 12 h — see `OAuthEndpointDeps`. */
  widgetOAuthOrigins?: ReadonlySet<string>;
  /** Max buffered request-body size in bytes (MAX_BODY_BYTES). */
  maxBodyBytes: number;
  /** Derive the client IP from X-Forwarded-For (TRUST_PROXY; see clientKey). */
  trustProxy: boolean;
  /**
   * `WLO_PUBLIC_BASE_URL` — this deployment's public origin, which the OAuth
   * discovery documents name as their own. Without it OAuth is only reachable
   * under TRUST_PROXY, and off otherwise (see `auth/oauth-metadata.ts`).
   */
  publicBaseUrl?: string;
  /** MCP response mode (JSON vs. real SSE), resolved once from MCP_SSE. */
  streamOptions: ReturnType<typeof streamableHttpOptions>;
}

/**
 * The longest JSON-RPC batch the MCP endpoint accepts.
 *
 * The SDK runs every element of an array body, with no bound, while the per-IP
 * limiter counts HTTP requests — so one POST under the 4 MiB body cap could
 * carry tens of thousands of searches (audit 2026-11-05, A-1; also the reachable
 * half of GHSA-f897-62hf-6gxq). Batches are kept rather than refused because the
 * 2025-03-26 protocol revision allows them; every element is charged to the
 * limiter, and this cap bounds the work one request can start.
 */
export const MAX_BATCH_LENGTH = 10;

/**
 * Paths where someone's WLO password is checked, and which therefore get no
 * CORS header at all. Over-inclusive on purpose: denying a cross-origin read to
 * a path that does not exist costs nothing, while the reverse is an oracle.
 *
 * `/auth/ticket` is the one carved-out exception, exact-match on purpose. Its
 * only real client is a chat widget on a FOREIGN origin (an edu-sharing page
 * that handed it the ticket of the person signed in there), so without CORS
 * the endpoint cannot serve its one purpose. And the reasoning that closes the
 * rest of `/auth*` does not carry over: what a page could make every visitor
 * present here is not a human-chosen password with guessable neighbours but a
 * repository-issued ticket — machine-made, high-entropy, worthless to
 * enumerate. Validating STOLEN tickets is not enabled by CORS either (a thief
 * can ask the repository directly), and the distinct-value limiter still
 * bounds attempts per address. `TICKET_ALLOWED_ORIGINS` narrows the carve-out
 * to the pages that embed the widget (see the CORS block in the handler).
 */
function isCredentialSurface(path: string): boolean {
  if (path === '/auth/ticket') return false;
  // MA-2: the upload slot carries a person's credential and is server-to-server only.
  if (path === UPLOAD_PATH) return true;
  return path.startsWith('/auth') || path.startsWith('/oauth/authorize');
}

const NO_CLIENTS: ReadonlyMap<string, TrustedClient> = new Map();

/** The request's own origin when the list allows it, else null (no CORS header). */
function listedOrigin(raw: string | string[] | undefined, allowed: ReadonlySet<string>): string | null {
  const origin = Array.isArray(raw) ? raw[0] : raw;
  return origin !== undefined && ticketOriginAllowed(origin, allowed) ? origin : null;
}

/** Build the request handler `http.ts` mounts on its node:http server. */
/**
 * A signal that aborts when the response's connection closes BEFORE the answer
 * was finished — the client hung up, or a proxy gave up on it. `close` also
 * fires after an ordinary answer; that is not an abort.
 */
export function clientGone(res: Pick<ServerResponse, 'once' | 'writableEnded' | 'destroyed'>): AbortSignal {
  const controller = new AbortController();
  // The listener is attached when the WORK begins — after the body was read and
  // the server connected. A client that hung up before that has already had its
  // `close`; `once` would then wait for an event that will not come again.
  if (res.destroyed && !res.writableEnded) controller.abort(new ClientGoneError());
  else res.once('close', () => { if (!res.writableEnded) controller.abort(new ClientGoneError()); });
  return controller.signal;
}

/**
 * The route a request counts under. A fixed, small set — the PATH itself is the
 * caller's text and would make the label set unbounded.
 */
export function routeClass(method: string | undefined, path: string | undefined): string {
  if (!path) return 'other';
  if (path === '/mcp' || (path === '/' && method === 'POST')) return 'mcp';
  if (path === '/health') return 'health';
  if (path === READY_PATH) return 'ready';
  if (path === METRICS_PATH) return 'metrics';
  if (path.startsWith('/api/')) return 'api';
  if (path === '/auth' || path.startsWith('/auth/') || path.startsWith('/auth-')) return 'auth';
  if (path.startsWith('/oauth/') || path.startsWith('/.well-known/')) return 'oauth';
  return 'other';
}

export function createHttpRequestHandler(
  opts: HttpAppOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const {
    rateLimiter, apiRateLimiter, authAbuseLimiter, ticketAbuseLimiter, ticketAllowedOrigins, widgetOAuthOrigins,
    maxBodyBytes, trustProxy, streamOptions, publicBaseUrl, protocolLimiter, clientBudgets, metricsToken,
  } = opts;

  // One store per process, held here rather than passed in: it takes no
  // configuration, and `/oauth/authorize` and `/oauth/token` must share the very
  // same instance or a code minted by one is unknown to the other.
  const codeStore = createCodeStore();

  // Everything this server exposes to the internet runs ANONYMOUS by default,
  // and the one branch that needs rights takes them deliberately (see the MCP
  // endpoint below). The reverse — elevated by default, opt out per surface —
  // is how the public REST layer silently inherited the service account: the
  // defect was in the default, not in the branch that forgot to opt out. With
  // this wrapper a surface added later is safe without anyone remembering.
  return async (req, res) => {
    // One id per request: answered as a header and carried by every log line
    // the request causes — the write it starts included (`request-id.ts`).
    const id = requestIdFrom(req.headers['x-request-id']);
    res.setHeader('X-Request-Id', id);
    // Counted when the response is over, by what it ended as. `close` without a
    // finished response is the client hanging up first.
    res.once('close', () => count('wlo_http_requests_total', {
      route: routeClass(req.method, parseRequestUrl(req.url)?.pathname),
      status: res.writableFinished ? String(res.statusCode) : 'aborted',
    }));
    return runWithRequestId(id, () => runAnonymous(() => handle(req, res)), traceFrom(req.headers));
  };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Dispatch on the PATH, never on the raw request target: `req.url` carries
    // the query string, so an exact comparison turned a configured endpoint with
    // any parameter appended into an unknown path. `rest/routes.ts` and
    // `rest/static.ts` parse the same way through the same helper, so all three
    // branches agree — including on what to do with a target that will not parse.
    //
    // node:http accepts targets the URL parser refuses (`//[` among them). Such
    // a target can match no route, so it is answered here rather than carried
    // further: passing the raw string down only moved the throw into the next
    // layer, where it escaped the handler and the caller got no answer at all.
    //
    // Parsed BEFORE the CORS headers below, because which headers this response
    // may carry depends on the path.
    const parsed = parseRequestUrl(req.url);
    if (!parsed) {
      log.warn('request target could not be parsed', { method: req.method });
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Malformed request target' }));
      return;
    }
    const path = parsed.pathname;

    // CORS, and the one surface that must not get it.
    //
    // `Authorization` is deliberately NOT advertised. The MCP endpoint forwards a
    // caller's credential to the WLO repository, which is why the abuse guard
    // below caps how many DISTINCT logins one client may present — and that cap
    // keys on the client address. Allowing the header cross-origin would let a
    // web page spend every visitor's address on a different guess and read the
    // outcome (a write-capable login yields a longer tool list), which is the
    // one way around the cap. CORS restrains browsers and nothing else, and no
    // browser is a client of that endpoint: AI-host connectors, curl and the
    // stdio bridge ignore it, and our own launcher fetches without credentials.
    //
    // `/auth*` gets NO CORS header at all, because there the credential travels
    // in the BODY and omitting one header would not close the same door:
    // `/auth/issue` checks a WLO password, so a wildcard origin lets a page make
    // every visitor guess from their own address — defeating the per-address cap
    // — and read which guess worked. The access-block pages are served from this
    // origin and fetch from it, so they need nothing here.
    //
    // `/oauth/authorize` joins that exception for exactly the same reason: from
    // P3 it checks a WLO password too. Excluded ALREADY, one package before that
    // endpoint exists, because the alternative is needing the exception at the
    // moment nobody is thinking about it any more. The rest of the OAuth surface
    // keeps the wildcard and needs it — the discovery documents are public and
    // secret-free, and clients fetch them cross-origin; `/oauth/register` and
    // `/oauth/token` carry no password and are useless without a code.
    //
    // `/auth/ticket` with `TICKET_ALLOWED_ORIGINS` set names the caller's origin
    // only when it is listed — the 403 in `rest/auth-pages.ts` is the rule, this
    // makes a foreign browser fail at the preflight instead of after the POST.
    if (!isCredentialSurface(path)) {
      const corsOrigin = path === '/auth/ticket' && ticketAllowedOrigins !== undefined
        ? listedOrigin(req.headers['origin'], ticketAllowedOrigins)
        : '*';
      if (corsOrigin !== '*') res.setHeader('Vary', 'Origin');
      if (corsOrigin) {
        res.setHeader('Access-Control-Allow-Origin', corsOrigin);
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id');
        res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id');
      }
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check — carries the widget build hashes as the DEPLOY FINGERPRINT
    // (content-addressed → changes with every widget/meta change), so whether
    // a fix is actually live is one curl instead of a byte-diff probe.
    if (req.method === 'GET' && path === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', server: 'wlo-mcp', version: SERVER_VERSION, widgets: widgetBuildIds() }));
      return;
    }

    // The operator's counters — only when a token is configured, only to it.
    if (req.method === 'GET' && path === METRICS_PATH && metricsToken) {
      handleMetrics(req, res, metricsToken);
      return;
    }

    // Readiness (plan 2026-11-07, S5): can the repository be reached? No budget —
    // the answer is cached and probed at most once per 30 s.
    if (req.method === 'GET' && path === READY_PATH) {
      await handleReady(res);
      return;
    }

    // Login status in one request (S4), with the credential rules of /mcp. Under
    // /auth*, so it carries no CORS header; spends the protocol budget.
    if (req.method === 'GET' && path === AUTH_STATUS_PATH) {
      const ip = clientKey(req.headers['x-forwarded-for'], req.socket.remoteAddress, trustProxy);
      const bucket = budgetBucket(req.headers[CLIENT_KEY_HEADER], ip, clientBudgets?.clients ?? NO_CLIENTS);
      const protocolBudget = bucket.kind === 'client' ? clientBudgets?.protocol(bucket.key) : protocolLimiter;
      await handleAuthStatus(req, res, {
        ip, bucket, authAbuseLimiter,
        ...(protocolBudget ? { protocolBudget } : {}),
        challenge: () => bearerChallenge(resolveIssuer({
          configured: publicBaseUrl, host: req.headers['host'], forwardedProto: req.headers['x-forwarded-proto'], trustProxy,
        })),
      });
      return;
    }

    // MA-2: one file of a batch into an upload slot (POST, personal credential, in memory). Off
    // unless WLO_BATCH_UPLOAD_ENABLED; then a 404 like any unknown path. Not on the per-IP REST
    // bucket: the caller is the chatbot backend, one address for all its users — the slot table
    // caps per identity and in total instead. It DOES spend the protocol budget, before the login
    // is looked at: a trusted client's own (`X-WLO-Client-Key`), else the address's (S-4).
    if (path === UPLOAD_PATH && batchUploadEnabled()) {
      const ip = clientKey(req.headers['x-forwarded-for'], req.socket.remoteAddress, trustProxy);
      const bucket = budgetBucket(req.headers[CLIENT_KEY_HEADER], ip, clientBudgets?.clients ?? NO_CLIENTS);
      const limiter = bucket.kind === 'client' ? clientBudgets?.protocol(bucket.key) : protocolLimiter;
      if (await handleUploadRequest(req, res, { slots: sharedUploadSlots(), timeoutMs: uploadTimeoutMs(),
        ip, authAbuseLimiter, ...(limiter ? { requestBudget: { limiter, key: bucket.key } } : {}) })) {
        return;
      }
    }

    // Public read-only REST layer (/api/*). GET-only; the wildcard CORS headers
    // above already permit cross-origin GET. Rate-limited per client IP on its own
    // (tighter) bucket. handleRestRequest returns false for an unknown /api path,
    // which then falls through to the 404 below.
    if (path.startsWith('/api/')) {
      const ip = clientKey(req.headers['x-forwarded-for'], req.socket.remoteAddress, trustProxy);
      if (apiRateLimiter.check(ip, Date.now())) {
        // REST, not JSON-RPC: the old `error` text stays, beside a code and the
        // exact wait (chatbot S2 — a flat 60 told clients to wait too long).
        refuseRateLimited(res, apiRateLimiter, ip, 'address', { shape: 'rest' });
        return;
      }
      // Anonymous by construction — the handler-wide scope above covers this
      // surface, which has no authentication of its own.
      if (await runWithRequestSignal(clientGone(res), () => handleRestRequest(req, res))) return;
    }

    // MCP endpoint – stateless: new server + transport per request
    if (req.method === 'POST' && (path === '/mcp' || path === '/')) {
      // Two budgets (plan 2026-11-07, S1). Which bucket: a trusted client's own
      // (X-WLO-Client-Key), else the address. The PROTOCOL budget bounds every
      // POST and is checked here, before any work (cheap rejection); the TOOL
      // budget counts only `tools/call` and needs the parsed body, see below.
      // Health and CORS preflight are exempt (handled above).
      const ip = clientKey(req.headers['x-forwarded-for'], req.socket.remoteAddress, trustProxy);
      const bucket = budgetBucket(req.headers[CLIENT_KEY_HEADER], ip, clientBudgets?.clients ?? NO_CLIENTS);
      const toolBudget = bucket.kind === 'client' ? clientBudgets?.tool(bucket.key) ?? rateLimiter : rateLimiter;
      const protocolBudget = bucket.kind === 'client' ? clientBudgets?.protocol(bucket.key) : protocolLimiter;
      if (protocolBudget?.check(bucket.key, Date.now())) {
        refuseRateLimited(res, protocolBudget, bucket.key, bucket.kind);
        return;
      }

      // A user who configured their own WLO credentials in their AI host's
      // connector settings sends them here. Parsed once, up front, because the
      // abuse guard below must only weigh credentials we would actually forward.
      const userCred = credentialFromHeader(req.headers['authorization']);

      // A Bearer we were GIVEN and cannot open is the one case that earns a 401,
      // and it is the doorway the MCP specification prescribes into OAuth
      // discovery: the `resource_metadata` pointer tells the client where to
      // read who may authorize it.
      //
      // Narrow on purpose. A request with NO header keeps answering 200 with the
      // public tools — that is requirement number one and the property this
      // whole undertaking most easily breaks. A `Basic` header we cannot parse
      // also keeps degrading to anonymous below: that is a WLO login the caller
      // got wrong, not a token of ours, and an authorization flow would answer a
      // question they did not ask. A REVOKED block, by contrast, lands here and
      // should — "fetch a new one" is exactly the right answer, and the 401 is
      // how a client learns where.
      //
      // Before the body is read (cheap rejection) and before the abuse limiter,
      // which deliberately weighs only credentials we would forward upstream —
      // a Bearer never leaves this server.
      if (!userCred && isUnusableBearer(req.headers['authorization'])) {
        log.info('unusable bearer token — answering 401 with the discovery pointer', { ip });
        res.writeHead(401, {
          'Content-Type': 'application/json',
          'WWW-Authenticate': bearerChallenge(resolveIssuer({
            configured: publicBaseUrl,
            host: req.headers['host'],
            forwardedProto: req.headers['x-forwarded-proto'],
            trustProxy,
          })),
        });
        res.end(JSON.stringify({ error: 'The access token is invalid or has been revoked.' }));
        return;
      }

      // That forwarding is what makes this endpoint usable as a relay for
      // guessing WLO logins from our address. Cap the number of DISTINCT logins,
      // not the request rate: a per-user client legitimately sends its header on
      // every call. A scheme we refuse (Bearer, Digest) never leaves this server,
      // so it is not a guessing attempt and costs nothing.
      //
      // WHICH bucket is `abuseBucketKey`'s decision, and it is not the address
      // for every scheme — see there. Keying a block by address refused a relay
      // client at its 11th signed-in person while letting a guesser who had
      // learned a `jti` multiply their budget by rotating addresses.
      const abuseBucket = userCred ? abuseBucketKey(userCred, ip) : '';
      if (userCred && authAbuseLimiter.check(abuseBucket, userCred.header, Date.now())) {
        // The same JSON-RPC shape as the request budget's 429 (review
        // 2026-11-07): a JSON-RPC client read the old free text as a network
        // failure.
        refuseTooManyLogins(res, authAbuseLimiter, { bucket: abuseBucket, perBlock: Boolean(userCred.jti), ip });
        return;
      }

      // Read body, but bound it: an MCP JSON-RPC request is tiny, so cap the
      // buffered size to avoid a memory-exhaustion DoS from an oversized POST.
      // The bound is handed in — the entry point resolves `MAX_BODY_BYTES`
      // (4 MiB by default, see `http.ts`); there is no fallback here.
      const { tooLarge, text: bodyText } = await readBodyWithLimit(req, maxBodyBytes);
      if (tooLarge) {
        // Names the likely cause and the way out. This fires in the TRANSPORT,
        // before any tool runs, so nothing else can explain it — and since
        // `wlo_create_content` takes a base64 image, the caller hitting this is
        // usually a model that has just been handed a file too big for the
        // limit. A bare "exceeds N bytes" left it with nothing to do next.
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: `Request body exceeds ${maxBodyBytes} bytes. If this was a file upload, the file is too `
            + 'large for this server — use a smaller one, or ask the operator to raise MAX_BODY_BYTES.',
        }));
        return;
      }

      let body: unknown;
      try {
        body = bodyText ? JSON.parse(bodyText) : undefined;
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        return;
      }

      // Bounded first, so an oversized batch cannot even spend the budget.
      if (Array.isArray(body) && body.length > MAX_BATCH_LENGTH) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `JSON-RPC batch exceeds ${MAX_BATCH_LENGTH} messages.` }));
        return;
      }
      // The tool budget: one unit per `tools/call`, each element of a batch on
      // its own (audit 2026-11-05: a batch is not one request's worth of work).
      {
        const now = Date.now();
        let limited = false;
        for (let i = countToolCalls(body); i > 0; i--) {
          if (toolBudget.check(bucket.key, now)) limited = true;
        }
        if (limited) {
          refuseRateLimited(res, toolBudget, bucket.key, bucket.kind);
          return;
        }
      }

      // Normalize Accept so ANY client works (incl. simple JSON-only clients like
      // curl or some IDE integrations). The MCP SDK hard-requires BOTH
      // application/json AND text/event-stream on POST (→ 406 otherwise); forcing
      // both is harmless in either response mode (JSON returns one body; a real
      // SSE client already accepts both). NOTE: @hono/node-server builds the Web
      // Request from `rawHeaders` (not the parsed `headers` object), so we patch
      // rawHeaders.
      {
        const WANT = 'application/json, text/event-stream';
        const rh = req.rawHeaders;
        let patched = false;
        for (let i = 0; i < rh.length; i += 2) {
          if (rh[i]?.toLowerCase() === 'accept') { rh[i + 1] = WANT; patched = true; }
        }
        if (!patched) rh.push('Accept', WANT);
        req.headers['accept'] = WANT;
      }

      // Error boundary: without it, a throw inside connect/handleRequest becomes an
      // unhandled rejection — which crashes the process under Node's default — and
      // leaves the client hanging with no response. Emit a generic 500 and always
      // close the per-request server.
      let server: ReturnType<typeof createMcpServer> | undefined;
      try {
        // The credential chain, resolved HERE rather than by a fallback, so it
        // applies to this endpoint and nothing else: the caller's own login
        // first, then the configured service account, then nobody. Scoped to
        // THIS request — one endpoint serves everyone, so an identity must
        // never outlive the call that carried it.
        //
        // A header we could not use is NOT the same as no header: that caller
        // asked to act as themselves, so they may not silently borrow the
        // shared account's rights (nor write under a name that attributes the
        // change to nobody). Anonymous keeps the request working and the rights
        // honest — the handler-wide runAnonymous scope already holds it.
        const unusable = !userCred && isUnusableAuthorization(req.headers['authorization']);
        if (unusable) {
          log.warn('Authorization header could not be used — serving this request anonymously', { ip });
        }
        const effective = userCred ?? (unusable ? null : configuredServiceCredential());
        // Not a gate any more — every request gets the same tool list, and a
        // curation tool refuses at call time (server.ts). Kept because the log
        // line below is the one place that says which rights a call was served
        // with, and that is what a live investigation reads.
        const writeMode = resolveWriteMode(effective, ALLOW_SERVICE_WRITES);
        // One line per request, naming the method and the SURFACE it was served.
        // Added 2026-08-05 after a day of live debugging: the log could say
        // "nobody called us" — which twice ruled out this server in one step —
        // but never "somebody called us, and this is the tool list they got".
        // Deliberately no label and no params: the question is which surface,
        // not who read what.
        log.info('mcp request', {
          method: typeof (body as { method?: unknown } | undefined)?.method === 'string'
            ? (body as { method: string }).method
            : 'unknown',
          mode: writeMode,
        });
        server = createMcpServer({
          issuer: resolveIssuer({
            configured: publicBaseUrl,
            host: req.headers['host'],
            forwardedProto: req.headers['x-forwarded-proto'],
            trustProxy,
          }),
        });
        const transport = new StreamableHTTPServerTransport({ ...streamOptions });
        await server.connect(transport);
        // Work for a client that hung up is stopped (request-scope.ts); writes
        // detach themselves from this scope in `registerCurationTool`.
        const handle = () => runWithRequestSignal(clientGone(res), () => transport.handleRequest(req, res, body));
        await (effective ? runWithCredential(effective, handle) : handle());
      } catch (err) {
        log.error('MCP request handling failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      } finally {
        if (server) await server.close().catch(() => { /* already closing */ });
      }
      return;
    }

    // Wrong method on the MCP endpoint → 405, not a 404 fall-through: the path
    // exists, the method does not. `GET /` is the launcher, so only `/mcp` is
    // gated here.
    if (path === '/mcp') {
      res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': 'POST' });
      res.end(JSON.stringify({ error: 'Method not allowed. Use POST.' }));
      return;
    }

    // Access-block endpoints (issue / revoke / public key). Before the static
    // branch because both live under /auth*, and this one owns the three paths
    // with a method and a body; it returns false for anything else, so the
    // PAGES (/auth, /auth.html, …) fall through to the static map below.
    //
    // Deliberately inside the handler-wide anonymous scope: nothing here runs
    // with the service account. Issuance opens its own credential scope for the
    // single call that verifies the user's login, and nothing else.
    if (await handleAuthEndpoint(req, res, {
      ip: clientKey(req.headers['x-forwarded-for'], req.socket.remoteAddress, trustProxy),
      maxBodyBytes: Math.min(maxBodyBytes, CREDENTIAL_BODY_MAX_BYTES),
      rateLimiter: apiRateLimiter,
      authAbuseLimiter,
      ...(ticketAbuseLimiter ? { ticketAbuseLimiter } : {}),
      ...(ticketAllowedOrigins ? { ticketAllowedOrigins } : {}),
    })) return;

    // OAuth surface (discovery in P1; register/authorize/token follow). Like the
    // access-block endpoints it returns false for a path it does not own, and it
    // answers 404 — not 500 — when the feature is not configured.
    //
    // The issuer is resolved per request rather than once at startup because the
    // fallback reads this request's headers; the configured value, when set,
    // makes that a constant anyway.
    if (await handleOAuthEndpoint(req, res, {
      ip: clientKey(req.headers['x-forwarded-for'], req.socket.remoteAddress, trustProxy),
      maxBodyBytes: Math.min(maxBodyBytes, CREDENTIAL_BODY_MAX_BYTES),
      // The consent surface shares the tight `/auth*` bucket — a password is
      // typed there. The connector's own steps get the same budget the MCP
      // endpoint gives that same client; see `OAuthEndpointDeps`.
      authorizeRateLimiter: apiRateLimiter,
      connectorRateLimiter: rateLimiter,
      authAbuseLimiter,
      codeStore,
      ...(widgetOAuthOrigins ? { widgetOAuthOrigins } : {}),
      issuer: resolveIssuer({
        configured: publicBaseUrl,
        host: req.headers['host'],
        forwardedProto: req.headers['x-forwarded-proto'],
        trustProxy,
      }),
    })) return;

    // Static prompt launcher (public, GET-only). Placed AFTER the MCP branch so
    // `POST /` stays the MCP endpoint; `GET /` and `GET /launcher.html` serve the
    // launcher. handleStaticRequest returns false for a path it doesn't own, so an
    // unrelated path falls through to the 404 below.
    if (await handleStaticRequest(req, res)) return;

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found. Use POST /mcp' }));
  };
}
