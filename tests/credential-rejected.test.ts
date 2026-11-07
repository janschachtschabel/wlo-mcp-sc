/**
 * credential-rejected.test.ts – a login the repository no longer accepts
 * (auth review 2026-11-05, finding 2).
 *
 * A block stays on the allow-list after its owner changes their WLO password.
 * Before this, every call kept sending the stale password upstream — several
 * times per tool call, since a search fans out into query variants — and the
 * person read "ngsearch failed: 401" or, worse, "das Material ist nicht
 * öffentlich", with nothing asking their client to sign in again.
 *
 * Measured basis (auth/identity.ts, 2026-07-31): wrong credentials answer 401
 * on the identity AND the search endpoints; a non-public node read anonymously
 * answers 403. So 401 is the rejection signal, and 403 is not.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { BASE_URL, WLO_REPOSITORY_URL } from '../src/wlo-config.js';
import { wloFetch } from '../src/wlo-fetch.js';
import {
  isCurrentCredentialRejected, runWithCredential, setServiceCredentialForTest, type WloCredential,
} from '../src/auth/credential.js';
import { applyReadOnlyToolDefaults, CREDENTIAL_REJECTED_NOTICE } from '../src/apps/tool-defaults.js';
import { nodeLookupMiss } from '../src/tools/shared.js';
import { connectedClient, installFetchMock, toolText } from './fetchMock.js';

const REPO = `${WLO_REPOSITORY_URL}/rest/node/v1/nodes/-home-/n1/metadata`;
const IDENTITY = `${BASE_URL}/iam/v1/people/-home-/-me-`;
const user = (): WloCredential => ({ header: 'Basic c3RhbGU6b2xk', label: 'stale', source: 'user' });

test('after a 401, the same request stops sending the rejected login upstream', async () => {
  const mock = installFetchMock(() => ({ status: 401, text: 'Unauthorized' }));
  try {
    const statuses = await runWithCredential(user(), async () => [
      (await wloFetch(REPO)).status,
      (await wloFetch(REPO)).status,
      (await wloFetch(REPO)).status,
    ]);
    assert.deepEqual(statuses, [401, 401, 401], 'every caller still sees the rejection');
    assert.deepEqual(mock.calls.map(c => c.url), [REPO, IDENTITY],
      'the first attempt plus ONE identity check reached the repository, nothing after');
  } finally { mock.restore(); }
});

test('a 401 for a login the repository still ACCEPTS is not a rejected login', async () => {
  // edu-sharing also answers 401 to a valid login that lacks a right (measured:
  // `/bulk/v1/find` → 401 "Admin rights are required"). Treating that as a
  // refused password would tell a working account to sign in again — forever.
  const mock = installFetchMock(url => url === IDENTITY
    ? { json: { person: { authorityName: 'stale' } } }
    : { status: 401, text: 'Admin rights are required' });
  try {
    const rejected = await runWithCredential(user(), async () => {
      await wloFetch(REPO); await wloFetch(REPO);
      return isCurrentCredentialRejected();
    });
    assert.equal(rejected, false);
    assert.equal(mock.calls.filter(c => c.url === REPO).length, 2, 'later calls still go out');
    assert.equal(mock.calls.filter(c => c.url === IDENTITY).length, 1, 'checked once per request, not per 401');
  } finally { mock.restore(); }
});

test('a 401 from the identity endpoint itself is the verdict — no second probe', async () => {
  const mock = installFetchMock(() => ({ status: 401, text: 'Unauthorized' }));
  try {
    await runWithCredential(user(), async () => { await wloFetch(IDENTITY); await wloFetch(REPO); });
    assert.deepEqual(mock.calls.map(c => c.url), [IDENTITY]);
  } finally { mock.restore(); }
});

test('an identity check that cannot answer leaves the login usable', async () => {
  // Unknown is not "refused": failing toward the old behaviour (keep sending)
  // is the side that cannot lock a working account out.
  const mock = installFetchMock(url => url === IDENTITY
    ? { status: 503, text: 'down' }
    : { status: 401, text: 'Unauthorized' });
  try {
    const rejected = await runWithCredential(user(), async () => {
      await wloFetch(REPO); await wloFetch(REPO);
      return isCurrentCredentialRejected();
    });
    assert.equal(rejected, false);
    assert.equal(mock.calls.filter(c => c.url === REPO).length, 2);
  } finally { mock.restore(); }
});

test('the next request starts fresh — a rejection is not remembered across requests', async () => {
  // Each HTTP request builds its own credential object, so a transient 401 can
  // never lock a person out beyond the request it happened in.
  const mock = installFetchMock(() => ({ status: 401, text: 'Unauthorized' }));
  try {
    await runWithCredential(user(), () => wloFetch(REPO));
    await runWithCredential(user(), () => wloFetch(REPO));
    assert.equal(mock.calls.filter(c => c.url === REPO).length, 2);
  } finally { mock.restore(); }
});

test('a 403 is not a rejected login — later calls still go out', async () => {
  const mock = installFetchMock(() => ({ status: 403, text: 'Forbidden' }));
  try {
    await runWithCredential(user(), async () => { await wloFetch(REPO); await wloFetch(REPO); });
    assert.equal(mock.calls.length, 2);
  } finally { mock.restore(); }
});

test('the shared service account is not short-circuited by one request', async () => {
  // It is ONE object for every request; marking it would end the server for
  // everyone after a single 401. Its rejection is the operator's boot-log case.
  const mock = installFetchMock(() => ({ status: 401, text: 'Unauthorized' }));
  setServiceCredentialForTest({ header: 'Basic c3ZjOng=', label: 'svc', source: 'service' });
  try {
    await wloFetch(REPO); await wloFetch(REPO);
    assert.equal(mock.calls.length, 2);
  } finally { setServiceCredentialForTest(null); mock.restore(); }
});

test('a tool answering under a rejected login says so first and asks for a new sign-in', async () => {
  const stale = user();
  setServiceCredentialForTest(stale);
  const mock = installFetchMock(() => ({ status: 401, text: 'Unauthorized' }));
  const c = await connectedClient();
  try {
    const r = await c.callTool({ name: 'search_wlo_content', arguments: { query: 'Bruchrechnung' } });
    const first = (r.content as Array<{ text: string }>)[0]!.text;
    assert.match(first, /Anmeldung/, 'block 0 names the cause — some clients read nothing else');
    assert.match(first, /neu (an)?melden|neu verbinden/i, 'and the way out');
    assert.equal(r.isError, true);
    const meta = (r as { _meta?: Record<string, unknown> })._meta;
    assert.ok(Array.isArray(meta?.['mcp/www_authenticate']), 'the client is asked to sign in again');
    // The search fires its three query variants IN PARALLEL, so all three are
    // already out when the first 401 returns — stopping them would mean
    // serialising every search. What the short-circuit guarantees is that
    // nothing AFTER that wave goes out (sequential case: first test above). The
    // three 401s share ONE identity check.
    assert.equal(mock.calls.filter(c => c.url !== IDENTITY).length, 3, 'one parallel wave, nothing after it');
    assert.equal(mock.calls.filter(c => c.url === IDENTITY).length, 1);
  } finally { await c.close(); setServiceCredentialForTest(null); mock.restore(); }
});

test('a tool that THROWS under a rejected login still leads with the notice', async () => {
  // The SDK turns a thrown error into an error result whose first block is the
  // raw message — "… 401" — which is exactly what the notice exists to replace.
  const server = new McpServer({ name: 't', version: '0' });
  applyReadOnlyToolDefaults(server, 'Bearer resource_metadata="x"');
  server.tool('throws_after_401', 'test', {}, async () => {
    await wloFetch(REPO);
    throw new Error('upstream failed: 401');
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'c', version: '0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  const mock = installFetchMock(() => ({ status: 401, text: 'Unauthorized' }));
  setServiceCredentialForTest(user());
  try {
    const r = await c.callTool({ name: 'throws_after_401', arguments: {} });
    assert.equal((r.content as Array<{ text: string }>)[0]!.text, CREDENTIAL_REJECTED_NOTICE);
    assert.match(toolText(r), /upstream failed: 401/, 'the original error is kept below the notice');
    assert.equal(r.isError, true);
    assert.ok(Array.isArray((r as { _meta?: Record<string, unknown> })._meta?.['mcp/www_authenticate']));
  } finally { await c.close(); setServiceCredentialForTest(null); mock.restore(); }
});

test('a tool answering normally is untouched', async () => {
  setServiceCredentialForTest(user());
  const mock = installFetchMock(() => ({ json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } }));
  const c = await connectedClient();
  try {
    const r = await c.callTool({ name: 'search_wlo_content', arguments: { query: 'Bruchrechnung' } });
    assert.notEqual(r.isError, true);
    assert.doesNotMatch(toolText(r), /Anmeldung.*abgelehnt/);
    assert.equal((r as { _meta?: Record<string, unknown> })._meta?.['mcp/www_authenticate'], undefined);
  } finally { await c.close(); setServiceCredentialForTest(null); mock.restore(); }
});

test('nodeLookupMiss tells a rejected login (401) apart from a non-public node (403)', () => {
  assert.match(nodeLookupMiss('n1', 403), /nicht öffentlich/);
  assert.doesNotMatch(nodeLookupMiss('n1', 401), /nicht öffentlich/, '401 is about the login, not the material');
  assert.match(nodeLookupMiss('n1', 401), /Anmeldung/);
  // A 401 can also be a working login that lacks a right, so the sentence may
  // not ASSERT a refused login — the tool-level notice says so when it is one.
  assert.doesNotMatch(nodeLookupMiss('n1', 401), /abgelehnt/);
});

// ── Chatbot feedback 2026-11-07, point 4: every error answer carries a code ──

async function oneToolClient(register: (s: McpServer) => void): Promise<Client> {
  const server = new McpServer({ name: 't', version: '0' });
  applyReadOnlyToolDefaults(server, 'Bearer resource_metadata="x"');
  register(server);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'c', version: '0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  return c;
}

const errorOf = (r: unknown) =>
  (r as { structuredContent?: { error?: { code?: string; message?: string } } }).structuredContent?.error;

test('a rejected login is coded login_rejected', async () => {
  const c = await oneToolClient(s => s.tool('reads', 'test', {}, async () => {
    await wloFetch(REPO);
    return { content: [{ type: 'text', text: 'leer' }] };
  }));
  const mock = installFetchMock(() => ({ status: 401, text: 'Unauthorized' }));
  setServiceCredentialForTest(user());
  try {
    const r = await c.callTool({ name: 'reads', arguments: {} });
    assert.equal(errorOf(r)?.code, 'login_rejected');
    assert.equal(errorOf(r)?.message, CREDENTIAL_REJECTED_NOTICE);
  } finally { await c.close(); setServiceCredentialForTest(null); mock.restore(); }
});

test('an isError without a code gets refused, with its own text as the message', async () => {
  const c = await oneToolClient(s => s.tool('says_no', 'test', {}, async () =>
    ({ content: [{ type: 'text', text: 'Nein, so nicht.' }], isError: true })));
  try {
    const r = await c.callTool({ name: 'says_no', arguments: {} });
    assert.deepEqual(errorOf(r), { code: 'refused', message: 'Nein, so nicht.' });
  } finally { await c.close(); }
});

test('a code the tool set itself is kept', async () => {
  const c = await oneToolClient(s => s.tool('coded', 'test', {}, async () =>
    ({ content: [{ type: 'text', text: 'x' }], isError: true,
      structuredContent: { error: { code: 'not_found', message: 'x' } } })));
  try {
    assert.equal(errorOf(await c.callTool({ name: 'coded', arguments: {} }))?.code, 'not_found');
  } finally { await c.close(); }
});

test('a thrown error is coded upstream_error', async () => {
  const c = await oneToolClient(s => s.tool('throws', 'test', {}, async () => { throw new Error('kaputt'); }));
  try {
    const r = await c.callTool({ name: 'throws', arguments: {} });
    assert.equal(r.isError, true);
    assert.equal(errorOf(r)?.code, 'upstream_error');
    assert.match(toolText(r), /kaputt/);
  } finally { await c.close(); }
});

test('a successful answer gets no error field', async () => {
  const c = await oneToolClient(s => s.tool('fine', 'test', {}, async () => ({ content: [{ type: 'text', text: 'ok' }] })));
  try {
    const r = await c.callTool({ name: 'fine', arguments: {} });
    assert.equal(errorOf(r), undefined);
  } finally { await c.close(); }
});

test('toolError codes a read timeout as timeout, a 403 as forbidden (feedback point 10)', async () => {
  const { toolError } = await import('../src/tools/shared.js');
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  assert.equal(toolError('Lesen', timeout).structuredContent.error.code, 'timeout');
  assert.equal(toolError('Lesen', new Error('getNodeMetadata failed: 403 Forbidden')).structuredContent.error.code, 'forbidden');
  assert.equal(toolError('Lesen', new Error('kaputt')).structuredContent.error.code, 'upstream_error');
});

test('errors the SDK builds itself are coded too — wrong arguments, unknown tool (review 2026-11-07)', async () => {
  // They never reach the tool handler: `McpServer.createToolError` answers them.
  // Wrong arguments are a chatbot's most common error.
  const { z } = await import('zod');
  const c = await oneToolClient(s => s.registerTool('typed', { inputSchema: { n: z.number() } },
    async () => ({ content: [{ type: 'text', text: 'ok' }] })));
  try {
    const bad = await c.callTool({ name: 'typed', arguments: { n: 'kein' } });
    assert.equal(bad.isError, true);
    assert.equal(errorOf(bad)?.code, 'invalid_input');
    assert.match(String(errorOf(bad)?.message), /Input validation error/);
    const unknown = await c.callTool({ name: 'gibt_es_nicht', arguments: {} });
    assert.equal(errorOf(unknown)?.code, 'unknown_tool');
  } finally { await c.close(); }
});
