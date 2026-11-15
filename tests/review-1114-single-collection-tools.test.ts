/**
 * review-1114-single-collection-tools.test.ts – two findings of the review of
 * 2026-11-14 on the single collection tools.
 *
 * - A filing answered 409 means "already in the collection" (measured
 *   2026-11-14: the same filing again answers 409 and makes no second
 *   reference). The batch said `already`; the single tool said "could not be
 *   filed" over a material that IS in the collection.
 * - A rename key that was redeemed replays its result; "nothing to change" is
 *   an answer for a call WITHOUT a key only — with a key the key decides, as in
 *   every other tool.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { registerCurationCollectionTools } from '../src/tools/curation-collections.js';
import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { installFetchMock, toolText, type MockResult } from './fetchMock.js';

const USER: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };
const COLLECTION = 'coll-1';
const NODE = 'node-1';

async function client(): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerCurationCollectionTools(server, 'Bearer error="invalid_request"');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  return c;
}

const tokenFrom = (text: string) => {
  const m = /confirmToken[^\w-]*([A-Za-z0-9_-]{20,})/.exec(text);
  assert.ok(m, `no token in reply:\n${text}`);
  return m[1]!;
};
const errorOf = (r: unknown) => (r as { structuredContent?: { error?: Record<string, unknown> } }).structuredContent?.error;

/** A collection and a material; the usage lookup knows of no filing; `write` answers every non-GET. */
function repo(write: (url: string, init: RequestInit) => MockResult, title = { now: 'Bruchrechnung' }) {
  return installFetchMock((url, init) => {
    if ((init?.method ?? 'GET') !== 'GET') return write(url, init!);
    if (url.includes('/usage/v1/')) return { json: [] };
    if (url.includes('/children')) {
      return { json: { nodes: [{ ref: { id: 'ref-1', repo: '-home-' }, properties: { 'ccm:original': [NODE] } }], pagination: { total: 1, from: 0, count: 1 } } };
    }
    if (url.includes(COLLECTION)) {
      return { json: { node: { ref: { id: COLLECTION, repo: '-home-' }, type: 'ccm:map', aspects: ['ccm:collection'], properties: { 'cm:title': [title.now] } } } };
    }
    return { json: { node: { ref: { id: NODE, repo: '-home-' }, type: 'ccm:io', properties: { 'cclom:title': ['Arbeitsblatt'] } } } };
  });
}

async function confirmed(c: Client, name: string, args: Record<string, unknown>) {
  const preview = toolText(await c.callTool({ name, arguments: args }));
  const withKey = { ...args, confirmToken: tokenFrom(preview) };
  return { withKey, result: await c.callTool({ name, arguments: withKey }) };
}

test('wlo_add_to_collection: a filing answered 409 is "already in the collection", not a failure', async () => {
  setServiceCredentialForTest(USER);
  const mock = repo(() => ({ status: 409, json: { message: 'duplicate' } }));
  const c = await client();
  try {
    const { result } = await confirmed(c, 'wlo_add_to_collection', { collectionId: COLLECTION, nodeId: NODE });
    assert.notEqual(result.isError, true, toolText(result));
    assert.match(toolText(result), /ist bereits in „Bruchrechnung“/);
    assert.doesNotMatch(toolText(result), /konnte nicht aufgenommen werden/);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('wlo_add_to_collection: another refusal (403) stays a refusal', async () => {
  setServiceCredentialForTest(USER);
  const mock = repo(() => ({ status: 403, json: {} }));
  const c = await client();
  try {
    const { result } = await confirmed(c, 'wlo_add_to_collection', { collectionId: COLLECTION, nodeId: NODE });
    assert.equal(result.isError, true);
    assert.deepEqual([errorOf(result)?.['code'], errorOf(result)?.['outcomeOpen']], ['forbidden', false]);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('wlo_remove_from_collection: a 409 there is NOT "already" — it is a refusal', async () => {
  setServiceCredentialForTest(USER);
  const mock = repo(() => ({ status: 409, json: {} }));
  const c = await client();
  try {
    const { result } = await confirmed(c, 'wlo_remove_from_collection', { collectionId: COLLECTION, nodeId: NODE });
    assert.equal(result.isError, true);
    assert.equal(errorOf(result)?.['code'], 'refused');
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('wlo_add_to_collection: a busy repository (429) is upstream_busy and open', async () => {
  setServiceCredentialForTest(USER);
  const mock = repo(() => ({ status: 429, json: {} }));
  const c = await client();
  try {
    const { result } = await confirmed(c, 'wlo_add_to_collection', { collectionId: COLLECTION, nodeId: NODE });
    assert.deepEqual([errorOf(result)?.['code'], errorOf(result)?.['outcomeOpen']], ['upstream_busy', true]);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('wlo_rename_collection: a redeemed key presented again replays the result — the record now HOLDS the new title', async () => {
  setServiceCredentialForTest(USER);
  const title = { now: 'Bruchrechnung' };
  const mock = repo(() => { title.now = 'Brüche'; return { json: {} }; }, title);
  const c = await client();
  try {
    const { withKey, result } = await confirmed(c, 'wlo_rename_collection', { nodeId: COLLECTION, title: 'Brüche' });
    assert.match(toolText(result), /heißt jetzt „Brüche“/);
    const writes = mock.calls.filter(x => (x.init?.method ?? 'GET') !== 'GET').length;
    const again = await c.callTool({ name: 'wlo_rename_collection', arguments: withKey });
    assert.match(toolText(again), /heißt jetzt „Brüche“/);
    assert.equal((again.structuredContent as { replayed?: boolean } | undefined)?.replayed, true);
    assert.equal(mock.calls.filter(x => (x.init?.method ?? 'GET') !== 'GET').length, writes, 'nothing is written twice');
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('wlo_rename_collection: a key over a record that already holds the values is judged as a KEY — never answered "nothing to change"', async () => {
  setServiceCredentialForTest(USER);
  // What a re-presented key meets once its stored result is gone (a restart): the title is already the new one.
  const mock = repo(() => ({ json: {} }), { now: 'Brüche' });
  const c = await client();
  try {
    const r = await c.callTool({ name: 'wlo_rename_collection', arguments: { nodeId: COLLECTION, title: 'Brüche', confirmToken: 'k'.repeat(32) } });
    assert.equal(r.isError, true, toolText(r));
    assert.deepEqual([errorOf(r)?.['code'], errorOf(r)?.['outcomeOpen']], ['confirm_unknown', true]);
    assert.equal((r.structuredContent as { unchanged?: boolean } | undefined)?.unchanged, undefined);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('wlo_rename_collection: WITHOUT a key, values that already stand are "unchanged" and earn no key', async () => {
  setServiceCredentialForTest(USER);
  const mock = repo(() => ({ json: {} }), { now: 'Brüche' });
  const c = await client();
  try {
    const r = await c.callTool({ name: 'wlo_rename_collection', arguments: { nodeId: COLLECTION, title: 'Brüche' } });
    assert.deepEqual(r.structuredContent, { confirm: null, unchanged: true });
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});
