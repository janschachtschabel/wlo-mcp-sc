/**
 * tools-curation-topic-page.test.ts – setting which variant a Themenseite renders.
 *
 * This tool writes `ccm:page_config`, and the P3 gate measurement (staging
 * 2026-08-09, docs/plans/2026-08-09-usecase-gap-tools.md) found that the
 * repository validates NOTHING about it: `POST …/property?property=ccm:page_config`
 * answered 200 for the literal string `"not json at all"` and stored it, and
 * accepted the property on a `ccm:io` that is no page-config folder at all. A
 * broken document does not fail at the API — it fails in the page builder, on a
 * public page.
 *
 * So every guarantee is made here, and these tests are that guarantee: the
 * document is edited rather than composed, a variant that is not a child of this
 * page is refused, an unreadable listing is not mistaken for "no such variant",
 * and an unparseable stored document is left alone.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { registerCurationTopicPageTool } from '../src/tools/curation-topic-page.js';
import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { installFetchMock, toolText } from './fetchMock.js';

const USER: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };
const COLLECTION = 'coll-1';
const FOLDER = 'folder-1';
const VAR_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const VAR_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const REF = (id: string) => `workspace://SpacesStore/${id}`;

async function client(): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerCurationTopicPageTool(server, 'Bearer error="invalid_request"');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  return c;
}

interface ServeOptions {
  /** The folder's stored `ccm:page_config`; `null` means the property is absent. */
  document?: string | null;
  /** `false` makes the children listing fail — unreadable, not empty. */
  childrenReadable?: boolean;
  /** `false` drops `ccm:page_config_ref` from the collection. */
  isTopicPage?: boolean;
  /** `false` makes the property write answer 200 while storing nothing. */
  writeLands?: boolean;
}

function variantNode(id: string, title: string) {
  return {
    ref: { id, repo: '-home-' },
    name: title,
    properties: {
      'cm:name': [title],
      'cclom:title': [title],
      'ccm:page_variant_config': ['{"structure":{"swimlanes":[]}}'],
    },
  };
}

