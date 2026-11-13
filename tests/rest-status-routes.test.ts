/**
 * rest-status-routes.test.ts – `GET /auth/status` and `GET /ready` through a
 * real HTTP server (plan 2026-11-07, S4/S5).
 */

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { createHttpRequestHandler, type HttpAppOptions } from '../src/http-app.js';
import { createDistinctValueLimiter, createRateLimiter } from '../src/rate-limit.js';
import { streamableHttpOptions } from '../src/mcp-transport.js';
import { resetReadinessForTest } from '../src/services/upstream-readiness.js';
import { AUTH_STATUS_CACHE_MS, AUTH_STATUS_UNKNOWN_CACHE_MS, resetAuthStatusCacheForTest } from '../src/rest/auth-status.js';
import { setServiceCredentialForTest } from '../src/auth/credential.js';
import { installFetchMock } from './fetchMock.js';

afterEach(() => { resetReadinessForTest(); resetAuthStatusCacheForTest(); });

const echt = globalThis.fetch;

async function start(overrides: Partial<HttpAppOptions> = {}) {
  const server = http.createServer(createHttpRequestHandler({
    rateLimiter: createRateLimiter(0), apiRateLimiter: createRateLimiter(0),
    authAbuseLimiter: createDistinctValueLimiter(0), maxBodyBytes: 1_048_576, trustProxy: false,
    streamOptions: streamableHttpOptions({}), ...overrides,
  }));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => new Promise<void>(r => server.close(() => r())) };
}

const MARIA = `Basic ${Buffer.from('maria:pw').toString('base64')}`;

