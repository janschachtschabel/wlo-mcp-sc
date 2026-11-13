/**
 * security-leftovers.test.ts – the lesser security findings of the audit of
 * 2026-11-12 (S-4, S-5, S-7 … S-13), one test group per finding.
 *
 * None of them is a way in. Each is a bound that was missing, a fact told to
 * somebody who need not know it, or a binding weaker than the one beside it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';

import { authStatusPayload } from '../src/auth/auth-status.js';
import { runWithCredential, type WloCredential } from '../src/auth/credential.js';
import { createCodeStore, MAX_CODES_PER_LABEL } from '../src/auth/oauth-codes.js';
import { issuerDependsOnHostHeader } from '../src/auth/oauth-metadata.js';
import { keyedDigest } from '../src/keyed-digest.js';
import { createDistinctValueLimiter, createRateLimiter } from '../src/rate-limit.js';
import { handleUploadRequest, UPLOAD_PATH } from '../src/rest/upload-route.js';
import { buildChangeSet } from '../src/services/write/change-set.js';
import { consumeToken, mintToken, MAX_PENDING_PER_IDENTITY, MAX_PENDING_SHARED_IDENTITY } from '../src/services/write/confirm.js';
import { batchOwner } from '../src/services/write/batch-confirm.js';
import { runWithRequestSignal } from '../src/request-scope.js';
import { renderMetrics, resetMetricsForTest } from '../src/metrics.js';
import { wloFetch } from '../src/wlo-fetch.js';
import { WLO_REPOSITORY_URL } from '../src/wlo-config.js';
import { readdirSync } from 'node:fs';
import { describeUpload, resolveFileUpload } from '../src/services/write/content-source.js';
import { fileBatchEntry } from '../src/services/write/batch-filing.js';
import { UploadSlots } from '../src/services/write/upload-slot.js';
import { installFetchMock } from './fetchMock.js';

const PDF = Buffer.from('%PDF-1.7\nHallo\n%%EOF\n', 'latin1');
const basic = (login: string) => `Basic ${Buffer.from(login).toString('base64')}`;

// ── S-4: the upload route ────────────────────────────────────────────────────

/** A server around the upload route; the repository confirms every login but `gast`. */
async function uploads(deps: Partial<Parameters<typeof handleUploadRequest>[2]> = {}) {
  const real = globalThis.fetch;
  const mock = installFetchMock((url, init) => {
    const auth = new Headers((init?.headers ?? {}) as HeadersInit).get('authorization') ?? '';
    if (url.includes('/iam/v1/people/')) {
      const login = Buffer.from(auth.replace(/^Basic /, ''), 'base64').toString();
      return { json: { person: { authorityName: login.startsWith('gast') ? 'esguest' : 'person' } } };
    }
    return { status: 404, json: {} };
  });
  const slots = new UploadSlots({ maxBytes: 1024, maxPerIdentity: 5 });
  const server = createServer((req, res) => {
    void handleUploadRequest(req, res, {
      slots, timeoutMs: 5000, ip: '127.0.0.1', authAbuseLimiter: createDistinctValueLimiter(0), ...deps,
    }).then((ok) => { if (!ok) { res.writeHead(404); res.end(); } });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    mock,
    post: (auth: string) => real(base + UPLOAD_PATH, {
      method: 'POST', body: new Uint8Array(PDF), headers: { 'Content-Type': 'application/octet-stream', Authorization: auth },
    }),
    close: async () => { mock.restore(); await new Promise<void>((r) => server.close(() => r())); },
  };
}

test('S-4: the upload route is bounded per caller BEFORE anybody is asked who they are', async () => {
  const s = await uploads({ requestBudget: { limiter: createRateLimiter(2), key: '127.0.0.1' } });
  try {
    // Its own wrong login: refusals are remembered per process, across tests.
    assert.equal((await s.post(basic('gast-budget:falsch'))).status, 403);
    assert.equal((await s.post(basic('gast-budget:falsch'))).status, 403);
    const third = await s.post(basic('lehrerin:geheim'));
    assert.equal(third.status, 429, 'a working login does not get past a spent budget either');
    const body = await third.json() as Record<string, unknown>;
    assert.equal(body['error'], 'rate_limited');
    assert.ok(Number(third.headers.get('retry-after')) >= 1);
  } finally { await s.close(); }
});

test('S-4: a login the repository refused is remembered — the same header does not ask it again', async () => {
  const s = await uploads();
  try {
    for (let i = 0; i < 4; i++) assert.equal((await s.post(basic('gast:falsch'))).status, 403);
    assert.equal(s.mock.calls.filter((c) => c.url.includes('/iam/v1/people/')).length, 1,
      'each further attempt was another failed login against the real account');
  } finally { await s.close(); }
});

test('S-4: one account cannot hold the shared byte budget — its own share is bounded', async () => {
  const slots = new UploadSlots({ maxBytes: 1024, maxPerIdentity: 10, maxTotal: 20, maxTotalBytes: 4096, maxBytesPerIdentity: 1500 });
  const file = (n: number) => Buffer.concat([PDF, Buffer.alloc(n - PDF.length, 0x20)]);
  assert.equal((await slots.put('a', Readable.from([file(1000)]), 'x.pdf', 1000)).ok, true);
  const second = await slots.put('a', Readable.from([file(1000)]), 'y.pdf', 1000);
  assert.deepEqual([second.ok, !second.ok && second.code], [false, 'too_many'], 'past its own share');
  assert.equal((await slots.put('b', Readable.from([file(1000)]), 'z.pdf', 1000)).ok, true, 'somebody else still has room');
});

// ── S-5: the batch preview ───────────────────────────────────────────────────

test('S-5: a file whose real size differs from the size the preview showed is not filed', async () => {
  const sha256 = createHash('sha256').update(PDF).digest('hex');
  const mock = installFetchMock(() => ({ json: {} }));
  try {
    const r = await fileBatchEntry('ordner-1',
      { index: 0, title: 'Brief', sha256, size: 5, ext: 'pdf', fileName: 'brief.pdf', role: 'content' },
      { data: PDF, sha256, size: PDF.length, type: { mimeType: 'application/pdf', ext: 'pdf' } } as never);
    assert.equal(r.status, 'failed');
    assert.equal(mock.calls.length, 0, 'nothing was sent');
  } finally { mock.restore(); }
});

// ── S-7: the status of a shared account ──────────────────────────────────────

test('S-7: the service account is reported as a MODE — its name is nobody\'s business', () => {
  const service: WloCredential = { header: 'Basic s', label: 'wlo-dienst', source: 'service' };
  const status = authStatusPayload(service, { authenticated: true, authority: 'wlo-dienst', displayName: 'WLO Dienst' });
  assert.equal(status.mode, 'service');
  assert.equal(status.authenticated, true);
  assert.equal(status.credential, 'service');
  assert.equal(JSON.stringify(status).includes('wlo-dienst'), false, JSON.stringify(status));
  assert.equal(JSON.stringify(status).includes('WLO Dienst'), false);

  // A person asking about their OWN login still gets it.
  const maria: WloCredential = { header: 'Basic m', label: 'maria', source: 'user' };
  const own = authStatusPayload(maria, { authenticated: true, authority: 'maria', displayName: 'Maria M.' });
  assert.deepEqual([own.configuredAs, own.authority, own.displayName], ['maria', 'maria', 'Maria M.']);
});

// ── S-8: anonymous OAuth connections ─────────────────────────────────────────

test('S-8: anonymous connections are bounded per ADDRESS — not twenty for everybody together', () => {
  const store = createCodeStore();
  const record = { clientId: 'c', redirectUri: 'https://a.example/cb', challenge: 'x', block: 'anon', label: 'anonym' };
  const other = store.mint({ ...record, owner: 'anonymous@198.51.100.7' }, 0);
  for (let i = 0; i <= MAX_CODES_PER_LABEL; i++) store.mint({ ...record, owner: 'anonymous@203.0.113.9' }, 1);
  assert.ok(store.consume(other, 2), 'another address\' login in progress survived');
});

// ── S-9: the allow-list reaches the disk ─────────────────────────────────────

test('S-9: the allow-list is synced to disk before it replaces the old one', () => {
  // A rename is atomic for the NAME; without a sync the new file's bytes may
  // still be in the page cache, and a hard stop then leaves an empty list —
  // which fails closed and switches every personal access off.
  const source = readFileSync(new URL('../src/auth/access-registry.ts', import.meta.url), 'utf8');
  assert.equal(/\bwriteFile\(temp/.test(source), false, 'every write of the temp file goes through the syncing helper');
  const helper = /async function writeSynced[\s\S]*?\n}/.exec(source)?.[0] ?? '';
  assert.match(helper, /\.sync\(\)/);
  assert.ok(helper.indexOf('.sync()') < helper.indexOf('rename('), 'synced BEFORE the rename');
});

// ── S-10: no bare hash of a login in memory ──────────────────────────────────

test('S-10: a credential is only ever kept as a digest keyed with a per-process secret', () => {
  const header = basic('maria:geheim');
  assert.notEqual(keyedDigest(header), createHash('sha256').update(header).digest('hex'),
    'a bare SHA-256 of "Basic user:pass" is a password hash anyone can attack offline');
  assert.equal(keyedDigest(header), keyedDigest(header), 'stable within the process');
  assert.match(keyedDigest(header), /^[0-9a-f]{64}$/);
  const rateLimit = readFileSync(new URL('../src/rate-limit.ts', import.meta.url), 'utf8');
  assert.equal(/createHash/.test(rateLimit), false, 'the distinct-login limiter stores keyed digests');
  const slot = readFileSync(new URL('../src/services/write/upload-slot.ts', import.meta.url), 'utf8');
  assert.equal(/update\(cred\.header\)/.test(slot), false);
});

// ── S-11: where the OAuth address comes from ─────────────────────────────────

test('S-11: an OAuth address taken from the caller\'s Host header is something the operator is told', () => {
  assert.equal(issuerDependsOnHostHeader({ configured: undefined, trustProxy: true }), true);
  assert.equal(issuerDependsOnHostHeader({ configured: '  ', trustProxy: true }), true);
  assert.equal(issuerDependsOnHostHeader({ configured: 'https://mcp.example', trustProxy: true }), false);
  assert.equal(issuerDependsOnHostHeader({ configured: undefined, trustProxy: false }), false, 'then OAuth is simply off');
});

// ── S-12: confirmation keys under a shared identity ──────────────────────────

const change = (to: string) => buildChangeSet('node-1', 'content', { 'cclom:title': ['Alt'] }, { 'cclom:title': [to] });
const ALICE: WloCredential = { header: 'Basic YQ==', label: 'alice', source: 'user' };
const BOB: WloCredential = { header: 'Basic Yg==', label: 'bob', source: 'user' };
const SERVICE: WloCredential = { header: 'Basic cw==', label: 'dienst', source: 'service' };

test('S-12: somebody else presenting a key does not use it up for its owner', () => {
  const cs = change('Gemeinsam');
  const token = runWithCredential(ALICE, () => mintToken(cs));
  assert.equal(runWithCredential(BOB, () => consumeToken(token, cs)), 'mismatch');
  assert.equal(runWithCredential(ALICE, () => consumeToken(token, cs)), 'ok', 'the approval is still hers');
});

test('S-12: the OWNER trying a different change still burns the key', () => {
  const token = runWithCredential(ALICE, () => mintToken(change('A')));
  assert.equal(runWithCredential(ALICE, () => consumeToken(token, change('B'))), 'mismatch');
  assert.equal(runWithCredential(ALICE, () => consumeToken(token, change('A'))), 'unknown');
});

test('S-12: the shared service identity is not ONE person — its previews do not evict each other at fifty', () => {
  const first = runWithCredential(SERVICE, () => mintToken(change('Besucher 0')));
  for (let i = 1; i <= MAX_PENDING_PER_IDENTITY + 5; i++) runWithCredential(SERVICE, () => mintToken(change(`Besucher ${i}`)));
  assert.equal(runWithCredential(SERVICE, () => consumeToken(first, change('Besucher 0'))), 'ok');
});

// ── S-13: what binds an upload to its approval ───────────────────────────────

test('S-13: the approval names the WHOLE checksum of the bytes, as the full-text path does', () => {
  const r = resolveFileUpload('Brüche', { content: '# Brüche kürzen\n' });
  assert.ok(r.ok && r.file);
  const sha = createHash('sha256').update(r.file.bytes).digest('hex');
  assert.ok(describeUpload(r.file).includes(sha), describeUpload(r.file));
});

// ── review of phase 3 ────────────────────────────────────────────────────────

test('the per-login share is never smaller than ONE file of the allowed size', async () => {
  // Half of the total is 750 here, below `maxBytes` — every full-size upload was refused.
  const slots = new UploadSlots({ maxBytes: 1024, maxPerIdentity: 10, maxTotal: 20, maxTotalBytes: 1500 });
  const file = Buffer.concat([PDF, Buffer.alloc(1000 - PDF.length, 0x20)]);
  assert.equal((await slots.put('a', Readable.from([file]), 'x.pdf', 1000)).ok, true);
});

test('S-10: no credential header is hashed without the process key — anywhere in src', () => {
  const header = basic('maria:geheim');
  const owner = batchOwner({ header, source: 'user' });
  assert.notEqual(owner, createHash('sha256').update(`batch:${header}`).digest('hex'));
  const srcDir = new URL('../src/', import.meta.url);
  const walk = (dir: URL): URL[] => readdirSync(dir, { withFileTypes: true })
    .flatMap(e => (e.isDirectory() ? walk(new URL(`${e.name}/`, dir)) : e.name.endsWith('.ts') ? [new URL(e.name, dir)] : []));
  const offending = walk(srcDir)
    .filter(file => /createHash\([^)]*\)\s*\.update\([^)]*\bheader\b/.test(readFileSync(file, 'utf8')))
    .map(file => file.pathname.split('/src/')[1]);
  assert.deepEqual(offending, [], 'use keyedDigest (src/keyed-digest.ts)');
});

