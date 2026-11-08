/**
 * tools-collection-tree.test.ts – a whole collection tree under ONE approval
 * (BOERDi wishlist item 6, decision E4 = B, 2026-11-06).
 *
 * The rules this pins: the preview names every node and the key binds to the
 * whole plan; execution is time-budgeted, and an unfinished plan hands back a
 * continuation key; a key may be presented AGAIN by the same identity — it then
 * continues or replays the result, never creates twice; another identity gets
 * `plan_mismatch`, an unknown key `plan_expired`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { registerCurationTreeTools } from '../src/tools/curation-tree.js';
import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { setPlanBudgetForTest } from '../src/services/write/plan-runner.js';
import { assertRejectsWithoutUpstream, installFetchMock, toolText } from './fetchMock.js';

const MARIA: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };
const OTTO: WloCredential = { header: 'Basic y', label: 'otto', source: 'user' };
const PARENT = 'parent-coll';

async function client(): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerCurationTreeTools(server, 'Bearer error="invalid_request"');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  return c;
}

/** A tiny collection repository: nodes with a parent and a title. */
function repository(existing: Array<{ id: string; parent: string; title: string }> = []) {
  const nodes = new Map<string, { parent: string; title: string }>([[PARENT, { parent: '-root-', title: 'Eltern' }]]);
  for (const e of existing) nodes.set(e.id, { parent: e.parent, title: e.title });
  let seq = 0;
  const creates: string[] = [];
  const mock = installFetchMock((url, init) => {
    const method = init?.method ?? 'GET';
    const create = /\/collection\/v1\/collections\/-home-\/([^/]+)\/children/.exec(url);
    if (create && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const id = `c-${++seq}`;
      nodes.set(id, { parent: create[1]!, title: body.title });
      creates.push(body.title);
      return { json: { collection: { ref: { id } } } };
    }
    const children = /\/node\/v1\/nodes\/-home-\/([^/]+)\/children/.exec(url);
    if (children) {
      const list = [...nodes].filter(([, n]) => n.parent === children[1]).map(([id, n]) => ({
        ref: { id, repo: '-home-' }, type: 'ccm:map', properties: { 'cclom:title': [n.title], 'cm:title': [n.title] },
      }));
      return { json: { nodes: list, pagination: { total: list.length, from: 0, count: list.length } } };
    }
    const meta = /\/nodes\/-home-\/([^/]+)\/metadata/.exec(url) ?? /\/collections\/-home-\/([^/?]+)(\?|$)/.exec(url);
    if (meta && method === 'GET') {
      const n = nodes.get(meta[1]!);
      if (!n) return { status: 404, json: {} };
      const props = { 'cclom:title': [n.title], 'cm:title': [n.title] };
      return { json: { node: { ref: { id: meta[1], repo: '-home-' }, type: 'ccm:map', title: n.title, properties: props },
        collection: { ref: { id: meta[1] }, title: n.title, properties: props } } };
    }
    return { json: {} };
  });
  return { mock, creates, nodes };
}

const TREE = [{ title: 'Optik', children: [{ title: 'Licht' }, { title: 'Linsen', children: [{ title: 'Brennweite' }] }] }];

interface TreeAnswer {
  complete: boolean; progress: { done: number; total: number };
  nodes: Array<{ path: string; nodeId?: string; status: string; code?: string }>;
  continuationToken?: string; inProgress?: boolean;
  confirm?: { token: string };
  error?: { code: string };
}
const sc = (r: unknown) => (r as { structuredContent: TreeAnswer }).structuredContent;

async function previewAndConfirm(c: Client, tree = TREE) {
  const preview = await c.callTool({ name: 'wlo_create_collection_tree', arguments: { parentCollectionId: PARENT, tree } });
  const token = sc(preview).confirm!.token;
  const done = await c.callTool({ name: 'wlo_create_collection_tree', arguments: { parentCollectionId: PARENT, tree, confirmToken: token } });
  return { preview, token, done };
}