/** A staging-shaped page: one collection → one config folder → two variants. */
function serve(opts: ServeOptions = {}) {
  const {
    document = JSON.stringify({ variants: [REF(VAR_A), REF(VAR_B)] }),
    childrenReadable = true,
    isTopicPage = true,
    writeLands = true,
  } = opts;

  const stored: Record<string, string[]> = {};
  if (document !== null) stored['ccm:page_config'] = [document];

  return installFetchMock((url, init) => {
    const method = init?.method ?? 'GET';
    if (method === 'POST' && url.includes('/property')) {
      if (writeLands) {
        const value = JSON.parse(String(init?.body ?? 'null')) as string[] | null;
        if (value) stored['ccm:page_config'] = value;
      }
      return { json: {} };
    }
    if (url.includes(`/${FOLDER}/children`)) {
      if (!childrenReadable) return { status: 503, json: {} };
      return { json: { nodes: [variantNode(VAR_A, 'Variante A'), variantNode(VAR_B, 'Variante B')] } };
    }
    if (url.includes(`/${FOLDER}/metadata`)) {
      return { json: { node: { ref: { id: FOLDER, repo: '-home-' }, properties: stored } } };
    }
    if (url.includes(`/${COLLECTION}/metadata`)) {
      const props: Record<string, string[]> = { 'cclom:title': ['Bruchrechnung'] };
      if (isTopicPage) props['ccm:page_config_ref'] = [REF(FOLDER)];
      return { json: { node: { ref: { id: COLLECTION, repo: '-home-' }, properties: props } } };
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

/** Preview then confirm, returning both replies. */
async function run(c: Client, args: Record<string, unknown>) {
  const preview = toolText(await c.callTool({ name: 'wlo_set_topic_page', arguments: args }));
  if (!/confirmToken/.test(preview)) return { preview, final: '' };
  const final = toolText(await c.callTool({
    name: 'wlo_set_topic_page',
    arguments: { ...args, confirmToken: tokenFrom(preview) },
  }));
  return { preview, final };
}

async function withPage<T>(opts: ServeOptions, fn: (c: Client, mock: ReturnType<typeof installFetchMock>) => Promise<T>): Promise<T> {
  setServiceCredentialForTest(USER);
  const mock = serve(opts);
  const c = await client();
  try {
    return await fn(c, mock);
  } finally {
    await c.close();
    mock.restore();
    setServiceCredentialForTest(null);
  }
}

// ── the gate ────────────────────────────────────────────────────────────────

test('without a write identity nothing is written', async () => {
  setServiceCredentialForTest(null);
  const mock = serve();
  const c = await client();
  try {
    const res = await c.callTool({
      name: 'wlo_set_topic_page', arguments: { collectionId: COLLECTION, variantId: VAR_B },
    });
    assert.equal((res as { isError?: boolean }).isError, true);
    assert.equal(writes(mock).length, 0);
  } finally {
    await c.close();
    mock.restore();
  }
});

// ── the two-step conversation ───────────────────────────────────────────────

test('no token, no write', async () => {
  await withPage({}, async (c, mock) => {
    const text = toolText(await c.callTool({
      name: 'wlo_set_topic_page', arguments: { collectionId: COLLECTION, variantId: VAR_B },
    }));
    assert.equal(writes(mock).length, 0);
    assert.match(text, /confirmToken/);
  });
});

test('the preview names the page, what is rendered today and what would be', async () => {
  await withPage({ document: JSON.stringify({ variants: [REF(VAR_A), REF(VAR_B)], default: REF(VAR_A) }) },
    async (c) => {
      const text = toolText(await c.callTool({
        name: 'wlo_set_topic_page', arguments: { collectionId: COLLECTION, variantId: VAR_B },
      }));
      assert.match(text, /Bruchrechnung/);
      assert.match(text, /Variante A/);
      assert.match(text, /Variante B/);
    });
});

test('a token minted for one variant does not confirm a call for another', async () => {
  await withPage({}, async (c, mock) => {
    const preview = toolText(await c.callTool({
      name: 'wlo_set_topic_page', arguments: { collectionId: COLLECTION, variantId: VAR_B },
    }));
    const text = toolText(await c.callTool({
      name: 'wlo_set_topic_page',
      arguments: { collectionId: COLLECTION, variantId: VAR_A, confirmToken: tokenFrom(preview) },
    }));
    assert.equal(writes(mock).length, 0);
    assert.match(text, /Bestätigungsschlüssel/);
  });
});

// ── what actually gets written ──────────────────────────────────────────────

test('the document is written through the property endpoint, with default as a store ref', async () => {
  await withPage({}, async (c, mock) => {
    await run(c, { collectionId: COLLECTION, variantId: VAR_B });
    const w = writes(mock);
    assert.equal(w.length, 1);
    const url = new URL(w[0]!.url);
    assert.match(url.pathname, /\/property$/);
    assert.equal(url.searchParams.get('property'), 'ccm:page_config');
    const sent = JSON.parse(JSON.parse(String(w[0]!.init?.body))[0]);
    assert.equal(sent.default, REF(VAR_B));
  });
});

test('the variant list survives the write untouched', async () => {
  await withPage({}, async (c, mock) => {
    await run(c, { collectionId: COLLECTION, variantId: VAR_B });
    const sent = JSON.parse(JSON.parse(String(writes(mock)[0]!.init?.body))[0]);
    assert.deepEqual(sent.variants, [REF(VAR_A), REF(VAR_B)]);
  });
});

test('keys the page builder owns and this code does not know survive the write', async () => {
  const doc = JSON.stringify({ variants: [REF(VAR_A), REF(VAR_B)], layoutHint: { columns: 3 } });
  await withPage({ document: doc }, async (c, mock) => {
    await run(c, { collectionId: COLLECTION, variantId: VAR_B });
    const sent = JSON.parse(JSON.parse(String(writes(mock)[0]!.init?.body))[0]);
    assert.deepEqual(sent.layoutHint, { columns: 3 });
  });
});

test('a successful write is reported only after the read-back shows it', async () => {
  await withPage({}, async (c) => {
    const { final } = await run(c, { collectionId: COLLECTION, variantId: VAR_B });
    assert.match(final, /Variante B/);
    assert.doesNotMatch(final, /nicht|offen/i);
  });
});

test('a 200 that stored nothing is reported as not visible, never as success', async () => {
  await withPage({ writeLands: false }, async (c) => {
    const { final } = await run(c, { collectionId: COLLECTION, variantId: VAR_B });
    assert.match(final, /nicht zu sehen|nachsehen/i);
  });
});

// ── the refusals the repository will not make for us ────────────────────────

test('the variant that already renders is refused, not written again', async () => {
  // No field changes here, so `buildChangeSet` has nothing to drop — the
  // mechanism that spares the other twelve tools a pointless write does not
  // apply. Without this check the preview would read "rendert künftig „B" statt
  // „B"" and confirming it would write an identical document to the one
  // document that steers a public page.
  const doc = JSON.stringify({ variants: [REF(VAR_A), REF(VAR_B)], default: REF(VAR_B) });
  await withPage({ document: doc }, async (c, mock) => {
    const text = toolText(await c.callTool({
      name: 'wlo_set_topic_page', arguments: { collectionId: COLLECTION, variantId: VAR_B },
    }));
    assert.equal(writes(mock).length, 0);
    assert.doesNotMatch(text, /confirmToken/);
    assert.match(text, /bereits/);
  });
});

test('recording an explicit default for the variant that renders by position IS a change', async () => {
  // The counterpart of the test above, and the reason it cannot simply compare
  // ids: with no `default` recorded the page renders `variants[0]` by position.
  // Writing that same variant down explicitly changes the document from
  // "whatever happens to be first" to a decision — refusing it would block the
  // one call that makes a page's rendering stable.
  await withPage({}, async (c, mock) => {
    await run(c, { collectionId: COLLECTION, variantId: VAR_A });
    assert.equal(writes(mock).length, 1);
    const sent = JSON.parse(JSON.parse(String(writes(mock)[0]!.init?.body))[0]);
    assert.equal(sent.default, REF(VAR_A));
  });
});

test('refuses a variant that is not a child of this page, and writes nothing', async () => {
  await withPage({}, async (c, mock) => {
    const text = toolText(await c.callTool({
      name: 'wlo_set_topic_page',
      arguments: { collectionId: COLLECTION, variantId: 'cccccccc-0000-0000-0000-000000000003' },
    }));
    assert.equal(writes(mock).length, 0);
    assert.match(text, /Variante/);
  });
});

test('an unreadable variant listing is refused as unreadable, not as "no such variant"', async () => {
  await withPage({ childrenReadable: false }, async (c, mock) => {
    const text = toolText(await c.callTool({
      name: 'wlo_set_topic_page', arguments: { collectionId: COLLECTION, variantId: VAR_B },
    }));
    assert.equal(writes(mock).length, 0);
    assert.match(text, /nicht lesbar|nicht gelesen/i);
  });
});

test('refuses a collection that is no Themenseite', async () => {
  await withPage({ isTopicPage: false }, async (c, mock) => {
    const text = toolText(await c.callTool({
      name: 'wlo_set_topic_page', arguments: { collectionId: COLLECTION, variantId: VAR_B },
    }));
    assert.equal(writes(mock).length, 0);
    assert.match(text, /Themenseite/);
  });
});

test('an unparseable stored document is left alone, not replaced', async () => {
  await withPage({ document: 'not json at all' }, async (c, mock) => {
    const text = toolText(await c.callTool({
      name: 'wlo_set_topic_page', arguments: { collectionId: COLLECTION, variantId: VAR_B },
    }));
    assert.equal(writes(mock).length, 0);
    assert.match(text, /JSON/i);
  });
});

test('a page-config folder without a document gets none invented for it', async () => {
  await withPage({ document: null }, async (c, mock) => {
    const text = toolText(await c.callTool({
      name: 'wlo_set_topic_page', arguments: { collectionId: COLLECTION, variantId: VAR_B },
    }));
    assert.equal(writes(mock).length, 0);
    assert.match(text, /page_config/);
  });
});

/**
 * A variant that was never renamed keeps `PAGE_VARIANT_<uuid>` in BOTH `cm:name`
 * and `cclom:title` — 22 of 68 staging variants do. The preview took
 * `cclom:title` unguarded, so the sentence a person confirms could name the
 * target by a technical id and give them nothing to check. The confirm token
 * binds to exactly that sentence, which makes this more than a display glitch.
 */
test('the preview does not name a variant by its PAGE_VARIANT placeholder', async () => {
  setServiceCredentialForTest(USER);
  const placeholder = `PAGE_VARIANT_${VAR_A}`;
  const mock = installFetchMock((url, init) => {
    const method = init?.method ?? 'GET';
    if (method === 'POST' && url.includes('/property')) return { json: {} };
    if (url.includes(`/${FOLDER}/children`)) {
      return { json: { nodes: [variantNode(VAR_A, placeholder), variantNode(VAR_B, 'Variante B')] } };
    }
    if (url.includes(`/${FOLDER}/metadata`)) {
      return { json: { node: { ref: { id: FOLDER, repo: '-home-' },
        properties: { 'ccm:page_config': [JSON.stringify({ variants: [REF(VAR_A), REF(VAR_B)], default: REF(VAR_B) })] } } } };
    }
    if (url.includes(`/${COLLECTION}/metadata`)) {
      return { json: { node: { ref: { id: COLLECTION, repo: '-home-' },
        properties: { 'cclom:title': ['Bruchrechnung'], 'ccm:page_config_ref': [REF(FOLDER)] } } } };
    }
    return { json: {} };
  });
  const c = await client();
  try {
    const preview = toolText(await c.callTool({
      name: 'wlo_set_topic_page',
      arguments: { collectionId: COLLECTION, variantId: VAR_A },
    }));
    assert.doesNotMatch(preview, /PAGE_VARIANT_/, 'a technical id is not something a person can check');
    assert.match(preview, new RegExp(VAR_A), 'the id itself still identifies the variant');
  } finally {
    await c.close();
    mock.restore();
  }
});

/** Same sentence pattern, same trap: the no-op refusal also names the variant. */
test('the no-op refusal names an unnamed variant by id, not by empty quotes', async () => {
  setServiceCredentialForTest(USER);
  const placeholder = `PAGE_VARIANT_${VAR_A}`;
  const mock = installFetchMock((url) => {
    if (url.includes(`/${FOLDER}/children`)) {
      return { json: { nodes: [variantNode(VAR_A, placeholder), variantNode(VAR_B, 'Variante B')] } };
    }
    if (url.includes(`/${FOLDER}/metadata`)) {
      return { json: { node: { ref: { id: FOLDER, repo: '-home-' },
        properties: { 'ccm:page_config': [JSON.stringify({ variants: [REF(VAR_A)], default: REF(VAR_A) })] } } } };
    }
    if (url.includes(`/${COLLECTION}/metadata`)) {
      return { json: { node: { ref: { id: COLLECTION, repo: '-home-' },
        properties: { 'cclom:title': ['Bruchrechnung'], 'ccm:page_config_ref': [REF(FOLDER)] } } } };
    }
    return { json: {} };
  });
  const c = await client();
  try {
    const reply = toolText(await c.callTool({
      name: 'wlo_set_topic_page',
      arguments: { collectionId: COLLECTION, variantId: VAR_A },
    }));
    assert.match(reply, /bereits/, 'still the no-op refusal');
    assert.doesNotMatch(reply, /„“/, 'not a pair of empty quotes where a name belongs');
    assert.match(reply, new RegExp(VAR_A));
  } finally {
    await c.close();
    mock.restore();
  }
});
