/**
 * tests/curation-open-outcomes.test.ts – what a write tool may say when it does
 * not know (audit 2026-11-12, package 7: K-4, K-5, K-7, A-4).
 *
 * The rule under all four: "failed" and "nothing was written" are statements of
 * fact, and a client acts on them by writing again. They may be said only where
 * they are known.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { isConnectionLost, isOutcomeOpen, isUpstreamTimeout } from '../src/services/write/timeouts.js';
import { planErrorReply } from '../src/tools/curation-plan-reply.js';
import { canonicalArgs } from '../src/tools/curation-plan.js';
import { confirmOrExplain, reportOutcome, timeoutOrError } from '../src/tools/curation-shared.js';
import { buildChangeSet } from '../src/services/write/change-set.js';
import { ClientGoneError } from '../src/request-scope.js';

const errorOf = (r: unknown) => (r as { structuredContent?: { error?: { code?: string; outcomeOpen?: boolean } } }).structuredContent?.error;
const textOf = (r: unknown) => (r as { content: Array<{ text: string }> }).content.map(c => c.text).join('\n');

/** `fetch` reports a network failure as `TypeError: fetch failed` with the reason in `cause`. */
const fetchFailed = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) });

// ── K-4: sent, no answer ─────────────────────────────────────────────────────

test('a connection that died after the request left is an OPEN outcome, like a timeout', () => {
  for (const code of ['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']) {
    assert.equal(isConnectionLost(fetchFailed(code)), true, code);
    assert.equal(isOutcomeOpen(fetchFailed(code)), true, code);
  }
  assert.equal(isOutcomeOpen(new Error('socket hang up')), true);
  assert.equal(isOutcomeOpen(new TypeError('fetch failed')), true, 'a failure we cannot place is open — the safe side for a write');
});

test('a request that provably never left is a refusal, not an open outcome', () => {
  for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'CERT_HAS_EXPIRED']) {
    assert.equal(isOutcomeOpen(fetchFailed(code)), false, code);
  }
});

test('what is NOT a lost connection: our own errors, an upstream refusal, a client that hung up', () => {
  assert.equal(isOutcomeOpen(new Error('ngsearch failed: 500')), false);
  assert.equal(isOutcomeOpen(new TypeError("Cannot read properties of undefined (reading 'x')")), false);
  assert.equal(isOutcomeOpen(new ClientGoneError()), false);
  assert.equal(isOutcomeOpen('fetch failed'), false);
  // And the old question keeps its old answer: a reset is not a TIMEOUT.
  assert.equal(isUpstreamTimeout(fetchFailed('ECONNRESET')), false);
});

test('a write tool reports a lost connection as open (code timeout), and a refused one as an error', () => {
  const lost = timeoutOrError('Fehler beim Anlegen', fetchFailed('ECONNRESET'), 'Ob die Sammlung angelegt wurde, ist offen');
  assert.equal(errorOf(lost)?.code, 'timeout', '`timeout` is the code that means "look before you repeat"');
  assert.equal(errorOf(lost)?.outcomeOpen, true);
  assert.match(textOf(lost), /Verbindungsabbruch/);

  const preview = timeoutOrError('Fehler', fetchFailed('ECONNRESET'), 'x', { preview: true });
  assert.equal(errorOf(preview)?.outcomeOpen, false, 'a call without a key wrote nothing, whatever happened to its reads');

  const refused = timeoutOrError('Fehler beim Anlegen', fetchFailed('ECONNREFUSED'), 'x');
  assert.notEqual(errorOf(refused)?.code, 'timeout');
});

test('no write path asks the narrower question any more', () => {
  // `isUpstreamTimeout` alone is how a reset became "failed". Every decision
  // between open and failed in the write pipeline goes through `isOutcomeOpen`.
  // Checked on the NAME, wherever and however it is used — a call, an import, a
  // re-export — in the write services and in every curation tool.
  const offending: string[] = [];
  const services = fileURLToPath(new URL('../src/services/write/', import.meta.url));
  for (const f of readdirSync(services)) {
    if (f.endsWith('.ts') && f !== 'timeouts.ts' && /isUpstreamTimeout/.test(readFileSync(services + f, 'utf8'))) offending.push(`services/write/${f}`);
  }
  const tools = fileURLToPath(new URL('../src/tools/', import.meta.url));
  for (const f of readdirSync(tools)) {
    if (/^curation-.*\.ts$/.test(f) && /isUpstreamTimeout/.test(readFileSync(tools + f, 'utf8'))) offending.push(`tools/${f}`);
  }
  assert.deepEqual(offending, []);
});

