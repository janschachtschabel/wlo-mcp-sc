/**
 * rest-upload-route.test.ts – MA-2: `POST /api/uploads`, the raw-body upload into a slot.
 *
 * Server-to-server (the chatbot streams a file of a batch): `application/octet-stream`, the client's
 * name in `X-Upload-Name` (only to tell markdown from text). A personal WLO credential is required —
 * none, the anonymous token or the service account → 403. Over the limit → 413 (by Content-Length
 * before reading, or cut off while streaming), unknown type → 415, too many open → 429.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';

import { handleUploadRequest, UPLOAD_PATH } from '../src/rest/upload-route.js';
import { UploadSlots } from '../src/services/write/upload-slot.js';
import { installFetchMock, type InstalledMock } from './fetchMock.js';
import { createDistinctValueLimiter } from '../src/rate-limit.js';

const grenze = () => ({ ip: '127.0.0.1', authAbuseLimiter: createDistinctValueLimiter(0) });

/** The real fetch for the test client — the mock below answers the server's identity checks. */
const echt = globalThis.fetch;
const GAST = `Basic ${Buffer.from('gast:falsch').toString('base64')}`;

/**
 * The repository confirms every login except ``gast`` (which answers as guest) — each as ITS OWN
 * account. It used to confirm everybody as `person`; since the slot identity is the confirmed account,
 * that made all the people of this file one person sharing one slot budget.
 */
function identitaeten(): InstalledMock {
  return installFetchMock((url, init) => {
    const auth = new Headers((init?.headers ?? {}) as HeadersInit).get('authorization') ?? '';
    if (url.includes('/iam/v1/people/')) {
      const account = Buffer.from(auth.replace(/^Basic\s+/i, ''), 'base64').toString('utf8').split(':')[0] || 'person';
      return { json: { person: { authorityName: auth === GAST ? 'esguest' : account } } };
    }
    return { status: 404, json: {} };
  });
}

const PERSON = `Basic ${Buffer.from('lehrerin:geheim').toString('base64')}`;
const PDF = Buffer.from('%PDF-1.7\nHallo\n%%EOF\n', 'latin1');

