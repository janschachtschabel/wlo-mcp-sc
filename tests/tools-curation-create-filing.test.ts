/**
 * tools-curation-create-filing.test.ts – create a record and file it in a
 * collection under ONE confirmation (BOERDi wishlist item 4, 2026-11-06).
 *
 * Two tools with two confirmations stalled at the second one in the chatbot
 * (the "Sammlungs-Gatekeeper" case). The rule that binds this: the collection
 * step is part of the change set the token is bound to — an approval for
 * "create" must not also authorise a filing nobody saw.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { registerCurationContentTools } from '../src/tools/curation-content.js';
import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { installFetchMock, toolText } from './fetchMock.js';

const USER: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };
const URL_NEW = 'https://example.org/neues-material';
const NODE = 'neu-1';
const COLL = 'coll-optik';
const ARGS = { url: URL_NEW, title: 'Brüche verstehen', addToCollectionId: COLL };

async function curationClient(): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerCurationContentTools(server, 'Bearer error="invalid_request"');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), client.connect(ct)]);
  return client;
}

interface Options { duplicate?: boolean; filingStatus?: number; collectionReadable?: boolean; alreadyFiled?: boolean }

function repository(opts: Options = {}) {
  const stored: Record<string, string[]> = { 'cclom:title': ['Brüche verstehen'] };
  const filed = new Set<string>(opts.alreadyFiled ? ['alt-0'] : []);
  return installFetchMock((url, init) => {
    const method = init?.method ?? 'GET';
    if (url.includes('/search/v1/')) {
      const nodes = opts.duplicate
        ? [{ ref: { id: 'alt-0', repo: '-home-' }, properties: { 'ccm:wwwurl': [URL_NEW], 'cclom:title': ['Schon da'] } }]
        : [];
      return { json: { nodes, pagination: { total: nodes.length, from: 0, count: nodes.length } } };
    }
    if (url.includes('/children') && method === 'POST') {
      // The create carries the properties (incl. ccm:wwwurl); keep them, or the
      // read-back rightly reports the URL as discarded.
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      for (const [k, v] of Object.entries(body)) if (Array.isArray(v)) stored[k] = v as string[];
      return { json: { node: { ref: { id: NODE, repo: '-home-' } } } };
    }
    const ref = new RegExp(`/collections/-home-/${COLL}/references/([^/?]+)`).exec(url);
    if (ref && method === 'PUT') {
      if (opts.filingStatus && opts.filingStatus !== 200) return { status: opts.filingStatus, json: { error: 'nein' } };
      filed.add(decodeURIComponent(ref[1]!));
      return { json: {} };
    }
    const usage = /\/usage\/v1\/usages\/node\/([^/]+)\/collections/.exec(url);
    if (usage) {
      return { json: filed.has(usage[1]!) ? [{ collectionUsageType: 'ACTIVE', collection: { ref: { id: COLL }, properties: {} } }] : [] };
    }
    if (method === 'GET' && url.includes(`/${COLL}/metadata`)) {
      return opts.collectionReadable === false
        ? { status: 404, json: {} }
        : { json: { node: { ref: { id: COLL, repo: '-home-' }, type: 'ccm:map', aspects: ['ccm:collection'], properties: { 'cclom:title': ['Optik'] } } } };
    }
    if (method === 'GET') {
      const id = /nodes\/-home-\/([^/]+)\/metadata/.exec(url)?.[1] ?? NODE;
      return { json: { node: { ref: { id, repo: '-home-' }, properties: id === 'alt-0' ? { 'cclom:title': ['Schon da'] } : stored } } };
    }
    if (url.includes('/metadata')) Object.assign(stored, JSON.parse(String(init?.body ?? '{}')));
    return { json: {} };
  });
}

const writes = (m: ReturnType<typeof installFetchMock>) => m.calls.filter(c => (c.init?.method ?? 'GET') !== 'GET' && !c.url.includes('/search/v1/'));
const filings = (m: ReturnType<typeof installFetchMock>) =>
  m.calls.filter(c => (c.init?.method ?? 'GET') === 'PUT' && c.url.includes('/references/'));

interface Confirm { token: string; preview: { statement?: string; collection?: { nodeId: string; title: string } } }
const confirmOf = (r: unknown) => (r as { structuredContent?: { confirm?: Confirm } }).structuredContent?.confirm;

async function run(opts: Options, args: Record<string, unknown> = ARGS) {
  setServiceCredentialForTest(USER);
  const mock = repository(opts);
  const client = await curationClient();
  try {
    const preview = await client.callTool({ name: 'wlo_create_content', arguments: args });
    const confirm = confirmOf(preview);
    const done = confirm
      ? await client.callTool({ name: 'wlo_create_content', arguments: { ...args, confirmToken: confirm.token } })
      : undefined;
    return { preview, confirm, done, mock };
  } finally {
    await client.close(); mock.restore(); setServiceCredentialForTest(null);
  }
}

test('the preview names BOTH steps and writes nothing', async () => {
  setServiceCredentialForTest(USER);
  const mock = repository();
  const client = await curationClient();
  try {
    const preview = await client.callTool({ name: 'wlo_create_content', arguments: ARGS });
    assert.equal(writes(mock).length, 0, 'not one write before the confirmation');
    assert.match(toolText(preview), /Optik/, 'the collection is named for the person');
    assert.deepEqual(confirmOf(preview)?.preview.collection, { nodeId: COLL, title: 'Optik' });
  } finally { await client.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('the confirmed call creates, then files — and reads both back', async () => {
  const { done, mock } = await run({});
  assert.ok(mock.calls.some(c => c.url.includes('/children') && c.init?.method === 'POST'), 'created');
  assert.equal(filings(mock).length, 1);
  assert.match(filings(mock)[0]!.url, new RegExp(`/references/${NODE}`), 'filed the NEW record');
  assert.ok(mock.calls.some(c => c.url.includes(`/usage/v1/usages/node/${NODE}/collections`)), 'filing read back');
  const sc = done!.structuredContent as { nodeId: string; collection: { nodeId: string; status: string } };
  assert.equal(sc.nodeId, NODE);
  assert.deepEqual(sc.collection, { nodeId: COLL, status: 'added' });
  assert.notEqual(done!.isError, true, toolText(done!));
});

test('a refused filing keeps the record and says so — not a total failure', async () => {
  const { done } = await run({ filingStatus: 403 });
  const sc = done!.structuredContent as { nodeId: string; collection: { status: string; code?: string } };
  assert.equal(sc.nodeId, NODE, 'the record exists and is named');
  assert.deepEqual(sc.collection.status, 'failed');
  assert.equal(sc.collection.code, 'forbidden');
  assert.notEqual(done!.isError, true, toolText(done!));
  assert.match(toolText(done!), new RegExp(NODE));
  assert.match(toolText(done!), /nicht in die Sammlung/);
});

test('an unreadable collection stops at the preview — no key for a step that cannot run', async () => {
  const { preview, confirm, mock } = await run({ collectionReadable: false });
  assert.equal(confirm, undefined);
  assert.equal(preview.isError, true);
  assert.equal(writes(mock).length, 0);
});

test('a key from a preview WITHOUT the collection does not authorise a call WITH it', async () => {
  setServiceCredentialForTest(USER);
  const mock = repository();
  const client = await curationClient();
  try {
    const { addToCollectionId: _omit, ...plain } = ARGS;
    const preview = await client.callTool({ name: 'wlo_create_content', arguments: plain });
    const token = confirmOf(preview)!.token;
    const res = await client.callTool({ name: 'wlo_create_content', arguments: { ...ARGS, confirmToken: token } });
    assert.equal(writes(mock).length, 0, 'the filing was not in the approved change');
    assert.equal(res.isError, true);
  } finally { await client.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('an existing record for the address is offered for filing instead of a second one', async () => {
  const { preview, done, mock } = await run({ duplicate: true });
  assert.match(toolText(preview), /alt-0/, 'the existing record is named');
  assert.match(toolText(preview), /nichts angelegt|nicht neu angelegt|Angelegt wird nichts/);
  // The key binds to this sentence — it must not let anyone believe the new
  // metadata reaches the existing record.
  assert.match(toolText(preview), /Metadaten.*nicht übernommen/);
  assert.ok(!mock.calls.some(c => c.url.includes('/children') && c.init?.method === 'POST'), 'no second record');
  assert.match(filings(mock)[0]!.url, /\/references\/alt-0/, 'the EXISTING record was filed');
  assert.deepEqual((done!.structuredContent as { collection: unknown }).collection, { nodeId: COLL, status: 'added' });
});

test('an existing record already in the collection needs no confirmation at all', async () => {
  const { preview, confirm, mock } = await run({ duplicate: true, alreadyFiled: true });
  assert.equal(confirm, null, 'no key — and said explicitly, not by absence');
  assert.equal(writes(mock).length, 0);
  assert.deepEqual((preview.structuredContent as { collection: unknown }).collection, { nodeId: COLL, status: 'already' });
  const sc = preview.structuredContent as { confirm?: unknown; unchanged?: boolean };
  assert.equal(sc.confirm, null, 'nothing to confirm, said in structured form (12a)');
  assert.equal(sc.unchanged, true);
});

test('a target that is not a collection is refused before anything is created', async () => {
  setServiceCredentialForTest(USER);
  const mock = repository();
  const client = await curationClient();
  try {
    // A material id passed as the collection: readable, but a ccm:io.
    const res = await client.callTool({ name: 'wlo_create_content', arguments: { ...ARGS, addToCollectionId: 'alt-0' } });
    assert.equal(res.isError, true);
    assert.match(toolText(res), /keine Sammlung/);
    assert.equal(confirmOf(res), undefined, 'no key for a filing that cannot work');
    assert.equal(writes(mock).length, 0);
  } finally { await client.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('an abort while READING before the confirmation says nothing was created (review R-B)', async () => {
  setServiceCredentialForTest(USER);
  const mock = repository();
  const real = globalThis.fetch;
  // The collection read times out — this is a preview, nothing is being written.
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    if (String(input).includes(`/${COLL}/metadata`)) {
      throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    }
    return real(input as string, init);
  }) as typeof fetch;
  const client = await curationClient();
  try {
    const res = await client.callTool({ name: 'wlo_create_content', arguments: ARGS });
    assert.equal(res.isError, true);
    assert.doesNotMatch(toolText(res), /angelegt wurde, ist damit\s+unklar|ist damit unklar/);
    assert.match(toolText(res), /nichts angelegt/i);
  } finally { globalThis.fetch = real; await client.close(); mock.restore(); setServiceCredentialForTest(null); }
});
