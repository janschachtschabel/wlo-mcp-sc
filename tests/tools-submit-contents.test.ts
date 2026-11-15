/**
 * tools-submit-contents.test.ts – many records to the editorial queue under ONE
 * approval (chatbot team, S4, 2026-11-14).
 *
 * The plan runner is the one the other batch tools use. What this pins beyond
 * it: a record already in the queue is `already` and is never submitted again —
 * decided for the preview AND right before the write; an aborted submission
 * that landed is OURS (`submitted`), not "already"; a submission answered with
 * success that left no status is `not_stored`; and the note is part of what
 * was approved.
 *
 * Offline: this proves what is sent and how an answer is read. That the
 * repository accepts the workflow PUT is measured (research doc §10) and
 * re-run by the live suite.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { registerCurationSubmitManyTool } from '../src/tools/curation-submit-many.js';
import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { setPlanBudgetForTest } from '../src/services/write/plan-runner.js';
import { assertRejectsWithoutUpstream, installFetchMock, toolText, type MockResult } from './fetchMock.js';

const MARIA: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };
const TOOL = 'wlo_submit_contents';
const QUEUE = '200_tocheck';

async function client(): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerCurationSubmitManyTool(server, 'Bearer error="invalid_request"');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  return c;
}

interface Behaviour {
  /** Ids already in the queue before anything runs. */
  queued?: string[];
  /** Ids whose workflow PUT is refused with 403. */
  refuse?: string[];
  /** Ids whose workflow PUT answers 200 and stores nothing. */
  drop?: string[];
  /** Called for every workflow PUT before it is answered; may throw, may return an override. */
  onPut?: (id: string, attempt: number) => MockResult | undefined;
}

/** Records r1–r5, a collection C1 and a folder F1. */
function repository(b: Behaviour = {}) {
  const nodes: Record<string, { type: string; aspects?: string[]; title: string }> = {
    r1: { type: 'ccm:io', title: 'Arbeitsblatt Licht' },
    r2: { type: 'ccm:io', title: 'Video Linsen' },
    r3: { type: 'ccm:io', title: 'Quiz Optik' },
    r4: { type: 'ccm:io', title: 'Simulation Prisma' },
    r5: { type: 'ccm:io', title: 'Text Farben' },
    C1: { type: 'ccm:map', aspects: ['ccm:collection'], title: 'Optik' },
    F1: { type: 'ccm:map', title: 'Ablage' },
  };
  const queued = new Set(b.queued ?? []);
  const puts: Array<{ id: string; comment: string }> = [];
  const attempts = new Map<string, number>();
  const mock = installFetchMock((url, init): MockResult => {
    const method = init?.method ?? 'GET';
    const workflow = /\/nodes\/-home-\/([^/]+)\/workflow/.exec(url);
    if (workflow && method === 'PUT') {
      const id = workflow[1]!;
      const body = JSON.parse(String(init?.body ?? '{}')) as { comment?: string; status?: string };
      puts.push({ id, comment: body.comment ?? '' });
      const attempt = (attempts.get(id) ?? 0) + 1;
      attempts.set(id, attempt);
      const over = b.onPut?.(id, attempt);
      if (over) return over;
      if (b.refuse?.includes(id)) return { status: 403, json: {} };
      if (!b.drop?.includes(id)) queued.add(id);
      return { json: {} };
    }
    const meta = /\/nodes\/-home-\/([^/]+)\/metadata/.exec(url);
    if (meta) {
      const n = nodes[meta[1]!];
      if (!n) return { status: 404, json: {} };
      return { json: { node: {
        ref: { id: meta[1], repo: '-home-' }, type: n.type, ...(n.aspects ? { aspects: n.aspects } : {}),
        properties: { 'cclom:title': [n.title], ...(queued.has(meta[1]!) ? { 'ccm:wf_status': [QUEUE], 'ccm:wf_receiver': ['GROUP_ORG_WLO-Uploadmanager'] } : {}) },
      } } };
    }
    return { json: {} };
  });
  return { mock, puts, queued, nodes };
}

interface Answer {
  complete: boolean; progress: { done: number; total: number };
  items: Array<{ nodeId: string; status: string; code?: string; outcomeOpen?: boolean }>;
  continuationToken?: string;
  confirm?: { token: string; preview: { items?: string[]; action?: string } };
  error?: { code: string; refused?: Array<{ nodeId: string; code: string }>; outcomeOpen?: boolean };
}
const sc = (r: unknown) => (r as { structuredContent: Answer }).structuredContent;
const ids = (...list: string[]) => list.map(nodeId => ({ nodeId }));
const statusOf = (a: Answer) => Object.fromEntries(a.items.map(i => [i.nodeId, i.code ? `${i.status}/${i.code}` : i.status]));

