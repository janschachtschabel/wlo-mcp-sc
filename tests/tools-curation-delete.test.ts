/**
 * tools-curation-delete.test.ts – the two irreversible acts.
 *
 * Two things are pinned here that nothing else can catch.
 *
 * `recycle=true` must be on every delete request: the flag decides whether the
 * node goes to the archive or is destroyed outright, and its default is not
 * ours to rely on.
 *
 * And the reply must NOT promise the deletion can be undone. A person-scoped
 * archive query found a deleted node once and then returned nothing for the
 * same node minutes later, so restorability could not be demonstrated. Telling
 * someone their material can be brought back, when we cannot show that it can,
 * is the kind of reassurance that costs them the material.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { registerCurationDeleteTools } from '../src/tools/curation-delete.js';
import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { installFetchMock, toolText } from './fetchMock.js';

const USER: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };
const NODE = 'node-1';
const COLLECTION = 'coll-1';

async function client(): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerCurationDeleteTools(server, 'Bearer error="invalid_request"');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  return c;
}

/**
 * A repository where a deleted node stops being readable.
 *
 * The 404 afterwards is the point: the DELETE answers 200 either way, and
 * "gelöscht" is the one reply in this server nobody can act on later. It is
 * therefore said only once the record is actually gone.
 */
function serve(title = 'Bruchrechnung Klasse 6', type: 'ccm:io' | 'ccm:map' | 'folder' = 'ccm:io') {
  // 'folder' = a `ccm:map` WITHOUT the collection aspect (a workspace or batch folder, measured 2026-11-12).
  const kind = type === 'folder' ? { type: 'ccm:map', aspects: ['ccm:mapdata'] } : { type, aspects: type === 'ccm:map' ? ['ccm:collection'] : [] };
  let deleted = false;
  return installFetchMock((_url, init) => {
    if (init?.method === 'DELETE') {
      deleted = true;
      return { json: {} };
    }
    if ((init?.method ?? 'GET') === 'GET') {
      if (deleted) return { status: 404, json: {} };
      return {
        json: {
          node: { ref: { id: NODE, repo: '-home-' }, ...kind, properties: { 'cclom:title': [title], 'cm:title': [title] } },
        },
      };
    }
    return { json: {} };
  });
}

const deletes = (m: ReturnType<typeof installFetchMock>) =>
  m.calls.filter(c => c.init?.method === 'DELETE');

function tokenFrom(text: string): string {
  const m = /confirmToken[^\w-]*([A-Za-z0-9_-]{20,})/.exec(text);
  assert.ok(m, `no token in reply:\n${text}`);
  return m[1]!;
}

/**
 * Nothing in a deletion reply may suggest the material can be brought back.
 * Only unambiguous promises are listed: "rückgängig" alone would also match the
 * denial "lässt sich nicht rückgängig machen", which is the wording we want.
 */
const PROMISES_RESTORE = /wiederherstell|wiederherstellbar|zurückhol|Papierkorb/i;

