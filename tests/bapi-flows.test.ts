/**
 * bapi-flows.test.ts – b-api flows through the repository's proxy (plan
 * 2026-11-17, chatbot team's wishes W1–W4, W6).
 *
 * The wire shapes pinned here are the ones measured on staging on 2026-11-17
 * (`scripts/bapi-proxy-probe.mjs`) and the chatbot team's description of the job
 * surface: 202 with `jobId`, the status words, 404 for an unknown or foreign
 * job, 409 for a finished one, 429 with `Retry-After`. A test against a fake
 * proves what we SEND; `tests/live/bapi-flows.test.ts` proves it is accepted.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import {
  allowedFlows, cancelFlow, failureFrom, flowStatus, isJobPath, listFlows, mapJobStatus, startFlow,
} from '../src/services/bapi/jobs.js';
import { checkNodes, parseInputs } from '../src/services/bapi/node-metadata-write.js';
import { clearJobOwnersForTest, ownsJob, recordJobOwner } from '../src/services/bapi/job-owners.js';
import { registerBapiFlowTools } from '../src/tools/bapi-flows.js';
import { connectedClient, installFetchMock, toolText, type MockResult } from './fetchMock.js';

const USER: WloCredential = { header: 'Basic dXNlcjpwdw==', label: 'maria', source: 'user' };
const SERVICE: WloCredential = { header: 'Basic c2VydmljZTpwdw==', label: 'dienst', source: 'service' };
const FLOW = 'edusharing.chatbot/node-metadata-write';

/** Per test, the values the environment had BEFORE its first change — restored once, after the test. */
const originals = new WeakMap<object, Map<string, string | undefined>>();

