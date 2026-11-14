/**
 * tools-submit-content-outcomes.test.ts – `wlo_submit_content` reads a
 * submission the way `wlo_submit_contents` does (audit 2026-11-14, W11).
 *
 * The single tool answered every non-success as `refused`: a submission the
 * record does not show, one that could not be checked and one the repository
 * answered 5xx — three different things to do next. And a 5xx was reported
 * without a look at the record, where a proxy answers 502 while the PUT lands.
 * Both tools now go through ONE reading (`sendSubmission`, submit-plan.ts).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { registerCurationContentTools } from '../src/tools/curation-content.js';
import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { installFetchMock, toolText, type MockResult } from './fetchMock.js';

const MARIA: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };
const TOOL = 'wlo_submit_content';
const QUEUE = '200_tocheck';

interface Behaviour {
  /** The answer of the workflow PUT. */
  put: MockResult;
  /** Does the PUT put the record in the queue, whatever it answers? */
  lands: boolean;
  /** Status of every read AFTER the PUT (default 200). */
  readAfter?: number;
}

async function scene(b: Behaviour) {
  setServiceCredentialForTest(MARIA);
  let queued = false;
  let sent = false;
  const puts: Array<{ comment: string }> = [];
  const mock = installFetchMock((url, init): MockResult => {
    const method = init?.method ?? 'GET';
    if (url.includes('/workflow') && method === 'PUT') {
      sent = true;
      puts.push({ comment: (JSON.parse(String(init?.body ?? '{}')) as { comment?: string }).comment ?? '' });
      if (b.lands) queued = true;
      return b.put;
    }
    if (sent && b.readAfter && b.readAfter !== 200) return { status: b.readAfter, json: {} };
    return { json: { node: { ref: { id: 'r1', repo: '-home-' }, type: 'ccm:io', aspects: [],
      properties: { 'cclom:title': ['Arbeitsblatt Licht'], ...(queued ? { 'ccm:wf_status': [QUEUE], 'ccm:wf_receiver': ['GROUP_X'] } : {}) } } } };
  });
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerCurationContentTools(server, 'Bearer error="invalid_request"');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  const submit = async (args: Record<string, unknown> = {}) => {
    const preview = await c.callTool({ name: TOOL, arguments: { nodeId: 'r1', ...args } });
    const token = (preview.structuredContent as { confirm?: { token: string } }).confirm?.token;
    assert.ok(token, toolText(preview));
    return c.callTool({ name: TOOL, arguments: { nodeId: 'r1', ...args, confirmToken: token } });
  };
  const end = async () => { await c.close(); mock.restore(); setServiceCredentialForTest(null); };
  return { submit, puts, end };
}

const errorOf = (r: unknown) => (r as { structuredContent?: { error?: Record<string, unknown> } }).structuredContent?.error;

test('answered with success, no status on the record: not_stored, and nothing was written', async () => {
  const s = await scene({ put: { json: {} }, lands: false });
  try {
    const r = await s.submit();
    assert.equal(r.isError, true);
    assert.deepEqual([errorOf(r)?.['code'], errorOf(r)?.['outcomeOpen']], ['not_stored', false]);
  } finally { await s.end(); }
});

test('answered with success, the record not readable afterwards: unverified and open', async () => {
  const s = await scene({ put: { json: {} }, lands: true, readAfter: 500 });
  try {
    const r = await s.submit();
    assert.deepEqual([errorOf(r)?.['code'], errorOf(r)?.['outcomeOpen']], ['unverified', true]);
  } finally { await s.end(); }
});

for (const [status, code] of [[403, 'forbidden'], [404, 'not_found'], [400, 'refused']] as const) {
  test(`a submission refused with ${status} is ${code} and NOT open`, async () => {
    const s = await scene({ put: { status, json: { message: 'nein' } }, lands: false });
    try {
      const r = await s.submit();
      assert.deepEqual([errorOf(r)?.['code'], errorOf(r)?.['outcomeOpen']], [code, false]);
    } finally { await s.end(); }
  });
}

test('a 5xx on a submission that LANDED is the submission — the record is read before anything is said', async () => {
  const s = await scene({ put: { status: 502, json: {} }, lands: true });
  try {
    const r = await s.submit();
    assert.notEqual(r.isError, true, toolText(r));
    assert.match(toolText(r), /eingereicht/);
  } finally { await s.end(); }
});

test('a 5xx on a submission that did not land is an error AND open — never "nothing written"', async () => {
  const s = await scene({ put: { status: 500, json: {} }, lands: false });
  try {
    const r = await s.submit();
    assert.deepEqual([errorOf(r)?.['code'], errorOf(r)?.['outcomeOpen']], ['upstream_error', true]);
    assert.doesNotMatch(toolText(r), /Es wurde nichts geschrieben/);
  } finally { await s.end(); }
});

test('a 5xx with the record unreadable afterwards is open', async () => {
  const s = await scene({ put: { status: 500, json: {} }, lands: true, readAfter: 503 });
  try {
    const r = await s.submit();
    assert.equal(errorOf(r)?.['outcomeOpen'], true);
  } finally { await s.end(); }
});

test('what is shown is what is sent: invisible characters in the note do not travel to the queue', async () => {
  const s = await scene({ put: { json: {} }, lands: true });
  try {
    const r = await s.submit({ comment: `Bitte${String.fromCharCode(0x200b)} prüfen\nZeile zwei` });
    assert.notEqual(r.isError, true, toolText(r));
    assert.deepEqual(s.puts.map(p => p.comment), ['Bitte prüfen Zeile zwei']);
  } finally { await s.end(); }
});
