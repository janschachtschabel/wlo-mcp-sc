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
  configuredServiceCredential,
  credentialFromHeader,
  isUnusableAuthorization,
  runAnonymous,
  runWithCredential,
} from './auth/credential.js';
import { resolveWriteMode, ALLOW_SERVICE_WRITES } from './services/write/credential-gate.js';
import { log } from './logger.js';
import type { DistinctValueLimiter, RateLimiter } from './rate-limit.js';
import { clientKey } from './rate-limit.js';
import { readBodyWithLimit } from './read-body.js';
import { parseRequestUrl } from './request-url.js';
import type { streamableHttpOptions } from './mcp-transport.js';
import { handleAuthEndpoint } from './rest/auth-pages.js';
import { handleRestRequest } from './rest/routes.js';
import { handleStaticRequest } from './rest/static.js';
import { widgetBuildIds } from './apps/resources.js';

export interface HttpAppOptions {
  /** Per-IP limiter for the MCP endpoint (RATE_LIMIT_RPM). */
  rateLimiter: RateLimiter;
  /** Tighter per-IP limiter for the public REST surface (API_RATE_LIMIT_RPM). */
  apiRateLimiter: RateLimiter;
  /** Cap on DISTINCT logins one IP may present (AUTH_CREDENTIAL_LIMIT). */
  authAbuseLimiter: DistinctValueLimiter;
  /** Max buffered request-body size in bytes (MAX_BODY_BYTES). */
  maxBodyBytes: number;
  /** Derive the client IP from X-Forwarded-For (TRUST_PROXY; see clientKey). */
  trustProxy: boolean;
  /** MCP response mode (JSON vs. real SSE), resolved once from MCP_SSE. */
  streamOptions: ReturnType<typeof streamableHttpOptions>;
}

/** Build the request handler `http.ts` mounts on its node:http server. */
export function createHttpRequestHandler(
  opts: HttpAppOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const { rateLimiter, apiRateLimiter, authAbuseLimiter, maxBodyBytes, trustProxy, streamOptions } = opts;

  // Everything this server exposes to the internet runs ANONYMOUS by default,
  // and the one branch that needs rights takes them deliberately (see the MCP
  // endpoint below). The reverse — elevated by default, opt out per surface —
  // is how the public REST layer silently inherited the service account: the
  // defect was in the default, not in the branch that forgot to opt out. With
  // this wrapper a surface added later is safe without anyone remembering.
  return async (req, res) => runAnonymous(() => handle(req, res));

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
    if (!path.startsWith('/auth')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id');
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
      res.end(JSON.stringify({ status: 'ok', server: 'wlo-mcp', version: '1.0.0', widgets: widgetBuildIds() }));
      return;
    }

    // Public read-only REST layer (/api/*). GET-only; the wildcard CORS headers
    // above already permit cross-origin GET. Rate-limited per client IP on its own
    // (tighter) bucket. handleRestRequest returns false for an unknown /api path,
    // which then falls through to the 404 below.
    if (path.startsWith('/api/')) {
      const ip = clientKey(req.headers['x-forwarded-for'], req.socket.remoteAddress, trustProxy);
      if (apiRateLimiter.check(ip, Date.now())) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
        res.end(JSON.stringify({ error: 'Rate limit exceeded. Retry after 60s.' }));
        return;
      }
      // Anonymous by construction — the handler-wide scope above covers this
      // surface, which has no authentication of its own.
      if (await handleRestRequest(req, res)) return;
    }

    // MCP endpoint – stateless: new server + transport per request
    if (req.method === 'POST' && (path === '/mcp' || path === '/')) {
      // Rate-limit per client IP BEFORE doing any work (cheap rejection). Health
      // and CORS preflight are intentionally exempt (handled above).
      const ip = clientKey(req.headers['x-forwarded-for'], req.socket.remoteAddress, trustProxy);
      if (rateLimiter.check(ip, Date.now())) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
        res.end(JSON.stringify({ error: 'Rate limit exceeded. Retry after 60s.' }));
        return;
      }

      // A user who configured their own WLO credentials in their AI host's
      // connector settings sends them here. Parsed once, up front, because the
      // abuse guard below must only weigh credentials we would actually forward.
      const userCred = credentialFromHeader(req.headers['authorization']);

      // That forwarding is what makes this endpoint usable as a relay for
      // guessing WLO logins from our address. Cap the number of DISTINCT logins
      // per client, not the request rate: a per-user client legitimately sends
      // its header on every call. A scheme we refuse (Bearer, Digest) never
      // leaves this server, so it is not a guessing attempt and costs nothing.
      if (userCred && authAbuseLimiter.check(ip, userCred.header, Date.now())) {
        log.warn('too many distinct credentials from one client', { ip });
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '600' });
        res.end(JSON.stringify({ error: 'Too many different logins from this address.' }));
        return;
      }

      // Read body, but bound it: an MCP JSON-RPC request is tiny, so cap the
      // buffered size to avoid a memory-exhaustion DoS from an oversized POST.
      // Overridable via MAX_BODY_BYTES; default 1 MB.
      const { tooLarge, text: bodyText } = await readBodyWithLimit(req, maxBodyBytes);
      if (tooLarge) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Request body exceeds ${maxBodyBytes} bytes` }));
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
        // Resolved before the server is built, because the tool list this
        // request sees depends on it: without an identity that may write, the
        // curation tools are not registered at all.
        server = createMcpServer(resolveWriteMode(effective, ALLOW_SERVICE_WRITES));
        const transport = new StreamableHTTPServerTransport({ ...streamOptions });
        await server.connect(transport);
        await (effective
          ? runWithCredential(effective, () => transport.handleRequest(req, res, body))
          : transport.handleRequest(req, res, body));
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
      maxBodyBytes,
      rateLimiter: apiRateLimiter,
      authAbuseLimiter,
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