test('S-12: the shared service identity has a share of its own — it cannot fill the store', () => {
  assert.ok(MAX_PENDING_SHARED_IDENTITY > MAX_PENDING_PER_IDENTITY);
  const alices = runWithCredential(ALICE, () => mintToken(change('Alice wartet')));
  const first = runWithCredential(SERVICE, () => mintToken(change('Flut 0')));
  for (let i = 1; i <= MAX_PENDING_SHARED_IDENTITY; i++) runWithCredential(SERVICE, () => mintToken(change(`Flut ${i}`)));
  assert.equal(runWithCredential(SERVICE, () => consumeToken(first, change('Flut 0'))), 'unknown', 'its own oldest made room');
  assert.equal(runWithCredential(ALICE, () => consumeToken(alices, change('Alice wartet'))), 'ok', 'a person\'s key survived the flood');
});

test('an upstream call our own caller abandoned is counted as cancelled, not as the repository failing', async () => {
  resetMetricsForTest();
  const controller = new AbortController();
  const mock = installFetchMock(() => { controller.abort(new Error('client gone')); throw new TypeError('aborted'); });
  try {
    await assert.rejects(runWithRequestSignal(controller.signal, () => wloFetch(`${WLO_REPOSITORY_URL}/rest/x`)));
    const text = renderMetrics();
    assert.match(text, /^wlo_upstream_requests_total\{outcome="cancelled"\} 1$/m, text);
    assert.doesNotMatch(text, /outcome="error"/);
  } finally { mock.restore(); }
});
