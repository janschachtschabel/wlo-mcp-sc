/**
 * tools-attach-fulltexts.test.ts – many full texts under ONE approval (plan
 * 2026-11-08, W2), on the plan runner with the single-record rules of W1.
 *
 * What this pins: the bounds (200 items, 3 000 000 bytes per call) are checked
 * before anything is read; the preview counts new / replaced / unchanged /
 * refused and refuses per record exactly as W1 does; only planned records are
 * written; the plan continues over `continuationToken`; and the server's memory
 * for held texts is bounded (`upstream_busy` BEFORE the key is spent).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { registerCurationFulltextTools } from '../src/tools/curation-fulltext.js';
import {
  FULLTEXTS_MAX_BYTES, fulltextStep, heldFulltextBytes, setFulltextHoldMaxForTest, type FulltextItem,
} from '../src/services/write/fulltext-plan.js';
import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { setPlanBudgetForTest } from '../src/services/write/plan-runner.js';
import { installFetchMock } from './fetchMock.js';

const MARIA: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };
const TOOL = 'wlo_attach_fulltexts';

async function client(): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerCurationFulltextTools(server, 'Bearer error="invalid_request"');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  return c;
}

interface Rec { size?: number; text?: string; originalId?: string }

/** `throwMeta`: metadata reads of these ids fail on the network (the fetch rejects). */
function repository(opts: { throwMeta?: Set<string> } = {}) {
  const recs: Record<string, Rec> = {
    plain: {}, plain2: {}, hasText: { text: 'Alt' }, same: { text: 'Gleich' }, withFile: { size: 4096 },
    refPlain: { originalId: 'plain' }, refSame: { originalId: 'same' },
    ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`p${i}`, {}])),
  };
  const posts: string[] = [];
  const mock = installFetchMock((url, init) => {
    const method = init?.method ?? 'GET';
    const tc = /\/nodes\/-home-\/([^/]+)\/textContent/.exec(url);
    if (tc && method === 'POST') { posts.push(tc[1]!); recs[tc[1]!]!.text = String(init?.body ?? ''); return { json: {} }; }
    if (tc) return { json: { text: recs[tc[1]!]?.text ?? null } };
    const meta = /\/nodes\/-home-\/([^/]+)\/metadata/.exec(url);
    if (meta) {
      if (opts.throwMeta?.has(meta[1]!)) throw new Error('socket hang up');
      const r = recs[meta[1]!];
      if (!r) return { status: 404, json: {} };
      return { json: { node: { ref: { id: meta[1], repo: '-home-' }, type: 'ccm:io', ...(r.size ? { size: String(r.size) } : {}),
        ...(r.originalId ? { originalId: r.originalId } : {}), properties: { 'cclom:title': [`Titel ${meta[1]}`] } } } };
    }
    return { json: {} };
  });
  return { mock, posts, recs };
}

const sc = (r: unknown) => (r as { structuredContent?: Record<string, any> }).structuredContent ?? {};
const item = (nodeId: string, markdown = `# ${nodeId}\n\nText.\n`) => ({ nodeId, markdown, source: 'binary' });