test('the code of a write that threw is `timeout` for every "sent, no answer" — in the batch steps too', async () => {
  const { writeFailureCode, failureCode } = await import('../src/services/failure-code.js');
  assert.equal(writeFailureCode(fetchFailed('ECONNRESET')), 'timeout');
  assert.equal(failureCode(fetchFailed('ECONNRESET')), 'upstream_error', 'a READ keeps the narrower meaning');
  assert.equal(writeFailureCode(fetchFailed('ECONNREFUSED')), 'upstream_error');
  assert.equal(writeFailureCode(new Error('ngsearch failed: 503')), 'upstream_busy');
});

test('a refusal that merely contains the letters is not a lost connection', () => {
  assert.equal(isOutcomeOpen(new Error('HTTP 400: recipepipe is not a valid value')), false);
  assert.equal(isOutcomeOpen(new Error('read ECONNRESET')), true);
  for (const code of ['CERT_NOT_YET_VALID', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_SSL_WRONG_VERSION_NUMBER', 'EPROTO']) {
    assert.equal(isOutcomeOpen(fetchFailed(code)), false, `${code}: TLS never completed, nothing was sent`);
  }
});

// ── K-7: a key that cannot be used ───────────────────────────────────────────

test('a lost plan is an open outcome — earlier calls of it may have run steps', () => {
  const expired = planErrorReply('plan_expired');
  assert.equal(errorOf(expired)?.outcomeOpen, true);
  assert.doesNotMatch(textOf(expired), /Es wurde nichts geschrieben/);
  assert.match(textOf(expired), /frühere Aufrufe/);

  // A mismatch is found on a LIVING plan of other arguments — which may have run steps.
  assert.equal(errorOf(planErrorReply('plan_mismatch'))?.outcomeOpen, true);
  assert.doesNotMatch(textOf(planErrorReply('plan_mismatch')), /Es wurde nichts geschrieben/);
  // Only a full plan list is decided before the key did anything.
  assert.equal(errorOf(planErrorReply('too_many_plans'))?.outcomeOpen, false);
});

test('an unknown confirmation key is an open outcome — it may be a key redeemed before a restart', () => {
  const cs = buildChangeSet('n-1', 'content', { 'cclom:title': ['Alt'] }, { 'cclom:title': ['Neu'] });
  const r = confirmOrExplain('ein-schluessel-den-niemand-kennt-0123456789', cs);
  assert.equal(errorOf(r)?.code, 'confirm_unknown');
  assert.equal(errorOf(r)?.outcomeOpen, true);
  assert.doesNotMatch(textOf(r), /Es wurde nichts geschrieben/, 'read as "start over", that sentence made duplicates');
  assert.match(textOf(r), /Dieser Aufruf hat nichts geschrieben/);
});

// ── K-5: the read-back decides ───────────────────────────────────────────────

test('a field the write call rejected with a 5xx is reported as STORED when the read-back shows it', () => {
  const cs = buildChangeSet('n-1', 'content', { 'cclom:title': ['Alt'], 'cclom:general_description': ['x'] },
    { 'cclom:title': ['Neu'], 'cclom:general_description': ['y'] });
  const statuses = [
    { property: 'cclom:title', ok: false, detail: 'HTTP 500' },
    { property: 'cclom:general_description', ok: true },
  ];
  const landed = reportOutcome(cs, statuses, { outcomes: { 'cclom:title': 'stored', 'cclom:general_description': 'stored' }, allStored: true });
  assert.equal((landed as { isError?: boolean }).isError, undefined, 'everything stands in the record — that is not an error');
  assert.match(textOf(landed), /Gespeichert:/);
  assert.match(textOf(landed), /HTTP 500/, 'the error answer is still named, beside the fact');
  assert.doesNotMatch(textOf(landed), /NICHT gespeichert/);
});

test('a rejected field the read-back does NOT show stays rejected — and says nothing was written for it', () => {
  const cs = buildChangeSet('n-1', 'content', { 'cclom:title': ['Alt'] }, { 'cclom:title': ['Neu'] });
  const r = reportOutcome(cs, [{ property: 'cclom:title', ok: false, detail: 'HTTP 403' }],
    { outcomes: { 'cclom:title': 'dropped' }, allStored: false });
  assert.equal(errorOf(r)?.code, 'not_stored');
  assert.equal(errorOf(r)?.outcomeOpen, false);
  assert.match(textOf(r), /abgelehnt \(HTTP 403\)/);
});

test('a field rejected with a 5xx that the read-back does not show is OPEN — the write may still be on its way', () => {
  const cs = buildChangeSet('n-1', 'content', { 'cclom:title': ['Alt'] }, { 'cclom:title': ['Neu'] });
  for (const status of ['HTTP 500', 'HTTP 502', 'HTTP 504']) {
    const r = reportOutcome(cs, [{ property: 'cclom:title', ok: false, detail: status }],
      { outcomes: { 'cclom:title': 'dropped' }, allStored: false });
    assert.equal(errorOf(r)?.outcomeOpen, true, status);
  }
});

test('a rejected field that reads back DIFFERENT from both is rejected and open — something changed', () => {
  const cs = buildChangeSet('n-1', 'content', { 'cclom:title': ['Alt'] }, { 'cclom:title': ['Neu'] });
  const r = reportOutcome(cs, [{ property: 'cclom:title', ok: false, detail: 'HTTP 500' }],
    { outcomes: { 'cclom:title': 'changed' }, allStored: false });
  assert.equal(errorOf(r)?.outcomeOpen, true);
  assert.match(textOf(r), /dennoch ein anderer Wert/);
});

// ── A-4: one course, one spelling of the arguments ───────────────────────────

test('the plan a key continues does not depend on the order the client wrote its keys in', () => {
  const a = canonicalArgs([{ nodeId: 'n-1', title: 'T', keywords: ['a', 'b'] }]);
  const b = canonicalArgs([{ keywords: ['a', 'b'], title: 'T', nodeId: 'n-1' }]);
  assert.equal(a, b);
  // The ORDER OF A LIST is content: other items, or the same in another order, is another plan.
  assert.notEqual(a, canonicalArgs([{ nodeId: 'n-1', title: 'T', keywords: ['b', 'a'] }]));
  assert.notEqual(canonicalArgs({ items: [1, 2], replace: false }), canonicalArgs({ items: [1, 2], replace: true }));
  assert.equal(canonicalArgs({ b: { d: 1, c: 2 }, a: null }), '{"a":null,"b":{"c":2,"d":1}}');
});

test('the course of a planned write exists once — no tool starts or looks up a plan by itself', () => {
  // On the NAME, not on a call: `findPlan<FulltextItem>(…)` — how the four old
  // handlers wrote it — is not matched by `findPlan\(`.
  const dir = fileURLToPath(new URL('../src/tools/', import.meta.url));
  const offending = readdirSync(dir)
    .filter(f => f.endsWith('.ts') && f !== 'curation-plan.ts')
    .filter(f => /\b(startPlan|findPlan|hasPlanCapacity)\b/.test(readFileSync(dir + f, 'utf8')));
  assert.deepEqual(offending, [], 'use runPlannedCall (tools/curation-plan.ts): its ORDER is the safety property');
});

// ── review of package 7 ──────────────────────────────────────────────────────

test('an unredeemed key that cannot be used wrote nothing — said explicitly', async () => {
  const { mintToken } = await import('../src/services/write/confirm.js');
  const a = buildChangeSet('n-1', 'content', { 'cclom:title': ['Alt'] }, { 'cclom:title': ['Neu'] });
  const b = buildChangeSet('n-1', 'content', { 'cclom:title': ['Alt'] }, { 'cclom:title': ['Anders'] });
  const mismatch = confirmOrExplain(mintToken(a), b);
  assert.equal(errorOf(mismatch)?.code, 'confirm_mismatch');
  assert.equal(errorOf(mismatch)?.outcomeOpen, false);
});

test('a REDEEMED key presented with other arguments is open — the earlier call may have written', async () => {
  const { replayAnswer } = await import('../src/tools/curation-replay.js');
  const r = replayAnswer({ kind: 'mismatch' } as never);
  assert.equal(errorOf(r)?.code, 'confirm_mismatch');
  assert.equal(errorOf(r)?.outcomeOpen, true);
  assert.doesNotMatch(textOf(r), /Es wurde nichts geschrieben/);
});

test('a step that keeps coming back open is ended after a bounded number of tries — failed AND open', async () => {
  const { MAX_OPEN_TRIES, findPlan, runPlan, startPlan, setPlanBudgetForTest } = await import('../src/services/write/plan-runner.js');
  setPlanBudgetForTest(0);
  try {
    const items = [{ key: 'a' }, { key: 'b', after: 'a' }];
    const args = `tries-${Date.now()}`;
    const id = startPlan('test-tries', args, items, new Map(), `token-${Date.now()}-0123456789abcdef`);
    const found = findPlan<{ key: string; after?: string }>('test-tries', id, args);
    assert.ok(found?.ok);
    let calls = 0;
    const alwaysOpen = async () => { calls++; return { status: 'pending' as const, code: 'timeout' }; };
    let report = await runPlan(found.plan, alwaysOpen);
    for (let i = 0; i < 10 && !report.complete; i++) report = await runPlan(found.plan, alwaysOpen);
    assert.equal(report.complete, true, 'a client looping "while not complete" comes to an end');
    assert.equal(calls, MAX_OPEN_TRIES);
    const state = found.plan.state.get('a')!;
    assert.deepEqual({ status: state.status, code: state.code, outcomeOpen: state.outcomeOpen }, { status: 'failed', code: 'timeout', outcomeOpen: true });
    assert.equal(found.plan.state.get('b')!.code, 'parent_failed', 'what depends on it stops with it');
  } finally { setPlanBudgetForTest(null); }
});

test('the runner\'s own counter is not part of an answer', async () => {
  const { planReply } = await import('../src/tools/curation-plan-reply.js');
  const r = planReply('x', { planId: 'p', complete: false, progress: { done: 0, total: 1 } }, Date.now(),
    [{ id: { path: 'a' }, text: 'a', state: { status: 'pending', code: 'timeout', tries: 2 } }], () => 'offen');
  const nodes = (r.structuredContent as { nodes: Array<Record<string, unknown>> }).nodes;
  assert.deepEqual(nodes, [{ path: 'a', status: 'pending', code: 'timeout' }]);
});

test('a collection that was created is never reported as failed because a LATER request was refused', async () => {
  const { installFetchMock } = await import('./fetchMock.js');
  const { createCollection } = await import('../src/services/write/collections.js');
  const { setServiceCredentialForTest } = await import('../src/auth/credential.js');
  setServiceCredentialForTest({ header: 'Basic x', label: 'maria', source: 'user' });
  let created = false;
  const mock = installFetchMock((_url, init) => {
    if (init?.method === 'POST' && !created) { created = true; return { json: { collection: { ref: { id: 'neu-7' } } } }; }
    // The repository restarts between the two requests: the second one never leaves.
    throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
  });
  try {
    const out = await createCollection(null, { title: 'Optik', description: 'Licht' });
    assert.equal(out.status, 'created', 'the id must reach the caller — in a tree every child hangs on it');
    assert.equal(out.status === 'created' && out.nodeId, 'neu-7');
    assert.equal(out.status === 'created' && out.check.status, 'unverified');
  } finally { mock.restore(); setServiceCredentialForTest(null); }
});

test('a folder or record that MAY exist although the create failed says so (5xx, or an answer without an id)', async () => {
  const { installFetchMock } = await import('./fetchMock.js');
  const { createBatchFolder } = await import('../src/services/write/batch-filing.js');
  const { setServiceCredentialForTest } = await import('../src/auth/credential.js');
  setServiceCredentialForTest({ header: 'Basic x', label: 'maria', source: 'user' });
  try {
    for (const [answer, open] of [
      [{ json: { node: {} } }, true],                 // 200 without an id: it WAS created
      [{ status: 500, json: {} }, true],              // a 5xx proves nothing
      [{ status: 400, json: {} }, undefined],         // a refusal: nothing exists
    ] as const) {
      const mock = installFetchMock(() => answer);
      try {
        const out = await createBatchFolder('Ablage');
        assert.equal(out.status, 'failed');
        assert.equal(out.status === 'failed' ? out.open : 'x', open, JSON.stringify(answer));
      } finally { mock.restore(); }
    }
  } finally { setServiceCredentialForTest(null); }
});
