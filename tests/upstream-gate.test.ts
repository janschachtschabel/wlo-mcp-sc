/**
 * tests/upstream-gate.test.ts – the process-wide bound on calls to the repository,
 * and the request scope that stops work nobody is waiting for.
 *
 * Audit 2026-11-12, P-1: every bound was per CALL. One search with the OER
 * filter starts about 25 requests at once, and nothing bounded the process — so
 * ten people searching at the same moment were 250 simultaneous requests
 * against one repository.
 *
 * `fetchMock` answers synchronously and cannot hold a call open, so these tests
 * install their own `fetch` whose answers are released by hand.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { wloFetch } from '../src/wlo-fetch.js';
import { WLO_REPOSITORY_URL } from '../src/wlo-config.js';
import { acquireUpstreamSlot, releaseUpstreamSlot, setUpstreamLimitForTest, upstreamGateStats } from '../src/upstream-gate.js';
import { ClientGoneError, detachedFromRequest, runWithRequestSignal } from '../src/request-scope.js';
import { ngsearch } from '../src/wlo-search.js';
import { failureFields } from '../src/services/failure-code.js';
import { readiness, resetReadinessForTest } from '../src/services/upstream-readiness.js';
import { mapPool } from '../src/concurrency.js';
import { isUpstreamTimeout } from '../src/services/write/timeouts.js';

const REPO = `${WLO_REPOSITORY_URL}/rest/node/v1/nodes/-home-/x/metadata`;

/** A `fetch` whose every call stays open until `release` is called for it. */
function heldFetch() {
  const real = globalThis.fetch;
  const open: Array<{ url: string; signal?: AbortSignal | null; answer: (status?: number) => void }> = [];
  let peak = 0;
  let active = 0;
  globalThis.fetch = ((input: unknown, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    active++; peak = Math.max(peak, active);
    const entry = {
      url: String(input), signal: init?.signal,
      answer: (status = 200) => { active--; resolve(new Response('{}', { status })); },
    };
    open.push(entry);
    init?.signal?.addEventListener('abort', () => { active--; reject(init.signal!.reason); }, { once: true });
  })) as typeof fetch;
  return { open, peak: () => peak, restore: () => { globalThis.fetch = real; } };
}

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('no more than the limit is in flight at the repository — the rest waits its turn', async () => {
  setUpstreamLimitForTest(3);
  const net = heldFetch();
  try {
    const calls = Array.from({ length: 10 }, () => wloFetch(REPO));
    await tick();
    assert.equal(net.open.length, 3, 'three sent, seven waiting');
    assert.equal(upstreamGateStats().waiting, 7);

    // Each answer lets exactly one waiter through, in order.
    for (let sent = 3; sent < 10; sent++) {
      net.open[sent - 3]!.answer();
      await tick();
      assert.equal(net.open.length, sent + 1);
    }
    for (const call of net.open.slice(7)) call.answer();
    const results = await Promise.all(calls);
    assert.ok(results.every(r => r.status === 200));
    assert.equal(net.peak(), 3);
    assert.deepEqual(upstreamGateStats(), { inFlight: 0, waiting: 0, limit: 3 });
  } finally { net.restore(); setUpstreamLimitForTest(null); }
});

test('a slot is given back when the call FAILS, not only when it answers', async () => {
  setUpstreamLimitForTest(1);
  const real = globalThis.fetch;
  let n = 0;
  globalThis.fetch = (async () => { if (++n === 1) throw new Error('socket hang up'); return new Response('{}'); }) as typeof fetch;
  try {
    await assert.rejects(wloFetch(REPO), /socket hang up/);
    assert.equal((await wloFetch(REPO)).status, 200, 'the next call is not stuck behind a slot that was never returned');
    assert.equal(upstreamGateStats().inFlight, 0);
  } finally { globalThis.fetch = real; setUpstreamLimitForTest(null); }
});

