/**
 * api/mcp.ts – Vercel serverless function for the WLO MCP server.
 * Implements Streamable HTTP transport (stateless, one server per request).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from '../src/server.js';
import { widgetBuildIds } from '../src/apps/resources.js';
import { log } from '../src/logger.js';

/**
 * Minimal local shims for Vercel's request/response objects, derived from
 * `node:http`. Vercel injects the concrete objects at runtime; we only need the
 * subset used below (`req.method`/`rawHeaders`/`headers`/`body`,
 * `res.setHeader`/`status`/`json`/`end`/`headersSent`). Defining them here drops
 * the `@vercel/node` dev dependency — whose transitive tree (undici, ajv,
 * path-to-regexp, minimatch, js-yaml, smol-toml) carried every remaining
 * npm-audit advisory — with zero runtime impact.
 */
type VercelRequest = IncomingMessage & { body?: unknown };
type VercelResponse = ServerResponse & {
  status(code: number): VercelResponse;
  json(body: unknown): void;
};

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method === 'GET') {
    // Same deploy fingerprint as the self-hosted /health (widget build hashes).
    res.status(200).json({ status: 'ok', server: 'wlo-mcp', version: '1.0.0', widgets: widgetBuildIds() });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  // NOTE: unlike the self-hosted path (src/http.ts), this serverless handler does
  // NOT rate-limit. In-memory limiting is ineffective on serverless (per-instance,
  // reset on cold start), so amplification protection MUST come from a platform
  // control — configure a Vercel Firewall rate rule on this route. See README
  // "Deployment / Vercel".
  let server: ReturnType<typeof createMcpServer> | undefined;
  try {
    // Normalize the Accept header so ANY client works — including simple ones
    // (curl, MCP Inspector, some IDE integrations) that send only
    // "application/json". The MCP SDK's POST handler hard-requires BOTH
    // application/json AND text/event-stream (→ 406 otherwise); since we reply
    // with a single JSON body (enableJsonResponse), forcing both is harmless.
    // NOTE: the underlying @hono/node-server builds the Web Request from
    // `rawHeaders` (not the parsed `headers` object), so we patch rawHeaders.
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

    server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless – required for Vercel serverless
      enableJsonResponse: true,      // reply with one JSON body instead of an SSE
                                     // stream — robust on serverless (no stream
                                     // torn down by the immediate server.close()).
    });

    await server.connect(transport);
    // req.body is already parsed by Vercel's default JSON middleware
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    // Log the detail server-side; return a generic error (no internal detail
    // leaks to the client) — matching the REST layer's error handling.
    log.error('MCP request handling failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  } finally {
    // Close in finally so a throw from connect()/handleRequest() cannot leak the
    // per-request server/transport on a warm serverless instance (mirrors http.ts).
    if (server) await server.close().catch(() => {});
  }
}
