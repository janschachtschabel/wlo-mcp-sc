/**
 * api-mcp.test.ts – the Vercel serverless entry (deep-audit #5: previously
 * driven by no test and compiled by no tsc project). The default export is
 * mounted on a real node:http server with minimal stand-ins for Vercel's
 * res.status()/res.json() and its pre-parsed req.body.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import handler from '../api/mcp.js';

function startVercelish(): Promise<{ server: http.Server; base: string }> {
  const server = http.createServer((req, res) => {
    const vres = res as http.ServerResponse & { status(c: number): typeof vres; json(b: unknown): void };
    vres.status = (c: number) => { res.statusCode = c; return vres; };
    vres.json = (b: unknown) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(b)); };
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const vreq = req as http.IncomingMessage & { body?: unknown };
      if (raw) { try { vreq.body = JSON.parse(raw); } catch { vreq.body = raw; } }
      void handler(vreq as never, vres as never);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

const close = (s: http.Server) => new Promise<void>((r) => { s.close(() => r()); });

test('api/mcp: GET → 200 health payload', async () => {
  const { server, base } = await startVercelish();
  try {
    const r = await fetch(base);
    assert.equal(r.status, 200);
    assert.equal((await r.json() as { status: string }).status, 'ok');
  } finally { await close(server); }
});

test('api/mcp: non-POST method → 405', async () => {
  const { server, base } = await startVercelish();
  try {
    const r = await fetch(base, { method: 'DELETE' });
    assert.equal(r.status, 405);
  } finally { await close(server); }
});

test('api/mcp: POST initialize with a JSON-only Accept → 200 result (Accept-patch)', async () => {
  const { server, base } = await startVercelish();
  try {
    const r = await fetch(base, {
      method: 'POST',
      // Deliberately ONLY application/json: without the rawHeaders Accept
      // patch the SDK would answer 406 for such simple clients.
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'vercel-test', version: '0.0.0' } },
      }),
    });
    assert.equal(r.status, 200);
    const body = await r.json() as { result?: { serverInfo?: { name?: string } } };
    assert.ok(body.result?.serverInfo?.name, 'initialize must return serverInfo');
  } finally { await close(server); }
});
