/**
 * tools-curation-update.test.ts – the first tool that changes someone's data.
 *
 * The load-bearing assertion is the first one, and it is deliberately made
 * against the RECORDED UPSTREAM CALLS rather than against the reply text: a
 * tool that says "nothing was written" while having written is exactly the
 * failure this two-step exists to prevent, and reply text cannot detect it.
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

const USER: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };
const NODE = 'node-1';

const STORED: Record<string, string[]> = {
  'cclom:title': ['Bruchrechnung Klasse 6'],
  'cclom:general_keyword': ['Mathematik'],
};

async function curationClient(): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerCurationContentTools(server, 'Bearer error="invalid_request"');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), client.connect(ct)]);
  return client;
}

/** Serve the node's metadata on GET; answer any write with `ok`. */
function serve(stored: Record<string, string[]> = STORED, onWrite?: (url: string) => MockResult) {
  return installFetchMock((url, init) => {
    if ((init?.method ?? 'GET') === 'GET') {
      return { json: { node: { ref: { id: NODE, repo: '-home-' }, properties: stored } } };
    }
    return onWrite ? onWrite(url) : { json: {} };
  });
}

function writeCalls(calls: Array<{ url: string; init?: RequestInit }>) {
  return calls.filter(c => (c.init?.method ?? 'GET') !== 'GET');
}

/** Pull the confirmation token out of the preview reply. */
function tokenFrom(text: string): string {
  const m = /confirmToken[^\w-]*([A-Za-z0-9_-]{20,})/.exec(text);
  assert.ok(m, `no token in reply:\n${text}`);
  return m[1]!;
}

