/**
 * oauth-routing.test.ts – which of four ways an incoming request takes (P1/T1.4).
 *
 * The MCP specification treats a `401` with `WWW-Authenticate` as the doorway
 * into OAuth discovery. This server cannot answer 401 by default: anonymous
 * reading is requirement number one, and a request with no credential must keep
 * getting the 25 public tools. So the 401 is narrowed to the one case where it
 * is both correct and useful — a `Bearer` we were GIVEN and cannot use.
 *
 *   nothing            → anonymous, 200      (unchanged, and pinned first below)
 *   Basic, any state   → existing path, 200  (a wrong password is WLO's answer to give)
 *   Bearer, usable     → existing path, 200
 *   Bearer, unusable   → 401 + WWW-Authenticate → discovery
 *
 * The `Basic` line is the one that is easy to get wrong. A bad password there is
 * not an invalid token of ours; sending that caller into an OAuth flow would
 * answer a question they did not ask. A REVOKED block is the opposite case —
 * "fetch a new one" is exactly the right answer, and the 401 is how a client
 * learns where.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createHttpRequestHandler, type HttpAppOptions } from '../src/http-app.js';
import { setAccessSupport } from '../src/auth/credential.js';
import { encodeAccessToken, loadAuthKeys, type AuthKeys } from '../src/auth/access-token.js';
import { openRegistry, type AccessRegistry } from '../src/auth/access-registry.js';
import { createDistinctValueLimiter, createRateLimiter } from '../src/rate-limit.js';
import { streamableHttpOptions } from '../src/mcp-transport.js';

const ISSUER = 'https://mcp.example';

/**
 * The anonymous tool surface. A FLOOR, not an equality: adding a read tool is
 * ordinary, losing the anonymous list is the regression this guards. Measured at
 * 25 on 2026-08-05.
 */
const ANONYMOUS_TOOLS_AT_LEAST = 25;

function startServer(overrides: Partial<HttpAppOptions> = {}): Promise<{ server: http.Server; base: string }> {
  const handler = createHttpRequestHandler({
    rateLimiter: createRateLimiter(0),
    apiRateLimiter: createRateLimiter(0),
    authAbuseLimiter: createDistinctValueLimiter(0),
    maxBodyBytes: 1_048_576,
    trustProxy: false,
    streamOptions: streamableHttpOptions({}),
    publicBaseUrl: ISSUER,
    ...overrides,
  });
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

const close = (s: http.Server) => new Promise<void>((r) => { s.close(() => r()); });

/** `tools/list` is answered without a handshake in stateless mode (measured). */
const LIST = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

async function listTools(base: string, authorization?: string): Promise<Response> {
  return fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
    body: LIST,
  });
}

async function toolNames(r: Response): Promise<string[]> {
  const body = await r.json() as { result?: { tools?: { name: string }[] } };
  return (body.result?.tools ?? []).map((t) => t.name);
}

const PAYLOAD = { v: 2 as const, jti: 'listed-id', u: 'lehrerin', secret: 'geheim', iat: 1_754_300_000 };

