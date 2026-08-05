/**
 * http-mcp-request-log.test.ts – one line per MCP request, naming the identity.
 *
 * Written after a day of live debugging in which the log answered every question
 * except the one that mattered. It could say "nobody called us" (an empty log
 * ruled out the server in one step, twice) but never "somebody called us, and
 * this is who they were" — so "why does this client see 25 tools instead of 38"
 * had no evidence behind it at all, and the only way to ask was to reproduce the
 * whole OAuth flow by hand.
 *
 * Deliberately NOT logged: the credential, the label, and the request params.
 * The question is which SURFACE a request got, and `mode` answers that. A user
 * name on every request would be a log of who read what.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createHttpRequestHandler } from '../src/http-app.js';
import { setAccessSupport } from '../src/auth/credential.js';
import { encodeAccessToken, loadAuthKeys } from '../src/auth/access-token.js';
import { openRegistry } from '../src/auth/access-registry.js';
import { createDistinctValueLimiter, createRateLimiter } from '../src/rate-limit.js';
import { streamableHttpOptions } from '../src/mcp-transport.js';

/** Capture the structured log lines written while `fn` runs. */
async function captureLog(fn: () => Promise<void>): Promise<Record<string, unknown>[]> {
  const real = process.stderr.write.bind(process.stderr);
  const lines: string[] = [];
  process.stderr.write = ((chunk: unknown) => { lines.push(String(chunk)); return true; }) as typeof process.stderr.write;
  try { await fn(); } finally { process.stderr.write = real; }
  return lines
    .flatMap((l) => l.split('\n').filter(Boolean))
    .flatMap((l) => { try { return [JSON.parse(l) as Record<string, unknown>]; } catch { return []; } });
}

const close = (s: http.Server) => new Promise<void>((r) => { s.close(() => r()); });
const LIST = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

test('every MCP request logs its method and which surface it was served', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'wlo-reqlog-'));
  const registry = await openRegistry(join(dir, 'registry.json'));
  assert.ok(registry);
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keys = loadAuthKeys({ current: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
  assert.ok(keys);
  setAccessSupport({ keys, registry });
  t.after(() => { setAccessSupport(null); rmSync(dir, { recursive: true, force: true }); });

  const payload = { v: 2 as const, jti: 'log-id', u: 'redakteurin', secret: 'x', iat: 1 };
  await registry.add({ jti: payload.jti, label: payload.u, iat: payload.iat });
  const bearer = `Bearer ${encodeAccessToken(payload, keys.publicKeyPem)}`;

  const server = http.createServer(createHttpRequestHandler({
    rateLimiter: createRateLimiter(0), apiRateLimiter: createRateLimiter(0),
    authAbuseLimiter: createDistinctValueLimiter(0), maxBodyBytes: 1_048_576,
    trustProxy: false, streamOptions: streamableHttpOptions({}),
  }));
  const base: string = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
  });

  try {
    const post = (authorization?: string) => fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
      body: LIST,
    }).then((r) => r.json());

    const anonymous = await captureLog(async () => { await post(); });
    const line = anonymous.find((l) => l['msg'] === 'mcp request');
    assert.ok(line, `no "mcp request" line: ${JSON.stringify(anonymous)}`);
    assert.equal(line['method'], 'tools/list', 'the method is what makes a line useful');
    assert.equal(line['mode'], 'none', 'a request with no credential is served the read surface');

    const asUser = await captureLog(async () => { await post(bearer); });
    const userLine = asUser.find((l) => l['msg'] === 'mcp request');
    assert.ok(userLine);
    assert.equal(userLine['mode'], 'user', 'a listed access block is served the write surface');

    // The whole point is that these two are distinguishable in a log file.
    assert.notEqual(line['mode'], userLine['mode']);

    // And nothing that identifies a person or what they asked for.
    for (const l of [line, userLine]) {
      const dump = JSON.stringify(l);
      assert.ok(!dump.includes('redakteurin'), `the label must not be logged per request: ${dump}`);
      assert.ok(!dump.includes('Bearer'), `the credential must never be logged: ${dump}`);
    }
  } finally {
    await close(server);
  }
});
