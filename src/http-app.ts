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
import { log } from './logger.js';
import type { RateLimiter } from './rate-limit.js';
import { clientKey } from './rate-limit.js';
import { readBodyWithLimit } from './read-body.js';
import type { streamableHttpOptions } from './mcp-transport.js';
import { handleRestRequest } from './rest/routes.js';
import { handleStaticRequest } from './rest/static.js';

export interface HttpAppOptions {
  /** Per-IP limiter for the MCP endpoint (RATE_LIMIT_RPM). */
  rateLimiter: RateLimiter;
  /** Tighter per-IP limiter for the public REST surface (API_RATE_LIMIT_RPM). */
  apiRateLimiter: RateLimiter;
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
  const { rateLimiter, apiRateLimiter, maxBodyBytes, trustProxy, streamOptions } = opts;

  return async (req, res) => {
    // CORS preflight
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', server: 'wlo-mcp', version: '1.0.0' }));
      return;
    }

    // Public read-only REST layer (/api/*). GET-only; the wildcard CORS headers
    // above already permit cross-origin GET. Rate-limited per client IP on its own
    // (tighter) bucket. handleRestRequest returns false for an unknown /api path,
    // which then falls through to the 404 below.
    if (req.url && req.url.startsWith('/api/')) {
      const ip = clientKey(req.headers['x-forwarded-for'], req.socket.remoteAddress, trustProxy);
      if (apiRateLimiter.check(ip, Date.now())) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
        res.end(JSON.stringify({ error: 'Rate limit exceeded. Retry after 60s.' }));
        return;
      }
      if (await handleRestRequest(req, res)) return;
    }

    // MCP endpoint – stateless: new server + transport per request
    if (req.method === 'POST' && (req.url === '/mcp' || req.url === '/')) {
      // Rate-limit per client IP BEFORE doing any work (cheap rejection). Health
      // and CORS preflight are intentionally exempt (handled above).
      const ip = clientKey(req.headers['x-forwarded-for'], req.socket.remoteAddress, trustProxy);
      if (rateLimiter.check(ip, Date.now())) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
        res.end(JSON.stringify({ error: 'Rate limit exceeded. Retry after 60s.' }));
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
        server = createMcpServer();
        const transport = new StreamableHTTPServerTransport({ ...streamOptions });
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
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

    // Wrong method on the MCP endpoint → 405 (not a 404 fall-through), matching
    // the Vercel handler. `GET /` is the launcher, so only `/mcp` is gated here.
    if (req.url === '/mcp') {
      res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': 'POST' });
      res.end(JSON.stringify({ error: 'Method not allowed. Use POST.' }));
      return;
    }

    // Static prompt launcher (public, GET-only). Placed AFTER the MCP branch so
    // `POST /` stays the MCP endpoint; `GET /` and `GET /launcher.html` serve the
    // launcher. handleStaticRequest returns false for a path it doesn't own, so an
    // unrelated path falls through to the 404 below.
    if (await handleStaticRequest(req, res)) return;

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found. Use POST /mcp' }));
  };
}
