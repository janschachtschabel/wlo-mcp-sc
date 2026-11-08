/**
 * tools-curation-batch.test.ts – MA-3/MA-4: prepare → store each file → store the manifest.
 *
 * Off unless WLO_BATCH_UPLOAD_ENABLED. Personal login only (the service account is refused, never
 * used). The prepare call files nothing; each store call redeems one index of the approved plan, with
 * the bytes the chatbot put into an upload slot for the SAME identity; the folder is made once.
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
import { installFetchMock, toolText } from './fetchMock.js';

const USER: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };
const SERVICE: WloCredential = { header: 'Basic y', label: 'dienst', source: 'service' };
const PDF = Buffer.from('%PDF-1.7\nMechanik\n%%EOF\n', 'latin1');
const SHA = createHash('sha256').update(PDF).digest('hex');

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

function repo(opts: { folder?: boolean; folderStatus?: number } = {}) {
  const calls: string[] = [];
  // Metadata writes are KEPT, as the repository keeps them (measured 2026-11-06) — the manifest's
  // summary in cm:description is read back, and a fake that drops it would rightly read "unverified".
  const kept: Record<string, string[]> = {};
  const mock = installFetchMock((url, init) => {
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url}`);
    if (url.includes('/metadata') && method !== 'GET') {
      Object.assign(kept, JSON.parse(String(init?.body ?? '{}')) as Record<string, string[]>);
      return { json: {} };
    }
    if (url.includes('/iam/v1/people/')) return { json: { person: { authorityName: 'maria' } } };
    if (url.includes('validateSession')) {
      return { json: { toolPermissions: opts.folder ? ['TOOLPERMISSION_CREATE_ELEMENTS_FOLDERS'] : [] } };
    }
    if (url.includes('type=cm%3Afolder')) {
      return opts.folderStatus ? { status: opts.folderStatus, json: {} } : { json: { node: { ref: { id: 'ordner-1' } } } };
    }
    if (url.includes('/children?') && method === 'POST') return { json: { node: { ref: { id: `n-${calls.length}` } } } };
    if (url.includes('/content?')) return { json: {} };
    if (method === 'GET') return { json: { node: { ref: { id: 'n' }, size: PDF.length, downloadUrl: 'x', properties: { ...kept } } } };
    return { json: {} };
  });
  return { calls, mock };
}

async function slot(): Promise<string> {
  const r = await sharedUploadSlots().put(slotIdentity(USER)!, Readable.from([PDF]), 'a.pdf');
  assert.ok(r.ok);
  return r.ok ? r.slot.ref : '';
}

const PLAN = { target: 'home', folderName: 'Physik 7',
  entries: [{ title: 'Mechanik', sha256: SHA, size: PDF.length, ext: 'pdf' },
    { title: 'Optik', sha256: SHA, size: PDF.length, ext: 'pdf' }] };

async function prepare(c: Client) {
  const r = await c.callTool({ name: 'wlo_prepare_file_batch', arguments: PLAN });
  return r as { structuredContent?: Record<string, unknown>; isError?: boolean };
}

test('off unless switched on', async () => {
  delete process.env['WLO_BATCH_UPLOAD_ENABLED'];
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerCurationBatchTools(server, 'Bearer x');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  // A server without a single tool does not even offer tools/list — that is the strongest "off".
  const namen = await c.listTools().then((r) => r.tools.map((t) => t.name), () => [] as string[]);
  assert.equal(namen.some((n) => n.includes('batch')), false);
});

test('the service account is refused, never used', async (t) => {
  setServiceCredentialForTest(SERVICE);
  const { mock } = repo();
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const r = await prepare(await client());
  assert.equal(r.isError, true);
  assert.equal(mock.calls.length, 0);
});

test('prepare files nothing, then each index files one record into one folder', async (t) => {
  setServiceCredentialForTest(USER);
  const { calls, mock } = repo({ folder: true });
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  const vorbereitet = await prepare(c);
  assert.equal(vorbereitet.structuredContent?.['layout'], 'folder');
  assert.equal(calls.filter((x) => x.startsWith('POST')).length, 0, 'prepare creates nothing');
  const token = String(vorbereitet.structuredContent?.['batchToken']);

  for (const index of [0, 1]) {
    const r = await c.callTool({ name: 'wlo_store_batch_file', arguments: { batchToken: token, index, ref: await slot() } });
    assert.equal((r as { structuredContent?: Record<string, unknown> }).structuredContent?.['status'], 'stored');
  }
  assert.equal(calls.filter((x) => x.includes('type=cm%3Afolder')).length, 1, 'one folder for the batch');
  assert.equal(calls.filter((x) => x.includes('/nodes/-home-/ordner-1/children?')).length, 2);

  const nochmal = await c.callTool({ name: 'wlo_store_batch_file', arguments: { batchToken: token, index: 0, ref: await slot() } });
  assert.equal((nochmal as { structuredContent?: Record<string, unknown> }).structuredContent?.['already'], true);

  const m = await c.callTool({ name: 'wlo_store_batch_manifest', arguments: { batchToken: token } });
  assert.match(toolText(m), /Vorgang: stored/);
  // Built by the server from the plan — the caller sends no content (finding 1).
  const datei = calls.find((x) => x.includes('/content?') && x.includes('application%2Fjson'));
  assert.ok(datei, 'vorgang.json went up as JSON');
  const zweimal = await c.callTool({ name: 'wlo_store_batch_manifest', arguments: { batchToken: token } });
  assert.match(toolText(zweimal), /schon ab/);
});

test('a refused folder continues flat and says so', async (t) => {
  setServiceCredentialForTest(USER);
  const { calls, mock } = repo({ folder: true, folderStatus: 403 });
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  const token = String((await prepare(c)).structuredContent?.['batchToken']);
  const r = await c.callTool({ name: 'wlo_store_batch_file', arguments: { batchToken: token, index: 0, ref: await slot() } });
  const s = (r as { structuredContent?: Record<string, unknown> }).structuredContent!;
  assert.equal(s['status'], 'stored');
  assert.equal(s['folderDenied'], true);
  assert.ok(calls.some((x) => x.includes('/nodes/-home/-userhome-/children?') || x.includes('/nodes/-home-/-userhome-/children?type=ccm')));
});

test('a missing slot or a foreign token files nothing', async (t) => {
  setServiceCredentialForTest(USER);
  const { calls, mock } = repo();
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  const token = String((await prepare(c)).structuredContent?.['batchToken']);
  const ohne = await c.callTool({ name: 'wlo_store_batch_file', arguments: { batchToken: token, index: 0, ref: 'x'.repeat(24) } });
  assert.equal((ohne as { structuredContent?: Record<string, unknown> }).structuredContent?.['reason'], 'slot_missing');
  const fremd = await c.callTool({ name: 'wlo_store_batch_file', arguments: { batchToken: 'erfundenes-token', index: 0, ref: await slot() } });
  assert.equal((fremd as { isError?: boolean }).isError, true);
  assert.equal(calls.filter((x) => x.startsWith('POST')).length, 0);
});

test('every batch refusal carries error.code — the contract every other tool keeps', async (t) => {
  setServiceCredentialForTest(USER);
  const { mock } = repo();
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  const token = String((await prepare(c)).structuredContent?.['batchToken']);
  const code = (r: unknown) =>
    ((r as { structuredContent?: { error?: { code?: string } } }).structuredContent?.error?.code);
  assert.equal(code(await c.callTool({ name: 'wlo_store_batch_file',
    arguments: { batchToken: token, index: 0, ref: 'x'.repeat(24) } })), 'slot_missing');
  assert.equal(code(await c.callTool({ name: 'wlo_store_batch_file',
    arguments: { batchToken: 'erfundenes-token', index: 0, ref: await slot() } })), 'batch_unknown');
  assert.equal(code(await c.callTool({ name: 'wlo_store_batch_manifest', arguments: { batchToken: token } })),
    'nothing_stored');
});

test('the service account is refused with login_required', async (t) => {
  setServiceCredentialForTest(SERVICE);
  const { mock } = repo();
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const r = await prepare(await client()) as { structuredContent?: { error?: { code?: string } } };
  assert.equal(r.structuredContent?.error?.code, 'login_required');
});


// ── Review MA-3/MA-4 ───────────────────────────────────────────────────────────────────────

test('wrong bytes create nothing and leave the index redeemable (finding 10)', async (t) => {
  setServiceCredentialForTest(USER);
  const { calls, mock } = repo();
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  const token = String((await prepare(c)).structuredContent?.['batchToken']);
  const anders = await sharedUploadSlots().put(slotIdentity(USER)!, Readable.from([Buffer.from('%PDF-anders')]), 'x.pdf');
  assert.ok(anders.ok);
  const r = await c.callTool({ name: 'wlo_store_batch_file', arguments: { batchToken: token, index: 0,
    ref: anders.ok ? anders.slot.ref : '' } });
  assert.equal((r as { structuredContent?: Record<string, unknown> }).structuredContent?.['reason'], 'mismatch_bytes');
  assert.equal(calls.filter((x) => x.startsWith('POST')).length, 0);
  const richtig = await c.callTool({ name: 'wlo_store_batch_file', arguments: { batchToken: token, index: 0, ref: await slot() } });
  assert.equal((richtig as { structuredContent?: Record<string, unknown> }).structuredContent?.['status'], 'stored');
});

test('a folder that fails (not 403) fails the file and is retried — no silent flat (finding 3)', async (t) => {
  setServiceCredentialForTest(USER);
  const { calls, mock } = repo({ folder: true, folderStatus: 500 });
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  const token = String((await prepare(c)).structuredContent?.['batchToken']);
  const r = await c.callTool({ name: 'wlo_store_batch_file', arguments: { batchToken: token, index: 0, ref: await slot() } });
  assert.equal((r as { structuredContent?: Record<string, unknown> }).structuredContent?.['reason'], 'folder_failed');
  assert.equal(calls.filter((x) => x.includes('type=ccm%3Aio')).length, 0, 'no file filed flat');
  await c.callTool({ name: 'wlo_store_batch_file', arguments: { batchToken: token, index: 0, ref: await slot() } });
  assert.equal(calls.filter((x) => x.includes('type=cm%3Afolder')).length, 2, 'the folder is tried again');
});

test('the preview returns the normalised plan with record names (finding 11)', async (t) => {
  setServiceCredentialForTest(USER);
  const { mock } = repo();
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const s = (await prepare(await client())).structuredContent!;
  const [erste] = s['entries'] as Array<Record<string, unknown>>;
  assert.deepEqual(erste, { index: 0, title: 'Mechanik', ext: 'pdf', size: PDF.length, fileName: 'mechanik.pdf', role: 'content' });
});

test('no manifest before a stored file', async (t) => {
  setServiceCredentialForTest(USER);
  const { calls, mock } = repo();
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  const token = String((await prepare(c)).structuredContent?.['batchToken']);
  const m = await c.callTool({ name: 'wlo_store_batch_manifest', arguments: { batchToken: token } });
  assert.equal((m as { structuredContent?: Record<string, unknown> }).structuredContent?.['reason'], 'nothing_stored');
  assert.equal(calls.filter((x) => x.startsWith('POST')).length, 0);
});

test('the batch preview carries the same structured confirmation as every other write (12a)', async () => {
  // The chatbot reads `structuredContent.confirm` for every write; a batch-only
  // `batchToken` would be the one tool it has to special-case.
  setServiceCredentialForTest(USER);
  const { mock } = repo();
  const c = await client();
  try {
    const before = Date.now();
    const sc = (await prepare(c)).structuredContent as {
      batchToken: string;
      confirm: { token: string; expiresAt: string; preview: { action: string; tool: string; target: { kind: string; title: string } } };
    };
    assert.equal(sc.confirm.token, sc.batchToken, 'one key, two names — the old field stays for existing callers');
    assert.equal(sc.confirm.preview.tool, 'wlo_prepare_file_batch');
    assert.equal(sc.confirm.preview.target.kind, 'home');
    assert.equal(sc.confirm.preview.target.title, 'Physik 7');
    const expires = Date.parse(sc.confirm.expiresAt);
    assert.ok(expires >= before + 29 * 60_000 && expires <= Date.now() + 30 * 60_000, 'the batch key lives 30 minutes');
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});


// ── Review R-A (2026-11-06) ────────────────────────────────────────────────────────────────

/** Every create POST throws an abort from the n-th on — the repository may have done the work. */
function abortCreatesFrom(n: number): () => void {
  const real = globalThis.fetch;
  let seen = 0;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    if (init?.method === 'POST' && String(input).includes('/children?') && ++seen >= n) {
      throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    }
    return real(input as string, init);
  }) as typeof fetch;
  return () => { globalThis.fetch = real; };
}

