/**
 * delete-own.test.ts – wlo_delete_own_content (plan 2026-11-20, chatbot team's
 * wish "eigene Inhalte löschen").
 *
 * The fake repository answers as MEASURED on staging on 2026-11-20
 * (`scripts/own-delete-probe.mjs`): `-userhome-` resolves to the home folder's
 * id; `cm:creator` is the login's authority; a record flat in the home has it
 * as `virtual:primaryparent_nodeid`, one in a home folder has the folder (a
 * `ccm:map` without the collection aspect), whose parent is the home;
 * `/usage/v1/usages/node/{id}` answers `{usages: [...]}`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { registerCurationDeleteOwnTool } from '../src/tools/curation-delete-own.js';
import { OWN_DELETE_MAX } from '../src/services/write/delete-own-plan.js';
import { installFetchMock, toolText, type MockResult } from './fetchMock.js';

const MARIA: WloCredential = { header: 'Basic bWFyaWE6cHc=', label: 'maria', source: 'user' };
const SERVICE: WloCredential = { header: 'Basic c2VydmljZTpwdw==', label: 'dienst', source: 'service' };
const HOME = 'home-maria';

interface FakeNode {
  type: string; aspects?: string[]; creator?: string; parent?: string; usages?: number; title?: string;
  /** `null` = the field is not sent. */
  isPublic?: boolean | null;
}

interface RepoOptions {
  usagesStatus?: number;
  /** One status per DELETE, in order; past the list (or without it) a DELETE succeeds. */
  deleteStatuses?: number[];
  /** What the metadata read answers for a node a DELETE was sent for (default: 404 once it succeeded). */
  metaAfterDelete?: number;
  /** The answer for `-userhome-`. */
  homeStatus?: number;
  onUsageRead?: () => void;
}

/** The repository as measured; `deleted` records every DELETE that succeeded. */
function repo(nodes: Record<string, FakeNode>, opts: RepoOptions = {}) {
  const deleted: string[] = [];
  const attempted = new Set<string>();
  let deletes = 0;
  const meta = (id: string): MockResult => {
    if (id === '-userhome-' || id === HOME) {
      if (opts.homeStatus) return { status: opts.homeStatus, json: {} };
      return { json: { node: { ref: { id: HOME }, type: 'ccm:map', aspects: [], properties: {} } } };
    }
    if (attempted.has(id) && opts.metaAfterDelete) return { status: opts.metaAfterDelete, json: {} };
    const n = nodes[id];
    if (!n || deleted.includes(id)) return { status: 404, json: { error: 'not found' } };
    return { json: { node: {
      ref: { id }, type: n.type, aspects: n.aspects ?? [], title: n.title ?? id,
      ...(n.isPublic === null ? {} : { isPublic: n.isPublic ?? false }),
      properties: {
        'cclom:title': [n.title ?? id],
        ...(n.creator ? { 'cm:creator': [n.creator] } : {}),
        ...(n.parent ? { 'virtual:primaryparent_nodeid': [n.parent] } : {}),
      },
    } } };
  };
  const mock = installFetchMock((url, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const usage = url.match(/\/usage\/v1\/usages\/node\/([^/?]+)$/);
    if (usage) {
      if (opts.usagesStatus) return { status: opts.usagesStatus, json: {} };
      const n = nodes[decodeURIComponent(usage[1]!)];
      const answer = { json: { usages: Array.from({ length: n?.usages ?? 0 }, (_, i) => ({ nodeId: `u${i}` })) } };
      opts.onUsageRead?.();
      return answer;
    }
    const node = url.match(/\/node\/v1\/nodes\/-home-\/([^/?]+)(\/metadata)?/);
    if (node && method === 'DELETE') {
      const id = decodeURIComponent(node[1]!);
      attempted.add(id);
      const status = opts.deleteStatuses?.[deletes++];
      if (status && status !== 200) return { status, json: {} };
      deleted.push(id);
      return { json: {} };
    }
    if (node && node[2]) return meta(decodeURIComponent(node[1]!));
    return { status: 404, json: {} };
  });
  return { mock, deleted };
}

async function client(): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerCurationDeleteOwnTool(server, 'Bearer error="invalid_request"');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  return c;
}

interface Item { nodeId: string; status: string; code?: string; outcomeOpen?: boolean }
interface Answer { items?: Item[]; complete?: boolean; confirm?: { token: string; preview: { items?: string[]; action?: string } }; error?: { code: string } }
const sc = (r: unknown) => (r as { structuredContent: Answer }).structuredContent;
const byId = (a: Answer) => Object.fromEntries((a.items ?? []).map(i => [i.nodeId, i.code ? `${i.status}/${i.code}` : i.status]));

