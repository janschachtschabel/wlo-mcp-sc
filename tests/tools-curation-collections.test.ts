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
import { installFetchMock, toolText, type MockResult } from './fetchMock.js';

const USER: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };
const COLLECTION = 'coll-1';
const NODE = 'node-1';
/** The reference the collection holds for NODE — a different id, and the one a removal must delete. */
const REFERENCE = 'ref-1';

async function client(): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerCurationCollectionTools(server, 'Bearer error="invalid_request"');
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
function serveHandler(
  titles: Record<string, string> = { [COLLECTION]: 'Bruchrechnung', 'neu-1': 'Bruchrechnung' },
  usage: string[] = [COLLECTION],
  /** `collectionType`: what the "collection" really is; `originalOf`: the material id is a reference to this record. */
  opts: { collectionType?: string; collectionAspects?: string[]; originalOf?: string; alreadyFiled?: boolean } = {},
) {
  // A removal is confirmed by re-reading the reference node, so the mock has to
  // stop serving it once it was deleted — otherwise every happy-path removal
  // reads back as "still there" and no test could ever see a success.
  let referenceDeleted = false;
  // The usage endpoint lists the collection only once the filing was SENT (or
  // from the start, `alreadyFiled`) — the tool asks it before the preview too.
  let filed = opts.alreadyFiled ?? false;
  return (url: string, init?: RequestInit): MockResult => {
    const method = init?.method ?? 'GET';
    if (method === 'PUT' && url.includes('/references/')) filed = true;
    if (method === 'DELETE' && url.includes(`/references/${REFERENCE}`)) referenceDeleted = true;
    if (method === 'GET') {
      if (referenceDeleted && url.includes(REFERENCE)) return { status: 404, json: {} };
      if (url.includes('/usage/v1/')) {
        return { json: (filed ? usage : []).map(id => ({ collectionUsageType: 'ACTIVE', collection: { ref: { id } } })) };
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
        return { json: { node: { ref: { id, repo: '-home-' }, type: opts.collectionType ?? 'ccm:map', aspects: opts.collectionAspects ?? ['ccm:collection'], properties: { 'cm:title': [titles[id]!] } } } };
      }
      return {
        json: {
          node: { ref: { id: NODE, repo: '-home-' }, type: 'ccm:io', ...(opts.originalOf ? { originalId: opts.originalOf } : {}),
            properties: { 'cclom:title': ['Arbeitsblatt Brüche'] } },
        },
      };
    }
    return { json: { collection: { ref: { id: 'neu-1' } } } };
  };
}

