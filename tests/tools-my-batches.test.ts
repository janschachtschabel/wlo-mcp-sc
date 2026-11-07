/**
 * tools-my-batches.test.ts – wlo_list_my_batches (BOERDi wishlist item 9,
 * decision A, 2026-11-06).
 *
 * The server cannot read a private file's bytes with a Basic login (measured:
 * download 403, /content 405, /textContent empty), so the manifest is ALSO kept
 * in `cm:description` of the vorgang.json record — a model property the
 * repository keeps unchanged at 54 000 characters, which an unknown property is
 * not (400, or 200 and dropped). The list reads that, from the NODE store of the
 * person's own area, never from the search index.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { registerCurationBatchTools } from '../src/tools/curation-batch.js';
import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { sharedUploadSlots, slotIdentity } from '../src/services/write/upload-slot.js';
import { installFetchMock, toolText, type MockResult } from './fetchMock.js';

const USER: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };
const SERVICE: WloCredential = { header: 'Basic y', label: 'dienst', source: 'service' };

async function client(): Promise<Client> {
  process.env['WLO_BATCH_UPLOAD_ENABLED'] = '1';
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerCurationBatchTools(server, 'Bearer error="invalid_request"');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  return c;
}

const manifest = (ordner: string, stands: string[]) => JSON.stringify({
  format: 'wlo.ablage-vorgang@1', ordner, layout: 'flat',
  inhalte: stands.map((stand, index) => ({ index, titel: `Datei ${index}`, art: 'pdf', groesse: 10, sha256: 'a'.repeat(64),
    name: `datei-${index}.pdf`, stand, ...(stand === 'stored' ? { nodeId: `rec-${index}` } : {}) })),
});

const file = (id: string, name: string, createdAt: string) =>
  ({ ref: { id, repo: '-home-' }, name, createdAt, properties: { 'cm:name': [name], 'cclom:title': [name] } });

/** The person's area: two flat manifests (one unreadable), one in a folder, one unrelated file. */
function area(calls: string[] = []) {
  const descriptions: Record<string, string> = {
    'man-flat': manifest('Physik 7', ['stored', 'stored', 'dropped', 'failed']),
    'man-bad': 'kein JSON',
    'man-folder': manifest('Chemie 8', ['stored', 'unverified', 'offen']),
  };
  return installFetchMock((url): MockResult => {
    calls.push(url);
    if (url.includes('/-userhome-/children') && url.includes('filter=files')) {
      return { json: { nodes: [
        file('man-flat', 'vorgang.json', '2026-11-06T10:00:00.000Z'),
        file('man-bad', 'vorgang (1).json', '2026-11-06T12:00:00.000Z'),
        file('other', 'Arbeitsblatt.pdf', '2026-11-06T13:00:00.000Z'),
      ], pagination: { total: 3, from: 0, count: 3 } } };
    }
    if (url.includes('/-userhome-/children') && url.includes('filter=folders')) {
      return { json: { nodes: [{ ref: { id: 'ordner-1', repo: '-home-' }, name: 'Chemie 8', properties: { 'cm:name': ['Chemie 8'] } }],
        pagination: { total: 1, from: 0, count: 1 } } };
    }
    if (url.includes('/ordner-1/children')) {
      return { json: { nodes: [file('man-folder', 'vorgang.json', '2026-11-05T09:00:00.000Z')], pagination: { total: 1, from: 0, count: 1 } } };
    }
    const meta = /nodes\/-home-\/([^/]+)\/metadata/.exec(url);
    if (meta && descriptions[meta[1]!] !== undefined) {
      return { json: { node: { ref: { id: meta[1], repo: '-home-' }, properties: { 'cm:description': [descriptions[meta[1]!]!] } } } };
    }
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
}

interface Batch {
  manifestNodeId: string; folderNodeId: string | null; title: string; createdAt: string;
  status: string; counts?: Record<string, number>;
  entries?: Array<{ index: number; title: string; nodeId?: string; status: string }>;
}

test('lists the own batches newest first, from the node store, an unreadable manifest named as such', async (t) => {
  setServiceCredentialForTest(USER);
  const calls: string[] = [];
  const mock = area(calls);
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const r = await (await client()).callTool({ name: 'wlo_list_my_batches', arguments: {} });
  assert.notEqual(r.isError, true, toolText(r));
  const batches = (r.structuredContent as { batches: Batch[] }).batches;
  assert.deepEqual(batches.map(b => b.manifestNodeId), ['man-bad', 'man-flat', 'man-folder'], 'newest first');
  assert.equal(batches[0]!.status, 'unreadable');
  assert.deepEqual(batches[1]!.counts, { stored: 2, dropped: 1, unverified: 0, failed: 1, open: 0 });
  assert.equal(batches[1]!.title, 'Physik 7');
  assert.equal(batches[1]!.folderNodeId, null, 'flat in the own area');
  assert.equal(batches[2]!.folderNodeId, 'ordner-1');
  assert.ok(!calls.some(u => u.includes('/search/')), 'never the search index — "no batches" must not rest on it');
});

test('limit bounds the list, and only the shown manifests are read', async (t) => {
  setServiceCredentialForTest(USER);
  const calls: string[] = [];
  const mock = area(calls);
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const r = await (await client()).callTool({ name: 'wlo_list_my_batches', arguments: { limit: 1 } });
  assert.equal((r.structuredContent as { batches: Batch[] }).batches.length, 1);
  assert.equal(calls.filter(u => /\/metadata/.test(u)).length, 1);
});

test('one batch in detail carries its entries', async (t) => {
  setServiceCredentialForTest(USER);
  const mock = area();
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const r = await (await client()).callTool({ name: 'wlo_list_my_batches', arguments: { nodeId: 'man-folder' } });
  const batch = (r.structuredContent as { batch: Batch }).batch;
  assert.equal(batch.title, 'Chemie 8');
  assert.deepEqual(batch.entries?.map(e => e.status), ['stored', 'unverified', 'open']);
  assert.equal(batch.entries?.[0]?.nodeId, 'rec-0');
});

test('a nodeId that is not one of the own manifests is not_found — never a foreign record', async (t) => {
  setServiceCredentialForTest(USER);
  const mock = area();
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const r = await (await client()).callTool({ name: 'wlo_list_my_batches', arguments: { nodeId: 'irgendwas' } });
  assert.equal(r.isError, true);
  assert.equal((r.structuredContent as { error: { code: string } }).error.code, 'not_found');
});

test('the service account is refused with login_required and nothing is read', async (t) => {
  setServiceCredentialForTest(SERVICE);
  const calls: string[] = [];
  const mock = area(calls);
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const r = await (await client()).callTool({ name: 'wlo_list_my_batches', arguments: {} });
  assert.equal(r.isError, true);
  assert.equal((r.structuredContent as { error: { code: string } }).error.code, 'login_required');
  assert.equal(calls.length, 0);
});



test('filing vorgang.json also writes the manifest into cm:description, and the preview says so', async (t) => {
  setServiceCredentialForTest(USER);
  const PDF = Buffer.from('%PDF-1.7\nx\n%%EOF\n', 'latin1');
  const writes: Array<{ url: string; body: string }> = [];
  let description = '';
  const mock = installFetchMock((url, init): MockResult => {
    const method = init?.method ?? 'GET';
    if (method !== 'GET') writes.push({ url, body: String(init?.body ?? '') });
    if (url.includes('validateSession')) return { json: { toolPermissions: [] } };
    if (url.includes('/children?') && method === 'POST') return { json: { node: { ref: { id: `n-${writes.length}` } } } };
    if (url.includes('/metadata') && method !== 'GET') {
      const props = JSON.parse(String(init?.body ?? '{}')) as Record<string, string[]>;
      if (props['cm:description']) description = props['cm:description'][0]!;
      return { json: {} };
    }
    if (method === 'GET' && url.includes('/metadata')) {
      return { json: { node: { ref: { id: 'n' }, size: PDF.length, properties: {
        'cclom:title': ['vorgang.json'], ...(description ? { 'cm:description': [description] } : {}) } } } };
    }
    return { json: {} };
  });
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  const plan = { target: 'home', folderName: 'Physik 7',
    entries: [{ title: 'Mechanik', sha256: createHash('sha256').update(PDF).digest('hex'), size: PDF.length, ext: 'pdf' }] };
  const prep = await c.callTool({ name: 'wlo_prepare_file_batch', arguments: plan });
  assert.match(toolText(prep), /Beschreibung des Datensatzes/, 'the extra write is announced');
  const token = String((prep.structuredContent as Record<string, unknown>)['batchToken']);
  const slot = await sharedUploadSlots().put(slotIdentity(USER)!, Readable.from([PDF]), 'a.pdf');
  await c.callTool({ name: 'wlo_store_batch_file', arguments: { batchToken: token, index: 0, ref: slot.ok ? slot.slot.ref : '' } });
  const m = await c.callTool({ name: 'wlo_store_batch_manifest', arguments: { batchToken: token } });
  assert.notEqual(m.isError, true, toolText(m));
  const stored = JSON.parse(description) as { format: string; inhalte: unknown[] };
  assert.equal(stored.format, 'wlo.ablage-vorgang@1');
  assert.equal(stored.inhalte.length, 1);
});


test('a summary the repository drops makes the manifest unverified, never stored', async (t) => {
  setServiceCredentialForTest(USER);
  const PDF = Buffer.from('%PDF-1.7 x %%EOF', 'latin1');
  // Metadata writes answer 200, but the read-back never carries cm:description.
  const mock = installFetchMock((url, init): MockResult => {
    const method = init?.method ?? 'GET';
    if (url.includes('validateSession')) return { json: { toolPermissions: [] } };
    if (url.includes('/children?') && method === 'POST') return { json: { node: { ref: { id: 'n-1' } } } };
    if (method === 'GET' && url.includes('/metadata')) {
      return { json: { node: { ref: { id: 'n-1' }, size: PDF.length, properties: { 'cclom:title': ['vorgang.json'] } } } };
    }
    return { json: {} };
  });
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  const plan = { target: 'home', folderName: 'Physik 7',
    entries: [{ title: 'Mechanik', sha256: createHash('sha256').update(PDF).digest('hex'), size: PDF.length, ext: 'pdf' }] };
  const prep = await c.callTool({ name: 'wlo_prepare_file_batch', arguments: plan });
  const token = String((prep.structuredContent as Record<string, unknown>)['batchToken']);
  const slot = await sharedUploadSlots().put(slotIdentity(USER)!, Readable.from([PDF]), 'a.pdf');
  await c.callTool({ name: 'wlo_store_batch_file', arguments: { batchToken: token, index: 0, ref: slot.ok ? slot.slot.ref : '' } });
  const m = await c.callTool({ name: 'wlo_store_batch_manifest', arguments: { batchToken: token } });
  assert.equal((m.structuredContent as { status: string }).status, 'unverified', toolText(m));
});


test('a folder that cannot be listed is disclosed as a cut scan, not passed over in silence (review)', async (t) => {
  setServiceCredentialForTest(USER);
  const base = area();
  base.restore();
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/ordner-1/children')) return { status: 500, json: {} };
    if (url.includes('/-userhome-/children') && url.includes('filter=folders')) {
      return { json: { nodes: [{ ref: { id: 'ordner-1', repo: '-home-' }, name: 'Chemie 8', properties: { 'cm:name': ['Chemie 8'] } }],
        pagination: { total: 1, from: 0, count: 1 } } };
    }
    if (url.includes('/-userhome-/children')) return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
    return { json: {} };
  });
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const r = await (await client()).callTool({ name: 'wlo_list_my_batches', arguments: {} });
  assert.equal((r.structuredContent as { scanTruncated?: boolean }).scanTruncated, true);
  assert.match(toolText(r), /älter|fehlen/);
});

