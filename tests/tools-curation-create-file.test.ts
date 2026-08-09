/**
 * tools-curation-create-file.test.ts – the second way to make a record.
 *
 * Two create paths now stand side by side, and this file covers the new one end
 * to end through the tool:
 *
 *   url  → the record POINTS at material elsewhere (covered by
 *          `tools-curation-create.test.ts`, unchanged)
 *   file → the record CARRIES its bytes, because the material was written in
 *          the conversation and has no address
 *
 * The load-bearing test is `the confirmation key is bound to the bytes`. The
 * token is a fingerprint of the previewed change set, so anything the call will
 * send has to be IN that preview. If the file were not, someone could approve
 * "create a record", and the confirming call could carry a different file
 * entirely — an approval for content nobody saw. Everything else here is about
 * not reporting success for a record that ended up empty.
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
const NODE = 'datei-1';
const MARKDOWN = '# Brüche kürzen\n\nAufgabe 1: Kürze 4/8.\n';

async function curationClient(): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerCurationContentTools(server, 'Bearer error="invalid_request"');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), client.connect(ct)]);
  return client;
}

interface Served {
  /** Bytes the upload actually carried, or null if it never happened. */
  uploaded: string | null;
  contentCalls: number;
}

/**
 * @param opts.stored    does the record report bytes after the upload
 * @param opts.uploadOk  does the upload endpoint accept the request
 * @param opts.siblings  titles already in the storage location
 */
function serve(opts: { stored?: boolean; uploadOk?: boolean; siblings?: string[] } = {}) {
  const { stored = true, uploadOk = true, siblings = [] } = opts;
  const seen: Served = { uploaded: null, contentCalls: 0 };
  const props: Record<string, string[]> = { 'cclom:title': ['Brüche kürzen'] };

  const mock = installFetchMock((url, init) => {
    const method = init?.method ?? 'GET';
    // The storage-location listing behind the same-title warning.
    if (url.includes('/children') && method === 'GET') {
      return { json: { nodes: siblings.map((t, i) => ({
        ref: { id: `alt-${i}`, repo: '-home-' }, properties: { 'cclom:title': [t] },
      })) } };
    }
    if (url.includes('/children') && method === 'POST') {
      return { json: { node: { ref: { id: NODE, repo: '-home-' } } } };
    }
    if (url.includes('/content?')) {
      seen.contentCalls++;
      return uploadOk ? { json: {} } : { status: 403, json: { error: 'AccessDenied' } };
    }
    if (method === 'GET') {
      return { json: { node: {
        ref: { id: NODE, repo: '-home-' },
        properties: props,
        size: stored ? MARKDOWN.length : null,
        downloadUrl: stored ? 'https://repo.example/dl' : null,
      } } };
    }
    if (url.includes('/metadata')) Object.assign(props, JSON.parse(String(init?.body ?? '{}')));
    return { json: {} };
  });

  // FormData bodies are captured as objects; read the part out on demand.
  const uploadedText = async (): Promise<string | null> => {
    const post = mock.calls.find((c) => c.url.includes('/content?'));
    const body = post?.init?.body;
    if (!(body instanceof FormData)) return null;
    const part = body.get('file');
    return part instanceof Blob ? await part.text() : null;
  };
  return { mock, seen, uploadedText };
}

const create = (client: Client, args: Record<string, unknown>) =>
  client.callTool({ name: 'wlo_create_content', arguments: args });

/**
 * Pull the confirmation key out of a preview. Same expression as the other six
 * curation test files — and the `-` inside the negated class is the whole point.
 *
 * The key is base64url, so it may begin with `-`. Written as `[^\w]*`, the
 * greedy run swallows that leading character and hands back a key the store has
 * never seen. Roughly one key in 64 starts that way, which made this file fail
 * about once in five runs, on a different test each time. Root-caused
 * 2026-08-06 after the shorter form was copied here without the exclusion; the
 * token store was never at fault.
 */