describe('POST /api/uploads', () => {
  let server: Server;
  let base: string;
  let slots: UploadSlots;
  let mock: InstalledMock;

  before(async () => {
    mock = identitaeten();
    slots = new UploadSlots({ maxBytes: 1024, maxPerIdentity: 1 });
    server = createServer((req, res) => {
      void handleUploadRequest(req, res, { slots, timeoutMs: 5000, ...grenze() }).then((ok) => {
        if (!ok) { res.writeHead(404); res.end(); }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    mock.restore();
    await new Promise<void>((r) => server.close(() => r()));
  });

  const post = (body: Buffer, headers: Record<string, string> = {}) => echt(base + UPLOAD_PATH, {
    method: 'POST', body: new Uint8Array(body),
    headers: { 'Content-Type': 'application/octet-stream', Authorization: PERSON, ...headers },
  });

  it('refuses without a personal credential', async () => {
    for (const auth of ['', 'Bearer wlo-anon.v1', 'Basic kaputt', GAST]) {
      const r = await post(PDF, { Authorization: auth });
      assert.equal(r.status, 403, auth);
    }
  });

  it('refuses a wrong content type and other methods', async () => {
    assert.equal((await post(PDF, { 'Content-Type': 'multipart/form-data; boundary=x' })).status, 415);
    assert.equal((await echt(base + UPLOAD_PATH)).status, 405);
  });

  it('stores a file and answers with ref, hash and type — without the name', async () => {
    const r = await post(PDF, { 'X-Upload-Name': encodeURIComponent('Brief an Eltern.pdf') });
    assert.equal(r.status, 201);
    const daten = await r.json() as Record<string, unknown>;
    assert.equal(daten['ext'], 'pdf');
    assert.equal(daten['size'], PDF.length);
    assert.match(String(daten['ref']), /^[A-Za-z0-9_-]{20,}$/);
    assert.equal(JSON.stringify(daten).includes('Brief'), false);
  });

  it('answers 429 when the identity has too many open slots', async () => {
    const r = await post(PDF);
    assert.equal(r.status, 429);
  });

  it('answers 413 for a body over the limit', async () => {
    const anders = `Basic ${Buffer.from('anderer:geheim').toString('base64')}`;
    const r = await post(Buffer.concat([PDF, Buffer.alloc(4096)]), { Authorization: anders });
    assert.equal(r.status, 413);
  });

  it('answers 415 for an unknown type', async () => {
    const dritte = `Basic ${Buffer.from('dritte:geheim').toString('base64')}`;
    const r = await post(Buffer.from('<html>x', 'latin1'), { Authorization: dritte });
    assert.equal(r.status, 415);
  });

  it('ignores other paths', async () => {
    assert.equal((await echt(`${base}/api/andere`, { method: 'POST' })).status, 404);
  });
});

describe('mounting in http-app (WLO_BATCH_UPLOAD_ENABLED)', () => {
  it('is a 404 unless switched on, and carries no CORS header', async () => {
    const { createHttpRequestHandler } = await import('../src/http-app.js');
    const { createDistinctValueLimiter, createRateLimiter } = await import('../src/rate-limit.js');
    const { streamableHttpOptions } = await import('../src/mcp-transport.js');
    const handler = createHttpRequestHandler({
      rateLimiter: createRateLimiter(0), apiRateLimiter: createRateLimiter(0),
      authAbuseLimiter: createDistinctValueLimiter(0), maxBodyBytes: 1_048_576, trustProxy: false,
      streamOptions: streamableHttpOptions({}),
    });
    const srv = createServer((req, res) => { void handler(req, res); });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}${UPLOAD_PATH}`;
    const mock = identitaeten();
    const senden = () => echt(url, { method: 'POST', body: new Uint8Array(PDF), headers: {
      'Content-Type': 'application/octet-stream', Authorization: PERSON } });
    try {
      delete process.env['WLO_BATCH_UPLOAD_ENABLED'];
      assert.equal((await senden()).status, 404);
      process.env['WLO_BATCH_UPLOAD_ENABLED'] = '1';
      const r = await senden();
      assert.equal(r.status, 201);
      assert.equal(r.headers.get('access-control-allow-origin'), null);
    } finally {
      delete process.env['WLO_BATCH_UPLOAD_ENABLED'];
      mock.restore();
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });
});


describe('streamed bodies (review MA-1/MA-2, findings 1/6)', () => {
  it('answers 413 to a chunked body over the limit — not a dropped connection', async () => {
    const mock = identitaeten();
    const slots = new UploadSlots({ maxBytes: 1024 });
    const srv = createServer((req, res) => { void handleUploadRequest(req, res, { slots, timeoutMs: 5000, ...grenze() }); });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    try {
      const { request } = await import('node:http');
      const status = await new Promise<number>((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port: (srv.address() as AddressInfo).port, path: UPLOAD_PATH,
          method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Authorization: PERSON,
            'Transfer-Encoding': 'chunked' } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
        req.on('error', reject);
        req.write(PDF);
        // Past the limit but inside the drain window (DRAIN_FACTOR x limit): the client finishes
        // sending and then sees 413, not a reset. An abusive stream beyond it may be cut off.
        for (let i = 0; i < 3; i++) req.write(Buffer.alloc(1000));
        req.end();
      });
      assert.equal(status, 413);
      assert.equal(slots.open, 0, 'the reservation is released');
    } finally {
      mock.restore();
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });

  it('answers 408 when the body is too slow, and releases the reservation', async () => {
    const mock = identitaeten();
    const slots = new UploadSlots({ maxBytes: 1024 });
    const srv = createServer((req, res) => { void handleUploadRequest(req, res, { slots, timeoutMs: 100, ...grenze() }); });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    try {
      const { request } = await import('node:http');
      const status = await new Promise<number>((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port: (srv.address() as AddressInfo).port, path: UPLOAD_PATH,
          method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Authorization: PERSON,
            'Content-Length': String(PDF.length) } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
        req.on('error', reject);
        req.write(PDF.subarray(0, 4));      // and then nothing more
      });
      assert.equal(status, 408);
      await new Promise((r) => setTimeout(r, 1200));
      assert.equal(slots.open, 0, 'the reservation is released');
    } finally {
      mock.restore();
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });
});


describe('login limiter (review MA-3/MA-4, finding 4)', () => {
  it('answers 429 too_many_logins when the distinct-login limiter refuses', async () => {
    const mock = identitaeten();
    const slots = new UploadSlots({ maxBytes: 1024 });
    const srv = createServer((req, res) => { void handleUploadRequest(req, res, { slots, timeoutMs: 5000,
      ip: '127.0.0.1', authAbuseLimiter: { check: () => true } as never }); });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    try {
      const anders = `Basic ${Buffer.from('vierte:geheim').toString('base64')}`;
      const r = await echt(`http://127.0.0.1:${(srv.address() as AddressInfo).port}${UPLOAD_PATH}`, {
        method: 'POST', body: new Uint8Array(PDF),
        headers: { 'Content-Type': 'application/octet-stream', Authorization: anders } });
      assert.equal(r.status, 429);
      assert.equal((await r.json() as Record<string, unknown>)['error'], 'too_many_logins');
    } finally {
      mock.restore();
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });
});

describe('login limiter buckets like POST /mcp (relay clients)', () => {
  it('counts a block per access id and Basic per address', async () => {
    const { verifiedSlotIdentity } = await import('../src/services/write/upload-slot.js');
    const mock = identitaeten();
    const keys: string[] = [];
    const limiter = { check: (key: string) => { keys.push(key); return false; } } as never;
    try {
      // Eleven people behind ONE chatbot address, each with their own block.
      for (let i = 0; i < 11; i++) {
        const cred = { header: `Basic ${Buffer.from(`relay${i}:pw`).toString('base64')}`, label: `relay${i}`,
          source: 'user' as const, jti: `jti-${i}` };
        const r = await verifiedSlotIdentity(cred, { ip: '10.0.0.9', authAbuseLimiter: limiter }, 1_000);
        assert.ok('identity' in r);
      }
      // A header no earlier test confirmed — the 10-minute cache would skip the limiter.
      await verifiedSlotIdentity({ header: `Basic ${Buffer.from('basic-relay:pw').toString('base64')}`,
        label: 'basic-relay', source: 'user' },
        { ip: '10.0.0.9', authAbuseLimiter: limiter }, 1_000);
      assert.equal(new Set(keys.slice(0, 11)).size, 11, 'one bucket per block, not one for the address');
      assert.equal(keys[11], 'ip:10.0.0.9', 'Basic stays per address');
    } finally {
      mock.restore();
    }
  });
});

describe('the slot identity is the account the login PROOF confirmed (review 2026-11-14, finding 3)', () => {
  it('two Basic spellings are one person; a block of that account takes the slot; a typed name never does', async () => {
    const { verifiedSlotIdentity, slotIdentity, slotHolder } = await import('../src/services/write/upload-slot.js');
    const basic = (user: string) => ({ header: `Basic ${Buffer.from(`${user}:pw`).toString('base64')}`, label: user, source: 'user' as const });
    // Whatever is typed, the repository confirms ONE account.
    const mock = installFetchMock(() => ({ json: { person: { authorityName: 'proof-maria' } } }));
    const deps = { ip: '10.0.0.7', authAbuseLimiter: createDistinctValueLimiter(0) };
    try {
      const one = await verifiedSlotIdentity(basic('Proof.Maria'), deps, 5_000);
      const two = await verifiedSlotIdentity(basic('proof.maria@example.org'), deps, 5_000);
      assert.ok('identity' in one && 'identity' in two);
      assert.equal(one.identity, two.identity, 'one budget for both spellings');
      const block = { label: 'Proof.Maria', source: 'user' as const, acct: 'proof-maria' };
      assert.equal(one.identity, slotIdentity(block), 'the identity a block of that account brings to the tool call');
      assert.notEqual(one.holder, two.holder);

      const slots = new UploadSlots();
      const put = async () => {
        const r = await slots.put(one.identity, Readable.from([PDF]), 'a.pdf', undefined, one.holder);
        assert.ok(r.ok);
        return r.slot.ref;
      };
      // A Basic header that merely TYPES the account name: another identity, another holder.
      const typed = basic('proof-maria');
      typed.header = `Basic ${Buffer.from('proof-maria:falsch').toString('base64')}`;
      const ref = await put();
      assert.equal(slots.take(ref, slotIdentity(typed)!, slotHolder(typed)), null, 'not by a typed name');
      // …and the refused take left the slot where it was.
      assert.ok(slots.take(ref, slotIdentity(block)!, 'some-other-holder'), 'by a block of the confirmed account');
      // The same Basic credential in the tool call: no `acct`, so only the holder matches.
      const same = basic('Proof.Maria');
      assert.notEqual(slotIdentity(same), one.identity);
      assert.ok(slots.take(await put(), slotIdentity(same)!, slotHolder(same)), 'by the credential that uploaded it');
    } finally { mock.restore(); }
  });

  it('a block whose account is recorded mid-session keeps its slots', async () => {
    const { verifiedSlotIdentity, slotIdentity } = await import('../src/services/write/upload-slot.js');
    const mock = installFetchMock(() => ({ json: { person: { authorityName: 'late-acct' } } }));
    const deps = { ip: '10.0.0.8', authAbuseLimiter: createDistinctValueLimiter(0) };
    try {
      const legacy = { header: 'Basic bGF0ZTpwdw==', label: 'Late.Acct', source: 'user' as const, jti: 'jti-late' };
      const before = await verifiedSlotIdentity(legacy, deps, 9_000);
      assert.ok('identity' in before);
      // `noteAccount` has run: the same block now names its account.
      assert.equal(before.identity, slotIdentity({ ...legacy, acct: 'late-acct' }));
    } finally { mock.restore(); }
  });
});

describe('review of B1–B3: upload refusals (findings 1 and 5)', () => {
  async function serve(limiter: unknown, handler: Parameters<typeof installFetchMock>[0]) {
    const mock = installFetchMock(handler);
    const slots = new UploadSlots({ maxBytes: 1024 });
    const srv = createServer((req, res) => { void handleUploadRequest(req, res, { slots, timeoutMs: 5000,
      ip: '127.0.0.1', authAbuseLimiter: limiter as never }); });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const send = (auth: string) => echt(`http://127.0.0.1:${(srv.address() as AddressInfo).port}${UPLOAD_PATH}`, {
      method: 'POST', body: new Uint8Array(PDF), headers: { 'Content-Type': 'application/octet-stream', Authorization: auth } });
    return { send, close: async () => { mock.restore(); await new Promise<void>((r) => srv.close(() => r())); } };
  }

  it('429 too_many_logins carries Retry-After, code and retryAfter — error stays the code string', async () => {
    const s = await serve({ check: () => true, retryAfterSeconds: () => 77 },
      () => ({ json: { person: { authorityName: 'person' } } }));
    try {
      const r = await s.send(`Basic ${Buffer.from('fuenfte:geheim').toString('base64')}`);
      assert.equal(r.status, 429);
      assert.equal(r.headers.get('retry-after'), '77');
      const body = await r.json() as Record<string, unknown>;
      assert.deepEqual([body['error'], body['code'], body['retryAfter']], ['too_many_logins', 'too_many_logins', 77]);
    } finally { await s.close(); }
  });

  it('an unreachable repository is 503 upstream_unreachable, not 403 login_required', async () => {
    const s = await serve(createDistinctValueLimiter(10), () => ({ status: 503, json: {} }));
    try {
      const r = await s.send(`Basic ${Buffer.from('sechste:geheim').toString('base64')}`);
      assert.equal(r.status, 503);
      assert.ok(Number(r.headers.get('retry-after')) > 0);
      const body = await r.json() as Record<string, unknown>;
      assert.equal(body['error'], 'upstream_unreachable');
      assert.equal(body['code'], 'upstream_unreachable');
    } finally { await s.close(); }
  });
});
