/**
 * collection-maintenance.test.ts – package 3 of the collection-structure plan
 * (chatbot team, S1 set / S6 / S7, 2026-11-14): setting an order, taking many
 * materials out, moving them, deleting empty collections, and the order a
 * created tree gets.
 *
 * Every test runs against `collectionRepo` (tests/collection-repo.ts), which
 * behaves as the repository was MEASURED to — an `/order` that refuses an
 * original's id, a DELETE by original id that answers 200 and removes nothing.
 * The live counterpart is tests/live/collection-structure.test.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { registerCurationOrderTool } from '../src/tools/curation-order.js';
import { registerCurationRemoveManyTool } from '../src/tools/curation-remove-many.js';
import { registerCurationAddManyTool } from '../src/tools/curation-add-many.js';
import { registerCurationDeleteEmptyTool } from '../src/tools/curation-delete-empty.js';
import { registerCurationTreeTools } from '../src/tools/curation-tree.js';
import { registerCurationCollectionTools } from '../src/tools/curation-collections.js';
import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { setPlanBudgetForTest } from '../src/services/write/plan-runner.js';
import { planOrder, type OrderChild } from '../src/services/write/collection-order.js';
import { assertRejectsWithoutUpstream, toolText } from './fetchMock.js';
import { collectionRepo, type RepoOptions } from './collection-repo.js';

const MARIA: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };

async function client(): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  const challenge = 'Bearer error="invalid_request"';
  registerCurationOrderTool(server, challenge);
  registerCurationRemoveManyTool(server, challenge);
  registerCurationAddManyTool(server, challenge);
  registerCurationDeleteEmptyTool(server, challenge);
  registerCurationTreeTools(server, challenge);
  registerCurationCollectionTools(server, challenge);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  return c;
}

interface Entry { nodeId?: string; collectionId?: string; path?: string; status: string; code?: string; outcomeOpen?: boolean; removeFrom?: string }
interface Answer {
  complete?: boolean; pairs?: Entry[]; items?: Entry[]; nodes?: Entry[]; continuationToken?: string;
  confirm?: { token: string; preview: { items?: string[]; action?: string } };
  error?: { code: string; missing?: string[]; unknown?: string[]; outcomeOpen?: boolean; refused?: unknown[] };
  order?: string[]; kind?: string;
}
const sc = (r: unknown) => (r as { structuredContent: Answer }).structuredContent;
const codeOf = (e: Entry) => (e.code ? `${e.status}/${e.code}` : e.status);

/** A scenario: the repository, a client, and "preview then confirm". */
async function scene(build: (repo: ReturnType<typeof collectionRepo>) => void, opts: RepoOptions = {}) {
  setServiceCredentialForTest(MARIA);
  const repo = collectionRepo(opts);
  build(repo);
  const c = await client();
  const call = (name: string, args: Record<string, unknown>) => c.callTool({ name, arguments: args });
  const confirm = async (name: string, args: Record<string, unknown>) => {
    const preview = await call(name, args);
    assert.notEqual(preview.isError, true, toolText(preview));
    const token = sc(preview).confirm?.token;
    assert.ok(token, `a preview with a key was expected: ${toolText(preview)}`);
    return { preview, done: await call(name, { ...args, confirmToken: token }) };
  };
  const end = async () => { setPlanBudgetForTest(null); await c.close(); repo.mock.restore(); setServiceCredentialForTest(null); };
  return { repo, call, confirm, end };
}

/** Optik with three sub-collections created in the order C, A, B and three records filed in it. */
function optik(repo: ReturnType<typeof collectionRepo>) {
  repo.collection('optik', 'Optik');
  repo.collection('c', 'C wie Camera', 'optik');
  repo.collection('a', 'A wie Auge', 'optik');
  repo.collection('b', 'B wie Brille', 'optik');
  for (const id of ['m1', 'm2', 'm3']) { repo.record(id, `Material ${id}`); repo.file('optik', id); }
  repo.collection('mechanik', 'Mechanik');
}

// ── wlo_order_collection ────────────────────────────────────────────────────

const kid = (id: string, extra: Partial<OrderChild> = {}): OrderChild => ({ id, title: id, hasPosition: false, ...extra });

test('planOrder: a list must name every child of its kind, of one kind, once', () => {
  const have = { collections: [kid('a'), kid('b'), kid('c')], contents: [kid('ref-1', { materialId: 'm1' }), kid('ref-2', { materialId: 'm2' })] };
  const missing = planOrder(have, ['b', 'a']);
  assert.deepEqual([missing.ok, !missing.ok && missing.code, !missing.ok && missing.missing], [false, 'invalid_input', ['c']]);
  const mixed = planOrder(have, ['a', 'b', 'c', 'm1']);
  assert.ok(!mixed.ok && /mischt/.test(mixed.reasons[0]!));
  const unknown = planOrder(have, ['a', 'b', 'x']);
  assert.deepEqual(!unknown.ok && unknown.unknown, ['x']);
  assert.ok(!planOrder(have, ['a', 'a', 'b', 'c']).ok);
  // The same content by its reference AND its original is one content named twice.
  assert.ok(!planOrder(have, ['m1', 'ref-1', 'm2']).ok);
  const good = planOrder(have, ['m2', 'ref-1']);
  assert.deepEqual(good.ok && [good.kind, good.children.map(c => c.id)], ['contents', ['ref-2', 'ref-1']]);
});