test('the preview counts new, replaced, unchanged and refused — and sends nothing', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, posts } = repository();
  const c = await client();
  try {
    const r = await c.callTool({ name: TOOL, arguments: { replace: true,
      items: [item('plain'), item('hasText'), item('same', 'Gleich'), item('withFile'), item('weg')] } });
    assert.deepEqual(sc(r)['counts'], { new: 1, replaced: 1, unchanged: 1, refused: 2 });
    assert.deepEqual(sc(r)['refused'].map((x: { nodeId: string; code: string }) => [x.nodeId, x.code]),
      [['withFile', 'would_replace_file'], ['weg', 'not_found']]);
    assert.equal(sc(r)['confirm']?.preview?.items?.length, 2);
    assert.equal(posts.length, 0);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('more than the call bound in bytes is invalid_input before anything is read', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock } = repository();
  const c = await client();
  try {
    const chunk = 'x'.repeat(Math.ceil(FULLTEXTS_MAX_BYTES / 2) + 1);
    const r = await c.callTool({ name: TOOL, arguments: { items: [item('plain', chunk), item('plain2', chunk)] } });
    assert.equal(sc(r)['error']?.code, 'invalid_input');
    assert.equal(mock.calls.length, 0);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('one approval writes exactly the planned records; the refused ones are never sent', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, posts } = repository();
  const c = await client();
  try {
    const items = [item('plain'), item('withFile'), item('plain2')];
    const preview = await c.callTool({ name: TOOL, arguments: { items } });
    const done = await c.callTool({ name: TOOL, arguments: { items, confirmToken: sc(preview)['confirm'].token } });
    assert.equal(sc(done)['complete'], true);
    assert.deepEqual(sc(done)['items'].map((x: { nodeId: string; status: string }) => [x.nodeId, x.status]),
      [['plain', 'stored'], ['plain2', 'stored']]);
    assert.deepEqual(posts.sort(), ['plain', 'plain2']);
    assert.equal(heldFulltextBytes(), 0, 'a done text is not held any longer');
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('it continues over continuationToken without a second approval', async (t) => {
  setServiceCredentialForTest(MARIA);
  setPlanBudgetForTest(0);
  t.after(() => setPlanBudgetForTest(null));
  const { mock, posts } = repository();
  const c = await client();
  try {
    const items = Array.from({ length: 6 }, (_, i) => item(`p${i}`));
    const preview = await c.callTool({ name: TOOL, arguments: { items } });
    let state = sc(await c.callTool({ name: TOOL, arguments: { items, confirmToken: sc(preview)['confirm'].token } }));
    assert.equal(state['complete'], false);
    for (let i = 0; i < 4 && !state['complete']; i++) {
      state = sc(await c.callTool({ name: TOOL, arguments: { items, continuationToken: state['continuationToken'] } }));
    }
    assert.equal(state['complete'], true);
    assert.equal(posts.length, 6, 'each record written once');
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('the held texts are bounded — over the bound it is upstream_busy before the key is spent', async (t) => {
  setServiceCredentialForTest(MARIA);
  setFulltextHoldMaxForTest(10);
  t.after(() => setFulltextHoldMaxForTest(null));
  const { mock, posts } = repository();
  const c = await client();
  try {
    const items = [item('plain')];
    const preview = await c.callTool({ name: TOOL, arguments: { items } });
    const token = sc(preview)['confirm'].token;
    const readsBefore = mock.calls.length;
    const busy = await c.callTool({ name: TOOL, arguments: { items, confirmToken: token } });
    assert.equal(sc(busy)['error']?.code, 'upstream_busy');
    assert.equal(mock.calls.length, readsBefore, 'a full memory is refused before a single record is read (finding 3)');
    assert.ok(sc(busy)['error']?.retryAfter > 0);
    assert.equal(posts.length, 0);
    setFulltextHoldMaxForTest(null);
    const later = await c.callTool({ name: TOOL, arguments: { items, confirmToken: token } });
    assert.equal(sc(later)['complete'], true, 'the key was not spent by the refusal');
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('the same record named twice is refused once as duplicate', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock } = repository();
  const c = await client();
  try {
    const r = await c.callTool({ name: TOOL, arguments: { items: [item('plain'), item('plain', '# anders\n')] } });
    assert.deepEqual(sc(r)['refused'].map((x: { code: string }) => x.code), ['duplicate']);
    assert.equal(sc(r)['confirm']?.preview?.items?.length, 1);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('texts held by ANOTHER unfinished plan count against the bound (review W2, finding 4)', async (t) => {
  setServiceCredentialForTest(MARIA);
  const { mock } = repository();
  const c = await client();
  t.after(() => { setFulltextHoldMaxForTest(null); setPlanBudgetForTest(null); });
  try {
    // Plan A: six records, one wave of four per call — two texts stay held.
    setPlanBudgetForTest(0);
    const a = Array.from({ length: 6 }, (_, i) => item(`p${i}`, `# p${i}\n\nAnderer Text.\n`));
    const aPreview = await c.callTool({ name: TOOL, arguments: { items: a } });
    const aState = sc(await c.callTool({ name: TOOL, arguments: { items: a, confirmToken: sc(aPreview)['confirm'].token } }));
    assert.equal(aState['complete'], false);
    const heldByA = heldFulltextBytes();
    assert.ok(heldByA > 0);
    // Plan B alone would fit; together with A it does not.
    const b = [item('plain')];
    setFulltextHoldMaxForTest(heldByA + Buffer.byteLength(b[0]!.markdown) - 1);
    const bPreview = await c.callTool({ name: TOOL, arguments: { items: b } });
    const busy = await c.callTool({ name: TOOL, arguments: { items: b, confirmToken: sc(bPreview)['confirm'].token } });
    assert.equal(sc(busy)['error']?.code, 'upstream_busy');
    // Finish A, so no unfinished plan of this identity outlives the test.
    setFulltextHoldMaxForTest(null);
    let st = aState;
    for (let i = 0; i < 4 && !st['complete']; i++) {
      st = sc(await c.callTool({ name: TOOL, arguments: { items: a, continuationToken: st['continuationToken'] } }));
    }
    assert.equal(st['complete'], true);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('a text changed between preview and confirmation is confirm_mismatch — nothing is written', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, posts } = repository();
  const c = await client();
  try {
    const preview = await c.callTool({ name: TOOL, arguments: { items: [item('plain')] } });
    const r = await c.callTool({ name: TOOL, arguments: { items: [item('plain', '# plain\n\nAnderer Text.\n')],
      confirmToken: sc(preview)['confirm'].token } });
    assert.equal(sc(r)['error']?.code, 'confirm_mismatch');
    assert.equal(posts.length, 0);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('a record named again through a reference is a duplicate — also when the first mention changes nothing (finding 6)', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock } = repository();
  const c = await client();
  try {
    const planned = sc(await c.callTool({ name: TOOL, arguments: { items: [item('plain'), item('refPlain', '# anders\n')] } }));
    assert.deepEqual(planned['refused'].map((x: { nodeId: string; code: string }) => [x.nodeId, x.code]), [['refPlain', 'duplicate']]);
    // `same` already carries "Gleich"; its reference must not then plan a replacement of it.
    const r = sc(await c.callTool({ name: TOOL, arguments: { replace: true, items: [item('same', 'Gleich'), item('refSame', '# neu\n')] } }));
    assert.deepEqual(r['unchangedItems'], [{ nodeId: 'same' }]);
    assert.deepEqual(r['refused'].map((x: { nodeId: string; code: string }) => [x.nodeId, x.code]), [['refSame', 'duplicate']]);
    assert.deepEqual(r['counts'], { new: 0, replaced: 0, unchanged: 1, refused: 1 });
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('a record that could not be checked at all is refused as unreadable, not text_unreadable (finding 5)', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock } = repository({ throwMeta: new Set(['plain2']) });
  const c = await client();
  try {
    const r = sc(await c.callTool({ name: TOOL, arguments: { items: [item('plain'), item('plain2')] } }));
    assert.deepEqual(r['refused'].map((x: { nodeId: string; code: string }) => [x.nodeId, x.code]), [['plain2', 'unreadable']]);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('a step that throws reports an open outcome and lets its text go (finding 1)', async () => {
  // Every read in `writeFulltext` answers a failure with a code now, so nothing
  // known throws there; the step's guard stays for what nobody foresaw — forced
  // here by a text that throws when it is read.
  const { mock } = repository();
  try {
    let held: string | null = 'x';
    const it = { key: 'plain', plan: { requestedId: 'plain', targetId: 'plain', title: 't', bytes: 7, sha256: 'x', replaces: false,
      source: 'binary', before: { size: 0, mimetype: '', hash: '' } } } as unknown as FulltextItem;
    Object.defineProperty(it, 'markdown', { get: () => { throw new Error('boom'); }, set: (v: string) => { held = v; } });
    const st = await fulltextStep(it, undefined);
    assert.equal(st.status, 'failed');
    assert.equal(st.outcomeOpen, true, 'whether anything went out is not known');
    assert.equal(held, '', 'a finished item never holds its text');
  } finally { mock.restore(); }
});

test('two confirmations with the same key at once start ONE plan, and the second is not sent back to a new preview (finding 2)', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, posts } = repository();
  const c = await client();
  try {
    const items = [item('plain'), item('plain2')];
    const token = sc(await c.callTool({ name: TOOL, arguments: { items } }))['confirm'].token;
    const [x, y] = await Promise.all([
      c.callTool({ name: TOOL, arguments: { items, confirmToken: token } }),
      c.callTool({ name: TOOL, arguments: { items, confirmToken: token } }),
    ]);
    for (const r of [x, y]) assert.equal(sc(r)['error']?.code, undefined, JSON.stringify(sc(r)['error']));
    assert.equal(posts.length, 2, 'each record written once');
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('memory taken by a plan that started WHILE this one was read is counted before the key is spent', async (t) => {
  setServiceCredentialForTest(MARIA);
  setPlanBudgetForTest(0);
  t.after(() => { setFulltextHoldMaxForTest(null); setPlanBudgetForTest(null); });
  const { mock } = repository();
  const c = await client();
  try {
    const a = Array.from({ length: 6 }, (_, i) => item(`p${i}`, `# p${i}\n\nDritter Text.\n`));
    const b = [item('plain', '# plain\n\nB.\n'), item('plain2', '# plain2\n\nB.\n')];
    const bytes = (xs: typeof a) => xs.reduce((n, x) => n + Buffer.byteLength(x.markdown), 0);
    // Each fits alone — so both pass the check before their reads — together they do not.
    setFulltextHoldMaxForTest(Math.max(bytes(a), bytes(b)) + 1);
    const ta = sc(await c.callTool({ name: TOOL, arguments: { items: a } }))['confirm'].token;
    const tb = sc(await c.callTool({ name: TOOL, arguments: { items: b } }))['confirm'].token;
    const [ra, rb] = await Promise.all([
      c.callTool({ name: TOOL, arguments: { items: a, confirmToken: ta } }),
      c.callTool({ name: TOOL, arguments: { items: b, confirmToken: tb } }),
    ]);
    const busy = [ra, rb].filter(r => sc(r)['error']?.code === 'upstream_busy');
    assert.equal(busy.length, 1, 'exactly one of the two had to wait');
    // Finish whatever started, so no unfinished plan of this identity outlives the test.
    setFulltextHoldMaxForTest(null);
    for (const [r, items] of [[ra, a], [rb, b]] as const) {
      let st = sc(r);
      for (let i = 0; i < 4 && st['continuationToken'] && !st['complete']; i++) {
        st = sc(await c.callTool({ name: TOOL, arguments: { items, continuationToken: st['continuationToken'] } }));
      }
    }
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('a record that gains content while the plan waits is not written — the safeguard is checked before EVERY write (overall review, 1)', async (t) => {
  setServiceCredentialForTest(MARIA);
  setPlanBudgetForTest(0);
  t.after(() => setPlanBudgetForTest(null));
  const { mock, posts, recs } = repository();
  const c = await client();
  try {
    const items = Array.from({ length: 6 }, (_, i) => item(`p${i}`, `# p${i}\n\nVierter Text.\n`));
    const preview = await c.callTool({ name: TOOL, arguments: { items } });
    let st = sc(await c.callTool({ name: TOOL, arguments: { items, confirmToken: sc(preview)['confirm'].token } }));
    assert.equal(st['complete'], false);
    // Between two calls of the plan someone uploads a file to p5.
    recs['p5']!.size = 4096;
    for (let i = 0; i < 4 && !st['complete']; i++) {
      st = sc(await c.callTool({ name: TOOL, arguments: { items, continuationToken: st['continuationToken'] } }));
    }
    const p5 = st['items'].find((x: { nodeId: string }) => x.nodeId === 'p5');
    assert.deepEqual([p5.status, p5.code, p5.outcomeOpen], ['failed', 'would_replace_file', false]);
    assert.ok(!posts.includes('p5'), 'nothing was sent to p5');
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});