async function previewAndConfirm(c: Client, args: Record<string, unknown>) {
  const preview = await c.callTool({ name: TOOL, arguments: args });
  assert.notEqual(preview.isError, true, toolText(preview));
  const token = sc(preview).confirm!.token;
  const done = await c.callTool({ name: TOOL, arguments: { ...args, confirmToken: token } });
  return { preview, token, done };
}
const cleanup = async (c: Client, mock: { restore(): void }) => { setPlanBudgetForTest(null); await c.close(); mock.restore(); setServiceCredentialForTest(null); };

test('without a login the tool refuses and reaches no repository', async () => {
  setServiceCredentialForTest(null);
  const c = await client();
  try {
    await assertRejectsWithoutUpstream(c, TOOL, { items: ids('r1') }, 'no login');
  } finally { await c.close(); }
});

test('more than 200 records, or none, are refused by the schema', async () => {
  setServiceCredentialForTest(MARIA);
  const c = await client();
  try {
    await assertRejectsWithoutUpstream(c, TOOL, { items: Array.from({ length: 201 }, (_, i) => ({ nodeId: `n${i}` })) }, '201 records');
    await assertRejectsWithoutUpstream(c, TOOL, { items: [] }, 'no record');
  } finally { await c.close(); setServiceCredentialForTest(null); }
});

test('the preview names every record and the note, and submits nothing', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, puts } = repository({ queued: ['r3'] });
  const c = await client();
  try {
    const r = await c.callTool({ name: TOOL, arguments: { items: ids('r1', 'r2', 'r3'), comment: 'Bitte\nbis Freitag' } });
    assert.deepEqual(puts, []);
    const text = toolText(r);
    for (const t of ['Arbeitsblatt Licht', 'Video Linsen', 'Quiz Optik', 'r1', 'r2']) assert.ok(text.includes(t), t);
    // The record already in the queue is IN the preview, as what it is.
    assert.match(sc(r).confirm!.preview.items!.find(l => l.includes('r3'))!, /liegt schon zur Prüfung vor.*kein Schritt/);
    assert.equal(sc(r).confirm!.preview.items!.length, 3);
    // The note is read in the preview — flattened, in one piece.
    assert.match(text, /Reicht 2 Datensätze zur redaktionellen Prüfung ein \(1 weitere/);
    assert.match(text, /Notiz an die Redaktion, an jedem Datensatz: „Bitte bis Freitag“/);
  } finally { await cleanup(c, mock); }
});

test('one approval submits every record with the note; the one already queued is "already" and is not sent', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, puts } = repository({ queued: ['r3'] });
  const c = await client();
  try {
    const args = { items: ids('r1', 'r2', 'r3'), comment: 'Aus dem Upload vom Montag' };
    const a = sc((await previewAndConfirm(c, args)).done);
    assert.equal(a.complete, true);
    assert.deepEqual(a.progress, { done: 3, total: 3 });
    assert.deepEqual(statusOf(a), { r1: 'submitted', r2: 'submitted', r3: 'already' });
    assert.deepEqual(puts.map(p => p.id).sort(), ['r1', 'r2']);
    assert.ok(puts.every(p => p.comment === 'Aus dem Upload vom Montag'));
  } finally { await cleanup(c, mock); }
});

test('a key presented again replays the result and submits nothing twice', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, puts } = repository();
  const c = await client();
  try {
    const args = { items: ids('r1', 'r2') };
    const { token } = await previewAndConfirm(c, args);
    const again = sc(await c.callTool({ name: TOOL, arguments: { ...args, confirmToken: token } }));
    assert.deepEqual(statusOf(again), { r1: 'submitted', r2: 'submitted' });
    assert.equal(puts.length, 2);
  } finally { await cleanup(c, mock); }
});

test('the note is part of the approval: the key with another note is not this plan', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, puts } = repository();
  const c = await client();
  try {
    const preview = await c.callTool({ name: TOOL, arguments: { items: ids('r1'), comment: 'gesehen' } });
    const r = await c.callTool({ name: TOOL, arguments: { items: ids('r1'), comment: 'NICHT gesehen', confirmToken: sc(preview).confirm!.token } });
    assert.equal(r.isError, true);
    assert.equal(sc(r).error!.code, 'confirm_mismatch');
    assert.equal(sc(r).error!.outcomeOpen, false);
    assert.deepEqual(puts, []);
  } finally { await cleanup(c, mock); }
});

