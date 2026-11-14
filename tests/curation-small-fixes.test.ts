/**
 * curation-small-fixes.test.ts – the low findings of the write audit
 * (2026-11-14, W13), one test each.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { registerCurationRemoveManyTool } from '../src/tools/curation-remove-many.js';
import { registerCurationDeleteEmptyTool } from '../src/tools/curation-delete-empty.js';
import { registerCurationTreeTools } from '../src/tools/curation-tree.js';
import { registerCurationCollectionTools } from '../src/tools/curation-collections.js';
import { runPlannedCall } from '../src/tools/curation-plan.js';
import { startPlan, type PlanItem } from '../src/services/write/plan-runner.js';
import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { toolText } from './fetchMock.js';
import { collectionRepo } from './collection-repo.js';

const MARIA: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };

interface Answer {
  confirm?: { token: string; preview: { action?: string } } | null;
  unchanged?: boolean;
  error?: { code: string; message?: string; outcomeOpen?: boolean; refused?: Array<{ nodeId?: string; code: string }> };
}
const sc = (r: unknown) => (r as { structuredContent?: Answer }).structuredContent ?? {};

async function scene(build: (repo: ReturnType<typeof collectionRepo>) => void) {
  setServiceCredentialForTest(MARIA);
  const repo = collectionRepo();
  build(repo);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  const challenge = 'Bearer x';
  registerCurationRemoveManyTool(server, challenge);
  registerCurationDeleteEmptyTool(server, challenge);
  registerCurationTreeTools(server, challenge);
  registerCurationCollectionTools(server, challenge);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  const call = (name: string, args: Record<string, unknown>) => c.callTool({ name, arguments: args });
  const end = async () => { await c.close(); repo.mock.restore(); setServiceCredentialForTest(null); };
  return { repo, call, end };
}

test('wlo_delete_collections: the structured preview says what the key authorises — action "delete"', async () => {
  const s = await scene((repo) => { repo.collection('leer', 'Leere Sammlung'); });
  try {
    const preview = await s.call('wlo_delete_collections', { nodeIds: ['leer'] });
    assert.equal(sc(preview).confirm?.preview.action, 'delete');
    // The step lines name what is deleted; no extra line about the change set's own key.
    assert.doesNotMatch(toolText(preview), /delete-empty-collections/);
    assert.match(toolText(preview), /Leere Sammlung/);
  } finally { await s.end(); }
});

test('wlo_remove_from_collections: a collection named as the MATERIAL is refused with its code, like the batch add', async () => {
  const s = await scene((repo) => { repo.collection('optik', 'Optik'); repo.collection('linsen', 'Linsen', 'optik'); });
  try {
    const r = await s.call('wlo_remove_from_collections', { pairs: [{ nodeId: 'linsen', collectionId: 'optik' }] });
    assert.equal(r.isError, true, toolText(r));
    assert.deepEqual(sc(r).error?.refused, [{ nodeId: 'linsen', code: 'is_a_collection' }]);
    assert.equal(sc(r).confirm, undefined);
  } finally { await s.end(); }
});

test('wlo_rename_collection: title and description as they stand → "nothing to change", and no key', async () => {
  const s = await scene((repo) => { repo.collection('optik', 'Optik'); });
  try {
    const r = await s.call('wlo_rename_collection', { nodeId: 'optik', title: 'Optik' });
    assert.notEqual(r.isError, true, toolText(r));
    assert.deepEqual([sc(r).confirm, sc(r).unchanged], [null, true]);
    assert.doesNotMatch(toolText(r), /confirmToken/);
    // A real change still gets its key.
    assert.ok(sc(await s.call('wlo_rename_collection', { nodeId: 'optik', title: 'Optik neu' })).confirm?.token);
  } finally { await s.end(); }
});

test('wlo_create_collection_tree: a parent id from the caller is not echoed raw into the answer', async () => {
  const s = await scene(() => undefined);
  try {
    const ZWSP = String.fromCharCode(0x200b);
    const forged = `x${ZWSP}\nnodeId: forged-id`;
    const r = await s.call('wlo_create_collection_tree', { parentCollectionId: forged, tree: [{ title: 'A' }] });
    assert.equal(r.isError, true);
    assert.equal(sc(r).error?.code, 'not_found');
    assert.doesNotMatch(toolText(r), new RegExp(`\n|${ZWSP}`), 'one line, no invisible characters');
    assert.doesNotMatch(String(sc(r).error?.message), new RegExp(`\n|${ZWSP}`));
  } finally { await s.end(); }
});

test('runPlannedCall: a throw while CONTINUING a stored plan is answered, not thrown at the caller', async () => {
  setServiceCredentialForTest(MARIA);
  try {
    const items: PlanItem[] = [{ key: 'a' }];
    const planId = startPlan('w13-proceed', 'args', items, new Map(), 'w13-confirm');
    const result = await runPlannedCall<PlanItem>({
      kind: 'w13-proceed', params: { continuationToken: planId }, args: 'args',
      step: () => async () => ({ status: 'created' }),
      answer: () => { throw new Error('kaputt beim Antworten'); },
      prepare: async () => { throw new Error('not reached'); },
      context: 'Fehler beim Fortsetzen', whatIsOpen: 'Ob schon etwas geschrieben wurde',
    });
    assert.equal(result.isError, true);
    assert.ok((result.structuredContent as { error?: { code?: string } }).error?.code);
  } finally { setServiceCredentialForTest(null); }
});

test('the confirmation key has ONE schema: no curation tool spells the described one out again', () => {
  const dir = new URL('../src/tools/', import.meta.url);
  const SPELLED_OUT = /Bestätigungsschlüssel aus der Vorschau\. Ohne ihn wird ausschließlich die Vorschau erzeugt/;
  const again = readdirSync(dir)
    .filter(f => /^curation-.*\.ts$/.test(f) && f !== 'curation-fields.ts')
    .filter(f => SPELLED_OUT.test(readFileSync(new URL(f, dir), 'utf8')));
  assert.deepEqual(again, []);
});