async function confirmed(c: Client, nodeIds: string[]) {
  const preview = await c.callTool({ name: 'wlo_delete_own_content', arguments: { nodeIds } });
  assert.notEqual(preview.isError, true, toolText(preview));
  const token = sc(preview).confirm?.token;
  assert.ok(token, `a key was expected: ${toolText(preview)}`);
  const done = await c.callTool({ name: 'wlo_delete_own_content', arguments: { nodeIds, confirmToken: token } });
  return { preview, done };
}

const OWN_FLAT: FakeNode = { type: 'ccm:io', creator: 'maria', parent: HOME, title: 'Lehrplan Physik' };

test('own records in the home — flat and in a home folder — are deleted; nothing else is sent', async (t) => {
  setServiceCredentialForTest(MARIA);
  const r = repo({
    flat: OWN_FLAT,
    folder: { type: 'ccm:map', creator: 'maria', parent: HOME },
    inner: { type: 'ccm:io', creator: 'maria', parent: 'folder', title: 'Gliederung 2' },
  });
  t.after(() => { r.mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  try {
    const { preview, done } = await confirmed(c, ['flat', 'inner']);
    const items = sc(preview).confirm!.preview.items!.join('\n');
    assert.match(items, /Lehrplan Physik/);
    assert.match(items, /Gliederung 2/);
    assert.deepEqual(byId(sc(done)), { flat: 'deleted', inner: 'deleted' });
    assert.deepEqual(r.deleted.sort(), ['flat', 'inner']);
  } finally { await c.close(); }
});

test('every condition keeps its node, with its own code — and sends no delete for it', async (t) => {
  setServiceCredentialForTest(MARIA);
  const r = repo({
    ok: OWN_FLAT,
    coll: { type: 'ccm:map', aspects: ['ccm:collection'], creator: 'maria', parent: HOME },
    fold: { type: 'ccm:map', creator: 'maria', parent: HOME },
    ref: { type: 'ccm:io', aspects: ['ccm:collection_io_reference'], creator: 'maria', parent: 'some-collection' },
    foreign: { type: 'ccm:io', creator: 'redaktion', parent: HOME },
    shared: { type: 'ccm:io', creator: 'maria', parent: 'shared-folder' },
    'shared-folder': { type: 'ccm:map', creator: 'maria', parent: 'company-home' },
    viaColl: { type: 'ccm:io', creator: 'maria', parent: 'a-collection' },
    'a-collection': { type: 'ccm:map', aspects: ['ccm:collection'], creator: 'maria', parent: HOME },
    used: { type: 'ccm:io', creator: 'maria', parent: HOME, usages: 1 },
    public: { type: 'ccm:io', creator: 'maria', parent: HOME, isPublic: true },
  });
  t.after(() => { r.mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  try {
    const ids = ['ok', 'gone', 'coll', 'fold', 'ref', 'foreign', 'shared', 'viaColl', 'used', 'public'];
    const { done } = await confirmed(c, ids);
    assert.deepEqual(byId(sc(done)), {
      ok: 'deleted', gone: 'kept/not_found', coll: 'kept/is_a_collection', fold: 'kept/is_a_folder',
      ref: 'kept/is_reference', foreign: 'kept/not_own', shared: 'kept/not_in_home', viaColl: 'kept/not_in_home',
      used: 'kept/in_use', public: 'kept/is_public',
    });
    assert.deepEqual(r.deleted, ['ok']);
  } finally { await c.close(); }
});

test('nothing deletable is an answer without a key, not an error', async (t) => {
  setServiceCredentialForTest(MARIA);
  const r = repo({ foreign: { type: 'ccm:io', creator: 'redaktion', parent: HOME } });
  t.after(() => { r.mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  try {
    const res = await c.callTool({ name: 'wlo_delete_own_content', arguments: { nodeIds: ['foreign', 'gone'] } });
    assert.notEqual(res.isError, true);
    assert.equal(sc(res).confirm, undefined, 'no key for nothing');
    assert.deepEqual(byId(sc(res)), { foreign: 'kept/not_own', gone: 'kept/not_found' });
    assert.deepEqual(r.deleted, []);
  } finally { await c.close(); }
});

test('what cannot be found out keeps the node: usages not readable → not_checked, never a delete', async (t) => {
  setServiceCredentialForTest(MARIA);
  const r = repo({ ok: OWN_FLAT }, { usagesStatus: 500 });
  t.after(() => { r.mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  try {
    const res = await c.callTool({ name: 'wlo_delete_own_content', arguments: { nodeIds: ['ok'] } });
    assert.deepEqual(byId(sc(res)), { ok: 'kept/not_checked' });
    assert.deepEqual(r.deleted, []);
  } finally { await c.close(); }
});

test('the conditions are read again right before the delete: a record used since the preview stays', async (t) => {
  setServiceCredentialForTest(MARIA);
  const nodes: Record<string, FakeNode> = { ok: { ...OWN_FLAT } };
  const r = repo(nodes);
  t.after(() => { r.mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  try {
    const preview = await c.callTool({ name: 'wlo_delete_own_content', arguments: { nodeIds: ['ok'] } });
    nodes['ok']!.usages = 1;
    const done = await c.callTool({ name: 'wlo_delete_own_content', arguments: { nodeIds: ['ok'], confirmToken: sc(preview).confirm!.token } });
    assert.deepEqual(byId(sc(done)), { ok: 'kept/in_use' });
    assert.deepEqual(r.deleted, []);
  } finally { await c.close(); }
});

test('the STEP itself checks: a usage that arises after the confirmation was read keeps the record', async (t) => {
  setServiceCredentialForTest(MARIA);
  const nodes: Record<string, FakeNode> = { ok: { ...OWN_FLAT } };
  // The preview and the confirmation's own look read the usages once each; the step reads them after that.
  let usageReads = 0;
  const r = repo(nodes, { onUsageRead: () => { if (++usageReads === 2) nodes['ok']!.usages = 1; } });
  t.after(() => { r.mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  try {
    const { done } = await confirmed(c, ['ok']);
    assert.ok(usageReads >= 3, `the step read the usages itself (${usageReads} reads)`);
    assert.deepEqual(byId(sc(done)), { ok: 'kept/in_use' });
    assert.deepEqual(r.deleted, []);
  } finally { await c.close(); }
});

test('a refused delete wrote nothing: failed, outcome closed', async (t) => {
  setServiceCredentialForTest(MARIA);
  const r = repo({ ok: OWN_FLAT }, { deleteStatuses: [403] });
  t.after(() => { r.mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  try {
    const { done } = await confirmed(c, ['ok']);
    const item = sc(done).items![0]!;
    assert.equal(item.status, 'failed');
    assert.equal(item.outcomeOpen ?? false, false);
  } finally { await c.close(); }
});

test('only with the person\'s own login — the service account is refused before anything is read', async (t) => {
  setServiceCredentialForTest(SERVICE);
  const r = repo({ ok: OWN_FLAT });
  t.after(() => { r.mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  try {
    const res = await c.callTool({ name: 'wlo_delete_own_content', arguments: { nodeIds: ['ok'] } });
    assert.equal(res.isError, true);
    assert.equal(sc(res).error?.code, 'login_required');
    assert.deepEqual(r.deleted, []);
  } finally { await c.close(); }
});

test('even where the operator lets the service account write, it may not delete "its own"', () => {
  // WLO_ALLOW_SERVICE_WRITES is read at module load: a child process with it on.
  const fixture = fileURLToPath(new URL('./delete-own-service.fixture.ts', import.meta.url));
  const r = spawnSync(process.execPath, ['--import', 'tsx', fixture], {
    encoding: 'utf8', env: { ...process.env, WLO_ALLOW_SERVICE_WRITES: '1', LOG_LEVEL: 'error' },
  });
  assert.equal(r.status, 0, r.stderr);
  const line = r.stdout.trim().split('\n').pop() ?? '';
  const out = JSON.parse(line) as { previewError: boolean; structured?: { error?: { code?: string } }; keyIssued: boolean; deletes: number };
  assert.equal(out.previewError, true);
  assert.equal(out.structured?.error?.code, 'login_required');
  assert.equal(out.keyIssued, false);
  assert.equal(out.deletes, 0);
});

test(`at most ${OWN_DELETE_MAX} nodeIds per call`, async (t) => {
  setServiceCredentialForTest(MARIA);
  const r = repo({});
  t.after(() => { r.mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  try {
    const res = await c.callTool({ name: 'wlo_delete_own_content', arguments: { nodeIds: Array.from({ length: OWN_DELETE_MAX + 1 }, (_, i) => `n${i}`) } });
    assert.equal(res.isError, true);
  } finally { await c.close(); }
});

test('the creator is compared without case — the repository\'s account names are case-insensitive', async (t) => {
  setServiceCredentialForTest(MARIA);
  const r = repo({ upper: { ...OWN_FLAT, creator: 'Maria' }, other: { ...OWN_FLAT, creator: 'mariam' } });
  t.after(() => { r.mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  try {
    const { done } = await confirmed(c, ['upper', 'other']);
    assert.deepEqual(byId(sc(done)), { upper: 'deleted', other: 'kept/not_own' });
  } finally { await c.close(); }
});

test('the home is at most three plain folders up; deeper, or through anything else, is not the home', async (t) => {
  setServiceCredentialForTest(MARIA);
  const folder = (parent: string): FakeNode => ({ type: 'ccm:map', creator: 'maria', parent });
  const r = repo({
    f1: folder(HOME), f2: folder('f1'), f3: folder('f2'), f4: folder('f3'),
    at3: { ...OWN_FLAT, parent: 'f3' }, at4: { ...OWN_FLAT, parent: 'f4' },
    odd: { type: 'cm:folder', creator: 'maria', parent: HOME }, viaOdd: { ...OWN_FLAT, parent: 'odd' },
  });
  t.after(() => { r.mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  try {
    const { done } = await confirmed(c, ['at3', 'at4', 'viaOdd']);
    assert.deepEqual(byId(sc(done)), { at3: 'deleted', at4: 'kept/not_in_home', viaOdd: 'kept/not_in_home' });
  } finally { await c.close(); }
});

test('a missing isPublic is not "not public": the node stays not_checked', async (t) => {
  setServiceCredentialForTest(MARIA);
  const r = repo({ silent: { ...OWN_FLAT, isPublic: null } });
  t.after(() => { r.mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  try {
    const res = await c.callTool({ name: 'wlo_delete_own_content', arguments: { nodeIds: ['silent'] } });
    assert.deepEqual(byId(sc(res)), { silent: 'kept/not_checked' });
    assert.match(toolText(res), /1 von 1 Knoten ließ sich gerade nicht prüfen/, 'not "not deletable"');
    assert.deepEqual(r.deleted, []);
  } finally { await c.close(); }
});

test('the home not readable: an error, nothing read further, nothing deleted', async (t) => {
  setServiceCredentialForTest(MARIA);
  const r = repo({ ok: OWN_FLAT }, { homeStatus: 503 });
  t.after(() => { r.mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  try {
    const res = await c.callTool({ name: 'wlo_delete_own_content', arguments: { nodeIds: ['ok'] } });
    assert.equal(res.isError, true);
    assert.equal(sc(res).error?.code, 'upstream_error');
    assert.deepEqual(r.deleted, []);
  } finally { await c.close(); }
});

test('a DELETE without an answer stays pending; the key continues the plan, and a 404 then is OUR delete', async (t) => {
  setServiceCredentialForTest(MARIA);
  const r = repo({ ok: OWN_FLAT }, { deleteStatuses: [500] });
  t.after(() => { r.mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  try {
    const preview = await c.callTool({ name: 'wlo_delete_own_content', arguments: { nodeIds: ['ok'] } });
    const key = sc(preview).confirm!.token;
    const done = await c.callTool({ name: 'wlo_delete_own_content', arguments: { nodeIds: ['ok'], confirmToken: key } });
    assert.equal(sc(done).items![0]!.status, 'pending');
    // The same KEY again CONTINUES the stored plan — no replay of the first answer: the second DELETE succeeds.
    const again = await c.callTool({ name: 'wlo_delete_own_content', arguments: { nodeIds: ['ok'], confirmToken: key } });
    assert.equal((again.structuredContent as { replayed?: boolean }).replayed, undefined, 'not a replay');
    assert.deepEqual(byId(sc(again)), { ok: 'deleted' });
  } finally { await c.close(); }
});

test('after a DELETE without an answer, a REFUSED look is no proof of a delete', async (t) => {
  setServiceCredentialForTest(MARIA);
  const r = repo({ ok: OWN_FLAT }, { deleteStatuses: [500], metaAfterDelete: 403 });
  t.after(() => { r.mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  try {
    const { done } = await confirmed(c, ['ok']);
    const token = (done.structuredContent as { continuationToken?: string }).continuationToken;
    assert.ok(token, 'an open plan hands out a continuation token');
    const again = await c.callTool({ name: 'wlo_delete_own_content', arguments: { nodeIds: ['ok'], continuationToken: token } });
    const item = sc(again).items![0]!;
    assert.notEqual(item.status, 'deleted');
    assert.equal(item.outcomeOpen, true);
  } finally { await c.close(); }
});

test('the order of the nodeIds does not matter to the key', async (t) => {
  setServiceCredentialForTest(MARIA);
  const r = repo({ a: { ...OWN_FLAT, title: 'A' }, b: { ...OWN_FLAT, title: 'B' } });
  t.after(() => { r.mock.restore(); setServiceCredentialForTest(null); });
  const c = await client();
  try {
    const preview = await c.callTool({ name: 'wlo_delete_own_content', arguments: { nodeIds: ['a', 'b'] } });
    const done = await c.callTool({ name: 'wlo_delete_own_content', arguments: { nodeIds: ['b', 'a'], confirmToken: sc(preview).confirm!.token } });
    assert.notEqual(done.isError, true, toolText(done));
    assert.deepEqual(byId(sc(done)), { a: 'deleted', b: 'deleted' });
  } finally { await c.close(); }
});