test('planOrder: the same order is "no change" only when it is SET — an order that merely equals creation is still written', () => {
  const unset = { collections: [kid('a'), kid('b')], contents: [] };
  assert.equal(planOrder(unset, ['a', 'b']).ok, true);
  const set = { collections: [kid('a', { hasPosition: true }), kid('b', { hasPosition: true })], contents: [] };
  const same = planOrder(set, ['a', 'b']);
  assert.deepEqual([same.ok, !same.ok && same.code], [false, 'no_change']);
});

test('wlo_order_collection: sub-collections — the preview shows the sequence, the confirm sets it, and the stored listing has it', async () => {
  const s = await scene(optik);
  try {
    assert.deepEqual(s.repo.order('optik'), ['c', 'a', 'b']);
    const { preview, done } = await s.confirm('wlo_order_collection', { collectionId: 'optik', order: ['a', 'b', 'c'] });
    assert.deepEqual(sc(preview).confirm!.preview.items, ['1. „A wie Auge“ (a)', '2. „B wie Brille“ (b)', '3. „C wie Camera“ (c)']);
    assert.equal(done.isError, undefined, toolText(done));
    assert.deepEqual(s.repo.order('optik'), ['a', 'b', 'c']);
    assert.deepEqual([sc(done).kind, sc(done).order], ['collections', ['a', 'b', 'c']]);
  } finally { await s.end(); }
});

test('wlo_order_collection: contents — originals are named, the REFERENCE ids are sent', async () => {
  const s = await scene(optik);
  try {
    const { done } = await s.confirm('wlo_order_collection', { collectionId: 'optik', order: ['m3', 'm1', 'm2'] });
    assert.equal(done.isError, undefined, toolText(done));
    assert.deepEqual(s.repo.order('optik', true), ['m3', 'm1', 'm2']);
    const sent = s.repo.writes.find(w => w.path.endsWith('/order'))!.body as string[];
    assert.deepEqual(sent, ['ref-m3-optik', 'ref-m1-optik', 'ref-m2-optik']);
    // The answer speaks the caller's ids.
    assert.deepEqual(sc(done).order, ['m3', 'm1', 'm2']);
  } finally { await s.end(); }
});

test('wlo_order_collection: an incomplete list is refused before any key and names what is missing', async () => {
  const s = await scene(optik);
  try {
    const r = await s.call('wlo_order_collection', { collectionId: 'optik', order: ['a', 'b'] });
    assert.equal(r.isError, true);
    assert.deepEqual([sc(r).error!.code, sc(r).error!.missing, sc(r).error!.outcomeOpen], ['invalid_input', ['c'], false]);
    assert.match(toolText(r), /ALLE 3 Untersammlungen/);
    assert.equal(s.repo.writes.length, 0);
  } finally { await s.end(); }
});

test('wlo_order_collection: a record, a listing that does not answer and an order nobody kept are each said as what they are', async () => {
  let s = await scene(optik);
  try {
    const r = await s.call('wlo_order_collection', { collectionId: 'm1', order: ['a'] });
    assert.equal(sc(r).error!.code, 'not_a_collection');
  } finally { await s.end(); }
  s = await scene(optik, { intercept: q => (q.method === 'GET' && q.url.includes('/children') && q.url.includes('filter=folders') ? { status: 503, json: {} } : undefined) });
  try {
    const r = await s.call('wlo_order_collection', { collectionId: 'optik', order: ['a', 'b', 'c'] });
    assert.deepEqual([sc(r).error!.code, sc(r).error!.outcomeOpen], ['not_checked', false]);
  } finally { await s.end(); }
  // Answered 200, and the listing shows the old order afterwards.
  s = await scene(optik, { intercept: q => (q.method === 'POST' && q.url.endsWith('/order') ? { json: {} } : undefined) });
  try {
    const { done } = await s.confirm('wlo_order_collection', { collectionId: 'optik', order: ['a', 'b', 'c'] });
    assert.equal(sc(done).error!.code, 'not_visible');
  } finally { await s.end(); }
});

// ── wlo_remove_from_collections ─────────────────────────────────────────────