test('an id named twice is one step', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, puts } = repository();
  const c = await client();
  try {
    const a = sc((await previewAndConfirm(c, { items: ids('r1', ' r1 ', 'r2') })).done);
    assert.equal(a.items.length, 2);
    assert.equal(puts.length, 2);
  } finally { await cleanup(c, mock); }
});

test('an unusable id refuses the whole call before any key, each with the single tool\'s code', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, puts } = repository();
  const c = await client();
  try {
    const r = await c.callTool({ name: TOOL, arguments: { items: ids('r1', 'nope', 'C1', 'F1') } });
    assert.equal(r.isError, true);
    assert.equal(sc(r).error!.code, 'invalid_input');
    assert.deepEqual(sc(r).error!.refused, [
      { nodeId: 'nope', code: 'not_found' }, { nodeId: 'C1', code: 'is_a_collection' }, { nodeId: 'F1', code: 'is_a_folder' },
    ]);
    assert.equal(sc(r).confirm, undefined);
    assert.deepEqual(puts, []);
  } finally { await cleanup(c, mock); }
});

test('every record already in the queue: an answer without a key, not an error', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, puts } = repository({ queued: ['r1', 'r2'] });
  const c = await client();
  try {
    const r = await c.callTool({ name: TOOL, arguments: { items: ids('r1', 'r2') } });
    assert.equal(r.isError, undefined, toolText(r));
    const a = sc(r);
    assert.equal(a.confirm, undefined);
    assert.equal(a.complete, true);
    assert.deepEqual(statusOf(a), { r1: 'already', r2: 'already' });
    assert.match(toolText(r), /Es wurde nichts geändert/);
    assert.deepEqual(puts, []);
  } finally { await cleanup(c, mock); }
});

test('one refused record does not stop the rest, and says why', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock } = repository({ refuse: ['r2'] });
  const c = await client();
  try {
    const a = sc((await previewAndConfirm(c, { items: ids('r1', 'r2', 'r4') })).done);
    assert.equal(a.complete, true);
    assert.deepEqual(statusOf(a), { r1: 'submitted', r2: 'failed/forbidden', r4: 'submitted' });
  } finally { await cleanup(c, mock); }
});

test('answered with success but no status on the record: not_stored — never "submitted"', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock } = repository({ drop: ['r1'] });
  const c = await client();
  try {
    const done = (await previewAndConfirm(c, { items: ids('r1', 'r2') })).done;
    assert.deepEqual(statusOf(sc(done)), { r1: 'not_stored/dropped', r2: 'submitted' });
    assert.match(toolText(done), /NICHT eingereicht/);
  } finally { await cleanup(c, mock); }
});

// The confirming call reads again, so a change BEFORE it changes the preview and
// the key no longer fits. What the step's own look is for is the plan's later
// calls — up to thirty minutes after the approval.
const FIVE = { items: ids('r1', 'r2', 'r3', 'r4', 'r5') };

test('a record that entered the queue after the approval is not submitted a second time', async () => {
  setServiceCredentialForTest(MARIA);
  const repo = repository();
  const c = await client();
  setPlanBudgetForTest(0); // one wave of four per call: r5 is left for the next
  try {
    const first = sc((await previewAndConfirm(c, FIVE)).done);
    assert.equal(statusOf(first)['r5'], 'pending');
    repo.queued.add('r5'); // someone else submitted it meanwhile
    const second = sc(await c.callTool({ name: TOOL, arguments: { ...FIVE, continuationToken: first.continuationToken } }));
    assert.equal(statusOf(second)['r5'], 'already');
    assert.ok(!repo.puts.some(p => p.id === 'r5'));
  } finally { await cleanup(c, repo.mock); }
});

test('a change before the confirming call changes the preview: the key no longer fits, nothing is sent', async () => {
  setServiceCredentialForTest(MARIA);
  const repo = repository();
  const c = await client();
  try {
    const args = { items: ids('r1', 'r2') };
    const preview = await c.callTool({ name: TOOL, arguments: args });
    repo.queued.add('r2');
    const r = await c.callTool({ name: TOOL, arguments: { ...args, confirmToken: sc(preview).confirm!.token } });
    assert.equal(r.isError, true);
    assert.equal(sc(r).error!.code, 'confirm_mismatch');
    assert.deepEqual(repo.puts, []);
  } finally { await cleanup(c, repo.mock); }
});

