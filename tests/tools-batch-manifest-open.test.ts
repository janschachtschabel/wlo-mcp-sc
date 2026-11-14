/**
 * tools-batch-manifest-open.test.ts – `wlo_store_batch_manifest` files
 * vorgang.json ONCE (audit 2026-11-14, W12; second review, finding 6).
 *
 * The tool gave its claim back whenever filing came out `failed` — also when
 * that failure was OPEN: a create answered 5xx may have created the record
 * (measured 2026-11-06). The next call then filed a second vorgang.json. W12
 * kept the claim instead — for good: every later call answered a non-error
 * "schon behandelt", nothing ever looked, and a manifest that had NOT landed
 * was never filed. Now an open outcome makes the next call LOOK in the place
 * the batch was filed in: found → reported, never a second file; not there →
 * filed once; could not look → still open, nothing filed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { registerCurationBatchTools, resetBatchesForTest } from '../src/tools/curation-batch.js';
import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { sharedUploadSlots, slotIdentity } from '../src/services/write/upload-slot.js';
import { installFetchMock, toolText, type MockResult } from './fetchMock.js';

const USER: WloCredential = { header: 'Basic x', label: 'maria-w12', source: 'user' };
const PDF = Buffer.from('%PDF-1.7\nMechanik\n%%EOF\n', 'latin1');
const SHA = createHash('sha256').update(PDF).digest('hex');

interface SceneOptions {
  /** What the manifest's create answers, attempt by attempt; past the list: 200. */
  statuses: number[];
  /** A create that is answered non-OK creates the (bare) record all the same. */
  lands?: boolean;
  /** Whether the listing of the own area answers — asked per look. */
  listing?: () => boolean;
}

/** One stored file, then the manifest. The own area is flat (no folder permission). */
async function scene(opts: SceneOptions) {
  setServiceCredentialForTest(USER);
  resetBatchesForTest();
  process.env['WLO_BATCH_UPLOAD_ENABLED'] = '1';
  const props = new Map<string, Record<string, string[]>>();
  const home: Array<{ id: string; name: string }> = [];
  let uploaded = 0;
  let creates = 0;
  let manifestTries = 0;
  const mock = installFetchMock((url, init): MockResult => {
    const method = init?.method ?? 'GET';
    const id = /\/nodes\/-home-\/([^/?]+)/.exec(url)?.[1] ?? '';
    if (url.includes('/iam/v1/people/')) return { json: { person: { authorityName: 'maria-w12' } } };
    if (url.includes('validateSession')) return { json: { toolPermissions: [] } };
    if (url.includes('/children?') && method === 'POST') {
      creates++;
      // The first create is the file; every later one is a vorgang.json.
      if (creates === 1) { home.push({ id: 'n-1', name: 'Mechanik.pdf' }); return { json: { node: { ref: { id: 'n-1' } } } }; }
      const status = opts.statuses[manifestTries++] ?? 200;
      const nodeId = `v-${manifestTries}`;
      if (status === 200 || opts.lands) home.push({ id: nodeId, name: home.some(n => n.name === 'vorgang.json') ? `vorgang (${manifestTries}).json` : 'vorgang.json' });
      return status === 200 ? { json: { node: { ref: { id: nodeId } } } } : { status, json: {} };
    }
    if (url.includes('/children?') && method === 'GET') {
      if (opts.listing && !opts.listing()) return { status: 503, json: {} };
      return { json: { nodes: home.map(n => ({ ref: { id: n.id }, name: n.name, createdAt: new Date().toISOString(), properties: { 'cm:name': [n.name] } })),
        pagination: { total: home.length, from: 0, count: home.length } } };
    }
    if (url.includes('/content?')) {
      const part = (init?.body as FormData).get('file');
      uploaded = part instanceof Blob ? part.size : 0;
      return { json: {} };
    }
    if (url.includes('/metadata') && method !== 'GET') {
      props.set(id, { ...(props.get(id) ?? {}), ...(JSON.parse(String(init?.body ?? '{}')) as Record<string, string[]>) });
      return { json: {} };
    }
    if (method === 'GET') return { json: { node: { ref: { id }, size: uploaded, downloadUrl: 'x', properties: { ...(props.get(id) ?? {}) } } } };
    return { json: {} };
  });
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerCurationBatchTools(server, 'Bearer x');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);

  const prepared = await c.callTool({ name: 'wlo_prepare_file_batch', arguments: {
    target: 'home', folderName: 'Physik 7', entries: [{ title: 'Mechanik', sha256: SHA, size: PDF.length, ext: 'pdf' }] } });
  const token = String((prepared.structuredContent as { batchToken?: string }).batchToken ?? '');
  assert.ok(token, toolText(prepared));
  const put = await sharedUploadSlots().put(slotIdentity(USER)!, Readable.from([PDF]), 'a.pdf');
  assert.ok(put.ok);
  const stored = await c.callTool({ name: 'wlo_store_batch_file', arguments: { batchToken: token, index: 0, ref: put.slot.ref } });
  assert.notEqual(stored.isError, true, toolText(stored));

  const manifest = () => c.callTool({ name: 'wlo_store_batch_manifest', arguments: { batchToken: token } });
  const end = async () => { await c.close(); mock.restore(); setServiceCredentialForTest(null); delete process.env['WLO_BATCH_UPLOAD_ENABLED']; };
  return { manifest, creates: () => creates, manifests: () => home.filter(n => /^vorgang/.test(n.name)), end };
}