test('wlo_remove_from_collections: one approval takes every pair out — by the reference, whichever id was named', async () => {
  const s = await scene(optik);
  try {
    const pairs = [{ nodeId: 'm1', collectionId: 'optik' }, { nodeId: 'ref-m2-optik', collectionId: 'optik' }, { nodeId: 'm3', collectionId: 'mechanik' }];
    const { preview, done } = await s.confirm('wlo_remove_from_collections', { pairs });
    assert.match(sc(preview).confirm!.preview.items![2]!, /ist dort nicht enthalten, kein Schritt/);
    assert.deepEqual(sc(done).pairs!.map(codeOf), ['removed', 'removed', 'absent']);
    assert.deepEqual(s.repo.order('optik', true), ['m3']);
    // The materials themselves are still there.
    assert.ok(s.repo.nodes.has('m1') && s.repo.nodes.has('m2'));
    const deletes = s.repo.writes.filter(w => w.method === 'DELETE').map(w => w.path.split('/').pop());
    assert.deepEqual(deletes.sort(), ['ref-m1-optik', 'ref-m2-optik']);
  } finally { await s.end(); }
});

test('wlo_remove_from_collections: nothing to take out is an answer without a key, and an unusable id refuses the call', async () => {
  const s = await scene(optik);
  try {
    const none = await s.call('wlo_remove_from_collections', { pairs: [{ nodeId: 'm1', collectionId: 'mechanik' }] });
    assert.equal(none.isError, undefined, toolText(none));
    assert.deepEqual([sc(none).confirm, sc(none).complete, sc(none).pairs!.map(codeOf)], [undefined, true, ['absent']]);
    const bad = await s.call('wlo_remove_from_collections', { pairs: [{ nodeId: 'm1', collectionId: 'm2' }, { nodeId: 'nope', collectionId: 'optik' }] });
    assert.equal(sc(bad).error!.code, 'invalid_input');
    assert.equal(sc(bad).error!.refused!.length, 2);
    assert.equal(s.repo.writes.length, 0);
  } finally { await s.end(); }
});

test('wlo_remove_from_collections: a refusal is failed and not open; an aborted removal that landed is OURS on the next call', async () => {
  let s = await scene(optik, { intercept: q => (q.method === 'DELETE' ? { status: 403, json: {} } : undefined) });
  try {
    const { done } = await s.confirm('wlo_remove_from_collections', { pairs: [{ nodeId: 'm1', collectionId: 'optik' }] });
    const e = sc(done).pairs![0]!;
    assert.deepEqual([e.status, e.code, e.outcomeOpen], ['failed', 'forbidden', false]);
    assert.match(toolText(done), /nicht herausgenommen \(forbidden\)/);
  } finally { await s.end(); }
  let aborted = false;
  s = await scene(optik, { intercept: (q) => {
    if (q.method !== 'DELETE' || aborted) return undefined;
    aborted = true;
    // The removal happens; only its answer is lost.
    s.repo.nodes.delete('ref-m1-optik');
    throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  } });
  try {
    const args = { pairs: [{ nodeId: 'm1', collectionId: 'optik' }] };
    const first = sc((await s.confirm('wlo_remove_from_collections', args)).done);
    assert.deepEqual(first.pairs!.map(codeOf), ['pending/timeout']);
    const second = sc(await s.call('wlo_remove_from_collections', { ...args, continuationToken: first.continuationToken }));
    assert.deepEqual(second.pairs!.map(codeOf), ['removed']);
  } finally { await s.end(); }
});

// ── moving: wlo_add_to_collections with removeFrom ──────────────────────────

test('removeFrom: filed in the target FIRST, then taken out of the source — moved', async () => {
  const s = await scene(optik);
  try {
    const pairs = [{ nodeId: 'm1', collectionId: 'mechanik', removeFrom: 'optik' }, { nodeId: 'm2', collectionId: 'mechanik' }];
    const { preview, done } = await s.confirm('wlo_add_to_collections', { pairs });
    assert.match(sc(preview).confirm!.preview.items![0]!, /→ „Mechanik“ \(mechanik\); danach heraus aus „Optik“ \(optik\)$/);
    assert.doesNotMatch(sc(preview).confirm!.preview.items![1]!, /danach heraus/);
    assert.deepEqual(sc(done).pairs!.map(codeOf), ['moved', 'added']);
    assert.equal(sc(done).pairs![0]!.removeFrom, 'optik');
    assert.deepEqual(s.repo.order('mechanik', true), ['m1', 'm2']);
    assert.deepEqual(s.repo.order('optik', true), ['m2', 'm3']);
    const sequence = s.repo.writes.filter(w => w.path.includes('m1')).map(w => w.method);
    assert.deepEqual(sequence, ['PUT', 'DELETE']);
  } finally { await s.end(); }
});

test('removeFrom: the removal fails — the material is in BOTH, and the answer says so', async () => {
  const s = await scene(optik, { intercept: q => (q.method === 'DELETE' ? { status: 403, json: {} } : undefined) });
  try {
    const { done } = await s.confirm('wlo_add_to_collections', { pairs: [{ nodeId: 'm1', collectionId: 'mechanik', removeFrom: 'optik' }] });
    assert.deepEqual(sc(done).pairs!.map(codeOf), ['added/not_removed']);
    assert.match(toolText(done), /liegt jetzt in BEIDEN Sammlungen/);
    assert.ok(s.repo.order('optik', true).includes('m1') && s.repo.order('mechanik', true).includes('m1'));
  } finally { await s.end(); }
});

