/**
 * tools-curation-compendium.test.ts – the collection's editorial prose.
 *
 * `ccm:oeh_collection_compendium_text` is not in the metadata set. `PUT
 * …/metadata` answers 200 for it and stores nothing — measured — so the only
 * route that works is the property endpoint. That is the assertion that matters
 * here; everything else follows the two-step pattern the other tools use.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { registerCurationCompendiumTool } from '../src/tools/curation-compendium.js';
import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { installFetchMock, toolText } from './fetchMock.js';

const USER: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };
const COLLECTION = 'coll-1';
const PROPERTY = 'ccm:oeh_collection_compendium_text';

async function client(): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerCurationCompendiumTool(server, 'Bearer error="invalid_request"');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  return c;
}

/** A collection whose stored properties follow whatever the tool writes. */
function serve(initial: string | null = null) {
  const stored: Record<string, string[]> = { 'cm:title': ['Bruchrechnung'] };
  if (initial !== null) stored[PROPERTY] = [initial];
  return installFetchMock((url, init) => {
    if ((init?.method ?? 'GET') === 'GET') {
      return { json: { node: { ref: { id: COLLECTION, repo: '-home-' }, properties: stored } } };
    }
    if (url.includes('/property')) {
      const value = JSON.parse(String(init?.body ?? 'null')) as string[] | null;
      if (value === null) delete stored[PROPERTY];
      else stored[PROPERTY] = value;
    }
    return { json: {} };
  });
}

const writes = (m: ReturnType<typeof installFetchMock>) =>
  m.calls.filter(c => (c.init?.method ?? 'GET') !== 'GET');

function tokenFrom(text: string): string {
  const m = /confirmToken[^\w-]*([A-Za-z0-9_-]{20,})/.exec(text);
  assert.ok(m, `no token in reply:\n${text}`);
  return m[1]!;
}

test('the text goes through the property endpoint, never the metadata one', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve();
  const c = await client();
  try {
    const preview = toolText(await c.callTool({
      name: 'wlo_update_compendium', arguments: { nodeId: COLLECTION, text: '# Überblick' },
    }));
    await c.callTool({
      name: 'wlo_update_compendium',
      arguments: { nodeId: COLLECTION, text: '# Überblick', confirmToken: tokenFrom(preview) },
    });
    const w = writes(mock);
    assert.equal(w.length, 1);
    const url = new URL(w[0]!.url);
    assert.match(url.pathname, /\/property$/);
    assert.equal(url.searchParams.get('property'), PROPERTY);
    assert.deepEqual(JSON.parse(String(w[0]!.init?.body ?? 'null')), ['# Überblick']);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('no token, no write', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve();
  const c = await client();
  try {
    const text = toolText(await c.callTool({
      name: 'wlo_update_compendium', arguments: { nodeId: COLLECTION, text: '# Überblick' },
    }));
    assert.equal(writes(mock).length, 0);
    assert.ok(tokenFrom(text).length > 0);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('replacing an existing text shows the old one in the preview', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve('# Alter Text');
  const c = await client();
  try {
    const text = toolText(await c.callTool({
      name: 'wlo_update_compendium', arguments: { nodeId: COLLECTION, text: '# Neuer Text' },
    }));
    assert.match(text, /Alter Text/);
    assert.match(text, /Neuer Text/);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('deleting sends null and says the collection itself stays', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve('# Alter Text');
  const c = await client();
  try {
    const preview = toolText(await c.callTool({
      name: 'wlo_update_compendium', arguments: { nodeId: COLLECTION, remove: true },
    }));
    assert.match(preview, /Sammlung selbst bleibt/i, 'the scope of the deletion is stated');
    await c.callTool({
      name: 'wlo_update_compendium',
      arguments: { nodeId: COLLECTION, remove: true, confirmToken: tokenFrom(preview) },
    });
    const w = writes(mock);
    assert.equal(w.length, 1);
    assert.equal(JSON.parse(String(w[0]!.init?.body ?? '"x"')), null, 'null is what deletes the property');
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('a read-back mismatch is reported as not saved', async () => {
  setServiceCredentialForTest(USER);
  // The repository answers 200 and keeps the old value — the silent drop.
  const stored: Record<string, string[]> = { 'cm:title': ['Bruchrechnung'], [PROPERTY]: ['# Alt'] };
  const mock = installFetchMock((url, init) => {
    if ((init?.method ?? 'GET') === 'GET') {
      return { json: { node: { ref: { id: COLLECTION, repo: '-home-' }, properties: stored } } };
    }
    return { json: {} };
  });
  const c = await client();
  try {
    const preview = toolText(await c.callTool({
      name: 'wlo_update_compendium', arguments: { nodeId: COLLECTION, text: '# Neu' },
    }));
    const res = await c.callTool({
      name: 'wlo_update_compendium',
      arguments: { nodeId: COLLECTION, text: '# Neu', confirmToken: tokenFrom(preview) },
    });
    assert.match(toolText(res), /nicht gespeichert/i);
    assert.equal((res as { isError?: boolean }).isError, true);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('a removal whose check could not run is reported as open, not as removed', async () => {
  // `getNodeMetadata` folds every non-OK status into null, so an unreadable
  // read-back looked exactly like "the property is gone". Saying "entfernt"
  // over a check that never ran is the one claim this pipeline exists to stop.
  setServiceCredentialForTest(USER);
  let written = false;
  const mock = installFetchMock((_url, init) => {
    if ((init?.method ?? 'GET') !== 'GET') { written = true; return { json: {} }; }
    // Reads before the write plan the removal; the read-back afterwards fails.
    if (written) return { status: 503, json: {} };
    return {
      json: {
        node: {
          ref: { id: COLLECTION, repo: '-home-' },
          properties: { 'cm:title': ['Bruchrechnung'], [PROPERTY]: ['# Überblick'] },
        },
      },
    };
  });
  const c = await client();
  try {
    const preview = toolText(await c.callTool({
      name: 'wlo_update_compendium', arguments: { nodeId: COLLECTION, remove: true },
    }));
    const res = await c.callTool({
      name: 'wlo_update_compendium',
      arguments: { nodeId: COLLECTION, remove: true, confirmToken: tokenFrom(preview) },
    });
    assert.equal((res as { isError?: boolean }).isError, true);
    assert.doesNotMatch(toolText(res), /entfernt\./, 'never claims the removal happened');
    assert.match(toolText(res), /offen|überprüf/i);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('either a text or an explicit removal is required', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve();
  const c = await client();
  try {
    const res = await c.callTool({ name: 'wlo_update_compendium', arguments: { nodeId: COLLECTION } });
    assert.equal((res as { isError?: boolean }).isError, true);
    assert.equal(mock.calls.length, 0);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('an anonymous caller is refused before anything is read', async () => {
  setServiceCredentialForTest(null);
  const mock = serve();
  const c = await client();
  try {
    const res = await c.callTool({
      name: 'wlo_update_compendium', arguments: { nodeId: COLLECTION, text: '# X' },
    });
    assert.equal((res as { isError?: boolean }).isError, true);
    assert.match(toolText(res), /anmelden/i);
    assert.equal(mock.calls.length, 0);
  } finally {
    await c.close();
    mock.restore();
  }
});