const keyFrom = (text: string): string => {
  const m = /confirmToken[^\w-]*([A-Za-z0-9_-]{20,})/.exec(text);
  assert.ok(m, `no confirmation key in the preview:\n${text}`);
  return m[1]!;
};

// ── the preview ────────────────────────────────────────────────────────────

test('the preview describes the file and writes nothing', async (t) => {
  setServiceCredentialForTest(USER);
  const s = serve();
  t.after(() => { s.mock.restore(); setServiceCredentialForTest(null); });

  const client = await curationClient();
  const text = toolText(await create(client, { title: 'Brüche kürzen', content: MARKDOWN }));

  assert.match(text, /brueche-kuerzen\.md/, 'the derived file name');
  assert.match(text, /text\/markdown/, 'the type');
  assert.match(text, /[0-9a-f]{12}/, 'a digest of the bytes');
  assert.match(text, /Brüche kürzen/, 'and the readable beginning');
  assert.equal(s.seen.contentCalls, 0, 'nothing is uploaded before confirmation');
  assert.equal(
    s.mock.calls.filter((c) => (c.init?.method ?? 'GET') === 'POST').length, 0,
    'and nothing is created either',
  );
});

/**
 * The rule the two-step exists for. The token is bound to a fingerprint of the
 * previewed change set; the file is described inside it. Confirming with
 * DIFFERENT bytes must therefore be refused — otherwise an approval for one
 * worksheet uploads another.
 */
test('the confirmation key is bound to the bytes, not just to the title', async (t) => {
  setServiceCredentialForTest(USER);
  const s = serve();
  t.after(() => { s.mock.restore(); setServiceCredentialForTest(null); });

  const client = await curationClient();
  const preview = toolText(await create(client, { title: 'Brüche kürzen', content: MARKDOWN }));
  const key = keyFrom(preview);

  const swapped = toolText(await create(client, {
    title: 'Brüche kürzen',
    content: '# Etwas ganz anderes\n',
    confirmToken: key,
  }));
  assert.equal(s.seen.contentCalls, 0, 'a swapped file must never reach the repository');
  assert.match(swapped, /Vorschau|bestätig|abgelaufen|passt nicht|erneut/i);
});

test('a same-title record in the storage location is named in the preview', async (t) => {
  setServiceCredentialForTest(USER);
  const s = serve({ siblings: ['Brüche kürzen'] });
  t.after(() => { s.mock.restore(); setServiceCredentialForTest(null); });

  const client = await curationClient();
  const text = toolText(await create(client, { title: 'Brüche kürzen', content: MARKDOWN }));
  assert.match(text, /bereits/i, 'the warning is shown');
  assert.match(text, /alt-0/, 'with the id of the record it means');
});

// ── confirming ─────────────────────────────────────────────────────────────

test('confirming creates the record and uploads the bytes unchanged', async (t) => {
  setServiceCredentialForTest(USER);
  const s = serve();
  t.after(() => { s.mock.restore(); setServiceCredentialForTest(null); });

  const client = await curationClient();
  const key = keyFrom(toolText(await create(client, { title: 'Brüche kürzen', content: MARKDOWN })));
  const text = toolText(await create(client, {
    title: 'Brüche kürzen', content: MARKDOWN, confirmToken: key,
  }));

  assert.match(text, new RegExp(`Angelegt: ${NODE}`));
  assert.match(text, /hochgeladen/i);
  assert.equal(await s.uploadedText(), MARKDOWN, 'the bytes arrive exactly as given');
});

/**
 * The measured failure the read-back exists for: the upload is answered with a
 * `200` and the record shows no content. Saying "created" alone would leave
 * someone with a record that looks finished and is empty.
 */
test('a record that ends up without content says so instead of reporting success', async (t) => {
  setServiceCredentialForTest(USER);
  const s = serve({ stored: false });
  t.after(() => { s.mock.restore(); setServiceCredentialForTest(null); });

  const client = await curationClient();
  const key = keyFrom(toolText(await create(client, { title: 'Brüche kürzen', content: MARKDOWN })));
  const text = toolText(await create(client, {
    title: 'Brüche kürzen', content: MARKDOWN, confirmToken: key,
  }));

  assert.match(text, new RegExp(`Angelegt: ${NODE}`), 'the id is still reported — the record exists');
  assert.match(text, /KEINEN Inhalt/i, 'and the missing content is stated plainly');
});