test('removeFrom: a filing that failed removes NOTHING from the source', async () => {
  const s = await scene(optik, { intercept: q => (q.method === 'PUT' ? { status: 403, json: {} } : undefined) });
  try {
    const { done } = await s.confirm('wlo_add_to_collections', { pairs: [{ nodeId: 'm1', collectionId: 'mechanik', removeFrom: 'optik' }] });
    assert.equal(sc(done).pairs![0]!.status, 'failed');
    assert.ok(!s.repo.writes.some(w => w.method === 'DELETE'));
    assert.ok(s.repo.order('optik', true).includes('m1'));
  } finally { await s.end(); }
});

test('removeFrom: source equal to target, a source that is no collection, and one filing with two sources are refused before any key', async () => {
  const s = await scene(optik);
  try {
    for (const pairs of [
      [{ nodeId: 'm1', collectionId: 'optik', removeFrom: 'optik' }],
      [{ nodeId: 'm1', collectionId: 'mechanik', removeFrom: 'm2' }],
      [{ nodeId: 'm1', collectionId: 'mechanik', removeFrom: 'optik' }, { nodeId: 'm1', collectionId: 'mechanik' }],
    ]) {
      const r = await s.call('wlo_add_to_collections', { pairs });
      assert.equal(r.isError, true, JSON.stringify(pairs));
      assert.equal(sc(r).confirm, undefined);
    }
    assert.equal(s.repo.writes.length, 0);
  } finally { await s.end(); }
});

test('removeFrom is part of the approval: the key without it is not this plan', async () => {
  const s = await scene(optik);
  try {
    const preview = await s.call('wlo_add_to_collections', { pairs: [{ nodeId: 'm1', collectionId: 'mechanik' }] });
    const r = await s.call('wlo_add_to_collections', { pairs: [{ nodeId: 'm1', collectionId: 'mechanik', removeFrom: 'optik' }], confirmToken: sc(preview).confirm!.token });
    assert.equal(r.isError, true);
    assert.equal(s.repo.writes.length, 0);
  } finally { await s.end(); }
});

test('removeFrom is part of the PLAN: a continuation that drops it is another plan', async () => {
  const s = await scene(optik);
  setPlanBudgetForTest(0);
  try {
    const pairs = ['m1', 'm2', 'm3'].map(nodeId => ({ nodeId, collectionId: 'mechanik', removeFrom: 'optik' }));
    pairs.push({ nodeId: 'm1', collectionId: 'c', removeFrom: 'optik' }, { nodeId: 'm2', collectionId: 'c', removeFrom: 'optik' });
    const first = sc((await s.confirm('wlo_add_to_collections', { pairs })).done);
    assert.equal(first.complete, false);
    const other = await s.call('wlo_add_to_collections', {
      pairs: pairs.map(({ nodeId, collectionId }) => ({ nodeId, collectionId })), continuationToken: first.continuationToken,
    });
    assert.equal(sc(other).error!.code, 'plan_mismatch');
  } finally { await s.end(); }
});

// ── wlo_delete_collections ──────────────────────────────────────────────────

/** A wrong tree under `root`: w1 > w2 > w3, all empty; `full` holds a record; `half` holds an unnamed sub-collection. */
function wrongTree(repo: ReturnType<typeof collectionRepo>) {
  repo.collection('root', 'Physik');
  repo.collection('w1', 'Falsch 1', 'root');
  repo.collection('w2', 'Falsch 2', 'w1');
  repo.collection('w3', 'Falsch 3', 'w2');
  repo.collection('full', 'Mit Inhalt', 'root');
  repo.record('m1', 'Material'); repo.file('full', 'm1');
  repo.collection('half', 'Mit Unterordner', 'root');
  repo.collection('other', 'Nicht genannt', 'half');
  repo.folder('f1', 'Ablage');
}

test('wlo_delete_collections: a chain of empty collections goes children-first; what holds something stays as not_empty', async () => {
  const s = await scene(wrongTree);
  try {
    const { preview, done } = await s.confirm('wlo_delete_collections', { nodeIds: ['w1', 'full', 'w2', 'half', 'w3'] });
    const lines = sc(preview).confirm!.preview.items!;
    assert.match(lines.find(l => l.includes('(full)'))!, /bleibt — enthält 1 Inhalt$/);
    assert.match(lines.find(l => l.includes('(half)'))!, /bleibt — enthält 1 Untersammlung, die nicht genannt ist$/);
    assert.match(lines.find(l => l.includes('(w1)'))!, /sobald ihre mitgenannten Untersammlungen gelöscht sind/);
    assert.match(lines.find(l => l.includes('(w3)'))!, /leer, wird gelöscht$/);
    const status = Object.fromEntries(sc(done).items!.map(e => [e.nodeId, codeOf(e)]));
    assert.deepEqual(status, { w3: 'deleted', w2: 'deleted', w1: 'deleted', full: 'not_empty', half: 'not_empty' });
    assert.deepEqual(s.repo.writes.filter(w => w.method === 'DELETE').map(w => w.path.split('/').pop()), ['w3', 'w2', 'w1']);
    assert.ok(s.repo.nodes.has('full') && s.repo.nodes.has('half') && s.repo.nodes.has('other') && s.repo.nodes.has('m1'));
  } finally { await s.end(); }
});