test('deleting content sends recycle=true', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve();
  const c = await client();
  try {
    const preview = toolText(await c.callTool({ name: 'wlo_delete_content', arguments: { nodeId: NODE } }));
    await c.callTool({ name: 'wlo_delete_content', arguments: { nodeId: NODE, confirmToken: tokenFrom(preview) } });
    const d = deletes(mock);
    assert.equal(d.length, 1);
    const url = new URL(d[0]!.url);
    assert.equal(url.searchParams.get('recycle'), 'true');
    assert.match(url.pathname, /\/node\/v1\/nodes\/-home-\/node-1$/);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('nothing is deleted without a token', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve();
  const c = await client();
  try {
    const text = toolText(await c.callTool({ name: 'wlo_delete_content', arguments: { nodeId: NODE } }));
    assert.equal(deletes(mock).length, 0);
    assert.match(text, /Bruchrechnung Klasse 6/, 'the preview names what would be lost');
    assert.match(text, new RegExp(NODE));
    assert.ok(tokenFrom(text).length > 0);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('the preview promises no way back', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve();
  const c = await client();
  try {
    const text = toolText(await c.callTool({ name: 'wlo_delete_content', arguments: { nodeId: NODE } }));
    assert.doesNotMatch(text, PROMISES_RESTORE);
    assert.match(text, /nicht rückgängig|endgültig|dauerhaft/i, 'and says so plainly');
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('the confirmation reply promises no way back either', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve();
  const c = await client();
  try {
    const preview = toolText(await c.callTool({ name: 'wlo_delete_content', arguments: { nodeId: NODE } }));
    const res = await c.callTool({
      name: 'wlo_delete_content', arguments: { nodeId: NODE, confirmToken: tokenFrom(preview) },
    });
    const done = toolText(res);
    assert.notEqual((res as { isError?: boolean }).isError, true, done);
    assert.doesNotMatch(done, PROMISES_RESTORE);
    assert.match(done, /wurde gelöscht/, 'the record is gone, so this may be said');
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('a record still readable after the delete is not reported as deleted', async () => {
  // The DELETE answers 200 whether or not it took effect. Saying "gelöscht"
  // over a record that is still there is the one mistake here nobody can undo,
  // because it stops the curator from looking.
  setServiceCredentialForTest(USER);
  const mock = installFetchMock((_url, init) => {
    if ((init?.method ?? 'GET') === 'GET') {
      return { json: { node: { ref: { id: NODE }, type: 'ccm:io', properties: { 'cclom:title': ['Bruchrechnung'] } } } };
    }
    return { json: {} };
  });
  const c = await client();
  try {
    const preview = toolText(await c.callTool({ name: 'wlo_delete_content', arguments: { nodeId: NODE } }));
    const res = await c.callTool({
      name: 'wlo_delete_content', arguments: { nodeId: NODE, confirmToken: tokenFrom(preview) },
    });
    assert.equal((res as { isError?: boolean }).isError, true);
    assert.doesNotMatch(toolText(res), /wurde gelöscht/);
    assert.match(toolText(res), /weiterhin lesbar/);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('a token for one node does not delete another', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve();
  const c = await client();
  try {
    const preview = toolText(await c.callTool({ name: 'wlo_delete_content', arguments: { nodeId: NODE } }));
    const res = await c.callTool({
      name: 'wlo_delete_content', arguments: { nodeId: 'node-2', confirmToken: tokenFrom(preview) },
    });
    assert.equal(deletes(mock).length, 0);
    assert.equal((res as { isError?: boolean }).isError, true);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

// No `recycle` here: the documented collection endpoint takes no such flag, and
// inventing one would be a parameter the repository silently ignores.
test('deleting a collection uses the collection endpoint, not the node one', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve('Bruchrechnung', 'ccm:map');
  const c = await client();
  try {
    const preview = toolText(await c.callTool({
      name: 'wlo_delete_collection', arguments: { nodeId: COLLECTION },
    }));
    assert.doesNotMatch(preview, PROMISES_RESTORE);
    await c.callTool({
      name: 'wlo_delete_collection', arguments: { nodeId: COLLECTION, confirmToken: tokenFrom(preview) },
    });
    const d = deletes(mock);
    assert.equal(d.length, 1);
    assert.match(d[0]!.url, /\/collection\/v1\/collections\//);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('deleting a collection says the material inside survives', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve('Bruchrechnung', 'ccm:map');
  const c = await client();
  try {
    const text = toolText(await c.callTool({ name: 'wlo_delete_collection', arguments: { nodeId: COLLECTION } }));
    assert.match(text, /Materialien.*bleib|Inhalte.*bleib/i,
      'a collection holds references — deleting it does not destroy what it points at');
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('a failed delete is reported as a failure, not as done', async () => {
  setServiceCredentialForTest(USER);
  const mock = installFetchMock((_url, init) => {
    if ((init?.method ?? 'GET') === 'GET') {
      return { json: { node: { ref: { id: NODE }, type: 'ccm:io', properties: { 'cclom:title': ['X'] } } } };
    }
    return { status: 403, json: {} };
  });
  const c = await client();
  try {
    const preview = toolText(await c.callTool({ name: 'wlo_delete_content', arguments: { nodeId: NODE } }));
    const res = await c.callTool({
      name: 'wlo_delete_content', arguments: { nodeId: NODE, confirmToken: tokenFrom(preview) },
    });
    assert.equal((res as { isError?: boolean }).isError, true);
    assert.match(toolText(res), /403/);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

// A deletion is the one act in this server nobody can undo, so its report is the
// one that must never state more than we know. An abort hits the RESPONSE, not
// the work: the repository may well have carried the deletion out. Saying "konnte
// nicht gelöscht werden" then sends the curator to delete it a second time and,
// worse, tells them the material is still there when it is gone.

const TIMEOUT = () =>
  Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });

test('a timed-out delete says the outcome is open, not that nothing was deleted', async () => {
  setServiceCredentialForTest(USER);
  const mock = installFetchMock((_url, init) => {
    if (init?.method === 'DELETE') throw TIMEOUT();
    return { json: { node: { ref: { id: NODE }, type: 'ccm:io', properties: { 'cclom:title': ['Bruchrechnung'] } } } };
  });
  const c = await client();
  try {
    const preview = toolText(await c.callTool({ name: 'wlo_delete_content', arguments: { nodeId: NODE } }));
    const res = await c.callTool({
      name: 'wlo_delete_content', arguments: { nodeId: NODE, confirmToken: tokenFrom(preview) },
    });
    const text = toolText(res);
    assert.match(text, /offen|unklar/i, 'the outcome is stated as open');
    assert.match(text, /nachsehen|nachschauen/i, 'and the curator is told to go and look');
    assert.doesNotMatch(text, /konnte nicht gelöscht werden/i, 'never a claim that nothing happened');
    assert.equal((res as { isError?: boolean }).isError, true);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('a delete whose read-back times out is not reported as failed', async () => {
  // The likelier half: the DELETE lands, the check afterwards does not. The
  // record is gone and the curator would be told it could not be deleted.
  setServiceCredentialForTest(USER);
  let deleted = false;
  const mock = installFetchMock((_url, init) => {
    if (init?.method === 'DELETE') { deleted = true; return { json: {} }; }
    if (deleted) throw TIMEOUT();
    return { json: { node: { ref: { id: NODE }, type: 'ccm:io', properties: { 'cclom:title': ['Bruchrechnung'] } } } };
  });
  const c = await client();
  try {
    const preview = toolText(await c.callTool({ name: 'wlo_delete_content', arguments: { nodeId: NODE } }));
    const text = toolText(await c.callTool({
      name: 'wlo_delete_content', arguments: { nodeId: NODE, confirmToken: tokenFrom(preview) },
    }));
    assert.doesNotMatch(text, /konnte nicht gelöscht werden/i);
    assert.match(text, /offen|überprüf|nachsehen/i);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('a delete whose read-back fails for any other reason is open, not failed', async () => {
  // Not every dropped read-back is a timeout — a reset socket is not, and
  // `isUpstreamTimeout` correctly does not match it. Without `confirmDeleted`
  // answering `unverified` itself, such a throw would reach the tool's catch as
  // an ordinary error and be reported as "konnte nicht gelöscht werden" over a
  // record the repository already removed.
  setServiceCredentialForTest(USER);
  let deleted = false;
  const mock = installFetchMock((_url, init) => {
    if (init?.method === 'DELETE') { deleted = true; return { json: {} }; }
    if (deleted) throw new Error('socket hang up');
    return { json: { node: { ref: { id: NODE }, type: 'ccm:io', properties: { 'cclom:title': ['Bruchrechnung'] } } } };
  });
  const c = await client();
  try {
    const preview = toolText(await c.callTool({ name: 'wlo_delete_content', arguments: { nodeId: NODE } }));
    const text = toolText(await c.callTool({
      name: 'wlo_delete_content', arguments: { nodeId: NODE, confirmToken: tokenFrom(preview) },
    }));
    assert.doesNotMatch(text, /konnte nicht gelöscht werden/i);
    assert.match(text, /nicht überprüf|offen/i, 'the check failed, so the outcome is unknown');
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('a timed-out collection delete is open too', async () => {
  setServiceCredentialForTest(USER);
  const mock = installFetchMock((_url, init) => {
    if (init?.method === 'DELETE') throw TIMEOUT();
    return { json: { node: { ref: { id: COLLECTION }, type: 'ccm:map', aspects: ['ccm:collection'], properties: { 'cclom:title': ['Mathe'] } } } };
  });
  const c = await client();
  try {
    const preview = toolText(await c.callTool({ name: 'wlo_delete_collection', arguments: { nodeId: COLLECTION } }));
    const text = toolText(await c.callTool({
      name: 'wlo_delete_collection', arguments: { nodeId: COLLECTION, confirmToken: tokenFrom(preview) },
    }));
    assert.match(text, /offen|unklar/i);
    assert.doesNotMatch(text, /konnte nicht gelöscht werden/i);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('an anonymous caller cannot delete anything', async () => {
  setServiceCredentialForTest(null);
  const mock = serve();
  const c = await client();
  try {
    for (const name of ['wlo_delete_content', 'wlo_delete_collection']) {
      const res = await c.callTool({ name, arguments: { nodeId: NODE } });
      assert.equal((res as { isError?: boolean }).isError, true, name);
      assert.match(toolText(res), /anmelden/i, name);
    }
    assert.equal(mock.calls.length, 0);
  } finally {
    await c.close();
    mock.restore();
  }
});

test('over a reference id the preview says the record survives', async () => {
  // Measured 2026-08-17 (F10): deleting a collection reference removes the
  // reference and leaves the record alone. The preview used to promise "der
  // Datensatz verschwindet aus allen Sammlungen" here — the one sentence a
  // person reads before an irreversible act, and false in this case.
  setServiceCredentialForTest(USER);
  const mock = installFetchMock(() => ({
    json: {
      node: {
        ref: { id: 'reference-1', repo: '-home-' }, type: 'ccm:io',
        originalId: 'original-1',
        properties: { 'cclom:title': ['Bruchrechnung Klasse 6'] },
      },
    },
  }));
  const c = await client();
  try {
    const text = toolText(await c.callTool({
      name: 'wlo_delete_content',
      arguments: { nodeId: 'reference-1' },
    }));
    assert.match(text, /VERKNÜPFUNG/, 'die Vorschau benennt den Fall');
    assert.match(text, /original-1/, 'und nennt den Datensatz, der bleibt');
    assert.doesNotMatch(text, /Der Datensatz verschwindet damit aus allen Sammlungen/,
      'die unbedingte Zusage darf hier nicht stehen');
    assert.equal(mock.calls.filter(x => x.init?.method === 'DELETE').length, 0, 'nichts gelöscht');
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('over an ordinary record the preview keeps the full-loss sentence', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve();
  const c = await client();
  try {
    const text = toolText(await c.callTool({ name: 'wlo_delete_content', arguments: { nodeId: NODE } }));
    assert.match(text, /verschwindet damit aus allen Sammlungen/);
    assert.doesNotMatch(text, /VERKNÜPFUNG/, 'kein Verknüpfungssatz, wo es keine ist');
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('both delete tools declare themselves destructive', async () => {
  const c = await client();
  try {
    const { tools } = await c.listTools();
    for (const name of ['wlo_delete_content', 'wlo_delete_collection']) {
      const tool = tools.find(t => t.name === name);
      assert.ok(tool, name);
      assert.equal(tool.annotations?.destructiveHint, true, name);
      assert.equal(tool.annotations?.readOnlyHint, false, name);
    }
  } finally {
    await c.close();
  }
});

// ── audit 2026-11-12, K-1: the tool must fit the node ───────────────────────

const sc = (r: unknown) => (r as { structuredContent?: { error?: { code?: string } } }).structuredContent;

test('a collection id at wlo_delete_content is refused — its preview would speak of ONE record (audit K-1)', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve('Optik', 'ccm:map');
  const c = await client();
  try {
    const r = await c.callTool({ name: 'wlo_delete_content', arguments: { nodeId: COLLECTION } });
    assert.equal(r.isError, true);
    assert.equal(sc(r)?.error?.code, 'is_a_collection');
    assert.match(toolText(r), /wlo_delete_collection/, 'and it names the tool that fits');
    assert.doesNotMatch(toolText(r), /confirmToken/, 'no key for a deletion that must not happen this way');
    assert.equal(deletes(mock).length, 0);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('a record id at wlo_delete_collection is refused (audit K-1)', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve('Arbeitsblatt', 'ccm:io');
  const c = await client();
  try {
    const r = await c.callTool({ name: 'wlo_delete_collection', arguments: { nodeId: NODE } });
    assert.equal(r.isError, true);
    assert.equal(sc(r)?.error?.code, 'not_a_collection');
    assert.match(toolText(r), /wlo_delete_content/);
    assert.equal(deletes(mock).length, 0);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

for (const alias of ['-userhome-', '-inbox-', '-root-']) {
  test(`the alias ${alias} is never deleted, by either tool (audit K-1)`, async () => {
    setServiceCredentialForTest(USER);
    const mock = serve('Mein Bereich', 'ccm:map');
    const c = await client();
    try {
      for (const name of ['wlo_delete_content', 'wlo_delete_collection']) {
        const r = await c.callTool({ name, arguments: { nodeId: alias } });
        assert.equal(r.isError, true, name);
        assert.equal(sc(r)?.error?.code, 'invalid_input', name);
      }
      assert.equal(mock.calls.length, 0, 'refused before anything is read');
    } finally {
      await c.close();
      mock.restore();
      setServiceCredentialForTest(null);
    }
  });
}

for (const [name, code] of [['wlo_delete_content', 'refused'], ['wlo_delete_collection', 'not_a_collection']] as const) {
  test(`${name}: a node whose type the repository does not name is not deleted — an irreversible act needs to know what it hits`, async () => {
    setServiceCredentialForTest(USER);
    const mock = installFetchMock(() => ({ json: { node: { ref: { id: NODE }, properties: { 'cclom:title': ['?'] } } } }));
    const c = await client();
    try {
      const r = await c.callTool({ name, arguments: { nodeId: NODE } });
      assert.equal(r.isError, true);
      assert.equal(sc(r)?.error?.code, code);
      assert.doesNotMatch(toolText(r), /confirmToken/);
      assert.equal(deletes(mock).length, 0);
    } finally {
      await c.close();
      mock.restore();
      setServiceCredentialForTest(null);
    }
  });
}

// Review of package 2: `ccm:map` is the repository's general container. Measured
// 2026-11-12 (tests/live/node-kinds.test.ts): the folder of a batch filing and
// the personal area report it too — WITHOUT the aspect `ccm:collection`.
for (const [name, code] of [['wlo_delete_content', 'is_a_folder'], ['wlo_delete_collection', 'not_a_collection']] as const) {
  test(`${name}: a folder is not a collection and not a record — refused, with what to do instead`, async () => {
    setServiceCredentialForTest(USER);
    const mock = serve('Ablage 2026-11-12', 'folder');
    const c = await client();
    try {
      const r = await c.callTool({ name, arguments: { nodeId: NODE } });
      assert.equal(r.isError, true);
      assert.equal(sc(r)?.error?.code, code);
      assert.match(toolText(r), /Ordner/);
      assert.match(toolText(r), /einzeln löschen/, 'it says what works instead');
      assert.doesNotMatch(toolText(r), /confirmToken/, 'under the collection preview its originals would go with it');
      assert.equal(deletes(mock).length, 0);
    } finally {
      await c.close();
      mock.restore();
      setServiceCredentialForTest(null);
    }
  });
}

test('the collection preview no longer promises that everything inside survives', async () => {
  setServiceCredentialForTest(USER);
  const mock = serve('Optik', 'ccm:map');
  const c = await client();
  try {
    const preview = toolText(await c.callTool({ name: 'wlo_delete_collection', arguments: { nodeId: COLLECTION } }));
    assert.match(preview, /Original direkt in der Sammlung angelegt wurden, werden\s+dagegen mitgelöscht/);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});