test('an aborted submission stays open; the next call finds it landed and calls it OURS — and sends nothing again', async () => {
  setServiceCredentialForTest(MARIA);
  const repo = repository({
    onPut: (id, attempt) => {
      if (id !== 'r1' || attempt > 1) return undefined;
      repo.queued.add('r1'); // the work happened; only the answer is lost
      throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    },
  });
  const c = await client();
  try {
    const args = { items: ids('r1') };
    const first = sc((await previewAndConfirm(c, args)).done);
    assert.equal(first.complete, false);
    assert.deepEqual(statusOf(first), { r1: 'pending/timeout' });
    const second = sc(await c.callTool({ name: TOOL, arguments: { ...args, continuationToken: first.continuationToken } }));
    assert.equal(second.complete, true);
    assert.deepEqual(statusOf(second), { r1: 'submitted' });
    assert.equal(repo.puts.length, 1);
  } finally { await cleanup(c, repo.mock); }
});

test('a record gone after the approval fails as not_found and sends nothing for it', async () => {
  setServiceCredentialForTest(MARIA);
  const repo = repository();
  const c = await client();
  setPlanBudgetForTest(0);
  try {
    const first = sc((await previewAndConfirm(c, FIVE)).done);
    delete repo.nodes['r5'];
    const second = sc(await c.callTool({ name: TOOL, arguments: { ...FIVE, continuationToken: first.continuationToken } }));
    assert.equal(statusOf(second)['r5'], 'failed/not_found');
    assert.equal(second.items.find(i => i.nodeId === 'r5')!.outcomeOpen, false);
    assert.ok(!repo.puts.some(p => p.id === 'r5'));
  } finally { await cleanup(c, repo.mock); }
});

test('a record that cannot be read right before the write is not submitted blind', async () => {
  setServiceCredentialForTest(MARIA);
  let down = false;
  const repo = repository();
  const inner = repo.mock;
  const c = await client();
  setPlanBudgetForTest(0);
  try {
    const first = sc((await previewAndConfirm(c, FIVE)).done);
    down = true;
    // This mock REPLACES the repository's, so it counts the PUTs itself.
    let puts = 0;
    const outage = installFetchMock((url, init): MockResult => {
      if (init?.method === 'PUT') puts += 1;
      return down && url.includes('/r5/metadata') ? { status: 503, json: {} } : { json: {} };
    });
    try {
      const second = sc(await c.callTool({ name: TOOL, arguments: { ...FIVE, continuationToken: first.continuationToken } }));
      assert.equal(statusOf(second)['r5'], 'pending/not_checked');
    } finally { outage.restore(); }
    assert.equal(puts, 0);
  } finally { await cleanup(c, inner); }
});

test('a plan that does not finish in one call continues with its key, without a new approval', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, puts } = repository();
  const c = await client();
  setPlanBudgetForTest(0);
  try {
    const args = FIVE;
    let a = sc((await previewAndConfirm(c, args)).done);
    for (let guard = 0; !a.complete && guard < 10; guard++) {
      assert.ok(a.continuationToken);
      a = sc(await c.callTool({ name: TOOL, arguments: { ...args, continuationToken: a.continuationToken } }));
    }
    assert.equal(a.complete, true);
    assert.deepEqual(puts.map(p => p.id).sort(), ['r1', 'r2', 'r3', 'r4', 'r5']);
  } finally { await cleanup(c, mock); }
});

// ── review of package 2 (2026-11-14) ────────────────────────────────────────

test('a 5xx on the submission that LANDED is our submission — the record is read before anything is said', async () => {
  setServiceCredentialForTest(MARIA);
  const repo = repository({ onPut: (id) => { if (id !== 'r1') return undefined; repo.queued.add('r1'); return { status: 502, json: {} }; } });
  const c = await client();
  try {
    assert.deepEqual(statusOf(sc((await previewAndConfirm(c, { items: ids('r1') })).done)), { r1: 'submitted' });
  } finally { await cleanup(c, repo.mock); }
});

test('a 5xx on the submission that did not land is failed AND open — and the text does not say "nicht eingereicht"', async () => {
  setServiceCredentialForTest(MARIA);
  const repo = repository({ onPut: () => ({ status: 500, json: {} }) });
  const c = await client();
  try {
    const done = (await previewAndConfirm(c, { items: ids('r1') })).done;
    const item = sc(done).items[0]!;
    assert.deepEqual([item.status, item.code, item.outcomeOpen], ['failed', 'upstream_error', true]);
    assert.match(toolText(done), /offen — Ausgang unbekannt/);
    assert.doesNotMatch(toolText(done), /nicht eingereicht/);
  } finally { await cleanup(c, repo.mock); }
});

