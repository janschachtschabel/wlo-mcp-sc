/**
 * tools-add-to-collections.test.ts – many materials into many collections under
 * ONE approval (BOERDi wishlist item 7, decision E4 = B, 2026-11-06).
 *
 * The same plan runner as the collection tree. What this pins beyond it: a
 * reference id is filed as its ORIGINAL (the PUT takes the original), a pair
 * already in place is `already` and sends nothing, a pair named twice — once
 * through a reference — is ONE step, and one refused pair does not stop the rest.
 *
 * Offline only: staging answers every filing with 500 since 2026-11-06 (STATUS).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { registerCurationAddManyTool } from '../src/tools/curation-add-many.js';
import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { setPlanBudgetForTest } from '../src/services/write/plan-runner.js';
import { assertRejectsWithoutUpstream, installFetchMock, toolText } from './fetchMock.js';

const MARIA: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };
const TOOL = 'wlo_add_to_collections';

async function client(): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerCurationAddManyTool(server, 'Bearer error="invalid_request"');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  return c;
}

/** Materials m1, m2 (and ref-2, a reference to m2), collections C1, C2. */
function repository(filed: Array<[string, string]> = [], refuse: string[] = []) {
  const nodes: Record<string, { type: string; aspects?: string[]; title: string; originalId?: string }> = {
    m1: { type: 'ccm:io', title: 'Arbeitsblatt Licht' },
    m2: { type: 'ccm:io', title: 'Video Linsen' },
    'ref-2': { type: 'ccm:io', title: 'Video Linsen', originalId: 'm2' },
    C1: { type: 'ccm:map', aspects: ['ccm:collection'], title: 'Optik' },
    C2: { type: 'ccm:map', aspects: ['ccm:collection'], title: 'Physik 7' },
  };
  const inCollection = new Set(filed.map(([n, c]) => `${n}>${c}`));
  const puts: string[] = [];
  const mock = installFetchMock((url, init) => {
    const method = init?.method ?? 'GET';
    const put = /\/collections\/-home-\/([^/]+)\/references\/([^/?]+)/.exec(url);
    if (put && method === 'PUT') {
      puts.push(`${put[2]}>${put[1]}`);
      if (refuse.includes(put[1]!)) return { status: 403, json: {} };
      inCollection.add(`${put[2]}>${put[1]}`);
      return { json: {} };
    }
    const usage = /\/usage\/v1\/usages\/node\/([^/]+)\/collections/.exec(url);
    if (usage) {
      const ids = [...inCollection].filter(k => k.startsWith(`${usage[1]}>`)).map(k => k.split('>')[1]!);
      return { json: ids.map(id => ({ collectionUsageType: 'ACTIVE', collection: { ref: { id, repo: '-home-' } } })) };
    }
    const meta = /\/nodes\/-home-\/([^/]+)\/metadata/.exec(url);
    if (meta) {
      const n = nodes[meta[1]!];
      if (!n) return { status: 404, json: {} };
      return { json: { node: {
        ref: { id: meta[1], repo: '-home-' }, type: n.type, ...(n.aspects ? { aspects: n.aspects } : {}), ...(n.originalId ? { originalId: n.originalId } : {}),
        properties: { 'cclom:title': [n.title], 'cm:title': [n.title] },
      } } };
    }
    return { json: {} };
  });
  return { mock, puts, nodes };
}

interface Answer {
  complete: boolean; progress: { done: number; total: number };
  pairs: Array<{ nodeId: string; collectionId: string; filedId?: string; status: string; code?: string }>;
  continuationToken?: string;
  confirm?: { token: string; preview: { items?: string[] } };
  error?: { code: string };
}
const sc = (r: unknown) => (r as { structuredContent: Answer }).structuredContent;

const PAIRS = [
  { nodeId: 'm1', collectionId: 'C1' },
  { nodeId: 'm1', collectionId: 'C2' },
  { nodeId: 'ref-2', collectionId: 'C1' },
];

