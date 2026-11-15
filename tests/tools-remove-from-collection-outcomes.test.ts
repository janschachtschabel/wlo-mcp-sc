/**
 * tools-remove-from-collection-outcomes.test.ts – `wlo_remove_from_collection`
 * says what happened, and refuses before the key what it will refuse after it
 * (audit 2026-11-14, W9).
 *
 * A listing that could not be read was reported as "Die Anfrage wurde
 * angenommen …" — nothing had been sent. "Not in the collection" was
 * `upstream_error` and, after the key, an open outcome; the batch tool calls
 * the same thing `absent`. And a record filed DIRECTLY in the collection (its
 * removal would delete the material) got a key first and the refusal after.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { registerCurationCollectionTools } from '../src/tools/curation-collections.js';
import { removeFromCollection } from '../src/services/write/collections.js';
import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { toolText } from './fetchMock.js';
import { collectionRepo, type RepoOptions } from './collection-repo.js';

const MARIA: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };
const TOOL = 'wlo_remove_from_collection';

interface Answer { confirm?: { token: string } | null; error?: { code: string; outcomeOpen?: boolean } }
const sc = (r: unknown) => (r as { structuredContent?: Answer }).structuredContent ?? {};

async function scene(build: (repo: ReturnType<typeof collectionRepo>) => void, opts: RepoOptions = {}) {
  setServiceCredentialForTest(MARIA);
  const repo = collectionRepo(opts);
  build(repo);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerCurationCollectionTools(server, 'Bearer x');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  const call = (args: Record<string, unknown>) => c.callTool({ name: TOOL, arguments: args });
  const end = async () => { await c.close(); repo.mock.restore(); setServiceCredentialForTest(null); };
  return { repo, call, end };
}

function shelf(repo: ReturnType<typeof collectionRepo>) {
  repo.collection('optik', 'Optik');
  repo.record('m1', 'Arbeitsblatt Licht');
  repo.record('m2', 'Video Linsen');
  repo.file('optik', 'm1');
  repo.direct('optik', 'd1', 'Direkt abgelegt');
}

const deletes = (repo: ReturnType<typeof collectionRepo>) => repo.writes.filter(w => w.method === 'DELETE');

test('a record filed DIRECTLY in the collection is refused in the PREVIEW — no key is issued for it', async () => {
  const s = await scene(shelf);
  try {
    const r = await s.call({ collectionId: 'optik', nodeId: 'd1' });
    assert.equal(r.isError, true, toolText(r));
    assert.deepEqual([sc(r).error?.code, sc(r).error?.outcomeOpen], ['is_original', false]);
    assert.equal(sc(r).confirm, undefined);
    assert.match(toolText(r), /Original direkt in der Sammlung/);
    assert.equal(deletes(s.repo).length, 0);
  } finally { await s.end(); }
});

test('a material that is not in the collection is refused in the preview too: not_in_collection, with the sentence it always had', async () => {
  const s = await scene(shelf);
  try {
    const r = await s.call({ collectionId: 'optik', nodeId: 'm2' });
    assert.deepEqual([sc(r).error?.code, sc(r).error?.outcomeOpen], ['not_in_collection', false]);
    assert.match(toolText(r), /ist nicht in dieser Sammlung enthalten — es wurde nichts geändert/);
    assert.equal(sc(r).confirm, undefined);
  } finally { await s.end(); }
});

test('removed between preview and confirmation: not_in_collection and NOT open — nothing was sent', async () => {
  const s = await scene(shelf);
  try {
    const token = sc(await s.call({ collectionId: 'optik', nodeId: 'm1' })).confirm!.token;
    s.repo.nodes.delete('ref-m1-optik');
    const r = await s.call({ collectionId: 'optik', nodeId: 'm1', confirmToken: token });
    assert.deepEqual([sc(r).error?.code, sc(r).error?.outcomeOpen], ['not_in_collection', false]);
    assert.equal(deletes(s.repo).length, 0);
  } finally { await s.end(); }
});

test('a listing that cannot be read at confirmation: not_checked, nothing was sent — never "Die Anfrage wurde angenommen"', async () => {
  let block = false;
  const s = await scene(shelf, { intercept: q => (block && q.method === 'GET' && q.url.includes('/children') ? { status: 503, json: {} } : undefined) });
  try {
    const token = sc(await s.call({ collectionId: 'optik', nodeId: 'm1' })).confirm!.token;
    block = true;
    const r = await s.call({ collectionId: 'optik', nodeId: 'm1', confirmToken: token });
    assert.deepEqual([sc(r).error?.code, sc(r).error?.outcomeOpen], ['not_checked', false]);
    assert.doesNotMatch(toolText(r), /Die Anfrage wurde angenommen/);
    assert.equal(deletes(s.repo).length, 0);
  } finally { await s.end(); }
});

test('a listing that cannot be read for the PREVIEW does not refuse: the confirmation looks again', async () => {
  const s = await scene(shelf, { intercept: q => (q.method === 'GET' && q.url.includes('/children') ? { status: 503, json: {} } : undefined) });
  try {
    assert.ok(sc(await s.call({ collectionId: 'optik', nodeId: 'm1' })).confirm?.token);
  } finally { await s.end(); }
});

test('the service: both refusals are coded, the ordinary removal still works', async () => {
  setServiceCredentialForTest(MARIA);
  const repo = collectionRepo();
  shelf(repo);
  try {
    const absent = await removeFromCollection('optik', 'm2');
    assert.deepEqual([absent.status, absent.status === 'failed' && absent.code], ['failed', 'not_in_collection']);
    assert.deepEqual(await removeFromCollection('optik', 'm1'), { status: 'ok' });
  } finally { repo.mock.restore(); setServiceCredentialForTest(null); }
});
