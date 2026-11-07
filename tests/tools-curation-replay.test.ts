/**
 * tools-curation-replay.test.ts – a confirmed write may be sent twice safely
 * (plan 2026-11-07, S3; acceptance "Antwort verloren → derselbe Aufruf →
 * gleiches Ergebnis, ein Datensatz" and "parallel zweimal → einmal geschrieben").
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

const MARIA: WloCredential = { header: 'Basic m', label: 'maria-replay', source: 'user' };
const OTTO: WloCredential = { header: 'Basic o', label: 'otto-replay', source: 'user' };
const ARGS = { url: 'https://example.org/replay', title: 'Brüche verstehen' };

async function client(): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerCurationContentTools(server, 'Bearer error="invalid_request"');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  return c;
}

/** No duplicate for the URL, a create that yields `neu-1`, a node that reads back what was written. */
function repository() {
  const stored: Record<string, string[]> = { 'cclom:title': [ARGS.title], 'ccm:wwwurl': [ARGS.url] };
  return installFetchMock((url, init) => {
    const method = init?.method ?? 'GET';
    if (url.includes('/search/v1/')) return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
    if (url.includes('/children') && method === 'POST') return { json: { node: { ref: { id: 'neu-1', repo: '-home-' } } } };
    if (method === 'GET') return { json: { node: { ref: { id: 'neu-1', repo: '-home-' }, properties: stored } } };
    return { json: {} };
  });
}

const creates = (m: ReturnType<typeof installFetchMock>) =>
  m.calls.filter(c => c.url.includes('/children') && (c.init?.method ?? 'GET') === 'POST').length;

async function previewToken(c: Client): Promise<string> {
  const r = await c.callTool({ name: 'wlo_create_content', arguments: ARGS });
  return (r.structuredContent as { confirm: { token: string } }).confirm.token;
}

const sc = (r: unknown) => (r as { structuredContent?: Record<string, unknown> }).structuredContent ?? {};

test('the answer lost → the same call again → the same result, replayed, ONE record', async () => {
  setServiceCredentialForTest(MARIA);
  const mock = repository();
  const c = await client();
  try {
    const token = await previewToken(c);
    const first = await c.callTool({ name: 'wlo_create_content', arguments: { ...ARGS, confirmToken: token } });
    assert.notEqual(first.isError, true, toolText(first));
    const before = mock.calls.length;
    const again = await c.callTool({ name: 'wlo_create_content', arguments: { ...ARGS, confirmToken: token } });
    assert.equal(mock.calls.length, before, 'the seam answers without asking the repository again');
    assert.equal(sc(again)['replayed'], true);
    assert.equal(sc(again)['nodeId'], sc(first)['nodeId'], 'the same answer as the first time');
    assert.match(toolText(again), /neu-1/);
    assert.equal(creates(mock), 1, 'nothing was written twice');
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('sent twice at once → written once; the other answer says in progress or replays', async () => {
  setServiceCredentialForTest(MARIA);
  const mock = repository();
  const c = await client();
  try {
    const token = await previewToken(c);
    const [a, b] = await Promise.all([
      c.callTool({ name: 'wlo_create_content', arguments: { ...ARGS, confirmToken: token } }),
      c.callTool({ name: 'wlo_create_content', arguments: { ...ARGS, confirmToken: token } }),
    ]);
    assert.equal(creates(mock), 1, 'one record');
    const flags = [a, b].map(r => (sc(r)['inProgress'] === true ? 'inProgress' : sc(r)['replayed'] === true ? 'replayed' : 'first'));
    assert.ok(flags.includes('first'), `one call did the work: ${flags}`);
    assert.ok(flags.includes('inProgress') || flags.includes('replayed'), `the other did not write: ${flags}`);
    for (const r of [a, b]) assert.notEqual(sc(r)['error'] && (sc(r)['error'] as { code?: string }).code, 'confirm_unknown');
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('the same key with OTHER arguments is confirm_mismatch, and nothing is written', async () => {
  setServiceCredentialForTest(MARIA);
  const mock = repository();
  const c = await client();
  try {
    const token = await previewToken(c);
    await c.callTool({ name: 'wlo_create_content', arguments: { ...ARGS, confirmToken: token } });
    const other = await c.callTool({ name: 'wlo_create_content', arguments: { ...ARGS, title: 'Anders', confirmToken: token } });
    assert.equal((sc(other)['error'] as { code?: string } | undefined)?.code, 'confirm_mismatch');
    assert.equal(creates(mock), 1);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('another identity presenting the key gets no replay — the answer is not theirs', async () => {
  setServiceCredentialForTest(MARIA);
  const mock = repository();
  const c = await client();
  try {
    const token = await previewToken(c);
    await c.callTool({ name: 'wlo_create_content', arguments: { ...ARGS, confirmToken: token } });
    setServiceCredentialForTest(OTTO);
    const foreign = await c.callTool({ name: 'wlo_create_content', arguments: { ...ARGS, confirmToken: token } });
    assert.notEqual(sc(foreign)['replayed'], true);
    assert.equal((sc(foreign)['error'] as { code?: string } | undefined)?.code, 'confirm_unknown');
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('a call that never redeemed its key leaves nothing to replay', async () => {
  setServiceCredentialForTest(MARIA);
  const mock = repository();
  const c = await client();
  try {
    const fake = await c.callTool({ name: 'wlo_create_content', arguments: { ...ARGS, confirmToken: 'x'.repeat(30) } });
    assert.equal((sc(fake)['error'] as { code?: string } | undefined)?.code, 'confirm_unknown');
    const again = await c.callTool({ name: 'wlo_create_content', arguments: { ...ARGS, confirmToken: 'x'.repeat(30) } });
    assert.notEqual(sc(again)['replayed'], true, 'a refusal before redemption is not stored');
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});