const serve = (...args: Parameters<typeof serveHandler>) => installFetchMock(serveHandler(...args));

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
  const mock = installFetchMock((url, init) => {
    if ((init?.method ?? 'GET') === 'GET') {
      if (url.includes('/usage/v1/')) return { json: [] };
      return url.includes(COLLECTION)
        ? { json: { node: { ref: { id: COLLECTION }, type: 'ccm:map', aspects: ['ccm:collection'], properties: { 'cm:title': ['Bruchrechnung'] } } } }
        : { json: { node: { ref: { id: NODE }, type: 'ccm:io', properties: { 'cm:title': ['Arbeitsblatt'] } } } };
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

// ── audit 2026-11-12, K-11: the same target checks the batch tool applies ────

const errorCode = (r: unknown) => (r as { structuredContent?: { error?: { code?: string } } }).structuredContent?.error?.code;
const mutations = (m: ReturnType<typeof installFetchMock>) => m.calls.filter(c => (c.init?.method ?? 'GET') !== 'GET');

for (const [name, args] of [
  ['wlo_add_to_collection', { collectionId: COLLECTION, nodeId: NODE }],
  ['wlo_remove_from_collection', { collectionId: COLLECTION, nodeId: NODE }],
  ['wlo_rename_collection', { nodeId: COLLECTION, title: 'Neu' }],
] as const) {
  test(`${name}: a "collection" that is a record is refused as not_a_collection (audit K-11)`, async () => {
    setServiceCredentialForTest(USER);
    const mock = serve(undefined, undefined, { collectionType: 'ccm:io' });
    const c = await client();
    try {
      const r = await c.callTool({ name, arguments: args });
      assert.equal(r.isError, true);
      assert.equal(errorCode(r), 'not_a_collection');
      assert.doesNotMatch(toolText(r), /confirmToken/);
      assert.equal(mutations(mock).length, 0);
    } finally {
      await c.close();
      mock.restore();
      setServiceCredentialForTest(null);
    }
  });
}

test('adding through a reference id files the ORIGINAL, and the preview says so (audit K-11)', async () => {
  setServiceCredentialForTest(USER);
  // NODE is a reference to 'original-9' — what a listing of another collection hands out.
  const mock = serve(undefined, ['other'], { originalOf: 'original-9' });
  const c = await client();
  try {
    const preview = toolText(await c.callTool({ name: 'wlo_add_to_collection', arguments: { collectionId: COLLECTION, nodeId: NODE } }));
    assert.match(preview, /original-9/, 'the approval names the record that is filed');
    await c.callTool({ name: 'wlo_add_to_collection', arguments: { collectionId: COLLECTION, nodeId: NODE, confirmToken: tokenFrom(preview) } });
    const puts = mock.calls.filter(x => x.init?.method === 'PUT');
    assert.equal(puts.length, 1);
    assert.match(puts[0]!.url, /\/references\/original-9/, 'the original is filed, as the batch tool does');
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

// ── review of audit package 2 ────────────────────────────────────────────────

for (const [name, args] of [
  ['wlo_add_to_collection', { collectionId: COLLECTION, nodeId: NODE }],
  ['wlo_remove_from_collection', { collectionId: COLLECTION, nodeId: NODE }],
  ['wlo_rename_collection', { nodeId: COLLECTION, title: 'Neu' }],
] as const) {
  test(`${name}: a folder is not a collection — ccm:map alone does not make one (measured 2026-11-12)`, async () => {
    setServiceCredentialForTest(USER);
    const mock = serve(undefined, undefined, { collectionAspects: ['ccm:mapdata'] });
    const c = await client();
    try {
      const r = await c.callTool({ name, arguments: args });
      assert.equal(r.isError, true);
      assert.equal(errorCode(r), 'not_a_collection');
      assert.match(toolText(r), /Ordner/);
      assert.equal(mutations(mock).length, 0);
    } finally {
      await c.close();
      mock.restore();
      setServiceCredentialForTest(null);
    }
  });
}

for (const name of ['wlo_add_to_collection', 'wlo_remove_from_collection']) {
  test(`${name}: the MATERIAL side is checked too — a collection is not filed as a record`, async () => {
    setServiceCredentialForTest(USER);
    // Both ids resolve to a collection: `serve` answers every id in `titles` as one.
    const mock = serve({ [COLLECTION]: 'Bruchrechnung', [NODE]: 'Eine Sammlung' });
    const c = await client();
    try {
      const r = await c.callTool({ name, arguments: { collectionId: COLLECTION, nodeId: NODE } });
      assert.equal(r.isError, true);
      assert.equal(errorCode(r), 'is_a_collection');
      assert.equal(mutations(mock).length, 0);
    } finally {
      await c.close();
      mock.restore();
      setServiceCredentialForTest(null);
    }
  });
}

test('adding what the collection already holds sends nothing and issues no key', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve(undefined, undefined, { alreadyFiled: true });
  const c = await client();
  try {
    const r = await c.callTool({ name: 'wlo_add_to_collection', arguments: { collectionId: COLLECTION, nodeId: NODE } });
    assert.notEqual(r.isError, true, 'being there already is not a failure');
    assert.match(toolText(r), /bereits in/);
    assert.doesNotMatch(toolText(r), /confirmToken/);
    assert.equal(mutations(mock).length, 0);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('a reference whose original cannot be read is refused BEFORE a key — not found out after it was spent', async () => {
  setServiceCredentialForTest(USER);
  const inner = serveHandler(undefined, ['other'], { originalOf: 'original-9' });
  const mock = installFetchMock((url, init) => {
    if ((init?.method ?? 'GET') === 'GET' && url.includes('/original-9/metadata')) return { status: 403, json: {} };
    return inner(url, init);
  });
  const c = await client();
  try {
    const r = await c.callTool({ name: 'wlo_add_to_collection', arguments: { collectionId: COLLECTION, nodeId: NODE } });
    assert.equal(r.isError, true);
    assert.equal(errorCode(r), 'not_found');
    assert.match(toolText(r), /original-9/);
    assert.doesNotMatch(toolText(r), /confirmToken/);
    assert.equal(mutations(mock).length, 0);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('a key approved for one original does not file another — the reference was re-pointed in between', async () => {
  setServiceCredentialForTest(USER);
  let original = 'original-A';
  const base = serveHandler(undefined, ['other']);
  const mock = installFetchMock((url, init) => {
    if ((init?.method ?? 'GET') === 'GET' && url.includes(`/${NODE}/metadata`)) {
      return { json: { node: { ref: { id: NODE, repo: '-home-' }, type: 'ccm:io', originalId: original, properties: { 'cm:title': ['Arbeitsblatt'] } } } };
    }
    return base(url, init);
  });
  const c = await client();
  try {
    const preview = toolText(await c.callTool({ name: 'wlo_add_to_collection', arguments: { collectionId: COLLECTION, nodeId: NODE } }));
    assert.match(preview, /original-A/);
    original = 'original-B';
    const r = await c.callTool({ name: 'wlo_add_to_collection', arguments: { collectionId: COLLECTION, nodeId: NODE, confirmToken: tokenFrom(preview) } });
    assert.equal(r.isError, true);
    assert.equal(errorCode(r), 'confirm_mismatch');
    assert.equal(mutations(mock).length, 0, 'nothing is filed under an approval for another record');
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('a confirmed filing through a reference reports success for the original', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve(undefined, [COLLECTION], { originalOf: 'original-9' });
  const c = await client();
  try {
    const r = await confirmed(c, 'wlo_add_to_collection', { collectionId: COLLECTION, nodeId: NODE });
    assert.notEqual((r as { isError?: boolean }).isError, true, toolText(r));
    assert.match(toolText(r), /ist jetzt in/);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('REMOVING through a reference id is not redirected — the reference node itself is addressed', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve(undefined, undefined, { originalOf: 'original-9' });
  const c = await client();
  try {
    const preview = toolText(await c.callTool({ name: 'wlo_remove_from_collection', arguments: { collectionId: COLLECTION, nodeId: NODE } }));
    assert.doesNotMatch(preview, /original-9/, 'no redirection is announced, because none happens');
    await c.callTool({ name: 'wlo_remove_from_collection', arguments: { collectionId: COLLECTION, nodeId: NODE, confirmToken: tokenFrom(preview) } });
    const dels = mock.calls.filter(x => x.init?.method === 'DELETE');
    assert.equal(dels.length, 1);
    assert.doesNotMatch(dels[0]!.url, /original-9/);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

// The alias gate sits in `registerCurationTool`, so it holds for every tool and
// every id argument — also inside a list of items.
for (const [name, args] of [
  ['wlo_rename_collection', { nodeId: '-userhome-', title: 'Neu' }],
  ['wlo_add_to_collection', { collectionId: '-inbox-', nodeId: NODE }],
  ['wlo_add_to_collection', { collectionId: COLLECTION, nodeId: ' -userhome- ' }],
  ['wlo_remove_from_collection', { collectionId: '-userhome-', nodeId: NODE }],
  ['wlo_create_collection', { title: 'Neu', parentId: '-root-' }],
] as const) {
  test(`${name} takes no repository alias (${JSON.stringify(args)})`, async () => {
    setServiceCredentialForTest(USER);
    const mock = serve();
    const c = await client();
    try {
      const r = await c.callTool({ name, arguments: args });
      assert.equal(r.isError, true);
      assert.equal(errorCode(r), 'invalid_input');
      assert.match(toolText(r), /Platzhalter/);
      assert.equal(mock.calls.length, 0, 'refused before anything is read');
    } finally {
      await c.close();
      mock.restore();
      setServiceCredentialForTest(null);
    }
  });
}

test('the alias check reads id arguments only — a title that looks like one is text', async () => {
  const { repositoryAliasIn } = await import('../src/tools/curation-shared.js');
  assert.equal(repositoryAliasIn({ title: '-wow-', description: '-x-' }), null);
  assert.equal(repositoryAliasIn({ nodeId: 'a1b2', collectionId: 'c3' }), null);
  assert.equal(repositoryAliasIn({ items: [{ nodeId: 'a' }, { collectionId: '-userhome-' }] }), '-userhome-');
  assert.equal(repositoryAliasIn({ nodeIds: ['a', '-inbox-'] }), '-inbox-');
  assert.equal(repositoryAliasIn({ addToCollectionId: '-root-' }), '-root-');
});

// ── cross-package review, phase 1: the parent of a new collection ────────────

const NOT_PARENTS: Array<[string, { collectionAspects?: string[]; collectionType?: string }, string]> = [
  ['a folder', { collectionAspects: ['ccm:mapdata'] }, 'not_a_collection'],
  ['a record', { collectionType: 'ccm:io' }, 'not_a_collection'],
];
for (const [what, opts, code] of NOT_PARENTS) {
  test(`wlo_create_collection refuses ${what} as the parent — the create endpoint takes any id`, async () => {
    setServiceCredentialForTest(USER);
    const mock = serve(undefined, undefined, opts);
    const c = await client();
    try {
      const r = await c.callTool({ name: 'wlo_create_collection', arguments: { title: 'Neu', parentId: COLLECTION } });
      assert.equal(r.isError, true);
      assert.equal(errorCode(r), code);
      assert.doesNotMatch(toolText(r), /confirmToken/);
      assert.equal(mutations(mock).length, 0);
    } finally {
      await c.close();
      mock.restore();
      setServiceCredentialForTest(null);
    }
  });
}

test('wlo_create_collection: a parent that cannot be read is not_found, before any key', async () => {
  setServiceCredentialForTest(USER);
  const mock = installFetchMock(() => ({ status: 404, json: {} }));
  const c = await client();
  try {
    const r = await c.callTool({ name: 'wlo_create_collection', arguments: { title: 'Neu', parentId: 'gibt-es-nicht' } });
    assert.equal(r.isError, true);
    assert.equal(errorCode(r), 'not_found');
    assert.equal(mutations(mock).length, 0);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('the preview of a sub-collection names the parent by its TITLE — the key binds to a sentence a person can check', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve({ [COLLECTION]: 'Bruchrechnung', 'neu-1': 'Brüche kürzen' });
  const c = await client();
  try {
    const preview = toolText(await c.callTool({ name: 'wlo_create_collection', arguments: { title: 'Brüche kürzen', parentId: COLLECTION } }));
    assert.match(preview, /unter „Bruchrechnung“/);
    assert.match(preview, new RegExp(COLLECTION));
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});
