/**
 * oauth-endpoints.test.ts – the OAuth HTTP surface (P1/T1.2 onward).
 *
 * Sibling of `auth-endpoints.test.ts` and shaped like it: the module owns a
 * closed set of paths, hands anything else back with `false`, and is OFF —
 * answering 404, not 500 — whenever the feature it depends on is not configured.
 *
 * "Off" here has two causes and one effect. Without key material there is no
 * access block to hand out, so there is nothing for OAuth to issue; without a
 * resolvable issuer the documents would name endpoints on a host we did not
 * choose. Either way the endpoint should not exist rather than half-work.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleOAuthEndpoint } from '../src/rest/oauth-pages.js';
import { setAccessSupport } from '../src/auth/credential.js';
import { loadAuthKeys } from '../src/auth/access-token.js';
import { openRegistry } from '../src/auth/access-registry.js';
import { authorizationServerMetadata, protectedResourceMetadata } from '../src/auth/oauth-metadata.js';
import { createRateLimiter } from '../src/rate-limit.js';

const ISSUER = 'https://mcp.example';

const req = (method: string, url: string, body?: string) => ({
  method,
  url,
  async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(body); },
});

function res() {
  const out = { status: 0, body: '', headers: {} as Record<string, string> };
  return {
    out,
    json: () => (out.body ? JSON.parse(out.body) as Record<string, unknown> : null),
    writeHead(status: number, headers?: Record<string, string>) {
      out.status = status;
      out.headers = headers ?? {};
    },
    end(body?: string) { out.body = body ?? ''; },
  };
}

function deps(over: Partial<Parameters<typeof handleOAuthEndpoint>[2]> = {}) {
  return {
    ip: '198.51.100.7',
    rateLimiter: createRateLimiter(100),
    issuer: ISSUER as string | null,
    ...over,
  };
}

/** Install access-block support for the duration of one test. */
async function support(t: { after: (fn: () => void) => void }): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'wlo-oauth-'));
  const registry = await openRegistry(join(dir, 'registry.json'));
  assert.ok(registry);
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keys = loadAuthKeys({ current: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
  assert.ok(keys);
  setAccessSupport({ keys, registry });
  t.after(() => { setAccessSupport(null); rmSync(dir, { recursive: true, force: true }); });
}

const AS_PATHS = ['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/mcp'];
const PR_PATHS = ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'];
const ALL = [...AS_PATHS, ...PR_PATHS];

// ── off ─────────────────────────────────────────────────────────────────────

test('without key material every discovery path answers 404, not a document', async () => {
  for (const path of ALL) {
    const r = res();
    assert.equal(await handleOAuthEndpoint(req('GET', path), r, deps()), true, `${path} is ours to answer`);
    assert.equal(r.out.status, 404, path);
  }
});

test('without a resolvable issuer the documents are withheld too', async (t) => {
  await support(t);
  for (const path of ALL) {
    const r = res();
    await handleOAuthEndpoint(req('GET', path), r, deps({ issuer: null }));
    assert.equal(r.out.status, 404, `${path} would otherwise name endpoints on a host we did not choose`);
  }
});

// ── on ──────────────────────────────────────────────────────────────────────

test('both spellings of the authorization-server path serve the same document', async (t) => {
  await support(t);
  for (const path of AS_PATHS) {
    const r = res();
    assert.equal(await handleOAuthEndpoint(req('GET', path), r, deps()), true);
    assert.equal(r.out.status, 200, path);
    assert.deepEqual(r.json(), authorizationServerMetadata(ISSUER), path);
  }
});

test('both spellings of the protected-resource path serve the same document', async (t) => {
  await support(t);
  for (const path of PR_PATHS) {
    const r = res();
    await handleOAuthEndpoint(req('GET', path), r, deps());
    assert.equal(r.out.status, 200, path);
    assert.deepEqual(r.json(), protectedResourceMetadata(ISSUER), path);
  }
});

test('a discovery document is cacheable and typed, and refuses to be sniffed', async (t) => {
  await support(t);
  const r = res();
  await handleOAuthEndpoint(req('GET', ALL[0]!), r, deps());
  assert.match(r.out.headers['Content-Type'] ?? '', /application\/json/);
  assert.match(r.out.headers['Cache-Control'] ?? '', /max-age=\d+/);
  assert.equal(r.out.headers['X-Content-Type-Options'], 'nosniff');
});

// ── the edges ───────────────────────────────────────────────────────────────

test('a discovery path is GET-only', async (t) => {
  await support(t);
  const r = res();
  assert.equal(await handleOAuthEndpoint(req('POST', ALL[0]!), r, deps()), true);
  assert.equal(r.out.status, 405);
  assert.equal(r.out.headers['Allow'], 'GET');
});

test('a path we do not own is handed back so the caller can fall through', async (t) => {
  await support(t);
  for (const path of ['/.well-known/openid-configuration', '/.well-known/', '/oauth', '/mcp']) {
    const r = res();
    assert.equal(await handleOAuthEndpoint(req('GET', path), r, deps()), false, path);
    assert.equal(r.out.status, 0, `${path} was answered when it should have fallen through`);
  }
});

test('an unparseable request target owns no route', async (t) => {
  await support(t);
  const r = res();
  assert.equal(await handleOAuthEndpoint(req('GET', '//['), r, deps()), false);
});

test('the discovery paths are rate-limited like the rest of the public surface', async (t) => {
  await support(t);
  // One request per window: the first passes, the second is over the line.
  const rateLimiter = createRateLimiter(1);
  const first = res();
  await handleOAuthEndpoint(req('GET', ALL[0]!), first, deps({ rateLimiter }));
  assert.equal(first.out.status, 200, 'the first request is served');

  const second = res();
  await handleOAuthEndpoint(req('GET', ALL[0]!), second, deps({ rateLimiter }));
  assert.equal(second.out.status, 429);
  assert.equal(second.out.headers['Retry-After'], '60');
});
