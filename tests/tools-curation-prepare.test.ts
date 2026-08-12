/**
 * tools-curation-prepare.test.ts – handing the write out instead of doing it.
 *
 * The embedded case (E2): the chatbot sits inside a repository page, the
 * visitor is signed in THERE and not here, and the change should carry their
 * name. So a confirmed curation step comes back as a described request that the
 * page performs with its own session.
 *
 * Three properties earn a test each, and all three are ways this could go
 * quietly wrong:
 *
 *   - preparing must not write. If it did, an operator who enabled it would get
 *     changes under the shared service account — the exact thing the write gate
 *     exists to prevent.
 *   - the flag must not open the tools it was not given. Only a tool marked
 *     `preparable` may take this route.
 *   - anonymous callers stay out, flag or not.
 *
 * `WLO_ALLOW_PREPARED_WRITES` is read at import like every other env value in
 * this codebase, so it is set before the modules are pulled in — hence the
 * dynamic imports. `import type` stays static: types are erased, not executed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { WloCredential } from '../src/auth/credential.js';

process.env['WLO_ALLOW_PREPARED_WRITES'] = '1';

const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
const { registerCurationCollectionTools } = await import('../src/tools/curation-collections.js');
const { registerCurationSuggestionTools } = await import('../src/tools/curation-suggestions.js');
const { registerCurationDecisionTool } = await import('../src/tools/curation-decide.js');
const { applyReadOnlyToolDefaults } = await import('../src/apps/tool-defaults.js');
const { setServiceCredentialForTest } = await import('../src/auth/credential.js');
const { installFetchMock, toolText } = await import('./fetchMock.js');

const SERVICE: WloCredential = { header: 'Basic y', label: 'wlo-mcp', source: 'service' };
const USER: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };
const COLLECTION = 'coll-1';
const NODE = 'node-1';

async function client() {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerCurationCollectionTools(server, 'Bearer error="invalid_request"');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  return c;
}

const REFERENCE = 'ref-1';

/** Both ends readable, every mutation accepted — so a write would show up. */
function serve() {
  return installFetchMock((url) => {
    // The collection's child listing, which is how a removal finds the
    // reference node it may delete. Checked first: its URL names the collection.
    if (url.includes('/children')) {
      return {
        json: {
          nodes: [{ ref: { id: REFERENCE, repo: '-home-' }, properties: { 'ccm:original': [NODE] } }],
          pagination: { total: 1, from: 0, count: 1 },
        },
      };
    }
    if (url.includes(COLLECTION)) {
      return { json: { node: { ref: { id: COLLECTION, repo: '-home-' }, properties: { 'cm:title': ['Bruchrechnung'] } } } };
    }
    return { json: { node: { ref: { id: NODE, repo: '-home-' }, properties: { 'cclom:title': ['Arbeitsblatt Brüche'] } } } };
  });
}

const writes = (m: ReturnType<typeof installFetchMock>) =>
  m.calls.filter(c => (c.init?.method ?? 'GET') !== 'GET');

function tokenFrom(text: string): string {
  const m = /confirmToken[^\w-]*([A-Za-z0-9_-]{20,})/.exec(text);
  assert.ok(m, `no token in reply:\n${text}`);
  return m[1]!;
}

interface PreparedResult {
  isError?: boolean;
  structuredContent?: { preparedRequest?: { method?: string; path?: string; body?: string }; doneMessage?: string };
}