test('wlo_delete_collections: a parent whose child is NOT named stays, even if that child is empty', async () => {
  const s = await scene(wrongTree);
  try {
    const { done } = await s.confirm('wlo_delete_collections', { nodeIds: ['w1', 'w3'] });
    const status = Object.fromEntries(sc(done).items!.map(e => [e.nodeId, codeOf(e)]));
    assert.deepEqual(status, { w3: 'deleted', w1: 'not_empty' });
    assert.ok(s.repo.nodes.has('w1') && s.repo.nodes.has('w2'));
  } finally { await s.end(); }
});

test('wlo_delete_collections: a collection that gained a member after the approval stays', async () => {
  const s = await scene(wrongTree);
  setPlanBudgetForTest(0);
  try {
    // Five independent empty collections: the fifth is left for the next call.
    for (const id of ['e1', 'e2', 'e3', 'e4', 'e5']) s.repo.collection(id, `Leer ${id}`, 'root');
    const args = { nodeIds: ['e1', 'e2', 'e3', 'e4', 'e5'] };
    const first = sc((await s.confirm('wlo_delete_collections', args)).done);
    assert.equal(first.complete, false);
    s.repo.file('e5', 'm1');
    const second = sc(await s.call('wlo_delete_collections', { ...args, continuationToken: first.continuationToken }));
    assert.equal(second.items!.find(e => e.nodeId === 'e5')!.status, 'not_empty');
    assert.ok(s.repo.nodes.has('e5'));
  } finally { await s.end(); }
});

test('wlo_delete_collections: nothing empty is an answer without a key; a record, a folder and an unknown id refuse the call', async () => {
  const s = await scene(wrongTree);
  try {
    const none = await s.call('wlo_delete_collections', { nodeIds: ['full', 'half'] });
    assert.equal(none.isError, undefined, toolText(none));
    assert.deepEqual([sc(none).confirm, sc(none).items!.map(codeOf)], [undefined, ['not_empty', 'not_empty']]);
    const bad = await s.call('wlo_delete_collections', { nodeIds: ['w3', 'm1', 'f1', 'nope'] });
    assert.equal(sc(bad).error!.code, 'invalid_input');
    assert.equal(sc(bad).error!.refused!.length, 3);
    assert.equal(s.repo.writes.length, 0);
  } finally { await s.end(); }
});

test('wlo_delete_collections: contents that cannot be read are never taken for "empty"', async () => {
  const s = await scene(wrongTree, { intercept: q => (q.method === 'GET' && q.id === 'w3' && q.url.includes('/children') ? { status: 503, json: {} } : undefined) });
  try {
    const { preview, done } = await s.confirm('wlo_delete_collections', { nodeIds: ['w3'] });
    assert.match(sc(preview).confirm!.preview.items![0]!, /WENN sie beim Löschen leer ist/);
    assert.deepEqual(sc(done).items!.map(codeOf), ['pending/not_checked']);
    assert.ok(s.repo.nodes.has('w3'));
    assert.ok(!s.repo.writes.some(w => w.method === 'DELETE'));
  } finally { await s.end(); }
});

test('wlo_delete_collections: more than 200 ids are refused by the schema', async () => {
  setServiceCredentialForTest(MARIA);
  const c = await client();
  try {
    await assertRejectsWithoutUpstream(c, 'wlo_delete_collections', { nodeIds: Array.from({ length: 201 }, (_, i) => `n${i}`) }, '201 ids');
  } finally { await c.close(); setServiceCredentialForTest(null); }
});

// ── the order of a created tree ─────────────────────────────────────────────

test('wlo_create_collection_tree: new sub-collections stand in the order of the input, behind the ones that were there', async () => {
  const s = await scene((repo) => {
    repo.collection('root', 'Physik');
    repo.collection('old-2', 'Zwei (alt)', 'root');
    repo.collection('old-1', 'Eins (alt)', 'root');
  });
  try {
    const tree = [{ title: 'Optik', children: [{ title: 'Linsen' }, { title: 'Auge' }, { title: 'Farben' }] }, { title: 'Eins (alt)' }, { title: 'Akustik' }];
    const { preview, done } = await s.confirm('wlo_create_collection_tree', { parentCollectionId: 'root', tree });
    assert.match(toolText(preview), /in der hier genannten Reihenfolge hinter den schon vorhandenen/);
    assert.ok(sc(done).nodes!.every(n => !n.code), JSON.stringify(sc(done).nodes));
    const title = (id: string) => s.repo.nodes.get(id)!.title;
    assert.deepEqual(s.repo.order('root').map(title), ['Zwei (alt)', 'Eins (alt)', 'Optik', 'Akustik']);
    const optikId = sc(done).nodes!.find(n => n.path === 'Optik')!.nodeId!;
    assert.deepEqual(s.repo.order(optikId).map(title), ['Linsen', 'Auge', 'Farben']);
    // Explicit: every child of both levels carries a position.
    for (const parent of ['root', optikId]) {
      assert.ok([...s.repo.nodes.values()].filter(n => n.parent === parent).every(n => n.position !== undefined), parent);
    }
  } finally { await s.end(); }
});