/** The repository: identity says who the Basic header is, search answers ok. */
function repository() {
  return installFetchMock((url, init) => {
    const auth = new Headers((init?.headers ?? {}) as HeadersInit).get('authorization') ?? '';
    if (url.includes('/iam/v1/people/')) {
      return { json: { person: { authorityName: auth === MARIA ? 'maria' : 'esguest', profile: { firstName: 'Maria' } } } };
    }
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
}

test('GET /auth/status with a login → 200, the same payload as wlo_auth_status', async () => {
  const mock = repository();
  const { base, close } = await start();
  try {
    const r = await echt(`${base}/auth/status`, { headers: { Authorization: MARIA } });
    assert.equal(r.status, 200);
    const body = await r.json() as Record<string, unknown>;
    assert.equal(body['mode'], 'user');
    assert.equal(body['authenticated'], true);
    assert.equal(body['credential'], 'basic');
    assert.equal(r.headers.get('access-control-allow-origin'), null, '/auth* sends no CORS header');
  } finally { await close(); mock.restore(); }
});

test('GET /auth/status without a header → anonymous', async () => {
  const mock = repository();
  const { base, close } = await start();
  try {
    const body = await (await echt(`${base}/auth/status`)).json() as Record<string, unknown>;
    assert.deepEqual([body['mode'], body['credential']], ['anonymous', 'none']);
  } finally { await close(); mock.restore(); }
});

test('GET /auth/status with an unusable Bearer → 401 with the challenge, like /mcp', async () => {
  const mock = repository();
  const { base, close } = await start();
  try {
    const r = await echt(`${base}/auth/status`, { headers: { Authorization: 'Bearer wlo2.kaputt' } });
    assert.equal(r.status, 401);
    assert.match(r.headers.get('www-authenticate') ?? '', /^Bearer/);
  } finally { await close(); mock.restore(); }
});

test('GET /auth/status twice within 60 s asks the repository once', async () => {
  const mock = repository();
  const { base, close } = await start();
  try {
    await echt(`${base}/auth/status`, { headers: { Authorization: MARIA } });
    await echt(`${base}/auth/status`, { headers: { Authorization: MARIA } });
    assert.equal(mock.calls.filter(c => c.url.includes('/iam/v1/people/')).length, 1);
  } finally { await close(); mock.restore(); }
});

test('GET /auth/status is bounded by the protocol budget — a REST 429, like /api', async () => {
  const mock = repository();
  const { base, close } = await start({ protocolLimiter: createRateLimiter(1) });
  try {
    assert.equal((await echt(`${base}/auth/status`)).status, 200);
    const refused = await echt(`${base}/auth/status`);
    assert.equal(refused.status, 429);
    const body = await refused.json() as Record<string, unknown>;
    assert.equal(body['code'], 'rate_limited');
    assert.equal(body['retryAfter'], Number(refused.headers.get('retry-after')));
    assert.equal(body['jsonrpc'], undefined, 'a REST endpoint does not answer in JSON-RPC');
  } finally { await close(); mock.restore(); }
});

/** Capture the structured log lines written while `fn` runs. */
async function captureLog(fn: () => Promise<void>): Promise<Record<string, unknown>[]> {
  const real = process.stderr.write.bind(process.stderr);
  const lines: string[] = [];
  process.stderr.write = ((chunk: unknown) => { lines.push(String(chunk)); return true; }) as typeof process.stderr.write;
  try { await fn(); } finally { process.stderr.write = real; }
  return lines.flatMap(l => l.split('\n').filter(Boolean))
    .flatMap(l => { try { return [JSON.parse(l) as Record<string, unknown>]; } catch { return []; } });
}

test('GET /auth/status is bounded by the login guard — refused and logged like /mcp', async () => {
  const mock = repository();
  const { base, close } = await start({ authAbuseLimiter: createDistinctValueLimiter(1) });
  try {
    const other = `Basic ${Buffer.from('paul:pw').toString('base64')}`;
    let refused: Response | undefined;
    const logs = await captureLog(async () => {
      assert.equal((await echt(`${base}/auth/status`, { headers: { Authorization: MARIA } })).status, 200);
      refused = await echt(`${base}/auth/status`, { headers: { Authorization: other } });
    });
    assert.equal(refused?.status, 429);
    const body = await refused!.json() as Record<string, unknown>;
    assert.equal(body['code'], 'too_many_logins');
    assert.ok(logs.some(l => l['message'] === 'too many distinct credentials'), 'the refusal reaches the operator');
  } finally { await close(); mock.restore(); }
});

test('GET /auth/status with an unusable Basic reads anonymous, never as the service account', async () => {
  const mock = repository();
  setServiceCredentialForTest({ header: `Basic ${Buffer.from('svc:pw').toString('base64')}`, label: 'svc', source: 'service' });
  const { base, close } = await start();
  try {
    const garbled = `Basic ${Buffer.from('ohne-doppelpunkt').toString('base64')}`;
    const body = await (await echt(`${base}/auth/status`, { headers: { Authorization: garbled } })).json() as Record<string, unknown>;
    assert.deepEqual([body['mode'], body['credential']], ['anonymous', 'none']);
  } finally { setServiceCredentialForTest(null); await close(); mock.restore(); }
});

test('an UNKNOWN answer (repository unreachable) is held briefly, a definite one for the full minute', async () => {
  let down = true;
  const mock = installFetchMock((url, init) => {
    if (url.includes('/iam/v1/people/')) {
      if (down) throw new Error('ECONNREFUSED');
      const auth = new Headers((init?.headers ?? {}) as HeadersInit).get('authorization') ?? '';
      return { json: { person: { authorityName: auth === MARIA ? 'maria' : 'esguest' } } };
    }
    return { json: {} };
  });
  const { base, close } = await start();
  const realNow = Date.now;
  const at = (ms: number) => { const t0 = realNow(); Date.now = () => t0 + ms; };
  const identityCalls = () => mock.calls.filter(c => c.url.includes('/iam/v1/people/')).length;
  try {
    const first = await (await echt(`${base}/auth/status`, { headers: { Authorization: MARIA } })).json() as Record<string, unknown>;
    assert.equal(first['authority'], null);
    assert.equal(first['upstream'], 'unreachable', 'no verdict on the login (B2)');
    down = false;
    at(AUTH_STATUS_UNKNOWN_CACHE_MS + 1);
    const second = await (await echt(`${base}/auth/status`, { headers: { Authorization: MARIA } })).json() as Record<string, unknown>;
    assert.equal(second['authenticated'], true, 'an outage is not held for the full minute');
    assert.equal(identityCalls(), 2);
    at(AUTH_STATUS_UNKNOWN_CACHE_MS + 2);
    await echt(`${base}/auth/status`, { headers: { Authorization: MARIA } });
    assert.equal(identityCalls(), 2, 'a definite answer stays cached');
    assert.ok(AUTH_STATUS_UNKNOWN_CACHE_MS < AUTH_STATUS_CACHE_MS);
  } finally { Date.now = realNow; await close(); mock.restore(); }
});

test('a REFUSED login (repository said 401) reads upstream ok and is held the full minute — it is an answer (B2)', async () => {
  const mock = installFetchMock((url) => (url.includes('/iam/v1/people/') ? { status: 401, json: {} } : { json: {} }));
  const { base, close } = await start();
  const realNow = Date.now;
  const at = (ms: number) => { const t0 = realNow(); Date.now = () => t0 + ms; };
  const identityCalls = () => mock.calls.filter(c => c.url.includes('/iam/v1/people/')).length;
  try {
    const body = await (await echt(`${base}/auth/status`, { headers: { Authorization: MARIA } })).json() as Record<string, unknown>;
    assert.deepEqual([body['authenticated'], body['authority'], body['upstream']], [false, null, 'ok']);
    at(AUTH_STATUS_UNKNOWN_CACHE_MS + 1);
    await echt(`${base}/auth/status`, { headers: { Authorization: MARIA } });
    assert.equal(identityCalls(), 1, 'a refusal is as definite as a login — only silence is held briefly');
  } finally { Date.now = realNow; await close(); mock.restore(); }
});

test('GET /ready → 200 when the repository answers, 503 unreachable when it does not', async () => {
  const ok = repository();
  const { base, close } = await start();
  try {
    const r = await echt(`${base}/ready`);
    assert.equal(r.status, 200);
    assert.equal((await r.json() as { upstream: string }).upstream, 'ok');
  } finally { ok.restore(); }
  resetReadinessForTest();
  const down = installFetchMock(() => { throw new Error('ECONNREFUSED'); });
  try {
    const r = await echt(`${base}/ready`);
    assert.equal(r.status, 503);
    assert.equal((await r.json() as { upstream: string }).upstream, 'unreachable');
  } finally { await close(); down.restore(); }
});

test('two blocks of ONE account are two answers — the cache keys on the header presented, not the login inside', async (t) => {
  const { generateKeyPairSync } = await import('node:crypto');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { openRegistry } = await import('../src/auth/access-registry.js');
  const { encodeAccessToken, loadAuthKeys } = await import('../src/auth/access-token.js');
  const { setAccessSupport } = await import('../src/auth/credential.js');
  const dir = mkdtempSync(join(tmpdir(), 'wlo-status-'));
  const registry = await openRegistry(join(dir, 'registry.json'));
  assert.ok(registry);
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keys = loadAuthKeys({ current: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
  assert.ok(keys);
  setAccessSupport({ keys, registry });
  t.after(() => { setAccessSupport(null); rmSync(dir, { recursive: true, force: true }); });
  const nowS = Math.floor(Date.now() / 1000);
  await registry.add({ jti: 'pasted', label: 'maria', iat: nowS });
  await registry.add({ jti: 'widget', label: 'maria', iat: nowS, exp: nowS + 3600 });
  const mk = (jti: string) => encodeAccessToken({ v: 2, jti, u: 'maria', secret: 'pw', iat: nowS }, keys.publicKeyPem);

  const mock = repository();
  const { base, close } = await start();
  try {
    const pasted = await (await echt(`${base}/auth/status`, { headers: { Authorization: `Bearer ${mk('pasted')}` } })).json() as Record<string, unknown>;
    const widget = await (await echt(`${base}/auth/status`, { headers: { Authorization: `Bearer ${mk('widget')}` } })).json() as Record<string, unknown>;
    assert.equal(pasted['expiresAt'], undefined);
    assert.equal(widget['expiresAt'], new Date((nowS + 3600) * 1000).toISOString());
  } finally { await close(); mock.restore(); }
});
