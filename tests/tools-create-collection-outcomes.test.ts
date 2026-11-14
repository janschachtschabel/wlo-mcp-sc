/**
 * tools-create-collection-outcomes.test.ts – `wlo_create_collection` is as
 * careful as its siblings (audit 2026-11-14, W8).
 *
 * (a) A collection that WAS created and came back unconfirmed lost its id in
 *     the coded answer, and the spent key said "preview again" — the second
 *     collection. (b) A parent the caller may not write was not refused before
 *     the key. (c) A namesake under the same parent was not mentioned.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { registerCurationCollectionTools } from '../src/tools/curation-collections.js';
import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { toolText } from './fetchMock.js';
import { collectionRepo, type RepoOptions } from './collection-repo.js';

const MARIA: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };
const TOOL = 'wlo_create_collection';

interface Answer {
  confirm?: { token: string; preview: { notes?: string[] } } | null;
  error?: { code: string; outcomeOpen?: boolean; recordExists?: boolean; nodeId?: string; requiresNewPreview?: boolean };
}
const sc = (r: unknown) => (r as { structuredContent: Answer }).structuredContent;
const allText = (r: unknown) => (r as { content: Array<{ text: string }> }).content.map(c => c.text).join(' ');

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
  const confirm = async (args: Record<string, unknown>) => {
    const preview = await call(args);
    const token = sc(preview).confirm?.token;
    assert.ok(token, `a preview with a key was expected: ${toolText(preview)}`);
    return { preview, done: await call({ ...args, confirmToken: token }) };
  };
  const end = async () => { await c.close(); repo.mock.restore(); setServiceCredentialForTest(null); };
  return { repo, call, confirm, end };
}

const isCreate = (q: { method: string; url: string }) => q.method === 'POST' && new URL(q.url).pathname.endsWith('/children');

test('(a) created, but the read-back did not answer: the id is IN the error, and the key does not say "preview again"', async () => {
  let created = false;
  const s = await scene(repo => { repo.collection('p', 'Physik'); }, { intercept: (q) => {
    if (isCreate(q)) { created = true; return undefined; }
    // Every read of the NEW collection fails; the parent stays readable.
    return created && q.method === 'GET' && q.id.startsWith('c-') ? { status: 500, json: {} } : undefined;
  } });
  try {
    const { done } = await s.confirm({ title: 'Optik', parentId: 'p' });
    const error = sc(done).error!;
    const id = [...s.repo.nodes.values()].find(n => n.title === 'Optik')!.id;
    assert.equal(done.isError, true);
    assert.deepEqual([error.code, error.outcomeOpen, error.recordExists, error.nodeId], ['unverified', true, true, id]);
    assert.equal(error.requiresNewPreview, false, 'a new preview would create the second collection');
    assert.match(allText(done), new RegExp(id));
  } finally { await s.end(); }
});

test('(a) a create the repository REFUSED wrote nothing; one it answered 5xx is open', async () => {
  // 429/503: busy, said as busy (second review 2026-11-14, finding 8) — and open all the same.
  for (const [status, code, open] of [[403, 'forbidden', false], [500, 'unverified', true], [429, 'upstream_busy', true], [503, 'upstream_busy', true]] as const) {
    const s = await scene(repo => { repo.collection('p', 'Physik'); }, { intercept: q => (isCreate(q) ? { status, json: {} } : undefined) });
    try {
      const { done } = await s.confirm({ title: 'Optik', parentId: 'p' });
      assert.deepEqual([sc(done).error!.code, sc(done).error!.outcomeOpen], [code, open], `HTTP ${status}`);
    } finally { await s.end(); }
  }
});

test('(b) a parent this login may not write is refused BEFORE any key', async () => {
  const s = await scene(repo => { repo.collection('p', 'Physik').readOnly = true; });
  try {
    const r = await s.call({ title: 'Optik', parentId: 'p' });
    assert.equal(r.isError, true);
    assert.deepEqual([sc(r).error!.code, sc(r).error!.outcomeOpen], ['forbidden', false]);
    assert.equal(sc(r).confirm, undefined, 'no key for a create that must fail');
    assert.equal(s.repo.writes.length, 0);
  } finally { await s.end(); }
});

test('(c) a namesake under the same parent is SAID in the preview — and the create is still possible', async () => {
  const s = await scene(repo => { repo.collection('p', 'Physik'); repo.collection('o1', 'Optik', 'p'); });
  try {
    const { preview, done } = await s.confirm({ title: '  optik ', parentId: 'p' });
    assert.match(toolText(preview), /gibt es bereits eine Sammlung.*o1/);
    assert.equal(sc(preview).confirm!.preview.notes?.length, 1);
    assert.notEqual(done.isError, true, allText(done));
  } finally { await s.end(); }
});

test('(c) no namesake: no note; a listing that did not answer is said, not passed over', async () => {
  let s = await scene(repo => { repo.collection('p', 'Physik'); repo.collection('m1', 'Mechanik', 'p'); });
  try {
    assert.equal(sc(await s.call({ title: 'Optik', parentId: 'p' })).confirm!.preview.notes, undefined);
  } finally { await s.end(); }
  s = await scene(repo => { repo.collection('p', 'Physik'); },
    { intercept: q => (q.method === 'GET' && q.url.includes('/children') ? { status: 503, json: {} } : undefined) });
  try {
    const preview = await s.call({ title: 'Optik', parentId: 'p' });
    assert.match(toolText(preview), /ließ sich gerade nicht prüfen/);
  } finally { await s.end(); }
});