test('a refusal (403) is failed and NOT open: nothing was written', async () => {
  setServiceCredentialForTest(MARIA);
  const repo = repository({ refuse: ['r1'] });
  const c = await client();
  try {
    const done = (await previewAndConfirm(c, { items: ids('r1') })).done;
    assert.equal(sc(done).items[0]!.outcomeOpen, false);
    assert.match(toolText(done), /nicht eingereicht \(forbidden\)/);
  } finally { await cleanup(c, repo.mock); }
});

test('a busy repository (503) leaves the step open; the next call sends again and it lands', async () => {
  setServiceCredentialForTest(MARIA);
  const repo = repository({ onPut: (_id, attempt) => (attempt === 1 ? { status: 503, json: {} } : undefined) });
  const c = await client();
  try {
    const args = { items: ids('r1') };
    const first = sc((await previewAndConfirm(c, args)).done);
    assert.deepEqual(statusOf(first), { r1: 'pending/upstream_busy' });
    const second = sc(await c.callTool({ name: TOOL, arguments: { ...args, continuationToken: first.continuationToken } }));
    assert.deepEqual(statusOf(second), { r1: 'submitted' });
    assert.equal(repo.puts.length, 2);
  } finally { await cleanup(c, repo.mock); }
});

test('a record that did not ANSWER in the preview is "not checked" — never "not found"', async () => {
  setServiceCredentialForTest(MARIA);
  const mock = installFetchMock((url): MockResult => (url.includes('/r2/metadata') ? { status: 503, json: {} }
    : { json: { node: { ref: { id: 'r1' }, type: 'ccm:io', properties: { 'cclom:title': ['A'] } } } }));
  const c = await client();
  try {
    const r = await c.callTool({ name: TOOL, arguments: { items: ids('r1', 'r2') } });
    assert.equal(r.isError, true);
    assert.equal(sc(r).error!.code, 'not_checked');
    assert.equal(sc(r).error!.outcomeOpen, false);
    assert.equal(sc(r).error!.refused, undefined);
    assert.match(toolText(r), /nicht, dass es sie nicht gibt/);
  } finally { await cleanup(c, mock); }
});

test('a record that stays unreadable ends as failed and NOT open: this plan never sent anything for it', async () => {
  setServiceCredentialForTest(MARIA);
  const repo = repository();
  const c = await client();
  setPlanBudgetForTest(0);
  let puts = 0;
  try {
    let a = sc((await previewAndConfirm(c, FIVE)).done);
    const outage = installFetchMock((url, init): MockResult => {
      if (init?.method === 'PUT') puts += 1;
      return url.includes('/r5/metadata') ? { status: 503, json: {} } : { json: {} };
    });
    try {
      for (let guard = 0; !a.complete && guard < 6; guard++) {
        a = sc(await c.callTool({ name: TOOL, arguments: { ...FIVE, continuationToken: a.continuationToken } }));
      }
    } finally { outage.restore(); }
    const item = a.items.find(i => i.nodeId === 'r5')!;
    assert.deepEqual([a.complete, item.status, item.code, item.outcomeOpen], [true, 'failed', 'not_checked', false]);
    assert.equal(puts, 0);
  } finally { await cleanup(c, repo.mock); }
});

test('two confirming calls at once submit every record once', async () => {
  setServiceCredentialForTest(MARIA);
  const repo = repository();
  const c = await client();
  try {
    const args = { items: ids('r1', 'r2', 'r3') };
    const token = sc(await c.callTool({ name: TOOL, arguments: args })).confirm!.token;
    await Promise.all([1, 2].map(() => c.callTool({ name: TOOL, arguments: { ...args, confirmToken: token } })));
    const final = sc(await c.callTool({ name: TOOL, arguments: { ...args, confirmToken: token } }));
    assert.deepEqual(statusOf(final), { r1: 'submitted', r2: 'submitted', r3: 'submitted' });
    assert.deepEqual(repo.puts.map(p => p.id).sort(), ['r1', 'r2', 'r3']);
  } finally { await cleanup(c, repo.mock); }
});

test('what is shown is what is sent: invisible characters in the note do not travel to the queue', async () => {
  setServiceCredentialForTest(MARIA);
  const repo = repository();
  const c = await client();
  try {
    await previewAndConfirm(c, { items: ids('r1'), comment: `Bitte${String.fromCharCode(0x200b)} prüfen\nbis Freitag` });
    assert.equal(repo.puts[0]!.comment, 'Bitte prüfen bis Freitag');
  } finally { await cleanup(c, repo.mock); }
});
