/**
 * http-hardening.test.ts – audit 2026-11-14: the response headers every answer
 * carries (S4), one decode per request for a Bearer (S5), and what the internal
 * port says about its own exposure (S3).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { generateKeyPairSync, type KeyObject } from 'node:crypto';

import { createHttpRequestHandler, type HttpAppOptions } from '../src/http-app.js';
import { createInternalHandler, internalPortExposure, resolveInternalBind } from '../src/rest/internal-port.js';
import { createDistinctValueLimiter, createRateLimiter } from '../src/rate-limit.js';
import { streamableHttpOptions } from '../src/mcp-transport.js';
import { loadAuthKeys, type AuthKeys } from '../src/auth/access-token.js';
import type { AccessRegistry } from '../src/auth/access-registry.js';
import {
  isUnusableAuthorization, isUnusableBearer, readAuthorization, setAccessSupport, ANONYMOUS_ACCESS_TOKEN,
} from '../src/auth/credential.js';
import { encodeClientId, decodeClientId } from '../src/auth/oauth-clients.js';
import { resetAuthStatusCacheForTest } from '../src/rest/auth-status.js';

async function listening(handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }) };
}

const publicHandler = (overrides: Partial<HttpAppOptions> = {}) => createHttpRequestHandler({
  rateLimiter: createRateLimiter(0), apiRateLimiter: createRateLimiter(0), authAbuseLimiter: createDistinctValueLimiter(0),
  maxBodyBytes: 1_000, trustProxy: false, streamOptions: streamableHttpOptions({}), ...overrides,
});

const INITIALIZE = JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'hardening-test', version: '0.0.0' } },
});

// ── S4 ───────────────────────────────────────────────────────────────────────

test('every answer of the public handler carries nosniff and a referrer policy', async () => {
  const { base, close } = await listening(publicHandler());
  try {
    const answers: Array<[string, Response]> = [
      ['404 unknown path', await fetch(`${base}/gibt-es-nicht`)],
      ['400 malformed target', await fetch(`${base}//[`)],
      ['405 GET /mcp', await fetch(`${base}/mcp`)],
      ['400 invalid JSON', await fetch(`${base}/mcp`, { method: 'POST', body: '{' })],
      ['413 body too large', await fetch(`${base}/mcp`, { method: 'POST', body: 'x'.repeat(2_000) })],
      ['401 unusable bearer', await fetch(`${base}/mcp`, { method: 'POST', body: INITIALIZE, headers: { authorization: 'Bearer nonsense' } })],
      ['200 MCP initialize', await fetch(`${base}/mcp`, { method: 'POST', body: INITIALIZE, headers: { 'content-type': 'application/json' } })],
      ['204 preflight', await fetch(`${base}/mcp`, { method: 'OPTIONS' })],
      ['200 health', await fetch(`${base}/health`)],
      ['static launcher or its 404', await fetch(`${base}/`)],
      ['auth page or its 404', await fetch(`${base}/auth`)],
    ];
    assert.deepEqual(answers.slice(0, 7).map(([, r]) => r.status), [404, 400, 405, 400, 413, 401, 200]);
    for (const [what, r] of answers) {
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff', what);
      assert.equal(r.headers.get('referrer-policy'), 'no-referrer', what);
      await r.arrayBuffer();
    }
  } finally { await close(); }
});

test('the internal port carries the same two headers, on its 404 too', async () => {
  const { base, close } = await listening(createInternalHandler());
  try {
    for (const path of ['/health', '/metrics', '/nichts']) {
      const r = await fetch(`${base}${path}`);
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff', path);
      assert.equal(r.headers.get('referrer-policy'), 'no-referrer', path);
      await r.arrayBuffer();
    }
  } finally { await close(); }
});

// ── S5 ───────────────────────────────────────────────────────────────────────

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const realKeys = loadAuthKeys({ current: privateKey })!;

/** Key material that counts how often a block is put to the private keys. */
function countingKeys(): { keys: AuthKeys; decodes: () => number } {
  let n = 0;
  const keys = {
    publicKeyPem: realKeys.publicKeyPem,
    // `decodeAccessToken` reads this once per block it actually tries to open.
    get privateKeys(): KeyObject[] { n++; return realKeys.privateKeys; },
  };
  return { keys, decodes: () => n };
}

const emptyRegistry = { has: () => false, labelOf: () => undefined } as unknown as AccessRegistry;
/** Shaped like a block (prefix, 256-byte wrapped key, 12-byte IV, a body), so it reaches the RSA step. */
const GARBAGE_BLOCK = ['wlo2', Buffer.alloc(256, 7).toString('base64url'), Buffer.alloc(12).toString('base64url'),
  Buffer.alloc(40).toString('base64url')].join('.');