test('wlo_create_collection_tree: an order that could not be set never undoes a create — the step says order_not_set', async () => {
  const s = await scene(repo => { repo.collection('root', 'Physik'); },
    { intercept: q => (q.method === 'POST' && q.url.endsWith('/order') ? { status: 500, json: {} } : undefined) });
  try {
    const { done } = await s.confirm('wlo_create_collection_tree', { parentCollectionId: 'root', tree: [{ title: 'A' }, { title: 'B' }] });
    const nodes = sc(done).nodes!;
    assert.deepEqual(nodes.map(n => n.status), ['created', 'created']);
    assert.deepEqual(nodes.map(n => n.code), [undefined, 'order_not_set']);
    assert.equal([...s.repo.nodes.values()].filter(n => n.parent === 'root').length, 2);
    assert.match(toolText(done), /die Reihenfolge dieser Ebene ließ sich nicht setzen/);
  } finally { await s.end(); }
});

test('wlo_create_collection_tree: a single new child and a tree that creates nothing send no order', async () => {
  const s = await scene((repo) => { repo.collection('root', 'Physik'); repo.collection('old', 'Optik', 'root'); });
  try {
    await s.confirm('wlo_create_collection_tree', { parentCollectionId: 'root', tree: [{ title: 'Optik', children: [{ title: 'Linsen' }] }] });
    assert.ok(!s.repo.writes.some(w => w.path.endsWith('/order')));
  } finally { await s.end(); }
});

// ── review of package 3 (2026-11-14) ────────────────────────────────────────

/** Optik, with one record lying in it DIRECTLY — the original itself, no reference. */
function withDirect(repo: ReturnType<typeof collectionRepo>) {
  optik(repo);
  repo.direct('optik', 'd1', 'Direkt abgelegt');
}

test('a record filed DIRECTLY in a collection is never "taken out": that would delete the material (measured)', async () => {
  const s = await scene(withDirect);
  try {
    // The batch: refused for this pair, the other pair still goes.
    const { done } = await s.confirm('wlo_remove_from_collections', { pairs: [{ nodeId: 'd1', collectionId: 'optik' }, { nodeId: 'm1', collectionId: 'optik' }] });
    const byId = Object.fromEntries(sc(done).pairs!.map(e => [e.nodeId, e]));
    assert.deepEqual([byId['d1']!.status, byId['d1']!.code, byId['d1']!.outcomeOpen], ['failed', 'is_original', false]);
    assert.equal(byId['m1']!.status, 'removed');
    assert.ok(s.repo.nodes.has('d1'), 'the material is still there');
    assert.ok(!s.repo.writes.some(w => w.method === 'DELETE' && w.path.endsWith('/d1')));
    // A move out of that collection: filed in the target, and it STAYS in the source.
    const move = await s.confirm('wlo_add_to_collections', { pairs: [{ nodeId: 'd1', collectionId: 'mechanik', removeFrom: 'optik' }] });
    assert.deepEqual(sc(move.done).pairs!.map(codeOf), ['added/source_is_original']);
    assert.ok(s.repo.nodes.has('d1'));
    assert.match(toolText(move.done), /würde das Material löschen/);
  } finally { await s.end(); }
});

test('removeFrom: a source that cannot be read ends the move as FILED and not removed — never as "nicht aufgenommen"', async () => {
  // The source's contents do not answer: the reference cannot be found, nothing can be sent.
  const s = await scene(optik, { intercept: q => (q.method === 'GET' && q.id === 'optik' && q.url.includes('/children') && !q.url.includes('filter=folders')
    ? { status: 503, json: {} } : undefined) });
  try {
    const args = { pairs: [{ nodeId: 'm1', collectionId: 'mechanik', removeFrom: 'optik' }] };
    let a = sc((await s.confirm('wlo_add_to_collections', args)).done);
    for (let guard = 0; !a.complete && guard < 6; guard++) {
      a = sc(await s.call('wlo_add_to_collections', { ...args, continuationToken: a.continuationToken }));
    }
    const e = a.pairs![0]!;
    assert.deepEqual([a.complete, e.status, e.code], [true, 'added', 'not_removed']);
    assert.notEqual(e.outcomeOpen, true, 'nothing was ever sent to the source');
    assert.ok(s.repo.order('mechanik', true).includes('m1'));
    // Filed ONCE: the later calls did not file again.
    assert.equal(s.repo.writes.filter(w => w.method === 'PUT').length, 1);
  } finally { await s.end(); }
});

