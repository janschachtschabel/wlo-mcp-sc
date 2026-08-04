/**
 * tools-curation-collections.test.ts – curating collections.
 *
 * The assertion that earns its place: taking material OUT of a collection must
 * never reach the node endpoint. "Remove from collection" and "delete the
 * material" are one path segment apart and easy to confuse in a conversation,
 * so the wording of the tools and the endpoint they hit are both pinned.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { registerCurationCollectionTools } from '../src/tools/curation-collections.js';
import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { installFetchMock, toolText } from './fetchMock.js';

const USER: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };
const COLLECTION = 'coll-1';
const NODE = 'node-1';
/** The reference the collection holds for NODE — a different id, and the one a removal must delete. */
const REFERENCE = 'ref-1';

async function client(): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerCurationCollectionTools(server);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  return c;
}

/**
 * A repository that accepts the mutation AND shows it afterwards.
 *
 * The second half is what makes this the happy path. Each of these calls answers
 * `200` on its own — which is exactly what a silently discarded write looks
 * like — so a mock that only answered the mutation would let every test here
 * claim a success the code is not entitled to claim.
 *
 * @param titles  what `cm:title` a collection reports when it is read back
 * @param usage   which collections the usage endpoint lists for the material
 */
function serve(
  titles: Record<string, string> = { [COLLECTION]: 'Bruchrechnung', 'neu-1': 'Bruchrechnung' },
  usage: string[] = [COLLECTION],
) {
  // A removal is confirmed by re-reading the reference node, so the mock has to
  // stop serving it once it was deleted — otherwise every happy-path removal
  // reads back as "still there" and no test could ever see a success.
  let referenceDeleted = false;
  return installFetchMock((url, init) => {
    const method = init?.method ?? 'GET';
    if (method === 'DELETE' && url.includes(`/references/${REFERENCE}`)) referenceDeleted = true;
    if (method === 'GET') {
      if (referenceDeleted && url.includes(REFERENCE)) return { status: 404, json: {} };
      if (url.includes('/usage/v1/')) {
        return { json: usage.map(id => ({ collectionUsageType: 'ACTIVE', collection: { ref: { id } } })) };
      }
      // A collection holds a REFERENCE node with its own id, and a removal has
      // to resolve that before it can delete anything — measured, the delete
      // with the original id answers 200 and removes nothing.
      if (url.includes('/children')) {
        const nodes = [{ ref: { id: REFERENCE, repo: '-home-' }, properties: { 'ccm:original': [NODE] } }];
        return { json: { nodes, pagination: { total: 1, from: 0, count: 1 } } };
      }
      const id = Object.keys(titles).find(k => url.includes(k));
      if (id) {
        return { json: { node: { ref: { id, repo: '-home-' }, properties: { 'cm:title': [titles[id]!] } } } };
      }
      return {
        json: {
          node: { ref: { id: NODE, repo: '-home-' }, properties: { 'cclom:title': ['Arbeitsblatt Brüche'] } },
        },
      };
    }
    return { json: { collection: { ref: { id: 'neu-1' } } } };
  });
}

/** Assert a tool reply is not an error, showing its text when it is. */
function succeeded(res: unknown): string {
  const text = toolText(res);
  assert.notEqual((res as { isError?: boolean }).isError, true, `reported an error:\n${text}`);
  return text;
}

const writes = (m: ReturnType<typeof installFetchMock>) =>
  m.calls.filter(c => (c.init?.method ?? 'GET') !== 'GET');

function tokenFrom(text: string): string {
  const m = /confirmToken[^\w-]*([A-Za-z0-9_-]{20,})/.exec(text);
  assert.ok(m, `no token in reply:\n${text}`);
  return m[1]!;
}

/** Run a tool through preview → confirm and return the confirmed reply. */
async function confirmed(c: Client, name: string, args: Record<string, unknown>): Promise<unknown> {
  const preview = toolText(await c.callTool({ name, arguments: args }));
  return await c.callTool({ name, arguments: { ...args, confirmToken: tokenFrom(preview) } });
}

