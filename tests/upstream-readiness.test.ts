/**
 * upstream-readiness.test.ts – "is edu-sharing reachable?" answered cheaply
 * (plan 2026-11-07, S5/S6). One probe at most per 30 s however often it is
 * asked, never two at once, and a slow probe answers `slow` within 5 s instead
 * of holding the caller for the full upstream timeout.
 */

import { test, afterEach, mock as nodeMock } from 'node:test';
import assert from 'node:assert/strict';

import {
  READY_CACHE_MS, readiness, resetReadinessForTest, SLOW_MS, startReadinessProbe, stopReadinessProbe,
} from '../src/services/upstream-readiness.js';
import { wloFetch } from '../src/wlo-fetch.js';
import { setServiceCredentialForTest } from '../src/auth/credential.js';
import { installFetchMock } from './fetchMock.js';

afterEach(() => resetReadinessForTest());

const okSearch = () => ({ json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } });

test('reachable → ok; asked again within 30 s → the cached answer, no second probe', async () => {
  const mock = installFetchMock(okSearch);
  try {
    const first = await readiness(1_000);
    assert.equal(first.upstream, 'ok');
    assert.equal(first.ok, true);
    await readiness(1_000 + READY_CACHE_MS - 1);
    assert.equal(mock.calls.length, 1, 'one probe for both answers');
    await readiness(1_000 + READY_CACHE_MS + 1_000);
    assert.equal(mock.calls.length, 2, 'a stale answer is probed again');
  } finally { mock.restore(); }
});

test('two callers at once share one probe', async () => {
  const mock = installFetchMock(okSearch);
  try {
    const [a, b] = await Promise.all([readiness(5_000), readiness(5_000)]);
    assert.equal(a.upstream, 'ok');
    assert.equal(b.upstream, 'ok');
    assert.equal(mock.calls.length, 1);
  } finally { mock.restore(); }
});

test('a failing upstream → unreachable, not ok', async () => {
  const mock = installFetchMock(() => { throw new Error('ECONNREFUSED'); });
  try {
    const r = await readiness(9_000);
    assert.deepEqual([r.ok, r.upstream], [false, 'unreachable']);
  } finally { mock.restore(); }
});

test('an error status from the search is unreachable too', async () => {
  const mock = installFetchMock(() => ({ status: 503, text: 'busy' }));
  try {
    assert.equal((await readiness(12_000)).upstream, 'unreachable');
  } finally { mock.restore(); }
});

test('the slow threshold is 5 s', () => {
  assert.equal(SLOW_MS, 5_000);
  assert.equal(READY_CACHE_MS, 30_000);
});

test('a slow upstream call is described by path, duration and status — never the query string', async () => {
  const { slowUpstreamEntry, SLOW_UPSTREAM_MS } = await import('../src/wlo-fetch.js');
  assert.equal(SLOW_UPSTREAM_MS, 5_000);
  assert.equal(slowUpstreamEntry('https://repo.example/rest/search/v1/x?q=geheim', 4_999, 200), null);
  assert.deepEqual(slowUpstreamEntry('https://repo.example/rest/search/v1/x?q=geheim', 22_000, 200),
    { path: '/rest/search/v1/x', ms: 22_000, status: 200 });
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

test('a call that runs past the threshold and then FAILS is logged as slow too — the timeout is the cold path', async () => {
  const realNow = Date.now;
  const mock = installFetchMock(() => {
    const t0 = realNow();
    Date.now = () => t0 + 21_000; // the abort fires at the 20 s budget
    throw new Error('The operation was aborted due to timeout');
  });
  try {
    const logs = await captureLog(async () => {
      await assert.rejects(wloFetch('https://repo.example/edu-sharing/rest/search/v1/x?q=geheim'));
    });
    const slow = logs.find(l => l['message'] === 'slow upstream');
    assert.ok(slow, 'the slow call reaches the log even though it threw');
    assert.equal(slow['status'], 0, 'status 0 = no answer');
    assert.equal(slow['path'], '/edu-sharing/rest/search/v1/x');
  } finally { Date.now = realNow; mock.restore(); }
});

test('the periodic probe asks on EVERY tick, not only when the 30 s answer has gone stale', async () => {
  const mock = installFetchMock(okSearch);
  nodeMock.timers.enable({ apis: ['setInterval'] });
  try {
    startReadinessProbe(10_000);
    await new Promise(r => setImmediate(r));
    assert.equal(mock.calls.length, 1, 'the warm-up probe at start');
    nodeMock.timers.tick(10_000);
    await new Promise(r => setImmediate(r));
    assert.equal(mock.calls.length, 2, 'a 10 s interval probes at 10 s, though the cache holds 30 s');
  } finally { stopReadinessProbe(); nodeMock.timers.reset(); mock.restore(); }
});

test('the probe asks ANONYMOUSLY, also from the timer — a wrong service password is not an outage', async () => {
  setServiceCredentialForTest({ header: 'Basic c2VydmljZTpwdw==', label: 'service', source: 'service' });
  const mock = installFetchMock(okSearch);
  nodeMock.timers.enable({ apis: ['setInterval'] });
  try {
    startReadinessProbe(10_000);
    await new Promise(r => setImmediate(r));
    assert.equal(mock.calls.length, 1);
    assert.equal(new Headers(mock.calls[0]!.init?.headers as HeadersInit).get('authorization'), null,
      'no credential rides on the probe');
  } finally { stopReadinessProbe(); nodeMock.timers.reset(); mock.restore(); setServiceCredentialForTest(null); }
});

test('the cache counts from when the answer ARRIVED — a slow probe is not stale the moment it lands', async () => {
  const realNow = Date.now;
  const mock = installFetchMock(() => {
    const t0 = realNow();
    Date.now = () => t0 + 4_000; // the probe took 4 s
    return okSearch();
  });
  try {
    await readiness(100_000);
    await readiness(100_000 + READY_CACHE_MS + 1_000);
    assert.equal(mock.calls.length, 1, 'answer arrived at +4 s, so +31 s is still inside its 30 s');
  } finally { Date.now = realNow; mock.restore(); }
});

test('the periodic probe is started only from the HTTP entry point', async () => {
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.ts')) files.push(p);
    }
  };
  walk('src');
  const callers = files.filter(f => /startReadinessProbe\s*\(/.test(readFileSync(f, 'utf8'))
    && !f.endsWith(join('services', 'upstream-readiness.ts')));
  assert.deepEqual(callers.map(f => f.split('\\').join('/')), ['src/http.ts'],
    'a timer started on import would hit the network in every test');
});