interface Shown {
  status?: string; nodeId?: string; already?: boolean; found?: boolean; httpStatus?: number; open?: boolean;
  error?: { code?: string; outcomeOpen?: boolean; retryAfter?: number };
}
const sc = (r: unknown) => (r as { structuredContent: Shown }).structuredContent;

test('a manifest whose create was answered 5xx and LANDED: the next call looks, finds it, and files no second vorgang.json', async () => {
  const s = await scene({ statuses: [500], lands: true });
  try {
    const first = await s.manifest();
    assert.equal(first.isError, true);
    assert.deepEqual([sc(first).error?.code, sc(first).error?.outcomeOpen], ['upstream_error', true]);
    assert.equal(sc(first).httpStatus, undefined, 'the status became the code; it is not part of the answer');
    const sent = s.creates();
    const second = await s.manifest();
    assert.equal(s.creates(), sent, 'no second create');
    assert.notEqual(second.isError, true, toolText(second));
    // The create landed, the step that writes content and summary never ran: there, and not complete.
    assert.deepEqual([sc(second).status, sc(second).nodeId, sc(second).found], ['unverified', 'v-1', true]);
    assert.match(toolText(second), /kein zweiter angelegt/);
    // Now it is a RESULT: handed out again, nothing looked up or sent.
    const third = await s.manifest();
    assert.deepEqual([sc(third).already, sc(third).nodeId], [true, 'v-1']);
    assert.equal(s.manifests().length, 1);
  } finally { await s.end(); }
});

test('a manifest whose create was answered 5xx and did NOT land: the next call looks, then files it — once', async () => {
  const s = await scene({ statuses: [502] });
  try {
    const first = await s.manifest();
    assert.equal(sc(first).error?.outcomeOpen, true);
    assert.match(toolText(first), /offen/);
    const sent = s.creates();
    const second = await s.manifest();
    assert.equal(s.creates(), sent + 1, 'looked, found nothing, filed');
    assert.deepEqual([second.isError === true, sc(second).status], [false, 'stored']);
    const third = await s.manifest();
    assert.equal(s.creates(), sent + 1);
    assert.equal(sc(third).already, true);
    assert.equal(s.manifests().length, 1, 'one vorgang.json');
  } finally { await s.end(); }
});

test('a manifest that was filed completely is FOUND by its summary (it names this batch\'s record)', async () => {
  // The create is answered 500 and lands; a later attempt of somebody (here: the fixture) finished it.
  const s = await scene({ statuses: [200] });
  try {
    const first = await s.manifest();
    assert.equal(sc(first).status, 'stored');
    const { findFiledManifest } = await import('../src/services/write/batch-filing.js');
    const mine = await findFiledManifest('-userhome-', new Set(['n-1']), { since: Date.now() + 60_000, ownFolder: false });
    assert.deepEqual(mine, { found: 'filed', nodeId: 'v-1' });
    // Another batch's manifest in the same flat area is not ours.
    const other = await findFiledManifest('-userhome-', new Set(['n-other']), { since: Date.now() + 60_000, ownFolder: false });
    assert.deepEqual(other, { found: 'none' });
  } finally { await s.end(); }
});

test('an open manifest whose place cannot be read stays OPEN: nothing is filed blind, and the next call looks again', async () => {
  let up = false;
  const s = await scene({ statuses: [500], listing: () => up });
  try {
    await s.manifest();
    const sent = s.creates();
    const second = await s.manifest();
    assert.equal(s.creates(), sent, 'no create without a look');
    assert.equal(second.isError, true);
    assert.deepEqual([sc(second).error?.code, sc(second).error?.outcomeOpen], ['not_checked', true]);
    up = true;
    const third = await s.manifest();
    assert.equal(s.creates(), sent + 1, 'the listing answers, nothing is there: filed');
    assert.equal(sc(third).status, 'stored');
  } finally { await s.end(); }
});

for (const status of [429, 503]) {
  test(`a manifest whose create was answered ${status} is coded upstream_busy with its wait — and open`, async () => {
    const s = await scene({ statuses: [status] });
    try {
      const first = await s.manifest();
      const error = sc(first).error!;
      assert.deepEqual([error.code, error.outcomeOpen, typeof error.retryAfter], ['upstream_busy', true, 'number']);
    } finally { await s.end(); }
  });
}

test('a manifest whose create was REFUSED (403) created nothing: coded forbidden, not open, and it may be filed again', async () => {
  const s = await scene({ statuses: [403, 403] });
  try {
    const first = await s.manifest();
    assert.equal(first.isError, true);
    assert.deepEqual([sc(first).error?.code, sc(first).error?.outcomeOpen], ['forbidden', false]);
    const sent = s.creates();
    await s.manifest();
    assert.equal(s.creates(), sent + 1, 'the claim was released, the retry sends again');
  } finally { await s.end(); }
});
