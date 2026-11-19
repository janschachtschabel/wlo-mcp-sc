/**
 * bapi-proxy-switch.test.ts – whether the b-api flow tools are on (2026-11-18).
 *
 * `WLO_BAPI_VIA_REPOSITORY` is the operator's word: `1` on, `0` off. Unset (or
 * `auto`) the HTTP server asks the repository at start — and again until it gets a
 * verdict — whether its b-api proxy
 * answers. The shapes pinned here were measured on staging on 2026-11-18,
 * anonymously: the proxy's flow list answers `200 []`, a path the repository
 * does not serve answers `404` with a JSON object (`{error, message}`).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { allowedFlows, droppedFlowNames, MAX_ANSWER_BYTES, probeBapiProxy } from '../src/services/bapi/jobs.js';
import { isDisabledFlag, isEnabledFlag } from '../src/env-flags.js';
import { NODE_METADATA_WRITE } from '../src/services/bapi/node-metadata-write.js';
import {
  bapiProxyDetection, bapiSwitch, bapiViaRepositoryEnabled, resetBapiProxyDetectionForTest, retryDelayMs,
  startBapiProxyDetection, warnOnBapiSettings,
} from '../src/services/bapi/proxy-switch.js';
import { connectedClient, installFetchMock, type MockResult } from './fetchMock.js';
import { env } from './env.js';

const SERVICE: WloCredential = { header: 'Basic c2VydmljZTpwdw==', label: 'dienst', source: 'service' };
const FLOW_TOOLS = ['wlo_cancel_flow', 'wlo_flow_status', 'wlo_list_flows', 'wlo_start_flow'];

function fresh(t: { after: (fn: () => void) => void }): void {
  resetBapiProxyDetectionForTest();
  t.after(() => resetBapiProxyDetectionForTest());
}

// ── the switch ───────────────────────────────────────────────────────────────

test('WLO_BAPI_VIA_REPOSITORY: unset, empty or auto = detect; the usual words for on and off; anything else = off', () => {
  for (const raw of [undefined, '', '  ', 'auto', ' AUTO ']) assert.deepEqual(bapiSwitch(raw), { mode: 'auto' }, String(raw));
  for (const raw of ['1', 'true', 'yes', 'on', ' On ']) assert.deepEqual(bapiSwitch(raw), { mode: 'on' }, raw);
  for (const raw of ['0', 'false', 'no', 'off', 'OFF']) assert.deepEqual(bapiSwitch(raw), { mode: 'off' }, raw);
  // A typo must not switch on a writing surface — and must not be silent either.
  for (const raw of ['ja', '2', 'enabled']) assert.deepEqual(bapiSwitch(raw), { mode: 'off', unrecognised: true }, raw);
});

test('the switch wins over the detection; auto follows it', (t) => {
  fresh(t);
  env(t, { WLO_BAPI_VIA_REPOSITORY: '1' });
  assert.equal(bapiViaRepositoryEnabled(), true, 'on without any detection');
  resetBapiProxyDetectionForTest('present');
  env(t, { WLO_BAPI_VIA_REPOSITORY: '0' });
  assert.equal(bapiViaRepositoryEnabled(), false, 'off although the proxy answers');
  env(t, { WLO_BAPI_VIA_REPOSITORY: 'kaputt' });
  assert.equal(bapiViaRepositoryEnabled(), false, 'an unrecognised value is off');
  env(t, { WLO_BAPI_VIA_REPOSITORY: undefined });
  assert.equal(bapiViaRepositoryEnabled(), true, 'auto + present');
  for (const state of ['pending', 'absent', 'unknown'] as const) {
    resetBapiProxyDetectionForTest(state);
    assert.equal(bapiViaRepositoryEnabled(), false, `auto + ${state}`);
  }
});

// ── the flows ────────────────────────────────────────────────────────────────

test('WLO_BAPI_FLOWS: unset or empty = node-metadata-write; none = none', (t) => {
  for (const raw of [undefined, '', '  ']) {
    env(t, { WLO_BAPI_FLOWS: raw });
    assert.deepEqual([...allowedFlows()], [NODE_METADATA_WRITE], String(raw));
  }
  for (const raw of ['none', ' NONE ']) {
    env(t, { WLO_BAPI_FLOWS: raw });
    assert.equal(allowedFlows().size, 0, raw);
  }
  // A list the operator wrote is taken as written — no default slipped in.
  env(t, { WLO_BAPI_FLOWS: 'other.ns/flow-1' });
  assert.deepEqual([...allowedFlows()], ['other.ns/flow-1']);
});

// ── the probe ────────────────────────────────────────────────────────────────

test('the probe asks the flow list ANONYMOUSLY — no service login, no DisableGuest', async (t) => {
  setServiceCredentialForTest(SERVICE);
  const seen: Array<{ url: string; headers: Headers }> = [];
  const mock = installFetchMock((url, init) => { seen.push({ url, headers: new Headers(init?.headers) }); return { json: [] }; });
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  assert.equal((await probeBapiProxy()).result, 'present');
  assert.equal(seen.length, 1);
  assert.match(seen[0]!.url, /\/rest\/bapi\/api\/v1\/jobs\/flows$/);
  assert.equal(seen[0]!.headers.get('authorization'), null, 'the service account says nothing about the proxy');
  // With DisableGuest an anonymous call is refused (401) — the guest's `200 []` is what tells the proxy is there.
  assert.equal(seen[0]!.headers.get('disableguest'), null);
});

test('the probe: 200 with a list = present; only the measured 404 = absent; everything else decides nothing', async (t) => {
  let answer: () => MockResult = () => ({ json: [] });
  const mock = installFetchMock(() => answer());
  t.after(() => mock.restore());
  const cases: Array<[string, () => MockResult, string]> = [
    ['200 []', () => ({ json: [] }), 'present'],
    ['200 with flows', () => ({ json: [{ namespace: 'a', id: 'b' }] }), 'present'],
    ['404 JSON (measured: no such path)', () => ({ status: 404, json: { error: '404', message: 'Not Found' } }), 'absent'],
    // A webapp still deploying answers a 404 PAGE — that is no word on the proxy.
    ['404 HTML', () => ({ status: 404, text: '<html>Not Found</html>', headers: { 'content-type': 'text/html' } }), 'unknown'],
    ['404 with a bare JSON string', () => ({ status: 404, json: 'Not Found' }), 'unknown'],
    ['404 with JSON null', () => ({ status: 404, json: null }), 'unknown'],
    ['404 with a JSON list', () => ({ status: 404, json: [] }), 'unknown'],
    ['200 but not a list', () => ({ json: { status: 'ok' } }), 'unknown'],
    ['200 HTML', () => ({ text: '<html></html>', headers: { 'content-type': 'text/html' } }), 'unknown'],
    // A repository whose guest is refused may still have the proxy.
    ['401 (anonymous refused)', () => ({ status: 401 }), 'unknown'],
    ['403', () => ({ status: 403 }), 'unknown'],
    ['302 (sent to a login or maintenance page)', () => ({ status: 302, headers: { location: '/login' } }), 'unknown'],
    ['429', () => ({ status: 429 }), 'unknown'],
    // A list past the read bound is not read — no verdict, not a guess.
    ['200 list past the read bound', () => ({ text: `[${' '.repeat(MAX_ANSWER_BYTES)}]` }), 'unknown'],
    ['503', () => ({ status: 503 }), 'unknown'],
    ['no answer', () => { throw new Error('ECONNREFUSED'); }, 'unknown'],
  ];
  for (const [name, a, expected] of cases) {
    answer = a;
    const got = await probeBapiProxy();
    assert.equal(got.result, expected, name);
  }
});

test('the probe: an answer whose body is lost is no answer, not a negative', async (t) => {
  const real = globalThis.fetch;
  for (const status of [200, 404]) {
    globalThis.fetch = (async () => new Response(new ReadableStream({
      start(c) { c.error(new Error('ECONNRESET')); },
    }), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    t.after(() => { globalThis.fetch = real; });
    assert.equal((await probeBapiProxy()).result, 'unknown', String(status));
  }
  globalThis.fetch = real;
});

// ── the detection ────────────────────────────────────────────────────────────

test('detection: present switches the tools on — on the full server', async (t) => {
  fresh(t);
  env(t, { WLO_BAPI_VIA_REPOSITORY: undefined });
  const mock = installFetchMock(() => ({ json: [] }));
  t.after(() => mock.restore());
  const before = await connectedClient();
  assert.deepEqual((await before.listTools()).tools.map(x => x.name).filter(n => FLOW_TOOLS.includes(n)), [],
    'nothing before the repository answered');
  await before.close();
  assert.equal(await startBapiProxyDetection(), 'present');
  const after = await connectedClient();
  assert.deepEqual((await after.listTools()).tools.map(x => x.name).filter(n => FLOW_TOOLS.includes(n)).sort(), FLOW_TOOLS);
  await after.close();
});

test('detection: absent keeps them off and asks no second time', async (t) => {
  fresh(t);
  env(t, { WLO_BAPI_VIA_REPOSITORY: undefined });
  let calls = 0;
  const mock = installFetchMock(() => { calls++; return { status: 404, json: { error: '404', message: 'Not Found' } }; });
  t.after(() => mock.restore());
  assert.equal(await startBapiProxyDetection(), 'absent');
  assert.equal(await startBapiProxyDetection(), 'absent');
  assert.equal(calls, 1);
  assert.equal(bapiViaRepositoryEnabled(), false);
});

test('detection: no verdict keeps them off and asks again later, until one comes', async (t) => {
  fresh(t);
  env(t, { WLO_BAPI_VIA_REPOSITORY: undefined });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let status = 503;
  let calls = 0;
  const mock = installFetchMock(() => { calls++; return status === 200 ? { json: [] } : { status }; });
  t.after(() => mock.restore());
  assert.equal(await startBapiProxyDetection(), 'unknown');
  assert.equal(bapiViaRepositoryEnabled(), false);
  t.mock.timers.tick(retryDelayMs(0));
  await new Promise(r => setImmediate(r));
  for (let i = 0; i < 10 && calls < 2; i++) await new Promise(r => setImmediate(r));
  assert.equal(calls, 2);
  assert.equal(bapiProxyDetection(), 'unknown');
  status = 200;
  // The second wait is the LONGER one: a millisecond short of it nothing is asked.
  t.mock.timers.tick(retryDelayMs(1) - 1);
  for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r));
  assert.equal(calls, 2, 'asked again before the second, longer wait was over');
  t.mock.timers.tick(1);
  for (let i = 0; i < 10 && bapiProxyDetection() !== 'present'; i++) await new Promise(r => setImmediate(r));
  assert.equal(calls, 3);
  assert.equal(bapiProxyDetection(), 'present');
  assert.equal(bapiViaRepositoryEnabled(), true);
});

test('a probe of an earlier generation writes nothing (test isolation)', async (t) => {
  fresh(t);
  env(t, { WLO_BAPI_VIA_REPOSITORY: undefined });
  let release: () => void = () => {};
  const real = globalThis.fetch;
  globalThis.fetch = (() => new Promise<Response>(r => { release = () => r(new Response('[]', { status: 200 })); })) as typeof fetch;
  t.after(() => { globalThis.fetch = real; });
  const late = startBapiProxyDetection();
  resetBapiProxyDetectionForTest('absent');
  release();
  await late;
  assert.equal(bapiProxyDetection(), 'absent', 'the reset state stands');
});

test('detection: present is final — nothing is asked again', async (t) => {
  fresh(t);
  env(t, { WLO_BAPI_VIA_REPOSITORY: undefined });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const mock = installFetchMock(() => { calls++; return { json: [] }; });
  t.after(() => mock.restore());
  assert.equal(await startBapiProxyDetection(), 'present');
  t.mock.timers.tick(60 * 60_000);
  for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r));
  assert.equal(calls, 1);
  assert.equal(bapiProxyDetection(), 'present');
});

test('detection: no verdict, then the measured 404 — ends absent and asks no more', async (t) => {
  fresh(t);
  env(t, { WLO_BAPI_VIA_REPOSITORY: undefined });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const mock = installFetchMock(() => {
    calls++;
    return calls === 1 ? { status: 503 } : { status: 404, json: { error: '404', message: 'Not Found' } };
  });
  t.after(() => mock.restore());
  assert.equal(await startBapiProxyDetection(), 'unknown');
  t.mock.timers.tick(retryDelayMs(0));
  for (let i = 0; i < 10 && bapiProxyDetection() !== 'absent'; i++) await new Promise(r => setImmediate(r));
  assert.equal(bapiProxyDetection(), 'absent');
  t.mock.timers.tick(60 * 60_000);
  for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r));
  assert.equal(calls, 2);
  assert.equal(bapiViaRepositoryEnabled(), false);
});

test('the retry waits grow and are capped', () => {
  assert.equal(retryDelayMs(0), 30_000);
  assert.equal(retryDelayMs(1), 60_000);
  assert.equal(retryDelayMs(10), 10 * 60_000);
});

test('a wrong setting is reported at start — also where nobody asks the repository (stdio)', (t) => {
  env(t, { WLO_BAPI_VIA_REPOSITORY: 'kaputt', WLO_BAPI_FLOWS: undefined });
  assert.deepEqual(warnOnBapiSettings(), ['switch']);
  env(t, { WLO_BAPI_VIA_REPOSITORY: '1', WLO_BAPI_FLOWS: `${NODE_METADATA_WRITE}, ns:id, a/b/c` });
  assert.equal(droppedFlowNames(), 2);
  assert.deepEqual(warnOnBapiSettings(), ['flows']);
  env(t, { WLO_BAPI_FLOWS: ' , ' });
  assert.equal(allowedFlows().size, 0);
  assert.deepEqual(warnOnBapiSettings(), ['flows'], 'a list that holds nothing is said, not a silent none');
  env(t, { WLO_BAPI_VIA_REPOSITORY: undefined, WLO_BAPI_FLOWS: 'none' });
  assert.deepEqual(warnOnBapiSettings(), []);
  env(t, { WLO_BAPI_FLOWS: undefined });
  assert.deepEqual(warnOnBapiSettings(), [], 'the default list is valid');
});

test('the on and the off spellings never overlap; empty is neither', () => {
  for (const raw of ['1', '0', 'true', 'false', 'yes', 'no', 'on', 'off', 'TRUE', ' Off ', '', 'auto', 'ja', '2', undefined, null]) {
    assert.ok(!(isEnabledFlag(raw) && isDisabledFlag(raw)), String(raw));
  }
  for (const raw of ['', '  ', undefined, null, 'auto']) {
    assert.equal(isEnabledFlag(raw), false, String(raw));
    assert.equal(isDisabledFlag(raw), false, String(raw));
  }
});

test('an operator who decided is not overruled: on or off asks the repository nothing', async (t) => {
  for (const raw of ['1', '0', 'kaputt']) {
    fresh(t);
    env(t, { WLO_BAPI_VIA_REPOSITORY: raw });
    let calls = 0;
    const mock = installFetchMock(() => { calls++; return { json: [] }; });
    try {
      await startBapiProxyDetection();
    } finally { mock.restore(); }
    assert.equal(calls, 0, raw);
    assert.equal(bapiViaRepositoryEnabled(), raw === '1', raw);
  }
});