test('readAuthorization agrees with the three single questions, header by header', () => {
  const { keys } = countingKeys();
  setAccessSupport({ keys, registry: emptyRegistry });
  try {
    for (const raw of [undefined, '', '   ', `Bearer ${GARBAGE_BLOCK}`, 'Bearer x', 'bearer  x', `Bearer ${ANONYMOUS_ACCESS_TOKEN}`,
      `Basic ${Buffer.from('user:pass').toString('base64')}`, `Basic ${Buffer.from('user:').toString('base64')}`,
      'Basic', 'Digest abc', 'Bearer', 'Bearer a b']) {
      const read = readAuthorization(raw);
      assert.equal(read.unusable, isUnusableAuthorization(raw), `unusable: ${JSON.stringify(raw)}`);
      assert.equal(read.unusableBearer, isUnusableBearer(raw), `unusableBearer: ${JSON.stringify(raw)}`);
      assert.equal(read.credential === null, read.unusable || !raw?.trim() || raw.includes(ANONYMOUS_ACCESS_TOKEN),
        `credential: ${JSON.stringify(raw)}`);
    }
  } finally { setAccessSupport(null); }
});

test('POST /mcp opens a garbage Bearer once before the 401 — not once per question', async () => {
  const { keys, decodes } = countingKeys();
  setAccessSupport({ keys, registry: emptyRegistry });
  const { base, close } = await listening(publicHandler());
  try {
    const r = await fetch(`${base}/mcp`, { method: 'POST', body: INITIALIZE, headers: { authorization: `Bearer ${GARBAGE_BLOCK}` } });
    assert.equal(r.status, 401);
    assert.equal(decodes(), 1);
  } finally { await close(); setAccessSupport(null); }
});

test('GET /auth/status opens a garbage Bearer once', async () => {
  const { keys, decodes } = countingKeys();
  setAccessSupport({ keys, registry: emptyRegistry });
  resetAuthStatusCacheForTest();
  const { base, close } = await listening(publicHandler());
  try {
    const r = await fetch(`${base}/auth/status`, { headers: { authorization: `Bearer ${GARBAGE_BLOCK}` } });
    assert.equal(r.status, 401);
    assert.equal(decodes(), 1);
  } finally { await close(); setAccessSupport(null); }
});

test('the client-id key is derived once per private key, not once per call', () => {
  const fresh = loadAuthKeys({ current: privateKey })!;
  const key = fresh.privateKeys[0]!;
  let exports = 0;
  const original = key.export.bind(key);
  (key as { export: unknown }).export = (...args: unknown[]) => { exports++; return (original as (...a: unknown[]) => unknown)(...args); };
  const client = { redirectUris: ['https://client.example.org/cb'], name: 'Client' };
  const id = encodeClientId(client, fresh);
  assert.deepEqual(decodeClientId(id, fresh)?.redirectUris, client.redirectUris);
  encodeClientId(client, fresh);
  decodeClientId(id, fresh);
  assert.equal(exports, 1, 'the private key left its object once');
  assert.equal(decodeClientId(id, loadAuthKeys({ current: privateKey })!)?.name, 'Client', 'a second key object derives the same key');
});

// ── S3 ───────────────────────────────────────────────────────────────────────

test('INTERNAL_BIND_ADDR: unset keeps every interface; a value is taken as given', () => {
  assert.equal(resolveInternalBind(undefined), undefined);
  assert.equal(resolveInternalBind('  '), undefined);
  assert.equal(resolveInternalBind(' 127.0.0.1 '), '127.0.0.1');
});

test('the internal port warns when /metrics is open on more than loopback', () => {
  assert.match(internalPortExposure({}) ?? '', /WITHOUT a token on every interface/);
  assert.match(internalPortExposure({ bindAddr: '0.0.0.0' }) ?? '', /the interface 0\.0\.0\.0/);
  assert.match(internalPortExposure({ bindAddr: '10.0.0.5' }) ?? '', /METRICS_TOKEN/);
  assert.match(internalPortExposure({ bindAddr: '::' }) ?? '', /INTERNAL_BIND_ADDR/);
});

test('http.ts binds the internal port where INTERNAL_BIND_ADDR says, and asks for the warning', () => {
  // `http.ts` listens on import, so its use of the two functions is read from the source.
  const source = readFileSync(new URL('../src/http.ts', import.meta.url), 'utf8');
  assert.match(source, /resolveInternalBind\(process\.env\['INTERNAL_BIND_ADDR'\]\)/);
  assert.match(source, /internal\.listen\(INTERNAL_PORT, INTERNAL_BIND_ADDR, /);
  assert.match(source, /else internal\.listen\(INTERNAL_PORT, listening\)/, 'unset keeps every interface, as before');
  assert.match(source, /internalPortExposure\(\{[\s\S]{0,200}\}\);\s*if \(exposure\) log\.warn\(exposure/);
});

test('…and says nothing when a token guards it or it listens on loopback only', () => {
  assert.equal(internalPortExposure({ metricsToken: 't'.repeat(16) }), null);
  assert.equal(internalPortExposure({ bindAddr: '0.0.0.0', metricsToken: 't'.repeat(16) }), null);
  for (const loopback of ['127.0.0.1', '127.8.9.1', '::1', '[::1]', 'localhost', 'LOCALHOST']) {
    assert.equal(internalPortExposure({ bindAddr: loopback }), null, loopback);
  }
});
