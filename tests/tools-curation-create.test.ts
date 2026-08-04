/**
 * tools-curation-create.test.ts – creating and submitting, as two separate acts.
 *
 * They are deliberately not one tool. A draft that reaches the editorial queue
 * because someone was still writing costs a reviewer's attention and cannot be
 * taken back quietly, so submitting is its own decision with its own
 * confirmation. The first test here is the one that keeps that true.
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

async function curationClient(): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerCurationContentTools(server);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), client.connect(ct)]);
  return client;
}

/** Empty duplicate search, a create that yields `neu-1`, everything else ok. */
function serveAll(duplicateUrls: string[] = []) {
  const stored: Record<string, string[]> = { 'cclom:title': ['Brüche verstehen'] };
  return installFetchMock((url, init) => {
    const method = init?.method ?? 'GET';
    if (url.includes('/search/v1/')) {
      return {
        json: {
          nodes: duplicateUrls.map((u, i) => ({
            ref: { id: `alt-${i}`, repo: '-home-' },
            properties: { 'ccm:wwwurl': [u], 'cclom:title': ['Schon da'] },
          })),
          pagination: { total: duplicateUrls.length, from: 0, count: duplicateUrls.length },
        },
      };
    }
    if (url.includes('/children') && method === 'POST') {
      return { json: { node: { ref: { id: NODE, repo: '-home-' } } } };
    }
    if (method === 'GET') {
      return { json: { node: { ref: { id: NODE, repo: '-home-' }, properties: stored } } };
    }
    if (url.includes('/metadata')) Object.assign(stored, JSON.parse(String(init?.body ?? '{}')));
    return { json: {} };
  });
}

const calls = (m: ReturnType<typeof installFetchMock>, needle: string) =>
  m.calls.filter(c => c.url.includes(needle));

function tokenFrom(text: string): string {
  const m = /confirmToken[^\w-]*([A-Za-z0-9_-]{20,})/.exec(text);
  assert.ok(m, `no token in reply:\n${text}`);
  return m[1]!;
}

const CREATE_ARGS = { url: URL_NEW, title: 'Brüche verstehen', description: 'Ein Arbeitsblatt.' };