test('only the repository is bounded — Wikipedia and the extraction service have their own hosts', async () => {
  setUpstreamLimitForTest(1);
  const net = heldFetch();
  try {
    const repo = wloFetch(REPO);
    const other = wloFetch('https://de.wikipedia.org/w/api.php?action=query');
    await tick();
    assert.equal(net.open.length, 2, 'the foreign call did not queue behind the repository');
    for (const call of net.open) call.answer();
    await Promise.all([repo, other]);
  } finally { net.restore(); setUpstreamLimitForTest(null); }
});

test('a call that waits longer than the bound is answered 503 with Retry-After — and was never sent', async () => {
  setUpstreamLimitForTest(1, { maxWaitMs: 40 });
  const net = heldFetch();
  try {
    const first = wloFetch(REPO);
    await tick();
    const second = await wloFetch(REPO);
    assert.equal(second.status, 503, 'the code every caller already reads as upstream_busy');
    assert.ok(Number(second.headers.get('retry-after')) >= 1);
    assert.equal(net.open.length, 1, 'nothing was sent for it');
    assert.equal(upstreamGateStats().waiting, 0, 'and it left the queue');
    net.open[0]!.answer();
    await first;
  } finally { net.restore(); setUpstreamLimitForTest(null); }
});

test('the timeout of a call starts when it is SENT, not while it waits for a slot', async () => {
  setUpstreamLimitForTest(1);
  const net = heldFetch();
  try {
    const first = wloFetch(REPO);
    const second = wloFetch(REPO);
    await tick();
    assert.equal(net.open.length, 1);
    net.open[0]!.answer();
    await first;
    await tick();
    assert.equal(net.open.length, 2);
    assert.equal(net.open[1]!.signal?.aborted, false, 'a fresh timeout — the wait did not spend it');
    net.open[1]!.answer();
    await second;
  } finally { net.restore(); setUpstreamLimitForTest(null); }
});

test('limit 0 switches the bound off', async () => {
  setUpstreamLimitForTest(0);
  const net = heldFetch();
  try {
    const calls = Array.from({ length: 30 }, () => wloFetch(REPO));
    await tick();
    assert.equal(net.open.length, 30);
    for (const call of net.open) call.answer();
    await Promise.all(calls);
  } finally { net.restore(); setUpstreamLimitForTest(null); }
});

// ── the request scope ────────────────────────────────────────────────────────

test('when the client is gone, a call in flight is aborted and a waiting one is never sent', async () => {
  setUpstreamLimitForTest(1);
  const net = heldFetch();
  const client = new AbortController();
  try {
    const [inFlight, waiting] = runWithRequestSignal(client.signal, () => [wloFetch(REPO), wloFetch(REPO)]);
    const settled = Promise.allSettled([inFlight, waiting]);
    await tick();
    assert.equal(net.open.length, 1);

    client.abort(new Error('client closed the connection'));
    const [a, b] = await settled;
    assert.equal(a.status, 'rejected');
    assert.equal(b.status, 'rejected');
    assert.equal(net.open.length, 1, 'the waiting call never reached the repository');
    assert.deepEqual(upstreamGateStats(), { inFlight: 0, waiting: 0, limit: 1 });
  } finally { net.restore(); setUpstreamLimitForTest(null); }
});

test('a request that is already gone starts nothing', async () => {
  setUpstreamLimitForTest(4);
  const net = heldFetch();
  const client = new AbortController();
  client.abort(new Error('gone'));
  try {
    await assert.rejects(runWithRequestSignal(client.signal, () => wloFetch(REPO)));
    assert.equal(net.open.length, 0);
  } finally { net.restore(); setUpstreamLimitForTest(null); }
});

test('work marked as detached runs to its end although the client is gone — a write and its read-back', async () => {
  setUpstreamLimitForTest(4);
  const net = heldFetch();
  const client = new AbortController();
  try {
    const call = runWithRequestSignal(client.signal, () => detachedFromRequest(() => wloFetch(REPO, { method: 'PUT' })));
    await tick();
    client.abort(new Error('client closed the connection'));
    await tick();
    assert.equal(net.open[0]!.signal?.aborted, false, 'the abort hits the response, not the work — so it must not be sent at all');
    net.open[0]!.answer();
    assert.equal((await call).status, 200);
  } finally { net.restore(); setUpstreamLimitForTest(null); }
});

