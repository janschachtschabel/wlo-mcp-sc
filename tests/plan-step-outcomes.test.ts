/**
 * plan-step-outcomes.test.ts – what a plan step says about a write the
 * repository did not confirm (audit 2026-11-14, W5/W6/W13).
 *
 * The rule, the same for every step: after an approval a 4xx wrote nothing
 * (`outcomeOpen: false`); anything else is not known and is LOOKED AT again by
 * the next call before anything is sent again. The filing step ended a 5xx as a
 * plain `failed` — neither open nor looked at — and a 4xx without saying that
 * nothing was written.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { registerCurationAddManyTool } from '../src/tools/curation-add-many.js';
import { registerCurationRemoveManyTool } from '../src/tools/curation-remove-many.js';
import { registerCurationDeleteEmptyTool } from '../src/tools/curation-delete-empty.js';
import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { MAX_OPEN_TRIES, setPlanBudgetForTest } from '../src/services/write/plan-runner.js';
import { registerCurationTreeTools } from '../src/tools/curation-tree.js';
import { planItemLabel } from '../src/tools/curation-plan-reply.js';
import { filingStep, type FilingItem } from '../src/services/write/filing-plan.js';
import { toolText } from './fetchMock.js';
import { collectionRepo, type RepoOptions } from './collection-repo.js';

const MARIA: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };

interface Entry { nodeId?: string; status: string; code?: string; outcomeOpen?: boolean }
interface Answer {
  complete?: boolean; pairs?: Entry[]; items?: Entry[]; nodes?: Entry[]; continuationToken?: string;
  confirm?: { token: string; preview: { action?: string; items?: string[] } };
  error?: { code: string; refused?: Array<{ nodeId?: string; code: string }> };
}
const sc = (r: unknown) => (r as { structuredContent: Answer }).structuredContent;
const codeOf = (e: Entry) => (e.code ? `${e.status}/${e.code}` : e.status);

async function scene(build: (repo: ReturnType<typeof collectionRepo>) => void, opts: RepoOptions = {}) {
  setServiceCredentialForTest(MARIA);
  const repo = collectionRepo(opts);
  build(repo);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  const challenge = 'Bearer error="invalid_request"';
  registerCurationAddManyTool(server, challenge);
  registerCurationRemoveManyTool(server, challenge);
  registerCurationDeleteEmptyTool(server, challenge);
  registerCurationTreeTools(server, challenge);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  const call = (name: string, args: Record<string, unknown>) => c.callTool({ name, arguments: args });
  const confirm = async (name: string, args: Record<string, unknown>) => {
    const preview = await call(name, args);
    const token = sc(preview).confirm?.token;
    assert.ok(token, `a preview with a key was expected: ${toolText(preview)}`);
    return { preview, done: await call(name, { ...args, confirmToken: token }) };
  };
  const end = async () => { setPlanBudgetForTest(null); await c.close(); repo.mock.restore(); setServiceCredentialForTest(null); };
  return { repo, call, confirm, end };
}

function shelf(repo: ReturnType<typeof collectionRepo>) {
  repo.collection('optik', 'Optik');
  repo.record('m1', 'Arbeitsblatt Licht');
}

const isFiling = (q: { method: string; url: string }) => q.method === 'PUT' && /\/references\/[^/?]+$/.test(new URL(q.url).pathname);

// ── W5: the filing step ─────────────────────────────────────────────────────

test('a filing answered 5xx stays OPEN — the next call looks, and files only if it is not there', async () => {
  let failures = 1;
  const s = await scene(shelf, { intercept: q => (isFiling(q) && failures-- > 0 ? { status: 502, json: {} } : undefined) });
  try {
    const args = { pairs: [{ nodeId: 'm1', collectionId: 'optik' }] };
    const first = sc((await s.confirm('wlo_add_to_collections', args)).done);
    assert.deepEqual(first.pairs!.map(codeOf), ['pending/upstream_error']);
    assert.equal(first.complete, false);
    const second = sc(await s.call('wlo_add_to_collections', { ...args, continuationToken: first.continuationToken }));
    assert.deepEqual(second.pairs!.map(codeOf), ['added']);
  } finally { await s.end(); }
});

test('a filing answered 5xx that LANDED is not sent a second time', async () => {
  const s = await scene(shelf, { intercept: (q) => {
    if (!isFiling(q) || s.repo.nodes.has('ref-m1-optik')) return undefined;
    s.repo.file('optik', 'm1');
    return { status: 502, json: {} };
  } });
  try {
    const args = { pairs: [{ nodeId: 'm1', collectionId: 'optik' }] };
    const first = sc((await s.confirm('wlo_add_to_collections', args)).done);
    assert.deepEqual(first.pairs!.map(codeOf), ['pending/upstream_error']);
    const second = sc(await s.call('wlo_add_to_collections', { ...args, continuationToken: first.continuationToken }));
    // OUR filing, found by the look: `added` — "lag schon in der Sammlung" was said over what this plan did.
    assert.deepEqual(second.pairs!.map(codeOf), ['added']);
    assert.equal(s.repo.writes.filter(w => w.method === 'PUT').length, 1, 'one filing request, not two');
  } finally { await s.end(); }
});

test('a filing answered 5xx that landed, found through the repository\'s own 409 (the look does not answer): added too', async () => {
  const s = await scene(shelf, { intercept: (q) => {
    if (q.method === 'GET' && q.url.includes('/usage/v1/')) return { status: 503, json: {} };
    if (!isFiling(q) || s.repo.nodes.has('ref-m1-optik')) return undefined;
    s.repo.file('optik', 'm1');
    return { status: 502, json: {} };
  } });
  try {
    const args = { pairs: [{ nodeId: 'm1', collectionId: 'optik' }] };
    const first = sc((await s.confirm('wlo_add_to_collections', args)).done);
    assert.deepEqual(first.pairs!.map(codeOf), ['pending/upstream_error']);
    const second = sc(await s.call('wlo_add_to_collections', { ...args, continuationToken: first.continuationToken }));
    assert.deepEqual(second.pairs!.map(codeOf), ['added']);
  } finally { await s.end(); }
});

test('what lay in the collection BEFORE the plan sent anything stays `already` — by the look and by the 409', async () => {
  for (const lookAnswers of [true, false]) {
    const s = await scene((repo) => { shelf(repo); repo.file('optik', 'm1'); },
      { intercept: q => (!lookAnswers && q.method === 'GET' && q.url.includes('/usage/v1/') ? { status: 503, json: {} } : undefined) });
    try {
      const { done } = await s.confirm('wlo_add_to_collections', { pairs: [{ nodeId: 'm1', collectionId: 'optik' }] });
      assert.deepEqual(sc(done).pairs!.map(codeOf), ['already'], `look answers: ${lookAnswers}`);
    } finally { await s.end(); }
  }
});

// Review 2026-11-14, finding 6: `not_removed` says "now in BOTH collections". A
// move whose filing did not happen removed nothing AND filed nothing — the
// state is the filing's own, with the filing's code.
test('a MOVE whose filing was refused is the filing\'s failure — never `not_removed`, and nothing leaves the source', async () => {
  const s = await scene((repo) => { shelf(repo); repo.collection('mechanik', 'Mechanik'); repo.file('optik', 'm1'); },
    { intercept: q => (isFiling(q) ? { status: 403, json: {} } : undefined) });
  try {
    const { done } = await s.confirm('wlo_add_to_collections', { pairs: [{ nodeId: 'm1', collectionId: 'mechanik', removeFrom: 'optik' }] });
    const e = sc(done).pairs![0]!;
    assert.deepEqual([e.status, e.code, e.outcomeOpen], ['failed', 'forbidden', false]);
    assert.doesNotMatch(toolText(done), /BEIDEN/);
    assert.ok(!s.repo.writes.some(w => w.method === 'DELETE'), 'nothing was taken out of the source');
  } finally { await s.end(); }
});

test('a filing REFUSED (403) is failed and NOT open: nothing was written', async () => {
  const s = await scene(shelf, { intercept: q => (isFiling(q) ? { status: 403, json: {} } : undefined) });
  try {
    const { done } = await s.confirm('wlo_add_to_collections', { pairs: [{ nodeId: 'm1', collectionId: 'optik' }] });
    const e = sc(done).pairs![0]!;
    assert.deepEqual([e.status, e.code, e.outcomeOpen], ['failed', 'forbidden', false]);
    assert.match(toolText(done), /nicht aufgenommen/);
  } finally { await s.end(); }
});

test('a busy repository (503) on a filing leaves the step open too', async () => {
  let failures = 1;
  const s = await scene(shelf, { intercept: q => (isFiling(q) && failures-- > 0 ? { status: 503, json: {} } : undefined) });
  try {
    const first = sc((await s.confirm('wlo_add_to_collections', { pairs: [{ nodeId: 'm1', collectionId: 'optik' }] })).done);
    assert.deepEqual(first.pairs!.map(codeOf), ['pending/upstream_busy']);
  } finally { await s.end(); }
});

// ── review 2026-11-14 (2), finding 2: the tree's CREATE step ────────────────
//
// It ended a 5xx/429 as a plain `failed` after one immediate look. A create was
// measured to answer 500 and exist (P5), and a proxy answers 502 while the work
// lands — so the step stays open like its siblings, and the next call LOOKS for
// the collection by title before it creates again.

const isCreate = (q: { method: string; url: string }) => q.method === 'POST' && /\/collections\/-home-\/[^/]+\/children$/.test(new URL(q.url).pathname);
const TREE = { parentCollectionId: 'root', tree: [{ title: 'Optik', children: [{ title: 'Linsen' }] }] };
const root = (repo: ReturnType<typeof collectionRepo>) => { repo.collection('root', 'Physik'); };
const titled = (repo: ReturnType<typeof collectionRepo>, title: string) => [...repo.nodes.values()].filter(n => n.kind === 'collection' && n.title === title);
const again = (s: Awaited<ReturnType<typeof scene>>, before: Answer) =>
  s.call('wlo_create_collection_tree', { ...TREE, continuationToken: before.continuationToken });

test('a tree create answered 500 that lands LATER: the step stays open, its child waits, the next call finds it — one request', async () => {
  let failures = 1;
  const s = await scene(root, { intercept: q => (isCreate(q) && failures-- > 0 ? { status: 500, json: {} } : undefined) });
  try {
    const first = sc((await s.confirm('wlo_create_collection_tree', TREE)).done);
    assert.deepEqual(first.nodes!.map(codeOf), ['pending/upstream_error', 'pending'], 'open, and the child WAITS');
    assert.equal(first.complete, false);
    // The create the 500 was answered for lands after all.
    s.repo.collection('landed', 'Optik', 'root');
    const second = sc(await again(s, first));
    assert.equal(second.nodes![0]!.nodeId, 'landed');
    assert.notEqual(second.nodes![0]!.status, 'failed');
    assert.equal(second.nodes![1]!.status, 'created');
    assert.equal(titled(s.repo, 'Optik').length, 1, 'no second Optik');
    assert.equal(s.repo.writes.filter(w => w.method === 'POST' && w.path.endsWith('/root/children')).length, 1, 'the create was not sent again');
  } finally { await s.end(); }
});

test('a tree create answered 500 that did NOT land: the next call looks, then creates — once', async () => {
  let failures = 1;
  const s = await scene(root, { intercept: q => (isCreate(q) && failures-- > 0 ? { status: 500, json: {} } : undefined) });
  try {
    const first = sc((await s.confirm('wlo_create_collection_tree', TREE)).done);
    assert.deepEqual(first.nodes!.map(codeOf), ['pending/upstream_error', 'pending']);
    const second = sc(await again(s, first));
    assert.deepEqual(second.nodes!.map(n => n.status), ['created', 'created']);
    assert.equal(titled(s.repo, 'Optik').length, 1);
  } finally { await s.end(); }
});

test('a busy repository (429) on a tree create leaves the step open, coded upstream_busy', async () => {
  let failures = 1;
  const s = await scene(root, { intercept: q => (isCreate(q) && failures-- > 0 ? { status: 429, json: {} } : undefined) });
  try {
    const first = sc((await s.confirm('wlo_create_collection_tree', TREE)).done);
    assert.deepEqual(first.nodes!.map(codeOf), ['pending/upstream_busy', 'pending']);
  } finally { await s.end(); }
});

test('a tree create REFUSED (403) is failed and NOT open — and its child fails with it', async () => {
  const s = await scene(root, { intercept: q => (isCreate(q) ? { status: 403, json: {} } : undefined) });
  try {
    const { done } = await s.confirm('wlo_create_collection_tree', TREE);
    const [parent, child] = sc(done).nodes!;
    assert.deepEqual([parent!.status, parent!.code, parent!.outcomeOpen], ['failed', 'forbidden', false]);
    assert.deepEqual([child!.status, child!.code], ['failed', 'parent_failed']);
    assert.equal(sc(done).complete, true);
  } finally { await s.end(); }
});

test('a tree create that keeps answering 500 ends after MAX_OPEN_TRIES — failed AND open, never "nicht angelegt"', async () => {
  const s = await scene(root, { intercept: q => (isCreate(q) ? { status: 500, json: {} } : undefined) });
  try {
    let answer = await s.confirm('wlo_create_collection_tree', TREE).then(r => r.done);
    for (let i = 1; i < MAX_OPEN_TRIES; i++) {
      assert.equal(sc(answer).complete, false, `call ${i}: still open`);
      answer = await again(s, sc(answer));
    }
    const [parent] = sc(answer).nodes!;
    assert.deepEqual([parent!.status, parent!.outcomeOpen], ['failed', true]);
    assert.equal(sc(answer).complete, true);
    assert.match(toolText(answer), /Optik: offen — Ausgang unbekannt/);
  } finally { await s.end(); }
});

// ── finding 10: `filingSent` means the request MAY have left ────────────────

test('a filing whose request provably never left is not remembered as sent; one that was reset is', async () => {
  const failing = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) });
  for (const [code, sent, status] of [['ECONNREFUSED', false, 'failed'], ['ECONNRESET', true, 'pending']] as const) {
    const s = await scene(shelf, { intercept: (q) => { if (isFiling(q)) throw failing(code); return undefined; } });
    try {
      const item: FilingItem = { key: 'm1>optik', requestedId: 'm1', filedId: 'm1', materialTitle: 'Arbeitsblatt Licht',
        collection: { nodeId: 'optik', title: 'Optik' } };
      const state = await filingStep(item, undefined);
      assert.equal(state.status, status, code);
      assert.equal(Boolean(item.filingSent), sent, `${code}: a later "already there" is ${sent ? 'ours' : 'not ours'}`);
    } finally { await s.end(); }
  }
});

// ── finding 4: a closed status that is OPEN is worded as open ───────────────

test('planItemLabel: any closed "not done" status carrying outcomeOpen reads as open — not only `failed`', () => {
  const labels = { not_stored: 'nicht gespeichert', failed: 'gescheitert', partly: 'teilweise', unverified: 'offen — nicht bestätigt', pending: 'offen' };
  assert.match(planItemLabel({ status: 'not_stored', code: 'not_stored', outcomeOpen: true }, labels), /^offen — Ausgang unbekannt/);
  assert.match(planItemLabel({ status: 'failed', outcomeOpen: true }, labels), /^offen — Ausgang unbekannt/);
  // Proven not to have landed: the table's word stands.
  assert.equal(planItemLabel({ status: 'not_stored', outcomeOpen: false }, labels), 'nicht gespeichert');
  // These already say what is open, and more precisely.
  assert.equal(planItemLabel({ status: 'partly', outcomeOpen: true }, labels), 'teilweise');
  assert.equal(planItemLabel({ status: 'unverified', outcomeOpen: true }, labels), 'offen — nicht bestätigt');
  assert.equal(planItemLabel({ status: 'pending', outcomeOpen: true }, labels), 'offen');
});

// ── W6: one reading of a rejected field write, single tool and batch ────────

import { registerCurationContentTools } from '../src/tools/curation-content.js';
import { registerCurationUpdateManyTool } from '../src/tools/curation-update-many.js';
import { installFetchMock, type MockResult } from './fetchMock.js';

/** One record whose metadata write is answered `status` and stores nothing. */
async function rejectedWrite(status: number) {
  setServiceCredentialForTest(MARIA);
  const mock = installFetchMock((url, init): MockResult => {
    if (url.includes('/metadata') && (init?.method ?? 'GET') !== 'GET') return { status, json: {} };
    return { json: { node: { ref: { id: 'm1', repo: '-home-' }, type: 'ccm:io', aspects: [], properties: { 'cclom:title': ['Licht'] } } } };
  });
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerCurationContentTools(server, 'Bearer x');
  registerCurationUpdateManyTool(server, 'Bearer x');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  const confirmed = async (name: string, args: Record<string, unknown>) => {
    const token = sc(await c.callTool({ name, arguments: args })).confirm!.token;
    return c.callTool({ name, arguments: { ...args, confirmToken: token } });
  };
  try {
    const single = await confirmed('wlo_update_content', { nodeId: 'm1', title: 'Licht neu' });
    const many = await confirmed('wlo_update_contents', { items: [{ nodeId: 'm1', title: 'Licht neu' }] });
    return {
      single: (single.structuredContent as { error: { code: string; outcomeOpen: boolean } }).error,
      many: sc(many).items![0]!,
    };
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
}

for (const [status, open] of [[502, true], [500, true], [429, true], [403, false], [400, false]] as const) {
  test(`a field write answered ${status} with the old value on read-back: outcomeOpen ${open} — in wlo_update_content AND wlo_update_contents`, async () => {
    const { single, many } = await rejectedWrite(status);
    assert.equal(single.code, 'not_stored');
    assert.equal(many.status, 'not_stored');
    assert.equal(single.outcomeOpen, open, 'single tool');
    assert.equal(many.outcomeOpen, open, 'batch tool');
  });
}