test('a refused upload is reported beside the id, not swallowed', async (t) => {
  setServiceCredentialForTest(USER);
  const s = serve({ uploadOk: false, stored: false });
  t.after(() => { s.mock.restore(); setServiceCredentialForTest(null); });

  const client = await curationClient();
  const key = keyFrom(toolText(await create(client, { title: 'Brüche kürzen', content: MARKDOWN })));
  const text = toolText(await create(client, {
    title: 'Brüche kürzen', content: MARKDOWN, confirmToken: key,
  }));

  assert.match(text, new RegExp(`Angelegt: ${NODE}`));
  assert.match(text, /fehlgeschlagen/i);
});

// ── the gate between the two paths ─────────────────────────────────────────

test('two sources at once are refused before anything happens', async (t) => {
  setServiceCredentialForTest(USER);
  const s = serve();
  t.after(() => { s.mock.restore(); setServiceCredentialForTest(null); });

  const client = await curationClient();
  const text = toolText(await create(client, {
    title: 'x', url: 'https://example.org/a', content: MARKDOWN,
  }));
  assert.match(text, /genau eine|nur eine/i);
  assert.equal(s.mock.calls.length, 0, 'no request at all');
});

test('no source at all is refused before anything happens', async (t) => {
  setServiceCredentialForTest(USER);
  const s = serve();
  t.after(() => { s.mock.restore(); setServiceCredentialForTest(null); });

  const client = await curationClient();
  const text = toolText(await create(client, { title: 'Nur ein Titel' }));
  assert.match(text, /url/i);
  assert.equal(s.mock.calls.length, 0);
});

test('a file that is not a recognised image never reaches the repository', async (t) => {
  setServiceCredentialForTest(USER);
  const s = serve();
  t.after(() => { s.mock.restore(); setServiceCredentialForTest(null); });

  const client = await curationClient();
  const text = toolText(await create(client, {
    title: 'Angeblich ein Bild',
    fileBase64: Buffer.from('<html><script>alert(1)</script></html>').toString('base64'),
  }));
  assert.match(text, /kein erkanntes Bild/i);
  assert.equal(s.mock.calls.length, 0);
});

// ── replacing the file on a record that already exists ─────────────────────

/**
 * `wlo_update_content` gained the same file path. Replacing content is NOT the
 * same act as creating: the record exists, and what is there now moves into the
 * version history. So the preview says that in words, and the confirmation key
 * is bound to it exactly as on the create side.
 *
 * The metadata write and the upload are two separate repository operations, and
 * either can fail on its own — so both are reported, never merged into one
 * verdict.
 */
function serveUpdate(opts: { stored?: boolean; uploadOk?: boolean } = {}) {
  const { stored = true, uploadOk = true } = opts;
  const props: Record<string, string[]> = { 'cclom:title': ['Brüche kürzen'] };
  const mock = installFetchMock((url, init) => {
    const method = init?.method ?? 'GET';
    if (url.includes('/content?')) {
      return uploadOk ? { json: {} } : { status: 403, json: { error: 'AccessDenied' } };
    }
    if (method === 'GET') {
      return { json: { node: {
        ref: { id: NODE, repo: '-home-' },
        properties: props,
        size: stored ? 42 : null,
        downloadUrl: stored ? 'https://repo.example/dl' : null,
      } } };
    }
    if (url.includes('/metadata')) Object.assign(props, JSON.parse(String(init?.body ?? '{}')));
    return { json: {} };
  });
  const uploadedText = async (): Promise<string | null> => {
    const post = mock.calls.find((c) => c.url.includes('/content?'));
    const body = post?.init?.body;
    if (!(body instanceof FormData)) return null;
    const part = body.get('file');
    return part instanceof Blob ? await part.text() : null;
  };
  return { mock, uploadedText };
}