async function previewAndConfirm(c: Client, pairs = PAIRS) {
  const preview = await c.callTool({ name: TOOL, arguments: { pairs } });
  assert.notEqual(preview.isError, true, toolText(preview));
  const token = sc(preview).confirm!.token;
  const done = await c.callTool({ name: TOOL, arguments: { pairs, confirmToken: token } });
  return { preview, token, done };
}

test('the preview names every pair by title and writes nothing', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, puts } = repository();
  const c = await client();
  try {
    const r = await c.callTool({ name: TOOL, arguments: { pairs: PAIRS } });
    assert.deepEqual(puts, []);
    for (const t of ['Arbeitsblatt Licht', 'Video Linsen', 'Optik', 'Physik 7']) assert.match(toolText(r), new RegExp(t));
    assert.equal(sc(r).confirm?.preview.items?.length, 3);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('one approval files every pair; a reference is filed as its original (filedId)', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, puts } = repository();
  const c = await client();
  try {
    const a = sc((await previewAndConfirm(c)).done);
    assert.equal(a.complete, true);
    assert.deepEqual(a.progress, { done: 3, total: 3 });
    assert.ok(a.pairs.every(p => p.status === 'added'), JSON.stringify(a.pairs));
    assert.ok(puts.includes('m2>C1') && !puts.some(p => p.startsWith('ref-2')), puts.join(','));
    const ref = a.pairs.find(p => p.nodeId === 'ref-2')!;
    assert.equal(ref.filedId, 'm2');
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('a pair already in place is already and sends nothing', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, puts } = repository([['m1', 'C1']]);
  const c = await client();
  try {
    const a = sc((await previewAndConfirm(c)).done);
    assert.equal(a.pairs.find(p => p.nodeId === 'm1' && p.collectionId === 'C1')!.status, 'already');
    assert.ok(!puts.includes('m1>C1'));
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('one refused pair does not stop the rest', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock } = repository([], ['C2']);
  const c = await client();
  try {
    const a = sc((await previewAndConfirm(c)).done);
    const by = (n: string, col: string) => a.pairs.find(p => p.nodeId === n && p.collectionId === col)!;
    assert.deepEqual([by('m1', 'C2').status, by('m1', 'C2').code], ['failed', 'forbidden']);
    assert.equal(by('m1', 'C1').status, 'added');
    assert.equal(by('ref-2', 'C1').status, 'added');
    assert.equal(a.complete, true, 'a failed pair is done, not open');
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('the same pair named twice — once through a reference — is one step', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, puts } = repository();
  const c = await client();
  try {
    const twice = [{ nodeId: 'm2', collectionId: 'C1' }, { nodeId: 'ref-2', collectionId: 'C1' }];
    const a = sc((await previewAndConfirm(c, twice)).done);
    assert.equal(a.progress.total, 1);
    assert.deepEqual(puts, ['m2>C1']);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('an unknown material or a target that is no collection refuses the preview', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, puts } = repository();
  const c = await client();
  try {
    const r = await c.callTool({ name: TOOL, arguments: { pairs: [{ nodeId: 'gone', collectionId: 'C1' }, { nodeId: 'm1', collectionId: 'm2' }] } });
    assert.equal(r.isError, true);
    assert.match(toolText(r), /gone/);
    assert.match(toolText(r), /keine Sammlung/);
    assert.deepEqual(puts, []);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('budget exhausted: the key continues; a re-presented key replays without a second PUT', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, puts } = repository();
  const c = await client();
  setPlanBudgetForTest(0);
  try {
    const { done, token } = await previewAndConfirm(c);
    let a = sc(done);
    for (let i = 0; i < 10 && !a.complete; i++) {
      a = sc(await c.callTool({ name: TOOL, arguments: { pairs: PAIRS, continuationToken: a.continuationToken } }));
    }
    assert.equal(a.complete, true);
    const again = sc(await c.callTool({ name: TOOL, arguments: { pairs: PAIRS, confirmToken: token } }));
    assert.equal(again.complete, true);
    assert.equal(puts.length, 3, puts.join(','));
  } finally { setPlanBudgetForTest(null); await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('bounds: at most 200 pairs', async () => {
  setServiceCredentialForTest(MARIA);
  const c = await client();
  try {
    const many = Array.from({ length: 201 }, (_, i) => ({ nodeId: `n${i}`, collectionId: 'C1' }));
    await assertRejectsWithoutUpstream(c, TOOL, { pairs: many }, '201 pairs');
  } finally { await c.close(); setServiceCredentialForTest(null); }
});

test('a filing whose answer never came is re-checked by the next call, not sent twice (review F4)', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, puts } = repository();
  const c = await client();
  try {
    const pairs = [{ nodeId: 'm1', collectionId: 'C1' }];
    const preview = await c.callTool({ name: TOOL, arguments: { pairs } });
    const real = globalThis.fetch;
    let aborted = false;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const res = await real(input as string, init);
      if (!aborted && init?.method === 'PUT') {
        aborted = true;
        throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
      }
      return res;
    }) as typeof fetch;
    try {
      const first = sc(await c.callTool({ name: TOOL, arguments: { pairs, confirmToken: sc(preview).confirm!.token } }));
      assert.deepEqual([first.pairs[0]!.status, first.pairs[0]!.code], ['pending', 'timeout']);
      assert.equal(first.complete, false);
      const second = sc(await c.callTool({ name: TOOL, arguments: { pairs, continuationToken: first.continuationToken } }));
      assert.equal(second.pairs[0]!.status, 'already');
      assert.equal(puts.length, 1);
    } finally { globalThis.fetch = real; }
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('two confirmations with the same key at once run ONE plan; the second is not sent to a new preview (overall review W1–W4)', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, puts } = repository();
  const c = await client();
  try {
    const token = sc(await c.callTool({ name: TOOL, arguments: { pairs: PAIRS } })).confirm!.token;
    const [x, y] = await Promise.all([
      c.callTool({ name: TOOL, arguments: { pairs: PAIRS, confirmToken: token } }),
      c.callTool({ name: TOOL, arguments: { pairs: PAIRS, confirmToken: token } }),
    ]);
    for (const r of [x, y]) assert.equal(sc(r).error?.code, undefined, JSON.stringify(sc(r).error));
    assert.equal(puts.length, 3, 'each filing done once');
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

// ── cross-package review of the audit follow-up, phase 1 ─────────────────────

test('the MATERIAL side is checked like the single tool does — a collection or folder is not filed as a record', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, puts, nodes } = repository();
  nodes['F1'] = { type: 'ccm:map', aspects: ['ccm:mapdata'], title: 'Ablage-Ordner' };
  const c = await client();
  try {
    const r = await c.callTool({ name: TOOL, arguments: { pairs: [
      { nodeId: 'C2', collectionId: 'C1' },     // a collection as the material
      { nodeId: 'F1', collectionId: 'C1' },     // a folder as the material
      { nodeId: 'm1', collectionId: 'F1' },     // a folder as the collection
      { nodeId: 'gone', collectionId: 'C1' },   // does not exist
    ] } });
    assert.equal(r.isError, true);
    const error = (r as unknown as { structuredContent: { error: { code: string; refused?: Array<Record<string, string>> } } }).structuredContent.error;
    assert.equal(error.code, 'invalid_input');
    // One entry per unusable id, with the code the single tool gives for it.
    assert.deepEqual([...(error.refused ?? [])].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), [
      { collectionId: 'F1', code: 'not_a_collection' },
      { nodeId: 'C2', code: 'is_a_collection' },
      { nodeId: 'F1', code: 'is_a_folder' },
      { nodeId: 'gone', code: 'not_found' },
    ].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
    assert.doesNotMatch(toolText(r), /confirmToken/);
    assert.equal(puts.length, 0);
    void mock;
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});