test('a caller-supplied signal still aborts, with or without a request scope', async () => {
  setUpstreamLimitForTest(4);
  const net = heldFetch();
  const own = new AbortController();
  try {
    const call = wloFetch(REPO, { signal: own.signal });
    await tick();
    own.abort(new Error('own timeout'));
    await assert.rejects(call, /own timeout/);
  } finally { net.restore(); setUpstreamLimitForTest(null); }
});

// ── review of this package ───────────────────────────────────────────────────

test('granted and aborted in the same tick, in either order — no slot is lost and none is counted twice', async () => {
  for (const abortFirst of [true, false]) {
    setUpstreamLimitForTest(1);
    assert.equal(await acquireUpstreamSlot({ maxWaitMs: 1_000 }), true);
    const c = new AbortController();
    const waiting = acquireUpstreamSlot({ maxWaitMs: 1_000, signal: c.signal }).then(got => ({ got }), err => ({ err }));
    if (abortFirst) { c.abort(new Error('gone')); releaseUpstreamSlot(); }
    else { releaseUpstreamSlot(); c.abort(new Error('gone')); }
    const outcome = await waiting;
    // Whoever came first decides; the loser changes nothing.
    if ('got' in outcome) { assert.equal(outcome.got, true); releaseUpstreamSlot(); }
    assert.deepEqual(upstreamGateStats(), { inFlight: 0, waiting: 0, limit: 1 }, `abortFirst=${abortFirst}`);
    setUpstreamLimitForTest(null);
  }
});

test('a waiting call whose OWN signal fires is rejected with that reason — unsent, and gone from the queue', async () => {
  setUpstreamLimitForTest(1);
  const net = heldFetch();
  try {
    const first = wloFetch(REPO);
    await tick();
    const own = AbortSignal.timeout(30);
    await assert.rejects(wloFetch(REPO, { signal: own }), (err: unknown) => (err as Error).name === 'TimeoutError');
    assert.equal(net.open.length, 1);
    assert.equal(upstreamGateStats().waiting, 0);
    net.open[0]!.answer();
    await first;
  } finally { net.restore(); setUpstreamLimitForTest(null); }
});

test('a full queue turns a call away at once instead of making it wait the whole bound', async () => {
  setUpstreamLimitForTest(1, { maxWaitMs: 60_000 });
  const net = heldFetch();
  try {
    const first = wloFetch(REPO);
    await tick();
    const queued = Array.from({ length: 4 }, () => wloFetch(REPO));   // the queue holds 4 × the limit
    await tick();
    assert.equal(upstreamGateStats().waiting, 4);
    const before = Date.now();
    const turnedAway = await wloFetch(REPO);
    assert.equal(turnedAway.status, 503);
    assert.ok(Date.now() - before < 500, 'no waiting for an answer that is already known');
    net.open[0]!.answer();
    await first;
    for (let i = 1; i <= 4; i++) { await tick(); net.open[i]!.answer(); }
    await Promise.all(queued);
  } finally { net.restore(); setUpstreamLimitForTest(null); }
});

test('through a real caller the turned-away call reads as upstream_busy with the wait', async () => {
  setUpstreamLimitForTest(1, { maxWaitMs: 30 });
  const net = heldFetch();
  try {
    const first = wloFetch(REPO);
    await tick();
    const err = await ngsearch([{ property: 'ngsearchword', values: ['Optik'] }], 'FILES', 1, 0).then(() => null, e => e as unknown);
    assert.ok(err, 'ngsearch throws on a non-OK answer');
    assert.deepEqual(failureFields(err), { code: 'upstream_busy', retryAfter: 5 });
    net.open[0]!.answer();
    await first;
  } finally { net.restore(); setUpstreamLimitForTest(null); }
});