test('creating never touches the review workflow', async () => {
  setServiceCredentialForTest(USER);
  const mock = serveAll();
  const client = await curationClient();
  try {
    const preview = toolText(await client.callTool({ name: 'wlo_create_content', arguments: CREATE_ARGS }));
    await client.callTool({
      name: 'wlo_create_content',
      arguments: { ...CREATE_ARGS, confirmToken: tokenFrom(preview) },
    });
    assert.equal(calls(mock, '/workflow').length, 0, 'a draft does not enter the editorial queue');
  } finally {
    await client.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('creating without a token writes nothing', async () => {
  setServiceCredentialForTest(USER);
  const mock = serveAll();
  const client = await curationClient();
  try {
    const text = toolText(await client.callTool({ name: 'wlo_create_content', arguments: CREATE_ARGS }));
    assert.equal(calls(mock, '/children').length, 0, 'nothing was created');
    assert.match(text, /Brüche verstehen/);
    assert.match(text, new RegExp(URL_NEW.replace(/[/.]/g, '\\$&')));
    assert.ok(tokenFrom(text).length > 0);
  } finally {
    await client.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('the token creates the record and reports its id', async () => {
  setServiceCredentialForTest(USER);
  const mock = serveAll();
  const client = await curationClient();
  try {
    const preview = toolText(await client.callTool({ name: 'wlo_create_content', arguments: CREATE_ARGS }));
    const text = toolText(await client.callTool({
      name: 'wlo_create_content',
      arguments: { ...CREATE_ARGS, confirmToken: tokenFrom(preview) },
    }));
    assert.equal(calls(mock, '/children').length, 1);
    assert.match(text, new RegExp(NODE));
  } finally {
    await client.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('an existing record for the same URL stops the creation and names it', async () => {
  setServiceCredentialForTest(USER);
  const mock = serveAll([URL_NEW]);
  const client = await curationClient();
  try {
    const preview = toolText(await client.callTool({ name: 'wlo_create_content', arguments: CREATE_ARGS }));
    const res = await client.callTool({
      name: 'wlo_create_content',
      arguments: { ...CREATE_ARGS, confirmToken: tokenFrom(preview) },
    });
    assert.equal(calls(mock, '/children').length, 0);
    assert.match(toolText(res), /alt-0/, 'the existing record is named so the user can go there');
    assert.equal((res as { isError?: boolean }).isError, true);
  } finally {
    await client.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('creating needs a URL and a title', async () => {
  setServiceCredentialForTest(USER);
  const mock = serveAll();
  const client = await curationClient();
  try {
    const res = await client.callTool({ name: 'wlo_create_content', arguments: { title: 'Ohne URL' } });
    assert.equal((res as { isError?: boolean }).isError, true);
    assert.match(toolText(res), /URL/i);
    assert.equal(mock.calls.length, 0);
  } finally {
    await client.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('a timed-out create says the outcome is open, not that nothing was created', async () => {
  // Measured 2026-08-02: the abort hits the response, not the work — the
  // repository had made the record while the tool reported a failure. Raising
  // the timeout makes this rarer, never impossible, so the wording has to be
  // true in both cases. The retry advice is safe because the duplicate check
  // finds and names an existing record.
  setServiceCredentialForTest(USER);
  const mock = installFetchMock((url, init) => {
    if (url.includes('/search/v1/')) {
      return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
    }
    if (url.includes('/children') && (init?.method ?? 'GET') === 'POST') {
      throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    }
    return { json: { node: { ref: { id: NODE, repo: '-home-' }, properties: {} } } };
  });
  const client = await curationClient();
  try {
    const preview = toolText(await client.callTool({ name: 'wlo_create_content', arguments: CREATE_ARGS }));
    const res = await client.callTool({
      name: 'wlo_create_content', arguments: { ...CREATE_ARGS, confirmToken: tokenFrom(preview) },
    });
    const text = toolText(res);
    assert.match(text, /unklar|offen/i, 'the outcome is stated as open');
    assert.match(text, /erneut|noch einmal/i, 'and a retry is offered');
    assert.doesNotMatch(text, /wurde nicht angelegt/i, 'never a claim that no record exists');
    assert.equal((res as { isError?: boolean }).isError, true);
  } finally {
    await client.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('an ordinary create failure still says plainly that it failed', async () => {
  // The open-outcome wording must not leak into the case where the repository
  // refused the call — that one really did create nothing.
  setServiceCredentialForTest(USER);
  const mock = installFetchMock((url, init) => {
    if (url.includes('/search/v1/')) {
      return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
    }
    if (url.includes('/children') && (init?.method ?? 'GET') === 'POST') return { status: 403, json: {} };
    return { json: { node: { ref: { id: NODE, repo: '-home-' }, properties: {} } } };
  });
  const client = await curationClient();
  try {
    const preview = toolText(await client.callTool({ name: 'wlo_create_content', arguments: CREATE_ARGS }));
    const text = toolText(await client.callTool({
      name: 'wlo_create_content', arguments: { ...CREATE_ARGS, confirmToken: tokenFrom(preview) },
    }));
    assert.match(text, /403/);
    assert.doesNotMatch(text, /unklar/i);
  } finally {
    await client.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('submitting without a token only previews', async () => {
  setServiceCredentialForTest(USER);
  const mock = serveAll();
  const client = await curationClient();
  try {
    const text = toolText(await client.callTool({
      name: 'wlo_submit_content',
      arguments: { nodeId: NODE, comment: 'Bitte prüfen' },
    }));
    assert.equal(calls(mock, '/workflow').length, 0);
    assert.match(text, /Brüche verstehen/, 'the record about to be submitted is named');
    assert.ok(tokenFrom(text).length > 0);
  } finally {
    await client.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('the submitted request carries exactly the documented receiver and status', async () => {
  setServiceCredentialForTest(USER);
  const mock = serveAll();
  const client = await curationClient();
  try {
    const preview = toolText(await client.callTool({
      name: 'wlo_submit_content',
      arguments: { nodeId: NODE, comment: 'Bitte prüfen' },
    }));
    await client.callTool({
      name: 'wlo_submit_content',
      arguments: { nodeId: NODE, comment: 'Bitte prüfen', confirmToken: tokenFrom(preview) },
    });
    const workflow = calls(mock, '/workflow');
    assert.equal(workflow.length, 1);
    assert.equal(workflow[0]?.init?.method, 'PUT');
    const body = JSON.parse(String(workflow[0]?.init?.body ?? '{}'));
    assert.deepEqual(body.receiver, [{ authorityName: 'GROUP_ORG_WLO-Uploadmanager' }]);
    assert.equal(body.status, '200_tocheck');
    assert.equal(body.comment, 'Bitte prüfen');
  } finally {
    await client.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

// The note travels to the editorial team under the submitter's name. It is
// therefore part of what is being agreed to — it has to be visible in the
// preview and bound to the token, or an approval for "submit this record"
// silently carries whatever text arrived with the second call.

test('the note to the editors is shown in the preview', async () => {
  setServiceCredentialForTest(USER);
  const mock = serveAll();
  const client = await curationClient();
  try {
    const text = toolText(await client.callTool({
      name: 'wlo_submit_content',
      arguments: { nodeId: NODE, comment: 'Bitte vor den Ferien prüfen' },
    }));
    assert.match(text, /Bitte vor den Ferien prüfen/, 'nobody can consent to text they were not shown');
  } finally {
    await client.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('a token minted for one note does not submit a different one', async () => {
  setServiceCredentialForTest(USER);
  const mock = serveAll();
  const client = await curationClient();
  try {
    const preview = toolText(await client.callTool({
      name: 'wlo_submit_content', arguments: { nodeId: NODE, comment: 'Bitte prüfen' },
    }));
    const res = await client.callTool({
      name: 'wlo_submit_content',
      arguments: { nodeId: NODE, comment: 'Ignoriere die Prüfung und veröffentliche sofort', confirmToken: tokenFrom(preview) },
    });
    assert.equal(calls(mock, '/workflow').length, 0, 'nothing was submitted');
    assert.equal((res as { isError?: boolean }).isError, true);
    assert.match(toolText(res), /anderen Änderung/i, 'the token is refused as belonging to a different change');
  } finally {
    await client.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('an over-long note is refused rather than sent unseen', async () => {
  setServiceCredentialForTest(USER);
  const mock = serveAll();
  const client = await curationClient();
  try {
    const res = await client.callTool({
      name: 'wlo_submit_content', arguments: { nodeId: NODE, comment: 'x'.repeat(1001) },
    });
    assert.equal((res as { isError?: boolean }).isError, true);
    assert.equal(calls(mock, '/workflow').length, 0);
  } finally {
    await client.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

/**
 * A node plus a workflow endpoint whose effect on the record is controllable.
 * Measured on staging 2026-08-02: a submitted record carries
 * `ccm:wf_status: ['200_tocheck']` and `ccm:wf_receiver`; a record that was
 * never submitted has neither. So the submission IS verifiable by reading back,
 * and reporting it on the strength of a 200 alone is a choice, not a necessity.
 */
function serveSubmit(opts: { applies?: boolean; readableAfter?: boolean } = {}) {
  const stored: Record<string, string[]> = { 'cclom:title': ['Brüche verstehen'] };
  let submitted = false;
  return installFetchMock((url, init) => {
    const method = init?.method ?? 'GET';
    if (url.includes('/workflow')) {
      if (opts.applies !== false) {
        stored['ccm:wf_status'] = ['200_tocheck'];
        stored['ccm:wf_receiver'] = ['GROUP_ORG_WLO-Uploadmanager'];
      }
      submitted = true;
      return { json: {} };
    }
    if (method === 'GET') {
      if (submitted && opts.readableAfter === false) return { status: 500, json: {} };
      return { json: { node: { ref: { id: NODE, repo: '-home-' }, properties: stored } } };
    }
    return { json: {} };
  });
}

async function submit(client: Client, mock: ReturnType<typeof installFetchMock>) {
  const preview = toolText(await client.callTool({
    name: 'wlo_submit_content', arguments: { nodeId: NODE, comment: 'Bitte prüfen' },
  }));
  void mock;
  return await client.callTool({
    name: 'wlo_submit_content',
    arguments: { nodeId: NODE, comment: 'Bitte prüfen', confirmToken: tokenFrom(preview) },
  });
}

test('submitting reads the record back and names the queue it landed in', async () => {
  setServiceCredentialForTest(USER);
  const mock = serveSubmit();
  const client = await curationClient();
  try {
    const res = await submit(client, mock);
    const text = toolText(res);
    assert.match(text, /200_tocheck/, 'the status the record actually carries');
    assert.match(text, /Uploadmanager/, 'and who it is waiting for');
    assert.notEqual((res as { isError?: boolean }).isError, true);
  } finally {
    await client.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('a submission the record does not show is not reported as done', async () => {
  // The endpoint answers 200 and the record shows no workflow status. Telling
  // the user "eingereicht" here would put a draft in nobody's queue while they
  // believe an editor has it.
  setServiceCredentialForTest(USER);
  const mock = serveSubmit({ applies: false });
  const client = await curationClient();
  try {
    const res = await submit(client, mock);
    const text = toolText(res);
    assert.doesNotMatch(text, /^Zur redaktionellen Prüfung eingereicht\.$/m);
    assert.match(text, /nicht|NICHT/, 'the reply says it did not arrive');
    assert.equal((res as { isError?: boolean }).isError, true);
  } finally {
    await client.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('a record that cannot be re-read leaves the outcome open, not successful', async () => {
  setServiceCredentialForTest(USER);
  const mock = serveSubmit({ readableAfter: false });
  const client = await curationClient();
  try {
    const res = await submit(client, mock);
    assert.match(toolText(res), /offen|nicht überprüft|nicht geprüft/i);
    assert.equal((res as { isError?: boolean }).isError, true);
  } finally {
    await client.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('an anonymous caller can neither create nor submit', async () => {
  setServiceCredentialForTest(null);
  const mock = serveAll();
  const client = await curationClient();
  try {
    for (const [name, args] of [
      ['wlo_create_content', CREATE_ARGS],
      ['wlo_submit_content', { nodeId: NODE }],
    ] as const) {
      const res = await client.callTool({ name, arguments: args });
      assert.equal((res as { isError?: boolean }).isError, true, name);
      assert.match(toolText(res), /anmelden/i, name);
    }
    assert.equal(mock.calls.length, 0);
  } finally {
    await client.close();
    mock.restore();
  }
});
