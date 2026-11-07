/**
 * server-version.test.ts – one version, read from package.json (audit
 * 2026-11-05, A-7). `/health` and the MCP `serverInfo` both said `1.0.0` in
 * code while releases came and went, so "which version is live" had no answer
 * but the widget hashes. Bumping package.json must now reach both surfaces.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { SERVER_VERSION } from '../src/version.js';
import { createHttpRequestHandler } from '../src/http-app.js';
import { createDistinctValueLimiter, createRateLimiter } from '../src/rate-limit.js';
import { streamableHttpOptions } from '../src/mcp-transport.js';
import { connectedClient } from './fetchMock.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

test('the server version IS the package.json version', () => {
  assert.equal(SERVER_VERSION, pkg.version);
});

test('the MCP serverInfo reports it', async () => {
  const client = await connectedClient();
  try {
    assert.equal(client.getServerVersion()?.version, pkg.version);
  } finally { await client.close(); }
});

test('/health reports it', async () => {
  const server = http.createServer(createHttpRequestHandler({
    rateLimiter: createRateLimiter(0), apiRateLimiter: createRateLimiter(0),
    authAbuseLimiter: createDistinctValueLimiter(0), maxBodyBytes: 1024,
    trustProxy: false, streamOptions: streamableHttpOptions({}),
  }));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  try {
    const { port } = server.address() as AddressInfo;
    const body = await (await fetch(`http://127.0.0.1:${port}/health`)).json() as { version: string };
    assert.equal(body.version, pkg.version);
  } finally { await new Promise<void>(r => server.close(() => r())); }
});