test('a confirmed filing comes back as a request, and nothing is written here', async () => {
  setServiceCredentialForTest(SERVICE);
  const mock = serve();
  const c = await client();
  try {
    const preview = toolText(await c.callTool({
      name: 'wlo_add_to_collection', arguments: { collectionId: COLLECTION, nodeId: NODE },
    }));
    assert.match(preview, /Bruchrechnung/, 'the preview still names both ends');

    const res = await c.callTool({
      name: 'wlo_add_to_collection',
      arguments: { collectionId: COLLECTION, nodeId: NODE, confirmToken: tokenFrom(preview) },
    }) as PreparedResult;

    assert.notEqual(res.isError, true, `reported an error:\n${toolText(res)}`);
    assert.equal(writes(mock).length, 0, 'preparing must not touch the repository');

    const req = res.structuredContent?.preparedRequest;
    assert.ok(req, `no prepared request in the reply:\n${JSON.stringify(res.structuredContent)}`);
    assert.equal(req.method, 'PUT');
    assert.ok(req.path?.startsWith('/'), 'origin-relative — the page prefixes its own');
    assert.match(req.path ?? '', new RegExp(`/collection/v1/collections/-home-/${COLLECTION}/references/${NODE}$`));
    assert.equal(req.body, undefined);

    // The sentence the page shows once the repository accepted it. It lives
    // here because the wording of "what happened" belongs with the tool, not
    // with whoever executes.
    assert.match(res.structuredContent?.doneMessage ?? '', /Arbeitsblatt Brüche/);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('a confirmed removal comes back as a request, and nothing is deleted here', async () => {
  // The twin of the filing above, and the harder half: the endpoint takes the
  // reference id, so this descriptor exists only because the lookup ran HERE.
  setServiceCredentialForTest(SERVICE);
  const mock = serve();
  const c = await client();
  try {
    const preview = toolText(await c.callTool({
      name: 'wlo_remove_from_collection', arguments: { collectionId: COLLECTION, nodeId: NODE },
    }));
    assert.match(preview, /nicht gelöscht/, 'the preview still says the material survives');

    const res = await c.callTool({
      name: 'wlo_remove_from_collection',
      arguments: { collectionId: COLLECTION, nodeId: NODE, confirmToken: tokenFrom(preview) },
    }) as PreparedResult;

    assert.notEqual(res.isError, true, `reported an error:\n${toolText(res)}`);
    assert.equal(writes(mock).length, 0, 'preparing must not touch the repository');

    const req = res.structuredContent?.preparedRequest;
    assert.ok(req, `no prepared request in the reply:\n${JSON.stringify(res.structuredContent)}`);
    assert.equal(req.method, 'DELETE');
    assert.match(req.path ?? '', new RegExp(`/references/${REFERENCE}$`), 'the reference, not the material');
    assert.match(res.structuredContent?.doneMessage ?? '', /Arbeitsblatt Brüche/);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('an individual login still writes rather than preparing', async () => {
  // The flag is on for this whole file, so this is the contrast that matters:
  // preparing is the fallback for a caller that cannot write, never a mode that
  // takes over from one that can.
  setServiceCredentialForTest(USER);
  const mock = serve();
  const c = await client();
  try {
    const preview = toolText(await c.callTool({
      name: 'wlo_add_to_collection', arguments: { collectionId: COLLECTION, nodeId: NODE },
    }));
    const res = await c.callTool({
      name: 'wlo_add_to_collection',
      arguments: { collectionId: COLLECTION, nodeId: NODE, confirmToken: tokenFrom(preview) },
    }) as PreparedResult;

    assert.equal(writes(mock).length > 0, true, 'the write went upstream');
    assert.equal(res.structuredContent?.preparedRequest, undefined, 'nothing was handed out');
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('a tool that was not marked preparable still refuses', async () => {
  setServiceCredentialForTest(SERVICE);
  const mock = serve();
  const c = await client();
  try {
    const res = await c.callTool({
      name: 'wlo_create_collection', arguments: { title: 'Bruchrechnung' },
    }) as PreparedResult;
    assert.equal(res.isError, true, 'the flag opens one route, not the whole file');
    assert.match(toolText(res), /anmelden|Dienstkonto/i);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('anonymous callers get nothing prepared, flag or not', async () => {
  setServiceCredentialForTest(null);
  const mock = serve();
  const c = await client();
  try {
    const res = await c.callTool({
      name: 'wlo_add_to_collection', arguments: { collectionId: COLLECTION, nodeId: NODE },
    }) as PreparedResult;
    assert.equal(res.isError, true);
    assert.equal(writes(mock).length, 0);
  } finally {
    await c.close();
    mock.restore();
  }
});

// ── Metadaten vorschlagen (user decision 2026-08-12) ─────────────────────
//
// The third preparable tool, and the first one that carries a body. A proposal
// changes no record — it stores what a model thinks a record should say, and a
// person decides later. That is why it is the one write beyond collection
// membership the operator asked for.

async function suggestClient() {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerCurationSuggestionTools(server, 'Bearer error="invalid_request"');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  return c;
}

const VORSCHLAG = {
  nodeId: NODE,
  suggestions: [{
    field: 'description',
    value: 'Ein Arbeitsblatt zum Kürzen und Erweitern von Brüchen.',
    reason: 'Dem Datensatz fehlt eine Beschreibung.',
  }],
};

test('a confirmed proposal comes back as a request, and nothing is stored here', async () => {
  setServiceCredentialForTest(SERVICE);
  const mock = serve();
  const c = await suggestClient();
  try {
    const preview = toolText(await c.callTool({ name: 'wlo_suggest_metadata', arguments: VORSCHLAG }));
    assert.match(preview, /NICHT verändert/, 'the preview still says the record survives');

    const res = await c.callTool({
      name: 'wlo_suggest_metadata',
      arguments: { ...VORSCHLAG, confirmToken: tokenFrom(preview) },
    }) as PreparedResult;

    assert.notEqual(res.isError, true, `reported an error:\n${toolText(res)}`);
    assert.equal(writes(mock).length, 0, 'preparing must not touch the repository');

    const req = res.structuredContent?.preparedRequest;
    assert.ok(req, `no prepared request in the reply:\n${JSON.stringify(res.structuredContent)}`);
    assert.equal(req.method, 'POST');
    assert.match(req.path ?? '', new RegExp(`/suggestions/v1/-home-/${NODE}\\?`));
    // `type=AI` is the provenance the repository stores: a model wrote this.
    // It travels in the descriptor so the executing page cannot file a proposal
    // that claims a human wrote it.
    assert.match(req.path ?? '', /[?&]type=AI(&|$)/);

    // The first prepared request with a body — the drafts the page posts.
    const body = JSON.parse(req.body ?? 'null');
    assert.ok(Array.isArray(body) && body.length === 1, `unexpected body: ${req.body}`);
    assert.equal(body[0].value, VORSCHLAG.suggestions[0]!.value);
    assert.equal(body[0].description, VORSCHLAG.suggestions[0]!.reason);

    assert.match(res.structuredContent?.doneMessage ?? '', /Vorschlag/i);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});

test('proposing without any login prepares nothing', async () => {
  setServiceCredentialForTest(null);
  const mock = serve();
  const c = await suggestClient();
  try {
    const res = await c.callTool({ name: 'wlo_suggest_metadata', arguments: VORSCHLAG }) as PreparedResult;
    assert.equal(res.isError, true);
    assert.equal(writes(mock).length, 0);
  } finally {
    await c.close();
    mock.restore();
  }
});

test('reviewing a proposal is NOT preparable — deciding stays here', async () => {
  // `wlo_decide_suggestion` accepts or rejects, and accepting WRITES the value
  // into the record. That is a different act from proposing, and it was not
  // part of the decision — so the flag must not quietly cover it.
  //
  // Asserted by CALLING it, not by checking which module registers it: absence
  // from this file's tool list is a different property, and it would keep
  // passing if `preparable: true` were ever added over in `curation-decide.ts`.
  setServiceCredentialForTest(SERVICE);
  const mock = serve();
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerCurationDecisionTool(server, 'Bearer error="invalid_request"');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  try {
    const res = await c.callTool({
      name: 'wlo_decide_suggestion',
      arguments: { nodeId: NODE, suggestionId: 's-1', decision: 'accept' },
    }) as PreparedResult;

    assert.equal(res.isError, true, 'the shared service account may not decide, flag or not');
    // The write GATE has to be what refused — not a schema complaint, which
    // would make every assertion here true for the wrong reason.
    assert.match(toolText(res), /anmelden|Dienstkonto/i);
    assert.equal(res.structuredContent?.preparedRequest, undefined,
      'and it must not hand the write out either');
    assert.equal(writes(mock).length, 0);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
});