test('the preview names every node and writes nothing', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, creates } = repository();
  const c = await client();
  try {
    const r = await c.callTool({ name: 'wlo_create_collection_tree', arguments: { parentCollectionId: PARENT, tree: TREE } });
    assert.deepEqual(creates, []);
    for (const p of ['Optik', 'Optik/Licht', 'Optik/Linsen', 'Optik/Linsen/Brennweite']) assert.match(toolText(r), new RegExp(p));
    assert.ok(sc(r).confirm?.token);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('one approval creates the whole tree top-down and maps every path to its id', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, creates } = repository();
  const c = await client();
  try {
    const { done } = await previewAndConfirm(c);
    const a = sc(done);
    assert.equal(a.complete, true);
    assert.deepEqual(a.progress, { done: 4, total: 4 });
    assert.equal(a.continuationToken, undefined);
    assert.deepEqual(creates[0], 'Optik', 'the parent before its children');
    assert.ok(a.nodes.every(n => n.status === 'created' && n.nodeId), JSON.stringify(a.nodes));
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('merge reuses an existing sub-collection of the same title instead of a duplicate', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, creates } = repository([{ id: 'old-optik', parent: PARENT, title: ' optik ' }]);
  const c = await client();
  try {
    const { preview, done } = await previewAndConfirm(c);
    assert.match(toolText(preview), /vorhanden|exists/);
    const optik = sc(done).nodes.find(n => n.path === 'Optik')!;
    assert.deepEqual([optik.status, optik.nodeId], ['existing', 'old-optik']);
    assert.ok(!creates.includes('Optik'));
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('an exhausted budget hands back a continuation key; the key continues without a new preview', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, creates } = repository();
  const c = await client();
  setPlanBudgetForTest(0); // nothing fits — every call does at most one wave
  try {
    const { done } = await previewAndConfirm(c);
    const first = sc(done);
    assert.equal(first.complete, false);
    assert.ok(first.continuationToken);
    let a = first;
    for (let i = 0; i < 10 && !a.complete; i++) {
      a = sc(await c.callTool({ name: 'wlo_create_collection_tree', arguments: {
        parentCollectionId: PARENT, tree: TREE, continuationToken: a.continuationToken ?? first.continuationToken,
      } }));
    }
    assert.equal(a.complete, true);
    assert.equal(creates.length, 4, 'every node exactly once');
  } finally { setPlanBudgetForTest(null); await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('a key presented again replays the result — a lost answer costs nothing, nothing twice', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, creates } = repository();
  const c = await client();
  try {
    const { token } = await previewAndConfirm(c);
    const again = await c.callTool({ name: 'wlo_create_collection_tree', arguments: { parentCollectionId: PARENT, tree: TREE, confirmToken: token } });
    assert.notEqual(again.isError, true, toolText(again));
    assert.equal(sc(again).complete, true);
    assert.equal(creates.length, 4, 'the replay wrote nothing');
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('another identity cannot use the key; an unknown key is expired', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock } = repository();
  const c = await client();
  setPlanBudgetForTest(0);
  try {
    const { done } = await previewAndConfirm(c);
    const key = sc(done).continuationToken!;
    setServiceCredentialForTest(OTTO);
    const foreign = await c.callTool({ name: 'wlo_create_collection_tree', arguments: { parentCollectionId: PARENT, tree: TREE, continuationToken: key } });
    assert.equal(foreign.isError, true);
    assert.equal(sc(foreign).error?.code, 'plan_mismatch');
    setServiceCredentialForTest(MARIA);
    const unknown = await c.callTool({ name: 'wlo_create_collection_tree', arguments: { parentCollectionId: PARENT, tree: TREE, continuationToken: 'x'.repeat(24) } });
    assert.equal(sc(unknown).error?.code, 'plan_expired');
  } finally { setPlanBudgetForTest(null); await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('a failed node skips its subtree, the rest still comes', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, creates } = repository();
  const c = await client();
  try {
    const preview = await c.callTool({ name: 'wlo_create_collection_tree', arguments: { parentCollectionId: PARENT, tree: TREE } });
    // From now on, creating "Linsen" is refused.
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) =>
      (String(init?.body ?? '').includes('"Linsen"') ? new Response('{}', { status: 403 }) : real(input as string, init))) as typeof fetch;
    try {
      const done = sc(await c.callTool({ name: 'wlo_create_collection_tree', arguments: {
        parentCollectionId: PARENT, tree: TREE, confirmToken: sc(preview).confirm!.token } }));
      const by = Object.fromEntries(done.nodes.map(n => [n.path, n]));
      assert.equal(by['Optik/Linsen']!.status, 'failed');
      assert.deepEqual([by['Optik/Linsen/Brennweite']!.status, by['Optik/Linsen/Brennweite']!.code], ['failed', 'parent_failed']);
      assert.equal(by['Optik/Licht']!.status, 'created');
      assert.ok(!creates.includes('Brennweite'));
    } finally { globalThis.fetch = real; }
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('bounds: 250 nodes, depth 4, 15 children, two identical siblings refused', async () => {
  setServiceCredentialForTest(MARIA);
  const c = await client();
  try {
    await assertRejectsWithoutUpstream(c, 'wlo_create_collection_tree', { parentCollectionId: PARENT,
      tree: [{ title: 'A', children: Array.from({ length: 16 }, (_, i) => ({ title: `K${i}` })) }] }, '16 children');
    const deep = { title: 'L1', children: [{ title: 'L2', children: [{ title: 'L3', children: [{ title: 'L4', children: [{ title: 'L5' }] }] }] }] };
    await assertRejectsWithoutUpstream(c, 'wlo_create_collection_tree', { parentCollectionId: PARENT, tree: [deep] }, 'depth 5');
    const { mock } = repository();
    try {
      const twins = await c.callTool({ name: 'wlo_create_collection_tree', arguments: {
        parentCollectionId: PARENT, tree: [{ title: 'Optik' }, { title: 'optik' }] } });
      assert.equal(twins.isError, true);
    } finally { mock.restore(); }
  } finally { await c.close(); setServiceCredentialForTest(null); }
});

test('a key presented with other arguments is plan_mismatch and writes nothing', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, creates } = repository();
  const c = await client();
  setPlanBudgetForTest(0);
  try {
    const { done } = await previewAndConfirm(c);
    const before = creates.length;
    const other = [{ title: 'Optik', children: [{ title: 'Schatten' }] }];
    const r = await c.callTool({ name: 'wlo_create_collection_tree', arguments: {
      parentCollectionId: PARENT, tree: other, continuationToken: sc(done).continuationToken } });
    assert.equal(sc(r).error?.code, 'plan_mismatch');
    assert.equal(creates.length, before);
  } finally { setPlanBudgetForTest(null); await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('a create whose answer never came is found on the next call, not created again', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, creates } = repository();
  const c = await client();
  try {
    const preview = await c.callTool({ name: 'wlo_create_collection_tree', arguments: { parentCollectionId: PARENT, tree: TREE } });
    const real = globalThis.fetch;
    let aborted = false;
    // The repository creates "Licht", but the answer is lost once.
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const res = await real(input as string, init);
      if (!aborted && String(init?.body ?? '').includes('"Licht"')) {
        aborted = true;
        throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
      }
      return res;
    }) as typeof fetch;
    try {
      const first = sc(await c.callTool({ name: 'wlo_create_collection_tree', arguments: {
        parentCollectionId: PARENT, tree: TREE, confirmToken: sc(preview).confirm!.token } }));
      const licht = first.nodes.find(n => n.path === 'Optik/Licht')!;
      assert.deepEqual([licht.status, licht.code], ['pending', 'timeout']);
      assert.equal(first.complete, false);
      const second = sc(await c.callTool({ name: 'wlo_create_collection_tree', arguments: {
        parentCollectionId: PARENT, tree: TREE, continuationToken: first.continuationToken } }));
      assert.equal(second.complete, true);
      assert.equal(second.nodes.find(n => n.path === 'Optik/Licht')!.status, 'existing');
      assert.equal(creates.filter(t => t === 'Licht').length, 1, 'Licht exactly once');
    } finally { globalThis.fetch = real; }
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('onExisting fail refuses a tree that meets an existing collection', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, creates } = repository([{ id: 'old-optik', parent: PARENT, title: 'Optik' }]);
  const c = await client();
  try {
    const r = await c.callTool({ name: 'wlo_create_collection_tree', arguments: {
      parentCollectionId: PARENT, tree: TREE, onExisting: 'fail' } });
    assert.equal(r.isError, true);
    assert.match(toolText(r), /old-optik/);
    assert.deepEqual(creates, []);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('the preview carries the WHOLE description: a key for one cannot create another (review F1)', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, creates } = repository();
  const c = await client();
  try {
    const head = 'x'.repeat(130);
    const treeA = [{ title: 'Optik', description: `${head} Ende A` }];
    const treeB = [{ title: 'Optik', description: `${head} Ende B` }];
    const preview = await c.callTool({ name: 'wlo_create_collection_tree', arguments: { parentCollectionId: PARENT, tree: treeA } });
    assert.match(toolText(preview), /Ende A/, 'the description in full');
    const swapped = await c.callTool({ name: 'wlo_create_collection_tree', arguments: {
      parentCollectionId: PARENT, tree: treeB, confirmToken: sc(preview).confirm!.token } });
    assert.equal(swapped.isError, true, toolText(swapped));
    assert.deepEqual(creates, []);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('a title of nothing but spaces is refused before any request (review F2)', async () => {
  setServiceCredentialForTest(MARIA);
  const c = await client();
  try {
    await assertRejectsWithoutUpstream(c, 'wlo_create_collection_tree',
      { parentCollectionId: PARENT, tree: [{ title: '   ' }] }, 'blank title');
  } finally { await c.close(); setServiceCredentialForTest(null); }
});

test('a second call while one runs gets inProgress, and nothing is created twice (review F5)', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, creates } = repository();
  const c = await client();
  try {
    const preview = await c.callTool({ name: 'wlo_create_collection_tree', arguments: { parentCollectionId: PARENT, tree: TREE } });
    const token = sc(preview).confirm!.token;
    const real = globalThis.fetch;
    let started!: () => void;
    const hasStarted = new Promise<void>(r => { started = r; });
    let release!: () => void;
    const released = new Promise<void>(r => { release = r; });
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      if (init?.method === 'POST') { started(); await released; }
      return real(input as string, init);
    }) as typeof fetch;
    try {
      const first = c.callTool({ name: 'wlo_create_collection_tree', arguments: { parentCollectionId: PARENT, tree: TREE, confirmToken: token } });
      await hasStarted;
      const second = sc(await c.callTool({ name: 'wlo_create_collection_tree', arguments: {
        parentCollectionId: PARENT, tree: TREE, confirmToken: token } }));
      assert.equal(second.inProgress, true, JSON.stringify(second));
      release();
      assert.equal(sc(await first).complete, true);
      assert.equal(creates.length, 4);
    } finally { release(); globalThis.fetch = real; }
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

/**
 * Measured on staging 2026-11-06: two collections created AT ONCE under the same
 * parent → HTTP 500 "ConcurrencyFailureException: Acl…", and the collection
 * exists anyway (17 of 24 parallel siblings; 0 of 12 under different parents).
 * This wrapper reproduces exactly that: an overlapping create under a parent
 * that already has one in flight lands, but answers 500.
 */
function siblingLockLikeStaging(real: typeof fetch): { fetch: typeof fetch; collisions: () => number } {
  const inFlight = new Map<string, number>();
  let collisions = 0;
  const wrapped = (async (input: unknown, init?: RequestInit) => {
    const m = /\/collections\/-home-\/([^/]+)\/children/.exec(String(input));
    if (!m || init?.method !== 'POST') return real(input as string, init);
    const parent = m[1]!;
    const busy = (inFlight.get(parent) ?? 0) > 0;
    inFlight.set(parent, (inFlight.get(parent) ?? 0) + 1);
    try {
      await new Promise(r => setTimeout(r, 15));
      const res = await real(input as string, init);
      if (busy) { collisions++; return new Response('{"error":"DAOException","message":"ConcurrencyFailureException: Acl"}', { status: 500 }); }
      return res;
    } finally { inFlight.set(parent, inFlight.get(parent)! - 1); }
  }) as typeof fetch;
  return { fetch: wrapped, collisions: () => collisions };
}

test('siblings are created one after another under the same parent (staging lock, 2026-11-06)', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, creates } = repository();
  const c = await client();
  const real = globalThis.fetch;
  try {
    const wide = [{ title: 'Optik', children: ['Licht', 'Linsen', 'Spiegel', 'Prisma', 'Farben'].map(title => ({ title })) }];
    const preview = await c.callTool({ name: 'wlo_create_collection_tree', arguments: { parentCollectionId: PARENT, tree: wide } });
    const lock = siblingLockLikeStaging(real);
    globalThis.fetch = lock.fetch;
    const a = sc(await c.callTool({ name: 'wlo_create_collection_tree', arguments: {
      parentCollectionId: PARENT, tree: wide, confirmToken: sc(preview).confirm!.token } }));
    assert.equal(lock.collisions(), 0, 'no two creates overlapped under one parent');
    assert.ok(a.nodes.every(n => n.status === 'created'), JSON.stringify(a.nodes));
    assert.equal(creates.length, 6);
  } finally { globalThis.fetch = real; await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('a create answered 500 that landed anyway is found and reported unverified, never failed', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, creates } = repository();
  const c = await client();
  const real = globalThis.fetch;
  try {
    const preview = await c.callTool({ name: 'wlo_create_collection_tree', arguments: { parentCollectionId: PARENT, tree: TREE } });
    let hit = false;
    // Someone else's create collides with ours once: the repository creates "Linsen" and answers 500.
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const res = await real(input as string, init);
      if (!hit && init?.method === 'POST' && String(init.body ?? '').includes('"Linsen"')) {
        hit = true;
        return new Response('{"message":"ConcurrencyFailureException: Acl"}', { status: 500 });
      }
      return res;
    }) as typeof fetch;
    const a = sc(await c.callTool({ name: 'wlo_create_collection_tree', arguments: {
      parentCollectionId: PARENT, tree: TREE, confirmToken: sc(preview).confirm!.token } }));
    const linsen = a.nodes.find(n => n.path === 'Optik/Linsen')!;
    assert.equal(linsen.status, 'unverified', JSON.stringify(linsen));
    assert.ok(linsen.nodeId);
    assert.equal(a.nodes.find(n => n.path === 'Optik/Linsen/Brennweite')!.status, 'created', 'its child still comes');
    assert.equal(creates.filter(t => t === 'Linsen').length, 1);
  } finally { globalThis.fetch = real; await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('every refusal of the write path carries a code, not only text (review: errors as codes)', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock } = repository();
  const c = await client();
  try {
    const code = (r: unknown) => (r as { structuredContent?: { error?: { code: string } } }).structuredContent?.error?.code;
    const twins = await c.callTool({ name: 'wlo_create_collection_tree', arguments: { parentCollectionId: PARENT, tree: [{ title: 'Optik' }, { title: 'optik' }] } });
    assert.equal(code(twins), 'invalid_input');
    const unknownToken = await c.callTool({ name: 'wlo_create_collection_tree', arguments: { parentCollectionId: PARENT, tree: TREE, confirmToken: 'z'.repeat(30) } });
    assert.equal(code(unknownToken), 'confirm_unknown');
    const missingParent = await c.callTool({ name: 'wlo_create_collection_tree', arguments: { parentCollectionId: 'gibt-es-nicht', tree: TREE } });
    assert.equal(code(missingParent), 'not_found');
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('a sixth unfinished plan is refused with too_many_plans — and the key stays valid (feedback point 7)', async () => {
  const { startPlan, PLANS_PER_IDENTITY } = await import('../src/services/write/plan-runner.js');
  const LISA: WloCredential = { header: 'Basic l', label: 'lisa-tree', source: 'user' };
  setServiceCredentialForTest(LISA);
  const { mock, creates } = repository();
  const c = await client();
  try {
    const preview = await c.callTool({ name: 'wlo_create_collection_tree', arguments: { parentCollectionId: PARENT, tree: TREE } });
    const token = (preview.structuredContent as { confirm: { token: string } }).confirm.token;
    const blockers = Array.from({ length: PLANS_PER_IDENTITY }, (_, i) =>
      startPlan('other-kind', 'x', [{ key: 'a' }], new Map(), `blocker-${i}`));
    const refused = await c.callTool({ name: 'wlo_create_collection_tree',
      arguments: { parentCollectionId: PARENT, tree: TREE, confirmToken: token } });
    assert.equal((refused.structuredContent as { error?: { code?: string } }).error?.code, 'too_many_plans');
    assert.equal(creates.length, 0, 'nothing written');
    // One blocker finishes → the SAME key now runs the plan.
    const { findPlan } = await import('../src/services/write/plan-runner.js');
    const first = findPlan<{ key: string }>('other-kind', blockers[0]!, 'x');
    if (first?.ok) first.plan.state.set('a', { status: 'created', nodeId: 'z' });
    const ran = await c.callTool({ name: 'wlo_create_collection_tree',
      arguments: { parentCollectionId: PARENT, tree: TREE, confirmToken: token } });
    assert.notEqual(ran.isError, true, toolText(ran));
    assert.ok(creates.length > 0);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('a timeout in the PREVIEW says outcomeOpen: false; with a key it stays open (feedback point 6)', async () => {
  setServiceCredentialForTest(MARIA);
  const mock = installFetchMock(() => {
    throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  });
  const c = await client();
  const err = (r: unknown) => (r as { structuredContent?: { error?: { code?: string; outcomeOpen?: boolean } } }).structuredContent?.error;
  try {
    const preview = await c.callTool({ name: 'wlo_create_collection_tree', arguments: { parentCollectionId: PARENT, tree: TREE } });
    assert.deepEqual([err(preview)?.code, err(preview)?.outcomeOpen], ['timeout', false]);
    assert.match(toolText(preview), /nichts geändert/);
    const keyed = await c.callTool({ name: 'wlo_create_collection_tree',
      arguments: { parentCollectionId: PARENT, tree: TREE, confirmToken: 'k'.repeat(30) } });
    assert.deepEqual([err(keyed)?.code, err(keyed)?.outcomeOpen], ['timeout', true]);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('two confirmations with the same key at once run ONE plan; the second is not sent to a new preview (overall review W1–W4)', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, creates } = repository();
  const c = await client();
  try {
    const args = { parentCollectionId: PARENT, tree: TREE };
    const token = sc(await c.callTool({ name: 'wlo_create_collection_tree', arguments: args })).confirm!.token;
    const [x, y] = await Promise.all([
      c.callTool({ name: 'wlo_create_collection_tree', arguments: { ...args, confirmToken: token } }),
      c.callTool({ name: 'wlo_create_collection_tree', arguments: { ...args, confirmToken: token } }),
    ]);
    for (const r of [x, y]) assert.equal(sc(r).error?.code, undefined, JSON.stringify(sc(r).error));
    assert.equal(creates.length, 4, 'each collection created once');
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});