function env(t: { after: (fn: () => void) => void }, values: Record<string, string | undefined>): void {
  let saved = originals.get(t);
  if (!saved) {
    const fresh = new Map<string, string | undefined>();
    originals.set(t, fresh);
    t.after(() => { for (const [k, v] of fresh) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
    saved = fresh;
  }
  for (const k of Object.keys(values)) if (!saved.has(k)) saved.set(k, process.env[k]);
  for (const [k, v] of Object.entries(values)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
}

const headersOf = (init?: RequestInit) => new Headers(init?.headers);

// ── the job surface ──────────────────────────────────────────────────────────

test('only the four calls of the job surface are ever made — method and path together', () => {
  const ok: Array<['GET' | 'POST' | 'DELETE', string]> = [
    ['GET', '/api/v1/jobs/flows'], ['POST', `/api/v1/jobs/flows/${FLOW}`], ['GET', '/api/v1/jobs/abc-123?details=true'],
    ['GET', '/api/v1/jobs/abc-123'], ['DELETE', '/api/v1/jobs/abc-123'],
  ];
  for (const [m, p] of ok) assert.equal(isJobPath(m, p), true, `${m} ${p}`);
  const wrongMethod: Array<['GET' | 'POST' | 'DELETE', string]> = [
    ['DELETE', '/api/v1/jobs/flows'], ['POST', '/api/v1/jobs/flows'], ['GET', `/api/v1/jobs/flows/${FLOW}`],
    ['DELETE', `/api/v1/jobs/flows/${FLOW}`], ['POST', '/api/v1/jobs/abc-123'], ['DELETE', '/api/v1/jobs/abc-123?details=true'],
  ];
  for (const [m, p] of wrongMethod) assert.equal(isJobPath(m, p), false, `${m} ${p}`);
  for (const bad of ['/api/v1/llm/openai/models', '/api/v1/jobs/flows/a/b/c', '/api/v1/jobs/x/files/y', '/api/v1/jobs/..',
    '/api/v1/jobs/.', '/api/v1/jobs/a..b', '/api/v1/jobs/flows/../x', '/api/v1/jobs/flows/a/..', '/api/v1/jobs/flows/./x',
    '/api/v1/edu-sharing/repo/node/v1/nodes/-home-/x/metadata', '/api/v1/jobs/a%2Fb', '/api/v1/jobs/']) {
    for (const m of ['GET', 'POST', 'DELETE'] as const) assert.equal(isJobPath(m, bad), false, `${m} ${bad}`);
  }
});

test('WLO_BAPI_FLOWS: comma-separated names; anything else is ignored (default and none: bapi-proxy-switch.test.ts)', (t) => {
  env(t, { WLO_BAPI_FLOWS: ` ${FLOW} , kaputt, a/b/c, other.ns/flow-1 ` });
  assert.deepEqual([...allowedFlows()], [FLOW, 'other.ns/flow-1']);
});

test('the status words map to five states; one the b-api does not document is "unknown", never "running"', () => {
  for (const s of ['QUEUED', 'RUNNING', 'CREATED', 'PAUSED', 'RESTARTED', 'RETRYING', 'KILLING']) assert.equal(mapJobStatus(s), 'running', s);
  for (const s of ['SUCCEEDED', 'SUCCESS', 'WARNING']) assert.equal(mapJobStatus(s), 'succeeded', s);
  assert.equal(mapJobStatus('FAILED'), 'failed');
  assert.equal(mapJobStatus('CANCELLED'), 'cancelled');
  assert.equal(mapJobStatus('KILLED'), 'cancelled');
  assert.equal(mapJobStatus('SOMETHING_NEW'), 'unknown');
});

test('refusals of the b-api become reasons, with its own code and the wait', () => {
  assert.deepEqual(failureFrom({ status: 429, body: {}, retryAfter: 17 }, 'unknown_job'),
    { ok: false, status: 429, reason: 'rate_limited', retryAfter: 17 });
  assert.equal(failureFrom({ status: 400, body: { error: 'EDU_USER_REQUIRED' } }, 'unknown_job').reason, 'edu_user_required');
  assert.equal(failureFrom({ status: 400, body: { message: 'x' } }, 'unknown_job').reason, 'bad_inputs');
  const forbidden = failureFrom({ status: 403, body: { error: { code: 'LEGACY_HEADERS' } } }, 'unknown_job');
  assert.equal(forbidden.reason, 'rejected');
  assert.equal(forbidden.code, 'LEGACY_HEADERS');
  assert.equal(failureFrom({ status: 401, body: null }, 'unknown_job').reason, 'rejected');
  assert.equal(failureFrom({ status: 404, body: null }, 'unknown_job').reason, 'unknown_job');
  assert.equal(failureFrom({ status: 404, body: null }, 'not_allowed').reason, 'not_allowed');
  assert.equal(failureFrom({ status: 502, body: null }, 'unknown_job').reason, 'upstream_error');
});

test('a start goes to the repository\'s proxy as the person: her login, DisableGuest, nothing claimed', async (t) => {
  setServiceCredentialForTest(USER);
  const mock = installFetchMock(() => ({ status: 202, json: { jobId: 'job-1' } }));
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const started = await startFlow(FLOW, { node_ids: ['n1'], language: 'de' });
  assert.deepEqual(started, { ok: true, jobId: 'job-1' });
  assert.equal(mock.calls.length, 1);
  const { url, init } = mock.calls[0]!;
  assert.match(url, new RegExp(`/rest/bapi/api/v1/jobs/flows/${FLOW.replace('.', '\\.')}$`));
  assert.equal(init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(init?.body)), { node_ids: ['n1'], language: 'de' });
  const h = headersOf(init);
  assert.equal(h.get('authorization'), USER.header, 'the person\'s own login, on the repository host');
  assert.equal(h.get('disableguest'), 'true', 'a dead login must not continue as the guest');
  assert.equal(h.get('x-api-key'), null);
  assert.equal([...h.keys()].some(k => k.startsWith('x-edu-')), false);
});

test('without a personal login nothing is called: not the shared account, not anonymously', async (t) => {
  const mock = installFetchMock(() => ({ status: 202, json: { jobId: 'job-1' } }));
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  for (const cred of [SERVICE, null]) {
    setServiceCredentialForTest(cred);
    assert.deepEqual(await startFlow(FLOW, {}), { ok: false, reason: 'login_required' });
    assert.deepEqual(await listFlows(), { ok: false, reason: 'login_required' });
    assert.deepEqual(await flowStatus('job-1'), { ok: false, reason: 'login_required' });
    assert.deepEqual(await cancelFlow('job-1'), { ok: false, reason: 'login_required' });
  }
  assert.equal(mock.calls.length, 0);
});

test('a start the b-api did not clearly accept or refuse is OPEN, a 4xx started nothing', async (t) => {
  setServiceCredentialForTest(USER);
  let answer: MockResult = { status: 500, json: {} };
  const mock = installFetchMock(() => answer);
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const r500 = await startFlow(FLOW, {});
  assert.equal(!r500.ok && 'open' in r500 && r500.open, true, '5xx: a job may run');
  answer = { status: 202, json: {} };
  const noId = await startFlow(FLOW, {});
  assert.equal(!noId.ok && 'open' in noId && noId.open, true, 'accepted without an id: a job may run');
  answer = { status: 400, json: { error: 'EDU_USER_REQUIRED' } };
  const r400 = await startFlow(FLOW, {});
  assert.equal(!r400.ok && r400.reason, 'edu_user_required');
  assert.equal(!r400.ok && 'open' in r400, false, 'a 4xx is no open outcome');
  answer = { status: 429, json: {}, headers: { 'Retry-After': '30' } };
  const r429 = await startFlow(FLOW, {});
  assert.equal(!r429.ok && r429.retryAfter, 30);
  assert.equal(!r429.ok && r429.reason, 'rate_limited');
  assert.equal(!r429.ok && 'open' in r429 && r429.open, true, 'busy is no verdict (wroteNothing): a job may run');
});

test('status: mapped state, outputs only when finished and bounded, files without their download link', async (t) => {
  setServiceCredentialForTest(USER);
  let answer: MockResult = { json: { status: 'RUNNING' } };
  const mock = installFetchMock(() => answer);
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const running = await flowStatus('job-1');
  assert.equal(running.ok && running.state, 'running');
  assert.match(mock.calls[0]!.url, /\/rest\/bapi\/api\/v1\/jobs\/job-1\?details=true$/);
  answer = { json: { status: 'SUCCEEDED', warnings: false, outputs: { report: [{ nodeId: 'n1', status: 'OK' }] },
    files: [{ name: 'a.json', size: 3, outputId: 'o1', available: true, downloadUrl: 'https://x/secret' }] } };
  const done = await flowStatus('job-1');
  assert.ok(done.ok);
  if (!done.ok) return;
  assert.deepEqual(done.outputs, { report: [{ nodeId: 'n1', status: 'OK' }] });
  assert.deepEqual(done.files, [{ outputId: 'o1', name: 'a.json', size: 3, available: true }]);
  assert.equal(JSON.stringify(done).includes('downloadUrl'), false);
  answer = { json: { status: 'SUCCEEDED', outputs: { report: 'x'.repeat(1024 * 1024 + 10) } } };
  const big = await flowStatus('job-1');
  assert.equal(big.ok && big.truncated, true);
  assert.equal(big.ok && 'outputs' in big, false);
  answer = { json: { status: 'RUNNING', outputs: { partial: 1 } } };
  const early = await flowStatus('job-1');
  assert.equal(early.ok && 'outputs' in early, false, 'no outputs before success');
  answer = { status: 404, json: { error: 'Job not found' } };
  const unknown = await flowStatus('job-1');
  assert.equal(!unknown.ok && unknown.reason, 'unknown_job');
});

test('status of a flow with loops: progress counts and per-iteration states, numbers and codes only', async (t) => {
  // b-api documentation 2026-11-18: `progress` {started, running, succeeded,
  // warning, failed}; with `details=true` also `iterations` [{index, status,
  // error.code}], at most 200 (then a sample; the total is progress.started).
  setServiceCredentialForTest(USER);
  const mock = installFetchMock(() => ({ json: { status: 'RUNNING', warnings: true,
    progress: { started: 4, running: 1, succeeded: 1, warning: 0, failed: 1, extra: 'x' },
    iterations: [
      { index: 0, status: 'SUCCEEDED', value: 'never passed on' },
      { index: 1, status: 'FAILED', error: { code: 'WRITE_FAILED', message: 'not passed on either' } },
      { index: 2, status: 'RUNNING' },
      { index: 'x', status: 'SUCCEEDED' },
      { index: 3, status: 'WARNING' },
    ] } }));
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const s = await flowStatus('job-1');
  assert.ok(s.ok);
  if (!s.ok) return;
  assert.deepEqual(s.progress, { started: 4, running: 1, succeeded: 1, warning: 0, failed: 1 });
  // Numbers per state only — no index, no value, no code (team's plan, 18.11.).
  assert.deepEqual(s.iterations, { running: 1, succeeded: 2, warning: 1, failed: 1, cancelled: 0 });
  assert.equal('iterationsSampled' in s, false, 'every started iteration is in the list');
  assert.equal(JSON.stringify(s).includes('never passed on'), false);
  assert.equal(JSON.stringify(s).includes('WRITE_FAILED'), false);
});

test('a sampled iteration list (over 200) says so', async (t) => {
  setServiceCredentialForTest(USER);
  const iterations = Array.from({ length: 200 }, (_, i) => ({ index: i, status: 'SUCCEEDED' }));
  const mock = installFetchMock(() => ({ json: { status: 'RUNNING', progress: { started: 450, running: 250, succeeded: 200, warning: 0, failed: 0 }, iterations } }));
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const s = await flowStatus('job-1');
  assert.equal(s.ok && s.iterationsSampled, true);
});

test('cancel: 2xx cancelled, 409 already finished, 404 unknown (or another person\'s)', async (t) => {
  setServiceCredentialForTest(USER);
  let status = 202;
  const mock = installFetchMock(() => ({ status, json: {} }));
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  assert.deepEqual(await cancelFlow('job-1'), { ok: true, outcome: 'cancelled' });
  assert.equal(mock.calls[0]!.init?.method, 'DELETE');
  status = 409;
  assert.deepEqual(await cancelFlow('job-1'), { ok: true, outcome: 'already_finished' });
  status = 404;
  assert.deepEqual(await cancelFlow('job-1'), { ok: true, outcome: 'unknown_job' });
});

test('the flow list is cut to WLO_BAPI_FLOWS and to active flows', async (t) => {
  setServiceCredentialForTest(USER);
  env(t, { WLO_BAPI_FLOWS: `${FLOW},x.y/inactive` });
  const mock = installFetchMock(() => ({ json: [
    { namespace: 'edusharing.chatbot', flowId: 'node-metadata-write', description: 'schreibt', inputSchema: { type: 'object' }, active: true },
    { namespace: 'x.y', flowId: 'inactive', active: false },
    { namespace: 'other', flowId: 'not-listed', active: true },
  ] }));
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const l = await listFlows();
  assert.ok(l.ok);
  assert.deepEqual(l.ok && l.flows.map(f => f.flow), [FLOW]);
});

// ── the checks before node-metadata-write ────────────────────────────────────

test('node-metadata-write takes 1–50 distinct ids and de/en, nothing else', () => {
  assert.equal(parseInputs({ node_ids: ['a1'] }).ok, true);
  assert.equal(parseInputs({ node_ids: [] }).ok, false);
  assert.equal(parseInputs({ node_ids: Array.from({ length: 51 }, (_, i) => `n${i}`) }).ok, false);
  assert.equal(parseInputs({ node_ids: ['a1', 'a1'] }).ok, false);
  assert.equal(parseInputs({ node_ids: ['a1'], language: 'fr' }).ok, false);
  assert.equal(parseInputs({ node_ids: ['a1'], extra: 1 }).ok, false);
  assert.equal(parseInputs({ node_ids: ['a/../b'] }).ok, false);
  const ok = parseInputs({ node_ids: ['a1'] });
  assert.equal(ok.ok && ok.language, 'de');
});

function repository(nodes: Record<string, MockResult>) {
  return (url: string): MockResult => {
    const m = /\/nodes\/-home-\/([^/]+)\/metadata/.exec(url);
    if (m && nodes[m[1]!]) return nodes[m[1]!]!;
    return { status: 404, json: {} };
  };
}
const record = (id: string, title: string, extra: Record<string, unknown> = {}): MockResult => ({ json: { node: {
  ref: { id }, type: 'ccm:io', aspects: [], access: ['Read', 'Write'], properties: { 'cclom:title': [title] }, ...extra,
} } });

test('each id must be a writable record of its own — not a collection, not a reference, not foreign', async (t) => {
  setServiceCredentialForTest(USER);
  const mock = installFetchMock(repository({
    good: record('good', 'Bruchrechnung'),
    coll: record('coll', 'Mathe', { type: 'ccm:map', aspects: ['ccm:collection'] }),
    ref: record('ref', 'Kopie', { aspects: ['ccm:collection_io_reference'] }),
    ro: record('ro', 'Fremd', { access: ['Read'] }),
    hidden: { status: 403, json: {} },
  }));
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const checked = await checkNodes(['good', 'coll', 'ref', 'ro', 'hidden', 'gone'], 'de');
  assert.equal(checked.ok, false);
  if (checked.ok) return;
  assert.equal(checked.reason, 'bad_inputs');
  assert.deepEqual(checked.problems, [
    { nodeId: 'coll', problem: 'not_a_record' }, { nodeId: 'ref', problem: 'is_reference' },
    { nodeId: 'ro', problem: 'not_writable' }, { nodeId: 'hidden', problem: 'not_readable' },
    { nodeId: 'gone', problem: 'not_found' },
  ]);
  const fine = await checkNodes(['good'], 'en');
  assert.deepEqual(fine, { ok: true, nodes: [{ nodeId: 'good', title: 'Bruchrechnung' }], language: 'en' });
});

test('a read that did not answer is no "no": unchecked, and the set is worth trying again', async (t) => {
  setServiceCredentialForTest(USER);
  const mock = installFetchMock(repository({ a: { status: 503, json: {} } }));
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const checked = await checkNodes(['a'], 'de');
  assert.equal(!checked.ok && checked.reason, 'upstream_error');
});

// ── the tools ────────────────────────────────────────────────────────────────

async function client(): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerBapiFlowTools(server, 'Bearer error="invalid_request"');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  await c.listTools();
  return c;
}

test('the four tools exist only when switched on — on the full server', async (t) => {
  const names = ['wlo_cancel_flow', 'wlo_flow_status', 'wlo_list_flows', 'wlo_start_flow'];
  env(t, { WLO_BAPI_VIA_REPOSITORY: '0' });
  const off = await connectedClient();
  assert.deepEqual((await off.listTools()).tools.map(x => x.name).filter(n => names.includes(n)), []);
  await off.close();
  env(t, { WLO_BAPI_VIA_REPOSITORY: '1' });
  const on = await connectedClient();
  assert.deepEqual((await on.listTools()).tools.map(x => x.name).filter(n => names.includes(n)).sort(), names);
  await on.close();
});

test('wlo_start_flow: preview names every record and what is overwritten, the key starts exactly once', async (t) => {
  env(t, { WLO_BAPI_VIA_REPOSITORY: '1', WLO_BAPI_FLOWS: FLOW });
  setServiceCredentialForTest(USER);
  const posts: unknown[] = [];
  const nodes = repository({ n1: record('n1', 'Bruchrechnung'), n2: record('n2', 'Prozente') });
  const mock = installFetchMock((url, init) => {
    if (url.includes('/rest/bapi/')) { posts.push(JSON.parse(String(init?.body))); return { status: 202, json: { jobId: 'job-7' } }; }
    return nodes(url);
  });
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  try {
    const args = { flow: FLOW, inputs: { node_ids: ['n1', 'n2'] } };
    const preview = await c.callTool({ name: 'wlo_start_flow', arguments: args });
    assert.equal(preview.isError, undefined);
    const text = toolText(preview);
    assert.match(text, /- n1 „Bruchrechnung“/);
    assert.match(text, /- n2 „Prozente“/);
    assert.match(text, /Überschreibt Titel, Beschreibung, Schlagworte, Fach, Bildungsstufe, Zielgruppe, Ressourcentyp und Sprache/);
    const sc = preview.structuredContent as { status: string; confirm: { token: string } };
    assert.equal(sc.status, 'preview');
    assert.equal(posts.length, 0, 'a preview starts nothing');

    const started = await c.callTool({ name: 'wlo_start_flow', arguments: { ...args, confirmToken: sc.confirm.token } });
    assert.deepEqual(started.structuredContent, { status: 'started', jobId: 'job-7', flow: FLOW });
    assert.deepEqual(posts, [{ node_ids: ['n1', 'n2'], language: 'de' }], 'the checked inputs, with the language made explicit');

    const again = await c.callTool({ name: 'wlo_start_flow', arguments: { ...args, confirmToken: sc.confirm.token } });
    assert.equal((again.structuredContent as { replayed?: boolean }).replayed, true);
    assert.equal(posts.length, 1, 'the same key never starts a second job');
  } finally { await c.close(); }
});

test('wlo_start_flow refuses before anything is sent: a flow not released, ids that do not fit', async (t) => {
  env(t, { WLO_BAPI_VIA_REPOSITORY: '1', WLO_BAPI_FLOWS: FLOW });
  setServiceCredentialForTest(USER);
  const mock = installFetchMock(repository({ ro: record('ro', 'Fremd', { access: ['Read'] }) }));
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  try {
    const other = await c.callTool({ name: 'wlo_start_flow', arguments: { flow: 'other/flow', inputs: {} } });
    assert.equal((other.structuredContent as { reason: string }).reason, 'not_allowed');
    const bad = await c.callTool({ name: 'wlo_start_flow', arguments: { flow: FLOW, inputs: { node_ids: ['ro'] } } });
    assert.deepEqual((bad.structuredContent as { problems: unknown }).problems, [{ nodeId: 'ro', problem: 'not_writable' }]);
    assert.equal(mock.calls.some(c2 => c2.url.includes('/rest/bapi/')), false);
  } finally { await c.close(); }
});

test('wlo_start_flow: no usable answer after the confirmation is OPEN, never "failed, nothing happened"', async (t) => {
  env(t, { WLO_BAPI_VIA_REPOSITORY: '1', WLO_BAPI_FLOWS: FLOW });
  setServiceCredentialForTest(USER);
  const nodes = repository({ n1: record('n1', 'Bruchrechnung') });
  const mock = installFetchMock((url) => (url.includes('/rest/bapi/') ? { status: 502, json: {} } : nodes(url)));
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  try {
    const args = { flow: FLOW, inputs: { node_ids: ['n1'] } };
    const token = ((await c.callTool({ name: 'wlo_start_flow', arguments: args })).structuredContent as { confirm: { token: string } }).confirm.token;
    const r = await c.callTool({ name: 'wlo_start_flow', arguments: { ...args, confirmToken: token } });
    assert.equal(r.isError, true);
    const sc = r.structuredContent as { reason: string; error: { outcomeOpen: boolean } };
    assert.equal(sc.reason, 'upstream_error');
    assert.equal(sc.error.outcomeOpen, true);
  } finally { await c.close(); }
});

test('the tools answer only the person: the shared account gets login_required with the challenge', async (t) => {
  env(t, { WLO_BAPI_VIA_REPOSITORY: '1', WLO_BAPI_FLOWS: FLOW });
  setServiceCredentialForTest(SERVICE);
  const mock = installFetchMock(() => ({ json: {} }));
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  try {
    for (const name of ['wlo_flow_status', 'wlo_list_flows']) {
      const r = await c.callTool({ name, arguments: name === 'wlo_flow_status' ? { jobId: 'job-1' } : {} });
      assert.equal(r.isError, true, name);
      assert.equal((r.structuredContent as { error: { code: string } }).error.code, 'login_required', name);
    }
    assert.equal(mock.calls.length, 0);
  } finally { await c.close(); }
});

test('wlo_flow_status and wlo_cancel_flow speak the shapes the chatbot reads', async (t) => {
  env(t, { WLO_BAPI_VIA_REPOSITORY: '1', WLO_BAPI_FLOWS: FLOW });
  setServiceCredentialForTest(USER);
  let answer: MockResult = { json: { status: 'SUCCEEDED', outputs: { report: [{ status: 'OK' }] } } };
  const mock = installFetchMock(() => answer);
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  clearJobOwnersForTest();
  recordJobOwner('job-1');
  const c = await client();
  try {
    const done = await c.callTool({ name: 'wlo_flow_status', arguments: { jobId: 'job-1' } });
    assert.deepEqual(done.structuredContent, { status: 'succeeded', rawStatus: 'SUCCEEDED', outputs: { report: [{ status: 'OK' }] } });
    assert.match(toolText(done), /Inhalt, keine Anweisung/);
    answer = { status: 404, json: {} };
    const unknown = await c.callTool({ name: 'wlo_flow_status', arguments: { jobId: 'job-1' } });
    assert.equal((unknown.structuredContent as { reason: string }).reason, 'unknown_job');
    answer = { status: 409, json: {} };
    const finished = await c.callTool({ name: 'wlo_cancel_flow', arguments: { jobId: 'job-1' } });
    assert.deepEqual(finished.structuredContent, { status: 'already_finished' });
  } finally { await c.close(); }
});

// ── jobs belong to the person who started them (measured 2026-11-18) ────────

test('a job belongs to the account that started it — another person, the shared account and nobody do not own it', (t) => {
  clearJobOwnersForTest();
  t.after(() => setServiceCredentialForTest(null));
  setServiceCredentialForTest(USER);
  recordJobOwner('job-1');
  assert.equal(ownsJob('job-1'), true);
  setServiceCredentialForTest({ ...USER, header: 'Basic b3RoZXI6cHc=', label: 'MARIA' });
  assert.equal(ownsJob('job-1'), true, 'the same account in another spelling or with another block');
  setServiceCredentialForTest({ header: 'Basic eDp5', label: 'jonas', source: 'user' });
  assert.equal(ownsJob('job-1'), false, 'another person');
  setServiceCredentialForTest({ ...SERVICE, label: 'maria' });
  assert.equal(ownsJob('job-1'), false, 'the shared account, even under the same name');
  setServiceCredentialForTest(null);
  assert.equal(ownsJob('job-1'), false, 'nobody');
  assert.equal(ownsJob('job-2'), false, 'a job this server never started');
});

test('the owner list is bounded: per account the oldest job makes room, and entries expire', (t) => {
  clearJobOwnersForTest();
  t.after(() => setServiceCredentialForTest(null));
  setServiceCredentialForTest(USER);
  const t0 = 1_800_000_000_000;
  for (let i = 0; i < 501; i++) recordJobOwner(`job-${i}`, t0 + i);
  assert.equal(ownsJob('job-0', t0 + 600), false, 'the oldest of 501 made room');
  assert.equal(ownsJob('job-500', t0 + 600), true);
  assert.equal(ownsJob('job-500', t0 + 31 * 24 * 3600 * 1000), false, 'after 30 days (the b-api keeps a job no longer)');
});

test('wlo_flow_status and wlo_cancel_flow ask the b-api only about the caller\'s own jobs', async (t) => {
  env(t, { WLO_BAPI_VIA_REPOSITORY: '1', WLO_BAPI_FLOWS: FLOW });
  clearJobOwnersForTest();
  setServiceCredentialForTest(USER);
  const nodes = repository({ n1: record('n1', 'Bruchrechnung') });
  const mock = installFetchMock((url, init) => {
    if (url.includes('/rest/bapi/api/v1/jobs/flows/')) return { status: 202, json: { jobId: 'job-mine' } };
    if (url.includes('/rest/bapi/')) return init?.method === 'DELETE' ? { status: 202, json: {} } : { json: { status: 'RUNNING' } };
    return nodes(url);
  });
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  try {
    const args = { flow: FLOW, inputs: { node_ids: ['n1'] } };
    const token = ((await c.callTool({ name: 'wlo_start_flow', arguments: args })).structuredContent as { confirm: { token: string } }).confirm.token;
    await c.callTool({ name: 'wlo_start_flow', arguments: { ...args, confirmToken: token } });
    const mine = await c.callTool({ name: 'wlo_flow_status', arguments: { jobId: 'job-mine' } });
    assert.equal((mine.structuredContent as { status: string }).status, 'running');

    const before = mock.calls.length;
    const foreign = await c.callTool({ name: 'wlo_flow_status', arguments: { jobId: 'job-of-someone-else' } });
    assert.equal((foreign.structuredContent as { reason: string }).reason, 'unknown_job');
    setServiceCredentialForTest({ header: 'Basic eDp5', label: 'jonas', source: 'user' });
    const notHis = await c.callTool({ name: 'wlo_cancel_flow', arguments: { jobId: 'job-mine' } });
    assert.deepEqual(notHis.structuredContent, { status: 'unknown_job' });
    assert.equal(mock.calls.length, before, 'nothing was asked of the b-api for a job that is not the caller\'s');
  } finally { await c.close(); }
});

// ── review 2026-11-18 ────────────────────────────────────────────────────────

/** Preview, then the confirmed call, for the start tool. */
async function previewThenConfirm(c: Client, args: Record<string, unknown>) {
  const preview = await c.callTool({ name: 'wlo_start_flow', arguments: args });
  const token = (preview.structuredContent as { confirm: { token: string } }).confirm.token;
  return { preview, confirmed: await c.callTool({ name: 'wlo_start_flow', arguments: { ...args, confirmToken: token } }), token };
}

test('a 4xx after the confirmation started nothing — said as such, never "may have written"', async (t) => {
  env(t, { WLO_BAPI_VIA_REPOSITORY: '1', WLO_BAPI_FLOWS: FLOW });
  clearJobOwnersForTest();
  setServiceCredentialForTest(USER);
  const nodes = repository({ n1: record('n1', 'Bruchrechnung') });
  let answer: MockResult = { status: 400, json: { error: 'EDU_USER_REQUIRED' } };
  const mock = installFetchMock((url) => (url.includes('/rest/bapi/') ? answer : nodes(url)));
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  try {
    const { confirmed } = await previewThenConfirm(c, { flow: FLOW, inputs: { node_ids: ['n1'] } });
    const sc = confirmed.structuredContent as { reason: string; error: { outcomeOpen: boolean } };
    assert.equal(sc.reason, 'edu_user_required');
    assert.equal(sc.error.outcomeOpen, false);
    assert.doesNotMatch(toolText(confirmed), /Es kann bereits etwas geschrieben sein/);

    // A 429 is no verdict (`wroteNothing`): open, with its reason and the wait.
    answer = { status: 429, json: {}, headers: { 'Retry-After': '30' } };
    const busy = (await previewThenConfirm(c, { flow: FLOW, inputs: { node_ids: ['n1'] } })).confirmed;
    const b = busy.structuredContent as { reason: string; retryAfter: number; error: { outcomeOpen: boolean } };
    assert.equal(b.reason, 'rate_limited');
    assert.equal(b.retryAfter, 30);
    assert.equal(b.error.outcomeOpen, true);
  } finally { await c.close(); }
});

test('no answer at all after the confirmation is OPEN', async (t) => {
  env(t, { WLO_BAPI_VIA_REPOSITORY: '1', WLO_BAPI_FLOWS: FLOW });
  setServiceCredentialForTest(USER);
  const nodes = repository({ n1: record('n1', 'Bruchrechnung') });
  const mock = installFetchMock((url) => { if (url.includes('/rest/bapi/')) throw new TypeError('fetch failed'); return nodes(url); });
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  try {
    const { confirmed } = await previewThenConfirm(c, { flow: FLOW, inputs: { node_ids: ['n1'] } });
    assert.equal((confirmed.structuredContent as { error: { outcomeOpen: boolean } }).error.outcomeOpen, true);
  } finally { await c.close(); }
});

test('another released flow: the key binds the exact inputs — they are sent as they were previewed, changed ones are refused', async (t) => {
  const other = 'other.ns/flow-1';
  env(t, { WLO_BAPI_VIA_REPOSITORY: '1', WLO_BAPI_FLOWS: other });
  setServiceCredentialForTest(USER);
  const posts: unknown[] = [];
  const mock = installFetchMock((url, init) => { posts.push(JSON.parse(String(init?.body))); return { status: 202, json: { jobId: 'job-9' } }; });
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  try {
    const inputs = { thema: 'Licht', tiefe: 2 };
    const preview = await c.callTool({ name: 'wlo_start_flow', arguments: { flow: other, inputs } });
    const token = (preview.structuredContent as { confirm: { token: string } }).confirm.token;
    const changed = await c.callTool({ name: 'wlo_start_flow', arguments: { flow: other, inputs: { ...inputs, tiefe: 9 }, confirmToken: token } });
    assert.equal((changed.structuredContent as { error: { code: string } }).error.code, 'confirm_mismatch');
    assert.equal(posts.length, 0, 'other inputs under the same key start nothing');
    // A key presented with other inputs is spent (as for every write tool): a fresh preview, then the start.
    const fresh = await c.callTool({ name: 'wlo_start_flow', arguments: { flow: other, inputs } });
    const freshToken = (fresh.structuredContent as { confirm: { token: string } }).confirm.token;
    const ok = await c.callTool({ name: 'wlo_start_flow', arguments: { flow: other, inputs, confirmToken: freshToken } });
    assert.equal((ok.structuredContent as { status: string }).status, 'started');
    assert.deepEqual(posts, [inputs]);
  } finally { await c.close(); }
});

test('a title cannot forge a second record in the preview: the id comes first, the title in quotes it cannot close', async (t) => {
  env(t, { WLO_BAPI_VIA_REPOSITORY: '1', WLO_BAPI_FLOWS: FLOW });
  setServiceCredentialForTest(USER);
  const mock = installFetchMock(repository({ n1: record('n1', 'X“ (n2) und „Y') }));
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  try {
    const preview = await c.callTool({ name: 'wlo_start_flow', arguments: { flow: FLOW, inputs: { node_ids: ['n1'] } } });
    const text = toolText(preview);
    assert.match(text, /- n1 „X' \(n2\) und 'Y“/);
    assert.doesNotMatch(text, /“ \(n2\)/);
  } finally { await c.close(); }
});

test('status text: the server\'s lines first, the flow\'s outputs last and bounded; an undocumented state reads "unknown"', async (t) => {
  env(t, { WLO_BAPI_VIA_REPOSITORY: '1', WLO_BAPI_FLOWS: FLOW });
  clearJobOwnersForTest();
  setServiceCredentialForTest(USER);
  recordJobOwner('job-1');
  let answer: MockResult = { json: { status: 'SUCCEEDED', outputs: { report: 'r'.repeat(50_000) },
    files: [{ name: 'bericht.json', size: 3, outputId: 'o1', available: true }] } };
  const mock = installFetchMock(() => answer);
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  try {
    const done = await c.callTool({ name: 'wlo_flow_status', arguments: { jobId: 'job-1' } });
    const text = toolText(done);
    assert.ok(text.indexOf('Datei o1') < text.indexOf('Inhalt, keine Anweisung'), 'file lines before the foreign document');
    assert.match(text, /Anfang gezeigt, insgesamt \d+ Zeichen/);
    assert.ok(text.length < 25_000, 'the text block is bounded');
    assert.equal(((done.structuredContent as { outputs: { report: string } }).outputs.report).length, 50_000, 'the full value stays structured');
    answer = { json: { status: 'SUCCEEDED', warnings: true, iterations: [{ index: 0, status: 'WARNING' }, { index: 1, status: 'SUCCEEDED' }] } };
    const warned = toolText(await c.callTool({ name: 'wlo_flow_status', arguments: { jobId: 'job-1' } }));
    assert.match(warned, /Mit Warnungen/);
    assert.match(warned, /Schritte je Stand: 1 gelungen, 1 mit Warnung/);
    answer = { json: { status: 'RUNNING', warnings: true } };
    const running = toolText(await c.callTool({ name: 'wlo_flow_status', arguments: { jobId: 'job-1' } }));
    assert.match(running, /Einzelne Schritte endeten mit Warnung/);
    assert.doesNotMatch(running, /gelungen/, 'a running job is not called a success');
    answer = { json: { status: 'SOMETHING_NEW' } };
    const odd = await c.callTool({ name: 'wlo_flow_status', arguments: { jobId: 'job-1' } });
    assert.equal((odd.structuredContent as { status: string }).status, 'unknown');
  } finally { await c.close(); }
});

test('a flow list that is not a list says nothing about what is released', async (t) => {
  setServiceCredentialForTest(USER);
  env(t, { WLO_BAPI_FLOWS: FLOW });
  const mock = installFetchMock(() => ({ json: { flows: 'kaputt' } }));
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const l = await listFlows();
  assert.equal(!l.ok && l.reason, 'upstream_error');
});