test('creating a collection is two-step and reports the new id', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve();
  const c = await client();
  try {
    const preview = toolText(await c.callTool({
      name: 'wlo_create_collection', arguments: { title: 'Bruchrechnung' },
    }));
    assert.equal(writes(mock).length, 0, 'the preview creates nothing');
    assert.match(preview, /Bruchrechnung/);

    const done = succeeded(await c.callTool({
      name: 'wlo_create_collection',
      arguments: { title: 'Bruchrechnung', confirmToken: tokenFrom(preview) },
    }));
    assert.equal(writes(mock).length, 1);
    assert.match(done, /neu-1/);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('a sub-collection names its parent in the request', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve({ [COLLECTION]: 'Bruchrechnung', 'neu-1': 'Brüche kürzen' });
  const c = await client();
  try {
    succeeded(await confirmed(c, 'wlo_create_collection', { title: 'Brüche kürzen', parentId: COLLECTION }));
    assert.match(writes(mock)[0]?.url ?? '', new RegExp(`/collections/-home-/${COLLECTION}/children`));
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('renaming shows the old and the new title before it happens', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve();
  const c = await client();
  try {
    const preview = toolText(await c.callTool({
      name: 'wlo_rename_collection', arguments: { nodeId: COLLECTION, title: 'Brüche' },
    }));
    assert.equal(writes(mock).length, 0);
    assert.match(preview, /Bruchrechnung/);
    assert.match(preview, /Brüche/);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('adding material to a collection sends no body', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve();
  const c = await client();
  try {
    succeeded(await confirmed(c, 'wlo_add_to_collection', { collectionId: COLLECTION, nodeId: NODE }));
    const w = writes(mock)[0];
    assert.equal(w?.init?.method, 'PUT');
    assert.equal(w?.init?.body, undefined);
    assert.match(w?.url ?? '', new RegExp(`/collections/-home-/${COLLECTION}/references/${NODE}`));
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('removing material targets the reference, never the material itself', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve(undefined, []);
  const c = await client();
  try {
    succeeded(await confirmed(c, 'wlo_remove_from_collection', { collectionId: COLLECTION, nodeId: NODE }));
    const w = writes(mock).filter(x => x.init?.method === 'DELETE')[0];
    assert.ok(w);
    assert.match(w.url, /\/collection\/v1\/collections\//);
    assert.match(w.url, new RegExp(`/references/${REFERENCE}$`), 'the reference node, not the material');
    assert.doesNotMatch(w.url, /\/node\/v1\/nodes\//, 'the material itself is untouched');
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('a reference the collection does not show afterwards is not reported as done', async () => {
  // The reply a curator reads must come from the record, not from the status
  // code — this endpoint answers 200 whether or not the reference was filed.
  setServiceCredentialForTest(USER);
  const mock = serve(undefined, []);
  const c = await client();
  try {
    const res = await confirmed(c, 'wlo_add_to_collection', { collectionId: COLLECTION, nodeId: NODE });
    assert.equal((res as { isError?: boolean }).isError, true);
    assert.match(toolText(res), /nachsehen/i);
    assert.doesNotMatch(toolText(res), /ist jetzt in/, 'and never says it landed');
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('a rename the collection does not show afterwards is not reported as done', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve({ [COLLECTION]: 'Bruchrechnung' });
  const c = await client();
  try {
    const res = await confirmed(c, 'wlo_rename_collection', { nodeId: COLLECTION, title: 'Brüche' });
    assert.equal((res as { isError?: boolean }).isError, true);
    assert.doesNotMatch(toolText(res), /heißt jetzt/);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('a rename the collection does show is reported plainly', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve({ [COLLECTION]: 'Brüche' });
  const c = await client();
  try {
    const text = succeeded(await confirmed(c, 'wlo_rename_collection', { nodeId: COLLECTION, title: 'Brüche' }));
    assert.match(text, /heißt jetzt „Brüche“/);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('the removal preview says the material itself survives', async () => {
  // Someone reading "entfernen" must not fear they are destroying the material.
  setServiceCredentialForTest(USER);
  const mock = serve();
  const c = await client();
  try {
    const preview = toolText(await c.callTool({
      name: 'wlo_remove_from_collection', arguments: { collectionId: COLLECTION, nodeId: NODE },
    }));
    assert.match(preview, /bleibt|nicht gelöscht/i);
    assert.match(preview, /Arbeitsblatt Brüche/, 'and names what is being removed');
    assert.equal(writes(mock).length, 0);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('the create preview shows the description that will be written', async () => {
  // The description is written to the record; a preview that does not name it
  // asks the curator to approve text they were never shown.
  setServiceCredentialForTest(USER);
  const mock = serve();
  const c = await client();
  try {
    const preview = toolText(await c.callTool({
      name: 'wlo_create_collection',
      arguments: { title: 'Bruchrechnung', description: 'Alles zu Brüchen.' },
    }));
    assert.match(preview, /Alles zu Brüchen\./);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('a token minted for one description does not authorise another', async () => {
  // The token binds the change, not the intent. Without the description inside
  // it, an approved "create Bruchrechnung" would carry any text at all.
  setServiceCredentialForTest(USER);
  const mock = serve();
  const c = await client();
  try {
    const preview = toolText(await c.callTool({
      name: 'wlo_create_collection',
      arguments: { title: 'Bruchrechnung', description: 'Harmlos.' },
    }));
    const res = await c.callTool({
      name: 'wlo_create_collection',
      arguments: { title: 'Bruchrechnung', description: 'Etwas ganz anderes.', confirmToken: tokenFrom(preview) },
    });
    assert.equal((res as { isError?: boolean }).isError, true);
    assert.match(toolText(res), /andere[nr]? Änderung|nichts geschrieben/i);
    assert.equal(writes(mock).length, 0, 'and nothing was created');
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('the rename preview shows the description it would overwrite', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve();
  const c = await client();
  try {
    const preview = toolText(await c.callTool({
      name: 'wlo_rename_collection',
      arguments: { nodeId: COLLECTION, title: 'Brüche', description: 'Neue Beschreibung.' },
    }));
    assert.match(preview, /Neue Beschreibung\./);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('an over-long collection title is refused before anything happens', async () => {
  // Every other written field passes validateField, which bounds its length.
  // The collection title reached the repository unchecked; stdio has no body cap.
  setServiceCredentialForTest(USER);
  const mock = serve();
  const c = await client();
  try {
    const res = await c.callTool({
      name: 'wlo_create_collection', arguments: { title: 'x'.repeat(300) },
    });
    assert.equal((res as { isError?: boolean }).isError, true);
    assert.match(toolText(res), /zu lang/i);
    assert.equal(writes(mock).length, 0);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('no collection mutation happens without a token', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve();
  const c = await client();
  try {
    for (const [name, args] of [
      ['wlo_create_collection', { title: 'X' }],
      ['wlo_rename_collection', { nodeId: COLLECTION, title: 'X' }],
      ['wlo_add_to_collection', { collectionId: COLLECTION, nodeId: NODE }],
      ['wlo_remove_from_collection', { collectionId: COLLECTION, nodeId: NODE }],
    ] as const) {
      await c.callTool({ name, arguments: args });
    }
    assert.equal(writes(mock).length, 0, 'four previews, zero writes');
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('a failed collection call is reported as a failure', async () => {
  setServiceCredentialForTest(USER);
  const mock = installFetchMock((_url, init) => {
    if ((init?.method ?? 'GET') === 'GET') {
      return { json: { node: { ref: { id: COLLECTION }, properties: { 'cm:title': ['Bruchrechnung'] } } } };
    }
    return { status: 403, json: {} };
  });
  const c = await client();
  try {
    const preview = toolText(await c.callTool({
      name: 'wlo_add_to_collection', arguments: { collectionId: COLLECTION, nodeId: NODE },
    }));
    const res = await c.callTool({
      name: 'wlo_add_to_collection',
      arguments: { collectionId: COLLECTION, nodeId: NODE, confirmToken: tokenFrom(preview) },
    });
    assert.equal((res as { isError?: boolean }).isError, true);
    assert.match(toolText(res), /403/);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('an anonymous caller can do none of it', async () => {
  setServiceCredentialForTest(null);
  const mock = serve();
  const c = await client();
  try {
    const res = await c.callTool({ name: 'wlo_create_collection', arguments: { title: 'X' } });
    assert.equal((res as { isError?: boolean }).isError, true);
    assert.match(toolText(res), /anmelden/i);
    assert.equal(mock.calls.length, 0);
  } finally {
    await c.close();
    mock.restore();
  }
});

test('none of these tools is marked destructive — deleting is a different tool', async () => {
  const c = await client();
  try {
    const { tools } = await c.listTools();
    assert.equal(tools.length, 4, 'create, rename, add, remove — no delete here');
    for (const t of tools) {
      assert.equal(t.annotations?.readOnlyHint, false, t.name);
      assert.equal(t.annotations?.destructiveHint, false, t.name);
    }
  } finally {
    await c.close();
  }
});