test('a batch folder is read with ONE page — a batch holds at most 201 entries (review)', async (t) => {
  setServiceCredentialForTest(USER);
  const calls: string[] = [];
  // A FULL first page: a reader that pages on would ask for a second one.
  const full = Array.from({ length: 250 }, (_, i) => file(`f-${i}`, `datei-${i}.pdf`, '2026-11-05T09:00:00.000Z'));
  const mock = installFetchMock((url): MockResult => {
    calls.push(url);
    if (url.includes('/-userhome-/children') && url.includes('filter=folders')) {
      return { json: { nodes: [{ ref: { id: 'ordner-1', repo: '-home-' }, name: 'Chemie 8', properties: { 'cm:name': ['Chemie 8'] } }],
        pagination: { total: 1, from: 0, count: 1 } } };
    }
    if (url.includes('/ordner-1/children')) return { json: { nodes: full, pagination: { total: 400, from: 0, count: 250 } } };
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  await (await client()).callTool({ name: 'wlo_list_my_batches', arguments: {} });
  const folderCalls = calls.filter(u => u.includes('/ordner-1/children'));
  assert.equal(folderCalls.length, 1);
  assert.match(folderCalls[0]!, /maxItems=250/);
});

test('an unreadable batch in a folder is named after its folder (review)', async (t) => {
  setServiceCredentialForTest(USER);
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/-userhome-/children') && url.includes('filter=folders')) {
      return { json: { nodes: [{ ref: { id: 'ordner-1', repo: '-home-' }, name: 'Chemie 8', properties: { 'cm:name': ['Chemie 8'] } }],
        pagination: { total: 1, from: 0, count: 1 } } };
    }
    if (url.includes('/ordner-1/children')) {
      return { json: { nodes: [file('man-x', 'vorgang.json', '2026-11-05T09:00:00.000Z')], pagination: { total: 1, from: 0, count: 1 } } };
    }
    if (url.includes('/man-x/metadata')) return { json: { node: { ref: { id: 'man-x' }, properties: {} } } };
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const r = await (await client()).callTool({ name: 'wlo_list_my_batches', arguments: {} });
  const [b] = (r.structuredContent as { batches: Batch[] }).batches;
  assert.deepEqual([b!.status, b!.title], ['unreadable', 'Chemie 8']);
});