test('a call without a token writes nothing at all', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve();
  const client = await curationClient();
  try {
    const res = await client.callTool({
      name: 'wlo_update_content',
      arguments: { nodeId: NODE, title: 'Brüche verstehen' },
    });
    assert.equal(writeCalls(mock.calls).length, 0, 'not one write request left this server');
    const text = toolText(res);
    assert.match(text, /Bruchrechnung Klasse 6/, 'the preview names the old value');
    assert.match(text, /Brüche verstehen/, 'and the new one');
    assert.ok(tokenFrom(text).length > 0);
  } finally {
    await client.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('the token from the preview performs the write', async () => {
  setServiceCredentialForTest(USER);
  const written: Record<string, string[]> = { ...STORED };
  const mock = installFetchMock((_url, init) => {
    if ((init?.method ?? 'GET') === 'GET') {
      return { json: { node: { ref: { id: NODE, repo: '-home-' }, properties: written } } };
    }
    Object.assign(written, JSON.parse(String(init?.body ?? '{}')));
    return { json: {} };
  });
  const client = await curationClient();
  try {
    const preview = toolText(await client.callTool({
      name: 'wlo_update_content',
      arguments: { nodeId: NODE, title: 'Brüche verstehen' },
    }));
    const res = await client.callTool({
      name: 'wlo_update_content',
      arguments: { nodeId: NODE, title: 'Brüche verstehen', confirmToken: tokenFrom(preview) },
    });
    assert.equal(writeCalls(mock.calls).length, 1, 'exactly one write for one MDS field');
    assert.deepEqual(written['cclom:title'], ['Brüche verstehen']);
    assert.match(toolText(res), /gespeichert/i);
    assert.notEqual((res as { isError?: boolean }).isError, true);
  } finally {
    await client.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('a token is single use — a replay writes nothing more', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve();
  const client = await curationClient();
  try {
    const token = tokenFrom(toolText(await client.callTool({
      name: 'wlo_update_content', arguments: { nodeId: NODE, title: 'Neu' },
    })));
    await client.callTool({ name: 'wlo_update_content', arguments: { nodeId: NODE, title: 'Neu', confirmToken: token } });
    const before = writeCalls(mock.calls).length;
    const replay = await client.callTool({
      name: 'wlo_update_content', arguments: { nodeId: NODE, title: 'Neu', confirmToken: token },
    });
    assert.equal(writeCalls(mock.calls).length, before, 'the replay wrote nothing');
    assert.equal((replay as { isError?: boolean }).isError, true);
  } finally {
    await client.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('a token minted for one edit does not authorise a different one', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve();
  const client = await curationClient();
  try {
    const token = tokenFrom(toolText(await client.callTool({
      name: 'wlo_update_content', arguments: { nodeId: NODE, title: 'Harmlose Korrektur' },
    })));
    const res = await client.callTool({
      name: 'wlo_update_content',
      arguments: { nodeId: NODE, title: 'Etwas ganz anderes', confirmToken: token },
    });
    assert.equal(writeCalls(mock.calls).length, 0);
    assert.equal((res as { isError?: boolean }).isError, true);
    assert.match(toolText(res), /wiederholen|erneut/i, 'the user is told to preview again');
    assert.match(toolText(res), /nichts geschrieben/i, 'and that nothing happened');
  } finally {
    await client.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('a token minted for a draft edit does not authorise a version commit', async () => {
  // `commit: true` turns the same values into a new entry in the record's public
  // version history, with a free-text comment. The preview said nothing about
  // either, so the token must not carry them.
  setServiceCredentialForTest(USER);
  const mock = serve();
  const client = await curationClient();
  try {
    const token = tokenFrom(toolText(await client.callTool({
      name: 'wlo_update_content', arguments: { nodeId: NODE, title: 'Neu' },
    })));
    const res = await client.callTool({
      name: 'wlo_update_content',
      arguments: { nodeId: NODE, title: 'Neu', commit: true, versionComment: 'Freigabe', confirmToken: token },
    });
    assert.equal(writeCalls(mock.calls).length, 0, 'nothing was written');
    assert.equal((res as { isError?: boolean }).isError, true);
  } finally {
    await client.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('a commit is announced in the preview it is confirmed from', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve();
  const client = await curationClient();
  try {
    const preview = toolText(await client.callTool({
      name: 'wlo_update_content',
      arguments: { nodeId: NODE, title: 'Neu', commit: true, versionComment: 'Freigabe' },
    }));
    assert.match(preview, /Version/i, 'the curator is told a version will be created');
    assert.match(preview, /Freigabe/, 'and with which comment');
  } finally {
    await client.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('a silently dropped field is reported as not saved, with no claim of success', async () => {
  setServiceCredentialForTest(USER);
  // The repository answers 200 and keeps the old value — the measured shape of
  // an MDS filter, a missing aspect, or a missing right.
  const mock = serve(STORED);
  const client = await curationClient();
  try {
    const token = tokenFrom(toolText(await client.callTool({
      name: 'wlo_update_content', arguments: { nodeId: NODE, title: 'Brüche verstehen' },
    })));
    const res = await client.callTool({
      name: 'wlo_update_content',
      arguments: { nodeId: NODE, title: 'Brüche verstehen', confirmToken: token },
    });
    const text = toolText(res);
    assert.match(text, /nicht gespeichert/i, 'the failure is named plainly');
    assert.match(text, /Titel/, 'and the field it concerns');
    assert.doesNotMatch(text, /erfolgreich gespeichert/i, 'no success claim anywhere');
  } finally {
    await client.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('an invalid licence is refused before anything is read or written', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve();
  const client = await curationClient();
  try {
    const res = await client.callTool({
      name: 'wlo_update_content',
      arguments: { nodeId: NODE, licenseKey: 'Universität Hamburg' },
    });
    assert.equal((res as { isError?: boolean }).isError, true);
    assert.match(toolText(res), /Universität Hamburg/);
    assert.equal(writeCalls(mock.calls).length, 0);
  } finally {
    await client.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('an edit that changes nothing says so instead of minting a token', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve();
  const client = await curationClient();
  try {
    const res = await client.callTool({
      name: 'wlo_update_content',
      arguments: { nodeId: NODE, title: 'Bruchrechnung Klasse 6' },
    });
    const text = toolText(res);
    assert.match(text, /Keine Änderung/i);
    assert.doesNotMatch(text, /confirmToken/);
    assert.equal(writeCalls(mock.calls).length, 0);
  } finally {
    await client.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('without an identity the tool refuses even when it is called', async () => {
  setServiceCredentialForTest(null);
  const mock = serve();
  const client = await curationClient();
  try {
    const res = await client.callTool({ name: 'wlo_update_content', arguments: { nodeId: NODE, title: 'Neu' } });
    assert.equal((res as { isError?: boolean }).isError, true);
    assert.match(toolText(res), /anmelden/i);
    assert.equal(mock.calls.length, 0, 'not even the node was read');
  } finally {
    await client.close();
    mock.restore();
  }
});

test('a content type the repository cannot aggregate is flagged in the preview', async () => {
  // Accepted, but the curator learns before confirming that material tagged
  // only with this will not appear under the aggregated content-type facets.
  setServiceCredentialForTest(USER);
  const mock = serve();
  const client = await curationClient();
  try {
    const text = toolText(await client.callTool({
      name: 'wlo_update_content',
      arguments: { nodeId: NODE, contentType: 'Unterrichtsplanung' },
    }));
    assert.match(text, /Unterrichtsplanung/);
    assert.match(text, /aggregiert/i, 'the consequence is named, not just the term');
    assert.ok(tokenFrom(text).length > 0, 'and it is still confirmable');
    assert.equal(writeCalls(mock.calls).length, 0);
  } finally {
    await client.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('an unknown content type is refused with near misses', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve();
  const client = await curationClient();
  try {
    const res = await client.callTool({
      name: 'wlo_update_content',
      arguments: { nodeId: NODE, contentType: 'Arbeitsblat' },
    });
    assert.equal((res as { isError?: boolean }).isError, true);
    assert.match(toolText(res), /Arbeitsblatt/, 'the near miss is offered');
    assert.equal(writeCalls(mock.calls).length, 0);
  } finally {
    await client.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('a timed-out edit says the outcome is open, not that nothing was saved', async () => {
  // The same rule the create and the delete paths follow: an abort hits the
  // response, not the work. "Konnte nicht bearbeitet werden" would send the
  // curator to redo an edit that may already be in the record.
  setServiceCredentialForTest(USER);
  const mock = installFetchMock((_url, init) => {
    if ((init?.method ?? 'GET') === 'GET') {
      return { json: { node: { ref: { id: NODE, repo: '-home-' }, properties: STORED } } };
    }
    throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  });
  const client = await curationClient();
  try {
    const preview = toolText(await client.callTool({
      name: 'wlo_update_content', arguments: { nodeId: NODE, title: 'Brüche verstehen' },
    }));
    const res = await client.callTool({
      name: 'wlo_update_content',
      arguments: { nodeId: NODE, title: 'Brüche verstehen', confirmToken: tokenFrom(preview) },
    });
    const text = toolText(res);
    assert.match(text, /offen/i, 'the outcome is stated as open');
    assert.match(text, /nachsehen/i, 'and the curator is sent to look');
    assert.doesNotMatch(text, /^Der Datensatz konnte nicht bearbeitet werden/,
      'never a bare claim that the edit did not happen');
  } finally {
    await client.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('an edit the repository refused is still reported as a plain failure', async () => {
  // The open-outcome wording must not swallow the case where the repository
  // answered and said no — that one really did change nothing.
  setServiceCredentialForTest(USER);
  const mock = installFetchMock((_url, init) => {
    if ((init?.method ?? 'GET') === 'GET') {
      return { json: { node: { ref: { id: NODE, repo: '-home-' }, properties: STORED } } };
    }
    return { status: 403, json: {} };
  });
  const client = await curationClient();
  try {
    const preview = toolText(await client.callTool({
      name: 'wlo_update_content', arguments: { nodeId: NODE, title: 'Brüche verstehen' },
    }));
    const text = toolText(await client.callTool({
      name: 'wlo_update_content',
      arguments: { nodeId: NODE, title: 'Brüche verstehen', confirmToken: tokenFrom(preview) },
    }));
    assert.match(text, /403|abgelehnt/i);
    assert.doesNotMatch(text, /ist offen/i, 'a refusal is not an open outcome');
  } finally {
    await client.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('the tool declares itself as writing, not read-only', async () => {
  const client = await curationClient();
  try {
    const { tools } = await client.listTools();
    const tool = tools.find(t => t.name === 'wlo_update_content');
    assert.ok(tool);
    assert.equal(tool.annotations?.readOnlyHint, false);
  } finally {
    await client.close();
  }
});
