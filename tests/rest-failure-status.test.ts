/**
 * `/api/*` answered every thrown upstream failure as 500 "Internal server
 * error" — a record that is not there, one this caller may not read, and a
 * repository that is busy for ten seconds all looked like a defect of ours.
 * The status and the code now follow the failure; only an accident stays 500.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleRestRequest, routeRestRequest } from '../src/rest/routes.js';
import { installFetchMock, type MockResult } from './fetchMock.js';
import { ClientGoneError } from '../src/request-scope.js';

const ID = '11111111-2222-4333-8444-555555555555';
type Body = { error: string; code?: string; retryAfter?: number };

/** Every upstream call of the request answers the same way. */
async function collectionAnswering(answer: MockResult) {
  const mock = installFetchMock(() => answer);
  try {
    return await routeRestRequest('GET', `/api/collection?nodeId=${ID}`);
  } finally { mock.restore(); }
}

for (const [upstream, status, code] of [
  [404, 404, 'not_found'], [403, 403, 'forbidden'], [401, 403, 'forbidden'],
  [500, 502, 'upstream_error'], [502, 502, 'upstream_error'],
] as const) {
  test(`/api/collection: an upstream ${upstream} is answered ${status} ${code}`, async () => {
    const r = await collectionAnswering({ status: upstream, json: { error: 'java.lang.Something at Impl.java:42' } });
    assert.equal(r?.status, status);
    const body = r!.json as Body;
    assert.equal(body.code, code);
    assert.equal(typeof body.error, 'string');
    assert.doesNotMatch(JSON.stringify(body), /java|Impl|getCollectionContents/, 'no internal detail');
    assert.equal(body.retryAfter, undefined);
  });
}

test('/api/collection: a busy repository is 503 with the wait, in the body and as a header', async () => {
  const r = await collectionAnswering({ status: 503, json: {}, headers: { 'Retry-After': '7' } });
  assert.equal(r?.status, 503);
  assert.deepEqual({ code: (r!.json as Body).code, retryAfter: (r!.json as Body).retryAfter }, { code: 'upstream_busy', retryAfter: 7 });
  assert.equal(r!.retryAfter, 7);

  const again = await collectionAnswering({ status: 429, json: {} });
  assert.equal(again?.status, 503);
  assert.ok(((again!.json as Body).retryAfter ?? 0) >= 1, 'an estimate when the repository named none');
});

test('/api/collection: a timeout is 504', async () => {
  const mock = installFetchMock(() => { throw new DOMException('The operation timed out', 'TimeoutError'); });
  try {
    const r = await routeRestRequest('GET', `/api/collection?nodeId=${ID}`);
    assert.equal(r?.status, 504);
    assert.equal((r!.json as Body).code, 'timeout');
  } finally { mock.restore(); }
});

test('an accident of ours stays 500 without a code or a detail', async () => {
  const mock = installFetchMock(() => { throw new RangeError('secret internals'); });
  try {
    const r = await routeRestRequest('GET', `/api/collection?nodeId=${ID}`);
    assert.equal(r?.status, 500);
    assert.deepEqual(r!.json, { error: 'Internal server error' });
  } finally { mock.restore(); }
});

test('the path-form search and the skill route classify the same way', async () => {
  const mock = installFetchMock(() => ({ status: 503, json: {} }));
  try {
    const search = await routeRestRequest('GET', '/api/search/optik?include=content');
    assert.equal(search?.status, 503);
    assert.equal((search!.json as Body).code, 'upstream_busy');
  } finally { mock.restore(); }
});

test('a 405 names the method that is allowed', async () => {
  for (const url of ['/api/search?q=optik', '/api/search/optik', `/api/skills/${ID}`]) {
    const r = await routeRestRequest('POST', url);
    assert.equal(r?.status, 405, url);
    assert.equal(r!.allow, 'GET', url);
  }
  const written: { status?: number; headers?: Record<string, string> } = {};
  await handleRestRequest({ method: 'DELETE', url: '/api/search?q=optik' }, {
    writeHead: (status, headers) => { written.status = status; written.headers = headers; },
    end: () => undefined,
  });
  assert.equal(written.status, 405);
  assert.equal(written.headers?.['Allow'], 'GET');
});

// ── What is NOT an answer of the repository ─────────────────────────────────

/** The structured log lines written while `fn` runs. */
async function captureLog(fn: () => Promise<void>): Promise<Record<string, unknown>[]> {
  const real = process.stderr.write.bind(process.stderr);
  const lines: string[] = [];
  process.stderr.write = ((chunk: unknown) => { lines.push(String(chunk)); return true; }) as typeof process.stderr.write;
  try { await fn(); } finally { process.stderr.write = real; }
  return lines.flatMap(l => l.split('\n').filter(Boolean))
    .flatMap((l) => { try { return [JSON.parse(l) as Record<string, unknown>]; } catch { return []; } });
}

test('a mistake of ours is a 500 without a code or a detail — by the rule the MCP tools go by', async () => {
  // One rule for both surfaces (`src/accident.ts`): JavaScript's own error
  // classes are ours. Its message names internals and stays in the log.
  const mock = installFetchMock(() => { throw new TypeError("Cannot read properties of undefined (reading 'ref')"); });
  try {
    const r = await routeRestRequest('GET', `/api/collection?nodeId=${ID}`);
    assert.equal(r?.status, 500);
    assert.deepEqual(r!.json, { error: 'Internal server error' });
  } finally { mock.restore(); }
});

test('a connection lost while the body is read is the repository, not us', async () => {
  // undici reports it as `TypeError: terminated` — a TypeError that is no accident.
  const mock = installFetchMock(() => { throw new TypeError('terminated'); });
  try {
    const r = await routeRestRequest('GET', `/api/collection?nodeId=${ID}`);
    assert.equal(r?.status, 502);
    assert.equal((r!.json as Body).code, 'upstream_error');
  } finally { mock.restore(); }
});

test('a repository answer that could not be read is still 502 — with or without a status in it', async () => {
  for (const answer of [{ text: '<html>proxy error</html>' }, { status: 500, json: {} }] as MockResult[]) {
    const r = await collectionAnswering(answer);
    assert.equal(r?.status, 502);
    assert.equal((r!.json as Body).code, 'upstream_error');
  }
  const mock = installFetchMock(() => { throw new TypeError('fetch failed'); });
  try {
    const r = await routeRestRequest('GET', `/api/collection?nodeId=${ID}`);
    assert.equal(r?.status, 502);
  } finally { mock.restore(); }
});

test('a caller that hung up is no failure: no error line, no upstream code, no 5xx', async () => {
  const mock = installFetchMock(() => { throw new ClientGoneError(); });
  try {
    let r: Awaited<ReturnType<typeof routeRestRequest>> = null;
    const lines = await captureLog(async () => { r = await routeRestRequest('GET', `/api/collection?nodeId=${ID}`); });
    const result = r as unknown as { status: number; json: Body };
    assert.ok(result.status < 500, `nobody reads it, and it must not count as a server error: ${result.status}`);
    assert.equal(result.json.code, undefined);
    assert.deepEqual(lines.filter(l => l['level'] === 'error'), []);
    assert.ok(lines.some(l => l['level'] === 'info' && /client is gone/.test(String(l['message']))));
  } finally { mock.restore(); }
});