async function withSupport(
  t: { after: (fn: () => void) => void },
): Promise<{ keys: AuthKeys; registry: AccessRegistry }> {
  const dir = mkdtempSync(join(tmpdir(), 'wlo-oauth-routing-'));
  const registry = await openRegistry(join(dir, 'registry.json'));
  assert.ok(registry);
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keys = loadAuthKeys({ current: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
  assert.ok(keys);
  setAccessSupport({ keys, registry });
  t.after(() => { setAccessSupport(null); rmSync(dir, { recursive: true, force: true }); });
  return { keys, registry };
}

const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;

// ── the property this whole undertaking most easily breaks ──────────────────

test('a request with no Authorization still gets 200 and the whole anonymous tool list', async () => {
  const { server, base } = await startServer();
  try {
    const r = await listTools(base);
    assert.equal(r.status, 200, 'anonymous reading is requirement number one');
    const names = await toolNames(r);
    assert.ok(
      names.length >= ANONYMOUS_TOOLS_AT_LEAST,
      `anonymous list shrank to ${names.length} tools: ${names.join(', ')}`,
    );
  } finally { await close(server); }
});

test('anonymous stays anonymous even where the feature is fully configured', async (t) => {
  await withSupport(t);
  const { server, base } = await startServer();
  try {
    const r = await listTools(base);
    assert.equal(r.status, 200);
    assert.ok((await toolNames(r)).length >= ANONYMOUS_TOOLS_AT_LEAST);
  } finally { await close(server); }
});

// ── the 401, and exactly where it fires ─────────────────────────────────────

test('a Bearer we cannot use answers 401 and says where to authorize', async (t) => {
  await withSupport(t);
  const { server, base } = await startServer();
  try {
    const r = await listTools(base, 'Bearer voellig-erfunden');
    assert.equal(r.status, 401);
    const challenge = r.headers.get('www-authenticate') ?? '';
    assert.match(challenge, /^Bearer /);
    assert.match(challenge, /error="invalid_token"/);
    assert.match(
      challenge,
      new RegExp(`resource_metadata="${ISSUER}/\\.well-known/oauth-protected-resource"`),
      `the discovery pointer is the whole point of the 401: ${challenge}`,
    );
  } finally { await close(server); }
});

test('a REVOKED block gets the 401 — "fetch a new one" is the right answer', async (t) => {
  const { keys, registry } = await withSupport(t);
  await registry.add({ jti: PAYLOAD.jti, label: PAYLOAD.u, iat: PAYLOAD.iat });
  const header = `Bearer ${encodeAccessToken(PAYLOAD, keys.publicKeyPem)}`;

  const { server, base } = await startServer();
  try {
    assert.equal((await listTools(base, header)).status, 200, 'while it is listed');
    await registry.remove(PAYLOAD.jti);
    assert.equal((await listTools(base, header)).status, 401, 'once it is not');
  } finally { await close(server); }
});

test('a Bearer block signed by a foreign key gets the 401, not a silent anonymous answer', async (t) => {
  await withSupport(t);
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const foreign = loadAuthKeys({ current: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
  assert.ok(foreign);
  const header = `Bearer ${encodeAccessToken(PAYLOAD, foreign.publicKeyPem)}`;

  const { server, base } = await startServer();
  try {
    assert.equal((await listTools(base, header)).status, 401);
  } finally { await close(server); }
});

test('with the feature off a Bearer still gets the 401 — it is still unusable', async () => {
  // No access support installed: every block is undecodable here.
  const { server, base } = await startServer();
  try {
    const r = await listTools(base, 'Bearer wlo2.a.b.c');
    assert.equal(r.status, 401);
  } finally { await close(server); }
});

test('without a resolvable issuer the 401 still fires, just without the pointer', async (t) => {
  await withSupport(t);
  // Neither configured nor derivable: no base URL and no reason to trust Host.
  const { server, base } = await startServer({ publicBaseUrl: undefined, trustProxy: false });
  try {
    const r = await listTools(base, 'Bearer erfunden');
    assert.equal(r.status, 401);
    const challenge = r.headers.get('www-authenticate') ?? '';
    assert.match(challenge, /error="invalid_token"/);
    assert.doesNotMatch(challenge, /resource_metadata/, 'no origin we stand behind, so no pointer');
  } finally { await close(server); }
});

// ── the lines that must NOT change ──────────────────────────────────────────

test('a Basic header we cannot parse still degrades to anonymous, never to 401', async (t) => {
  await withSupport(t);
  const { server, base } = await startServer();
  try {
    for (const header of ['Basic !!!not-base64!!!', 'Basic ' + Buffer.from('kein-doppelpunkt').toString('base64')]) {
      const r = await listTools(base, header);
      assert.equal(r.status, 200, `${header} is a WLO login problem, not an invalid token of ours`);
      assert.ok((await toolNames(r)).length >= ANONYMOUS_TOOLS_AT_LEAST);
    }
  } finally { await close(server); }
});

test('a well-formed Basic header takes the existing path untouched', async (t) => {
  await withSupport(t);
  const { server, base } = await startServer();
  try {
    const r = await listTools(base, basic('lehrerin', 'geheim'));
    assert.equal(r.status, 200);
    assert.ok((await toolNames(r)).length >= ANONYMOUS_TOOLS_AT_LEAST);
  } finally { await close(server); }
});

test('a listed access block takes the existing path untouched', async (t) => {
  const { keys, registry } = await withSupport(t);
  await registry.add({ jti: PAYLOAD.jti, label: PAYLOAD.u, iat: PAYLOAD.iat });
  const { server, base } = await startServer();
  try {
    const r = await listTools(base, `Bearer ${encodeAccessToken(PAYLOAD, keys.publicKeyPem)}`);
    assert.equal(r.status, 200);
    const names = await toolNames(r);
    assert.ok(names.length > ANONYMOUS_TOOLS_AT_LEAST, 'a user identity also brings the curation tools');
  } finally { await close(server); }
});
