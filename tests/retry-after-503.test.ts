/**
 * retry-after-503.test.ts – a 503 for a passing outage says when to come back.
 *
 * Every other 503 of this server carried `Retry-After`; `/api/wikipedia` and
 * `/ready` did not (found while the HTTP surface was written down, 2026-11-13).
 */

import { test, mock as nodeMock } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerResponse } from 'node:http';

import { handleRestRequest } from '../src/rest/routes.js';
import { handleReady } from '../src/rest/ready.js';
import { READY_CACHE_MS, resetReadinessForTest, SLOW_MS, SLOW_RETRY_MS } from '../src/services/upstream-readiness.js';
import { installFetchMock } from './fetchMock.js';

/** A response that records what was written. */
function recorder() {
  const out = { status: 0, headers: {} as Record<string, string | number>, body: '' };
  const res = {
    writeHead(status: number, headers: Record<string, string | number> = {}) { out.status = status; out.headers = headers; return this; },
    end(body?: string) { out.body = body ?? ''; },
  } as unknown as ServerResponse;
  return { res, out };
}

test('/api/wikipedia: an outage answers 503 with Retry-After — header and field agree', async () => {
  const mock = installFetchMock(() => ({ status: 503, json: {} }));
  try {
    const { res, out } = recorder();
    assert.equal(await handleRestRequest({ method: 'GET', url: '/api/wikipedia?q=Photosynthese' }, res), true);
    assert.equal(out.status, 503);
    const body = JSON.parse(out.body) as { code?: string; retryAfter?: number };
    assert.equal(body.code, 'upstream_unreachable');
    assert.ok(Number.isInteger(body.retryAfter) && body.retryAfter! >= 1);
    assert.equal(String(out.headers['Retry-After']), String(body.retryAfter));
  } finally { mock.restore(); }
});

test('/api/wikipedia: "no article" stays a 404 without Retry-After', async () => {
  const mock = installFetchMock(() => ({ status: 404, json: {} }));
  try {
    const { res, out } = recorder();
    await handleRestRequest({ method: 'GET', url: '/api/wikipedia?q=Qwertzuiop' }, res);
    assert.equal(out.status, 404);
    assert.equal(out.headers['Retry-After'], undefined);
  } finally { mock.restore(); }
});

test('/ready: not ready says how long until the next probe can change the answer', async () => {
  resetReadinessForTest();
  const mock = installFetchMock(() => ({ status: 503, json: {} }));
  try {
    const { res, out } = recorder();
    await handleReady(res);
    assert.equal(out.status, 503);
    const body = JSON.parse(out.body) as { status?: string; retryAfter?: number };
    assert.equal(body.status, 'not_ready');
    // The answer is held for READY_CACHE_MS: asking sooner returns the same one.
    assert.ok(body.retryAfter! >= 1 && body.retryAfter! <= READY_CACHE_MS / 1000, String(body.retryAfter));
    assert.equal(String(out.headers['Retry-After']), String(body.retryAfter));
  } finally { mock.restore(); resetReadinessForTest(); }
});

const readyBody = (out: { body: string }) => JSON.parse(out.body) as { upstream?: string; retryAfter?: number };

test('/ready: the wait counts from when the answer ARRIVED, and shrinks as the cached answer ages', async () => {
  resetReadinessForTest();
  const realNow = Date.now;
  // A caller's clock far from the wall clock: only a wait computed from the
  // cache stamp comes out right — `checkedAt` is the probe's (wall-clock) start.
  const t0 = Date.UTC(2031, 0, 1);
  const mock = installFetchMock(() => {
    const started = realNow();
    Date.now = () => started + 4_000; // the probe took 4 s
    return { status: 503, json: {} };
  });
  try {
    const fresh = recorder();
    await handleReady(fresh.res, t0);
    assert.equal(fresh.out.status, 503);
    assert.equal(readyBody(fresh.out).retryAfter, READY_CACHE_MS / 1000, 'just arrived (at t0 + 4 s): it stands the whole cache time');
    assert.equal(String(fresh.out.headers['Retry-After']), String(READY_CACHE_MS / 1000));

    const aged = recorder();
    await handleReady(aged.res, t0 + 4_000 + 12_500); // 12.5 s after the answer arrived
    assert.equal(mock.calls.length, 1, 'still the cached answer');
    assert.equal(readyBody(aged.out).retryAfter, 18, '30 s − 12.5 s, rounded up');
    assert.equal(String(aged.out.headers['Retry-After']), '18');

    const last = recorder();
    await handleReady(last.res, t0 + 4_000 + READY_CACHE_MS - 200);
    assert.equal(readyBody(last.out).retryAfter, 1, 'never below one second');
    assert.deepEqual(Object.keys(JSON.parse(last.out.body) as object).sort(), ['checkedAt', 'ok', 'retryAfter', 'status', 'upstream'],
      'the internal wait does not leak into the body');
  } finally { Date.now = realNow; mock.restore(); resetReadinessForTest(); }
});

test('/ready: a probe still in flight answers slow with a SHORT wait — that answer is not cached', async () => {
  resetReadinessForTest();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => new Promise<Response>(() => { /* never answers */ })) as typeof fetch;
  nodeMock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { res, out } = recorder();
    const answered = handleReady(res);
    nodeMock.timers.tick(SLOW_MS);
    await answered;
    assert.equal(out.status, 503);
    assert.equal(readyBody(out).upstream, 'slow');
    assert.equal(readyBody(out).retryAfter, SLOW_RETRY_MS / 1000);
    assert.equal(String(out.headers['Retry-After']), String(SLOW_RETRY_MS / 1000));
    assert.ok(SLOW_RETRY_MS < READY_CACHE_MS);
  } finally { nodeMock.timers.reset(); globalThis.fetch = realFetch; resetReadinessForTest(); }
});

test('/ready: ready is a 200 and carries no Retry-After', async () => {
  resetReadinessForTest();
  // The probe is a one-hit ngsearch; any JSON search answer is "reachable".
  const mock = installFetchMock(() => ({ json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } }));
  try {
    const { res, out } = recorder();
    await handleReady(res);
    assert.match(mock.calls[0]!.url, /\/search\/v1\/queries\/-home-\/mds_oeh\/ngsearch\?/);
    assert.equal(out.status, 200);
    assert.equal(out.headers['Retry-After'], undefined);
    const body = JSON.parse(out.body) as Record<string, unknown>;
    assert.deepEqual([body['status'], body['ok'], body['upstream']], ['ready', true, 'ok']);
    assert.equal('retryAfter' in body, false);
  } finally { mock.restore(); resetReadinessForTest(); }
});