const update = (client: Client, args: Record<string, unknown>) =>
  client.callTool({ name: 'wlo_update_content', arguments: args });

test('replacing a file previews the replacement and writes nothing', async (t) => {
  setServiceCredentialForTest(USER);
  const s = serveUpdate();
  t.after(() => { s.mock.restore(); setServiceCredentialForTest(null); });

  const client = await curationClient();
  const text = toolText(await update(client, { nodeId: NODE, content: MARKDOWN }));

  assert.match(text, /ersetzt/i, 'the preview says the existing content goes');
  assert.match(text, /Versionshistorie/i, 'and where it goes');
  assert.match(text, /brueche-kuerzen\.md/, 'the derived name, taken from the STORED title');
  assert.match(text, /[0-9a-f]{12}/, 'a digest of the new bytes');
  assert.equal(s.mock.calls.filter((c) => c.url.includes('/content?')).length, 0, 'nothing uploaded yet');
});

test('the confirmation key for a replacement is bound to the new bytes', async (t) => {
  setServiceCredentialForTest(USER);
  const s = serveUpdate();
  t.after(() => { s.mock.restore(); setServiceCredentialForTest(null); });

  const client = await curationClient();
  const key = keyFrom(toolText(await update(client, { nodeId: NODE, content: MARKDOWN })));
  const swapped = toolText(await update(client, {
    nodeId: NODE, content: '# etwas anderes\n', confirmToken: key,
  }));

  assert.equal(s.mock.calls.filter((c) => c.url.includes('/content?')).length, 0,
    'a swapped file must never reach the repository');
  assert.match(swapped, /Vorschau|bestätig|abgelaufen|passt nicht|erneut/i);
});

test('confirming replaces the content and reports it', async (t) => {
  setServiceCredentialForTest(USER);
  const s = serveUpdate();
  t.after(() => { s.mock.restore(); setServiceCredentialForTest(null); });

  const client = await curationClient();
  const key = keyFrom(toolText(await update(client, { nodeId: NODE, content: MARKDOWN })));
  const text = toolText(await update(client, { nodeId: NODE, content: MARKDOWN, confirmToken: key }));

  assert.equal(await s.uploadedText(), MARKDOWN, 'the bytes arrive exactly as given');
  assert.match(text, /hochgeladen/i);
});

/**
 * A file alone is a change. Before this, the tool refused a call with no
 * metadata field — which would have made "just replace the content" impossible.
 */
test('a file with no metadata field is a change, not an empty call', async (t) => {
  setServiceCredentialForTest(USER);
  const s = serveUpdate();
  t.after(() => { s.mock.restore(); setServiceCredentialForTest(null); });

  const client = await curationClient();
  const text = toolText(await update(client, { nodeId: NODE, content: MARKDOWN }));
  assert.ok(!/kein zu änderndes Feld/i.test(text), `refused a file-only change:\n${text}`);
});

test('a replacement the repository refuses is reported, not swallowed', async (t) => {
  setServiceCredentialForTest(USER);
  const s = serveUpdate({ uploadOk: false, stored: false });
  t.after(() => { s.mock.restore(); setServiceCredentialForTest(null); });

  const client = await curationClient();
  const key = keyFrom(toolText(await update(client, { nodeId: NODE, content: MARKDOWN })));
  const text = toolText(await update(client, { nodeId: NODE, content: MARKDOWN, confirmToken: key }));
  assert.match(text, /fehlgeschlagen/i);
});

test('a replacement the record does not show afterwards is not called success', async (t) => {
  setServiceCredentialForTest(USER);
  const s = serveUpdate({ stored: false });
  t.after(() => { s.mock.restore(); setServiceCredentialForTest(null); });

  const client = await curationClient();
  const key = keyFrom(toolText(await update(client, { nodeId: NODE, content: MARKDOWN })));
  const text = toolText(await update(client, { nodeId: NODE, content: MARKDOWN, confirmToken: key }));
  assert.match(text, /KEINEN Inhalt/i);
});