test('an aborted file is recorded as open: a retry reports it, never "being filed" forever', async (t) => {
  setServiceCredentialForTest(USER);
  const { calls, mock } = repo();
  const restore = abortCreatesFrom(1);
  t.after(() => { restore(); mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  const token = String((await prepare(c)).structuredContent?.['batchToken']);
  const r = await c.callTool({ name: 'wlo_store_batch_file', arguments: { batchToken: token, index: 0, ref: await slot() } });
  assert.equal((r as { isError?: boolean }).isError, true);
  assert.match(toolText(r), /nicht rechtzeitig/);
  const nochmal = await c.callTool({ name: 'wlo_store_batch_file', arguments: { batchToken: token, index: 0, ref: await slot() } });
  const s = (nochmal as { structuredContent?: Record<string, unknown> }).structuredContent!;
  assert.equal(s['already'], true);
  assert.equal(s['status'], 'unverified');
  assert.doesNotMatch(String(s['detail'] ?? ''), /gerade abgelegt/);
  assert.equal(calls.filter((x) => x.startsWith('POST')).length, 0, 'the mock never saw a create: it was aborted, not retried');
});

test('an aborted manifest is not reported as filed by the next call', async (t) => {
  setServiceCredentialForTest(USER);
  const { mock } = repo();
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  const token = String((await prepare(c)).structuredContent?.['batchToken']);
  await c.callTool({ name: 'wlo_store_batch_file', arguments: { batchToken: token, index: 0, ref: await slot() } });
  const restore = abortCreatesFrom(1);
  try {
    const m = await c.callTool({ name: 'wlo_store_batch_manifest', arguments: { batchToken: token } });
    assert.equal((m as { isError?: boolean }).isError, true);
    const zweimal = await c.callTool({ name: 'wlo_store_batch_manifest', arguments: { batchToken: token } });
    const s = (zweimal as { structuredContent?: Record<string, unknown> }).structuredContent!;
    assert.notEqual(s['status'], 'stored', toolText(zweimal));
    assert.doesNotMatch(toolText(zweimal), /liegt schon ab/);
    assert.equal(s['status'], 'unverified');
    assert.doesNotMatch(String(s['detail'] ?? ''), /gerade/, 'the abort is over — not "being filed"');
  } finally { restore(); }
});

test('with service writes off, the gate itself refuses the service account with the challenge', async (t) => {
  setServiceCredentialForTest(SERVICE);
  const { mock } = repo();
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const r = await prepare(await client()) as { _meta?: Record<string, unknown> };
  assert.ok(Array.isArray(r._meta?.['mcp/www_authenticate']), 'the challenge rides along like at the gate');
});

test('a refused batch token does not spend the upload slot (feedback point 8)', async (t) => {
  setServiceCredentialForTest(USER);
  const { calls, mock } = repo();
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  const ref = await slot();
  const fremd = await c.callTool({ name: 'wlo_store_batch_file', arguments: { batchToken: 'erfundenes-token', index: 0, ref } });
  assert.equal((fremd as { isError?: boolean }).isError, true);
  // The same upload still files under a freshly prepared batch.
  const token = String((await prepare(c)).structuredContent?.['batchToken']);
  const r = await c.callTool({ name: 'wlo_store_batch_file', arguments: { batchToken: token, index: 0, ref } });
  assert.equal((r as { structuredContent?: Record<string, unknown> }).structuredContent?.['status'], 'stored');
  assert.ok(calls.some(x => x.startsWith('POST')));
});

// ── W4: the role of a file in the batch (plan 2026-11-08) ──────────────────

test('a role per entry: content by default, structure when named, shown in the preview', async (t) => {
  setServiceCredentialForTest(USER);
  const { mock } = repo();
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  const r = await c.callTool({ name: 'wlo_prepare_file_batch', arguments: { ...PLAN,
    entries: [{ ...PLAN.entries[0]!, role: 'structure' }, PLAN.entries[1]!] } });
  const entries = (r.structuredContent as Record<string, unknown>)['entries'] as Array<Record<string, unknown>>;
  assert.deepEqual(entries.map(e => e['role']), ['structure', 'content']);
  assert.match(toolText(r), /Mechanik.*Strukturdokument/);
  assert.doesNotMatch(toolText(r), /Optik.*Strukturdokument/);
});

test('the role is part of the approval — another role is another plan', async (t) => {
  setServiceCredentialForTest(USER);
  const { mock } = repo();
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  const fp = async (role?: string) => {
    const r = await c.callTool({ name: 'wlo_prepare_file_batch', arguments: { ...PLAN,
      entries: [{ ...PLAN.entries[0]!, ...(role ? { role } : {}) }, PLAN.entries[1]!] } });
    return String((r.structuredContent as Record<string, unknown>)['batchToken']).split('.')[1];
  };
  assert.equal(await fp(), await fp('content'), 'the default IS content');
  assert.notEqual(await fp('content'), await fp('structure'));
});

test('an unknown role is refused as invalid input before anything is planned', async (t) => {
  setServiceCredentialForTest(USER);
  const { calls, mock } = repo();
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  const r = await c.callTool({ name: 'wlo_prepare_file_batch', arguments: { ...PLAN,
    entries: [{ ...PLAN.entries[0]!, role: 'anhang' }] } });
  assert.equal(r.isError, true);
  assert.equal((r.structuredContent as { error?: { code?: string } } | undefined)?.error?.code, 'invalid_input');
  assert.equal(calls.length, 0, 'nothing asked upstream');
});

test('a structure document past the preview line cap is still named, and the preview says roles are filed (review P1, finding 2)', async (t) => {
  setServiceCredentialForTest(USER);
  const { mock } = repo();
  t.after(() => { mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  const many = Array.from({ length: 25 }, (_, i) => ({ title: `Teil ${i}`, sha256: SHA, size: PDF.length, ext: 'pdf',
    ...(i === 23 ? { role: 'structure' } : {}) }));
  const r = await c.callTool({ name: 'wlo_prepare_file_batch', arguments: { ...PLAN, entries: many } });
  const text = toolText(r);
  assert.match(text, /Teil 23.*Strukturdokument/, 'the 24th entry is past the cap of 20 and still named');
  assert.match(text, /Rolle/, 'what the manifest records includes the role');
});