test('removeFrom: a removal whose answer was lost — the next call does not file again, and reports the move', async () => {
  let lost = false;
  const s = await scene(optik, { intercept: (q) => {
    if (q.method !== 'DELETE' || lost) return undefined;
    lost = true;
    s.repo.nodes.delete('ref-m1-optik'); // the removal lands; only its answer is lost
    throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  } });
  try {
    const args = { pairs: [{ nodeId: 'm1', collectionId: 'mechanik', removeFrom: 'optik' }] };
    const first = sc((await s.confirm('wlo_add_to_collections', args)).done);
    assert.equal(first.complete, false);
    const second = sc(await s.call('wlo_add_to_collections', { ...args, continuationToken: first.continuationToken }));
    assert.deepEqual(second.pairs!.map(codeOf), ['moved']);
    assert.equal(s.repo.writes.filter(w => w.method === 'PUT').length, 1);
  } finally { await s.end(); }
});

test('wlo_add_to_collections: a filing the repository answers 409 (it is there) is "already", not a failure', async () => {
  // The usage lookup does not answer, so the tool files — and the repository says "there already".
  const s = await scene((repo) => { optik(repo); repo.file('mechanik', 'm1'); },
    { intercept: q => (q.url.includes('/usage/') ? { status: 500, json: {} } : undefined) });
  try {
    const { done } = await s.confirm('wlo_add_to_collections', { pairs: [{ nodeId: 'm1', collectionId: 'mechanik' }] });
    assert.deepEqual(sc(done).pairs!.map(codeOf), ['already']);
  } finally { await s.end(); }
});

test('wlo_delete_collections: a 5xx on a delete that LANDED is our delete; a refusal is failed and not open', async () => {
  let s = await scene(wrongTree, { intercept: (q) => {
    if (q.method !== 'DELETE' || !q.url.endsWith('/w3')) return undefined;
    s.repo.nodes.delete('w3');
    return { status: 502, json: {} };
  } });
  try {
    const args = { nodeIds: ['w3'] };
    const first = sc((await s.confirm('wlo_delete_collections', args)).done);
    assert.deepEqual(first.items!.map(codeOf), ['pending/upstream_error']);
    const second = sc(await s.call('wlo_delete_collections', { ...args, continuationToken: first.continuationToken }));
    assert.deepEqual(second.items!.map(codeOf), ['deleted']);
  } finally { await s.end(); }
  s = await scene(wrongTree, { intercept: q => (q.method === 'DELETE' ? { status: 403, json: {} } : undefined) });
  try {
    const { done } = await s.confirm('wlo_delete_collections', { nodeIds: ['w3'] });
    const e = sc(done).items![0]!;
    assert.deepEqual([e.status, e.code, e.outcomeOpen], ['failed', 'forbidden', false]);
    assert.match(toolText(done), /nicht gelöscht \(forbidden\)/);
  } finally { await s.end(); }
});

test('wlo_delete_collections: a parent waits for a named child whose delete is still open — it is not kept for good', async () => {
  let aborted = false;
  const s = await scene(wrongTree, { intercept: (q) => {
    if (q.method !== 'DELETE' || !q.url.endsWith('/w3') || aborted) return undefined;
    aborted = true; // the first delete of w3 never answers and does NOT land
    throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  } });
  try {
    const args = { nodeIds: ['w1', 'w2', 'w3'] };
    let a = sc((await s.confirm('wlo_delete_collections', args)).done);
    assert.deepEqual(Object.fromEntries(a.items!.map(e => [e.nodeId, codeOf(e)])),
      { w3: 'pending/timeout', w2: 'pending/child_pending', w1: 'pending/child_pending' });
    for (let guard = 0; !a.complete && guard < 6; guard++) a = sc(await s.call('wlo_delete_collections', { ...args, continuationToken: a.continuationToken }));
    assert.deepEqual(a.items!.map(e => e.status), ['deleted', 'deleted', 'deleted']);
  } finally { await s.end(); }
});

test('wlo_delete_collections: a record lying directly in a collection makes it not empty; a long chain goes in order across calls', async () => {
  const s = await scene((repo) => {
    repo.collection('root', 'Physik');
    repo.collection('holds', 'Hält ein Original', 'root');
    repo.direct('holds', 'd1', 'Direkt');
    let parent = 'root';
    for (let i = 1; i <= 6; i++) { repo.collection(`k${i}`, `Kette ${i}`, parent); parent = `k${i}`; }
  });
  setPlanBudgetForTest(0);
  try {
    const args = { nodeIds: ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'holds'] };
    const started = await s.confirm('wlo_delete_collections', args);
    assert.match(sc(started.preview).confirm!.preview.items!.find(l => l.includes('(k1)'))!, /sobald ihre mitgenannten Untersammlungen gelöscht sind/);
    assert.match(sc(started.preview).confirm!.preview.items!.find(l => l.includes('(k6)'))!, /leer, wird gelöscht$/);
    let a = sc(started.done);
    for (let guard = 0; !a.complete && guard < 8; guard++) a = sc(await s.call('wlo_delete_collections', { ...args, continuationToken: a.continuationToken }));
    const status = Object.fromEntries(a.items!.map(e => [e.nodeId, e.status]));
    assert.deepEqual(status, { k6: 'deleted', k5: 'deleted', k4: 'deleted', k3: 'deleted', k2: 'deleted', k1: 'deleted', holds: 'not_empty' });
    assert.deepEqual(s.repo.writes.filter(w => w.method === 'DELETE').map(w => w.path.split('/').pop()), ['k6', 'k5', 'k4', 'k3', 'k2', 'k1']);
    assert.ok(s.repo.nodes.has('d1'));
  } finally { await s.end(); }
});