test('the readiness probe measures the REPOSITORY — a full gate of our own is not "unreachable"', async () => {
  setUpstreamLimitForTest(1, { maxWaitMs: 30 });
  resetReadinessForTest();
  const net = heldFetch();
  try {
    const busy = wloFetch(REPO);                 // the one slot is taken
    await tick();
    const probing = readiness();
    await tick();
    assert.equal(net.open.length, 2, 'the probe was SENT, past the gate');
    // Answered like a search: the probe is `ngsearch`.
    net.open[1]!.answer();
    const result = await probing;
    assert.notEqual(result.upstream, 'unreachable');
    net.open[0]!.answer();
    await busy;
  } finally { net.restore(); setUpstreamLimitForTest(null); resetReadinessForTest(); }
});

test('a hang-up is its own kind of error: not a timeout, so never an "open outcome"', () => {
  const gone = new ClientGoneError();
  assert.equal(isUpstreamTimeout(gone), false);
  assert.equal(failureFields(gone).code, 'upstream_error');
});

test('a fan-out stops when its client is gone — the remaining items are not started', async () => {
  const client = new AbortController();
  let started = 0;
  const results = await runWithRequestSignal(client.signal, () => mapPool(Array.from({ length: 100 }, (_, i) => i), 2, async (i) => {
    started++;
    if (i === 3) client.abort(new ClientGoneError());
    await tick();
    return i;
  }));
  assert.ok(started <= 6, `started ${started} of 100 after the client left`);
  assert.equal(results.length, 100, 'the shape is unchanged: one slot per item, null where nothing ran');
});

test('a hang-up is logged as an abandoned call, not as a tool error', async () => {
  const { toolError } = await import('../src/tools/shared.js');
  const realWrite = process.stderr.write.bind(process.stderr);
  const captured: string[] = [];
  process.stderr.write = ((chunk: unknown) => { captured.push(String(chunk)); return true; }) as never;
  try {
    toolError('Suche', new ClientGoneError());
    toolError('Suche', new Error('upstream 500'));
  } finally { process.stderr.write = realWrite; }
  const levels = captured.map(line => (JSON.parse(line) as { level: string }).level);
  assert.deepEqual(levels, ['info', 'error']);
});

// ── cross-package review of phase 2: a WRITE is not shed ─────────────────────

test('a write waits past the bound and past a full queue — it is never answered with a 503 it cannot tell from a real one', async () => {
  setUpstreamLimitForTest(1, { maxWaitMs: 30 });
  const net = heldFetch();
  try {
    const first = wloFetch(REPO);                                  // holds the one slot
    await tick();
    const queued = Array.from({ length: 4 }, () => wloFetch(REPO).then(r => r.status));   // fills the queue (4 × limit)
    await tick();
    const write = detachedFromRequest(() => wloFetch(REPO, { method: 'PUT' }));
    const read = await wloFetch(REPO);
    assert.equal(read.status, 503, 'a read meets the full queue and is turned away');

    // Past the wait bound: the queued reads are shed, the write is still waiting.
    assert.deepEqual(await Promise.all(queued), [503, 503, 503, 503]);
    assert.equal(upstreamGateStats().waiting, 1, 'only the write is left in the queue');

    net.open[0]!.answer();
    await first;
    await tick();
    assert.equal(net.open.length, 2, 'now it is sent');
    assert.equal(net.open[1]!.url, REPO);
    net.open[1]!.answer();
    assert.equal((await write).status, 200);
  } finally { net.restore(); setUpstreamLimitForTest(null); }
});

test('a waiting write still ends when its OWN timeout fires', async () => {
  setUpstreamLimitForTest(1);
  const net = heldFetch();
  try {
    const first = wloFetch(REPO);
    await tick();
    // (A controller with an ordinary timer: `AbortSignal.timeout` is unref'd, and
    // with nothing else pending the test's event loop would simply end.)
    const own = new AbortController();
    setTimeout(() => own.abort(new DOMException('own timeout', 'TimeoutError')), 30);
    await assert.rejects(detachedFromRequest(() => wloFetch(REPO, { method: 'PUT', signal: own.signal })),
      (err: unknown) => (err as Error).name === 'TimeoutError');
    assert.equal(upstreamGateStats().waiting, 0);
    net.open[0]!.answer();
    await first;
  } finally { net.restore(); setUpstreamLimitForTest(null); }
});