test('wlo_order_collection: a material filed twice is named by its references — the preview shows the id that is sent', async () => {
  const s = await scene((repo) => { optik(repo); repo.file('optik', 'm1', 'ref-m1-second'); });
  try {
    const byMaterial = await s.call('wlo_order_collection', { collectionId: 'optik', order: ['m1', 'm2', 'm3'] });
    assert.equal(sc(byMaterial).error!.code, 'invalid_input');
    assert.match(toolText(byMaterial), /mehrfach in der Sammlung.*ref-m1-optik, ref-m1-second/);
    const { preview } = await s.confirm('wlo_order_collection', { collectionId: 'optik', order: ['ref-m1-second', 'm2', 'm3', 'ref-m1-optik'] });
    const lines = sc(preview).confirm!.preview.items!;
    assert.equal(lines[0], '1. „Material m1“ (m1; Verweis ref-m1-second)');
    assert.equal(lines[3], '4. „Material m1“ (m1; Verweis ref-m1-optik)');
  } finally { await s.end(); }
});

test('wlo_order_collection: 500 entries can be ordered, 501 are too many — said as that, not as "name all 501"', async () => {
  for (const [n, code] of [[500, undefined], [501, 'too_many']] as const) {
    const s = await scene((repo) => { repo.collection('big', 'Groß'); for (let i = 0; i < n; i++) repo.collection(`s${i}`, `S ${i}`, 'big'); });
    try {
      const order = Array.from({ length: 500 }, (_, i) => `s${499 - i}`);
      const r = await s.call('wlo_order_collection', { collectionId: 'big', order });
      assert.equal(sc(r).error?.code, code, toolText(r).slice(0, 200));
    } finally { await s.end(); }
  }
});

test('wlo_remove_from_collections: a reference and its original named for one collection are ONE step', async () => {
  const s = await scene(optik);
  try {
    const { done } = await s.confirm('wlo_remove_from_collections', { pairs: [{ nodeId: 'm1', collectionId: 'optik' }, { nodeId: 'ref-m1-optik', collectionId: 'optik' }] });
    assert.equal(sc(done).pairs!.length, 1);
    assert.equal(s.repo.writes.filter(w => w.method === 'DELETE').length, 1);
  } finally { await s.end(); }
});

test('wlo_create_collection_tree: the level is ordered even when its LAST step failed', async () => {
  const s = await scene(repo => { repo.collection('root', 'Physik'); },
    { intercept: q => (q.method === 'POST' && q.url.endsWith('/root/children') && (q.body as { title?: string }).title === 'C' ? { status: 403, json: {} } : undefined) });
  try {
    const { done } = await s.confirm('wlo_create_collection_tree', { parentCollectionId: 'root', tree: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] });
    assert.deepEqual(sc(done).nodes!.map(n => n.status), ['created', 'created', 'failed']);
    assert.equal(s.repo.writes.filter(w => w.path.endsWith('/order')).length, 1);
    assert.ok([...s.repo.nodes.values()].filter(n => n.parent === 'root').every(n => n.position !== undefined));
  } finally { await s.end(); }
});

test('wlo_remove_from_collection (the single tool): a record filed directly is refused too — its preview promised the material stays', async () => {
  const s = await scene(withDirect);
  try {
    const { done } = await s.confirm('wlo_remove_from_collection', { collectionId: 'optik', nodeId: 'd1' });
    assert.equal(done.isError, true);
    assert.deepEqual([sc(done).error!.code, sc(done).error!.outcomeOpen], ['is_original', false]);
    assert.match(toolText(done), /würde das Material selbst löschen/);
    assert.ok(s.repo.nodes.has('d1'));
    assert.ok(!s.repo.writes.some(w => w.method === 'DELETE'));
    // A reference beside it still goes.
    const ok = await s.confirm('wlo_remove_from_collection', { collectionId: 'optik', nodeId: 'm1' });
    assert.equal(ok.done.isError, undefined, toolText(ok.done));
    assert.ok(s.repo.nodes.has('m1') && !s.repo.nodes.has('ref-m1-optik'));
  } finally { await s.end(); }
});
