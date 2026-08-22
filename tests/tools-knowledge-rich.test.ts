/**
 * tools-knowledge-rich.test.ts – `WLO_SEARCH_OUTPUT_MODE=rich`: `search` carries
 * the same metadata, buckets and widget as `search_wlo_all`, WITHOUT breaking
 * the ChatGPT knowledge convention it is registered under.
 *
 * The convention's own words (developers.openai.com/api/docs/mcp): the result is
 * "an object with a single key, results", each item carrying id / title / url.
 * A third-party report describes connectors filtering out "any or all items"
 * whose shape does not match — an all-or-nothing failure that would be invisible
 * from here. Every test below therefore re-asserts the convention shape; the
 * enrichment may only ever ADD sibling keys.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { registerKnowledgeTools } from '../src/tools/knowledge.js';
import { resolveSearchOutputMode } from '../src/wlo-config.js';
import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { installFetchMock, makeNode, type MockResult } from './fetchMock.js';

const WIDGET = 'ui://widget/search-results.html';

async function knowledgeClient(
  opts: { mode?: 'lean' | 'rich'; widgetUri?: string } = {},
): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerKnowledgeTools(server, { mode: opts.mode ?? 'lean', widgetUri: opts.widgetUri });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  return c;
}

/** One content hit carrying every field the lean projection throws away. */
function richMock() {
  const node = {
    ...makeNode('n1', 'Photosynthese erklärt', {
      'ccm:wwwurl': ['https://example.org/photo'],
      'cclom:general_description': ['Ein Erklärvideo.'],
      'ccm:commonlicense_key': ['CC_BY'],
      'ccm:taxonid_DISPLAYNAME': ['Biologie'],
      'ccm:educationalcontext_DISPLAYNAME': ['Sekundarstufe I'],
    }),
    preview: { url: 'https://example.org/preview.png', isIcon: false },
  };
  return installFetchMock((url): MockResult => {
    if (url.includes('/collections') || url.includes('/children')) return { json: { nodes: [] } };
    return { json: { nodes: [node], pagination: { total: 1, from: 0, count: 1 } } };
  });
}

/** The convention shape, re-checked in every mode. */
function assertConventionShape(payload: unknown) {
  const p = payload as { results?: Array<Record<string, unknown>> };
  assert.ok(Array.isArray(p.results), 'a `results` array is present');
  for (const r of p.results!) {
    assert.deepEqual(
      Object.keys(r).sort(), ['id', 'title', 'url'],
      'a result item carries the three convention fields and nothing else',
    );
    for (const k of ['id', 'title', 'url'] as const) {
      assert.equal(typeof r[k], 'string', `${k} is a string`);
    }
  }
}

test('lean mode (the default) is unchanged: only `results`, no widget', async () => {
  const mock = richMock();
  const client = await knowledgeClient();
  try {
    const tools = await client.listTools();
    const search = tools.tools.find(t => t.name === 'search');
    assert.ok(search, 'search is registered');
    assert.equal((search!._meta as Record<string, unknown> | undefined)?.['openai/outputTemplate'], undefined,
      'lean mode declares no widget — there is nothing rich to render');

    const result = await client.callTool({ name: 'search', arguments: { query: 'Photosynthese' } });
    const sc = result.structuredContent as Record<string, unknown>;
    assertConventionShape(sc);
    assert.deepEqual(Object.keys(sc), ['results'], 'no sibling keys in lean mode');
  } finally { await client.close(); mock.restore(); }
});

test('rich mode keeps the convention shape and ADDS the buckets', async () => {
  const mock = richMock();
  const client = await knowledgeClient({ mode: 'rich' });
  try {
    const result = await client.callTool({ name: 'search', arguments: { query: 'Photosynthese' } });
    const sc = result.structuredContent as Record<string, unknown>;

    assertConventionShape(sc);   // the non-negotiable half

    const content = sc['content'] as { results: Array<Record<string, unknown>> };
    assert.ok(Array.isArray(content?.results), 'the content bucket is present');
    assert.ok(sc['collections'], 'the collections bucket is present');
    assert.ok(sc['topicPages'], 'the topicPages bucket is present');

    // The point of the whole exercise: the fields the lean projection drops.
    const hit = content.results[0];
    assert.equal(hit['license'], 'CC BY');
    assert.deepEqual(hit['disciplines'], ['Biologie']);
    assert.deepEqual(hit['educationalContexts'], ['Sekundarstufe I']);
    assert.equal(hit['previewUrl'], 'https://example.org/preview.png');
    assert.equal(hit['description'], 'Ein Erklärvideo.');
  } finally { await client.close(); mock.restore(); }
});

test('rich mode ships no compendium text — `search` cannot ask for it', async () => {
  // Measured 2026-08-09 on staging: for "Klimawandel" the inline
  // `ccm:oeh_collection_compendium_text` was 61 742 of 93 583 characters — 66 %
  // of a payload the convention sends TWICE. On `search_wlo_all` the compendium
  // is opt-in (`includeCompendium`, default off); `search` takes a single
  // `query` and can never opt in, so delivering it anyway is unrequested bulk.
  // No widget reads the field either.
  const node = {
    ...makeNode('c1', 'Klimawandel und Klimaschutz', {
      'ccm:oeh_collection_compendium_text': ['Ein sehr langer kuratierter Text. '.repeat(200)],
    }),
    type: 'ccm:map',
  };
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/collections')) return { json: { nodes: [node] } };
    if (url.includes('/children')) return { json: { nodes: [] } };
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
  const client = await knowledgeClient({ mode: 'rich' });
  try {
    const result = await client.callTool({ name: 'search', arguments: { query: 'Klimawandel' } });
    const text = (result.content as Array<{ text: string }>)[0].text;
    assert.ok(text.includes('Klimawandel und Klimaschutz'), 'the collection itself is still returned');
    assert.ok(!text.includes('compendiumText'), 'no compendium text rides along');
    assert.ok(!text.includes('kuratierter Text'), 'and none of its content either');
  } finally { await client.close(); mock.restore(); }
});

test('rich mode declares the search-results widget', async () => {
  const mock = richMock();
  const client = await knowledgeClient({ mode: 'rich', widgetUri: WIDGET });
  try {
    const tools = await client.listTools();
    const search = tools.tools.find(t => t.name === 'search');
    const meta = search!._meta as Record<string, unknown>;
    assert.equal(meta['openai/outputTemplate'], WIDGET, 'the host is told which widget renders this');
  } finally { await client.close(); mock.restore(); }
});

test('content[0].text stays the SAME JSON as structuredContent in both modes', async () => {
  // The convention has ChatGPT read the payload out of content[0].text. If the
  // two ever drift, one of the two consumers silently sees a different result.
  for (const mode of ['lean', 'rich'] as const) {
    const mock = richMock();
    const client = await knowledgeClient({ mode });
    try {
      const result = await client.callTool({ name: 'search', arguments: { query: 'Photosynthese' } });
      const text = (result.content as Array<{ text: string }>)[0].text;
      // Compared AFTER a JSON round-trip, which is what a real transport does to
      // both halves. The in-memory transport hands `structuredContent` over as a
      // live object, so optional fields left `undefined` survive there while
      // JSON.stringify drops them — a difference that cannot reach a client.
      assert.deepEqual(
        JSON.parse(text),
        JSON.parse(JSON.stringify(result.structuredContent)),
        `${mode}: text mirrors structuredContent on the wire`,
      );
      assertConventionShape(JSON.parse(text));
    } finally { await client.close(); mock.restore(); }
  }
});

/** The convention shape for `fetch`, re-checked in every mode. */
function assertFetchConventionShape(payload: unknown) {
  const d = payload as Record<string, unknown>;
  for (const k of ['id', 'title', 'text', 'url'] as const) {
    assert.equal(typeof d[k], 'string', `${k} is a string`);
  }
  assert.equal(typeof d['metadata'], 'object', 'metadata is an object');
}

function fetchMock() {
  const node = {
    ...makeNode('n1', 'Photosynthese erklärt', {
      'ccm:wwwurl': ['https://example.org/photo'],
      'cclom:general_description': ['Ein Erklärvideo.'],
      'ccm:commonlicense_key': ['CC_BY'],
    }),
    preview: { url: 'https://example.org/preview.png', isIcon: false },
    downloadUrl: 'https://example.org/download',
  };
  return installFetchMock((url): MockResult => {
    if (url.includes('/textContent')) return { json: { content: 'Der volle Text.' } };
    if (url.includes('/metadata')) return { json: { node } };
    return { json: {} };
  });
}

test('lean fetch is unchanged: convention shape only, no widget', async () => {
  const mock = fetchMock();
  const client = await knowledgeClient({ widgetUri: WIDGET });
  try {
    const tools = await client.listTools();
    const fetchTool = tools.tools.find(t => t.name === 'fetch');
    assert.equal((fetchTool!._meta as Record<string, unknown> | undefined)?.['openai/outputTemplate'], undefined);

    const result = await client.callTool({ name: 'fetch', arguments: { id: 'n1' } });
    const sc = result.structuredContent as Record<string, unknown>;
    assertFetchConventionShape(sc);
    assert.deepEqual(Object.keys(sc).sort(), ['id', 'metadata', 'text', 'title', 'url']);
  } finally { await client.close(); mock.restore(); }
});

test('rich fetch keeps the convention shape, adds the full node and the widget', async () => {
  const mock = fetchMock();
  const client = await knowledgeClient({ mode: 'rich', widgetUri: WIDGET });
  try {
    const tools = await client.listTools();
    const fetchTool = tools.tools.find(t => t.name === 'fetch');
    assert.equal((fetchTool!._meta as Record<string, unknown>)['openai/outputTemplate'], WIDGET,
      'the detail answer can render like get_node_details');

    const result = await client.callTool({ name: 'fetch', arguments: { id: 'n1' } });
    const sc = result.structuredContent as Record<string, unknown>;
    assertFetchConventionShape(sc);   // the non-negotiable half

    const results = (sc['results'] as Array<Record<string, unknown>>);
    assert.equal(results?.length, 1, 'the node rides along in the shape the widget knows');
    // The fields `fetch` used to drop — previewUrl is the preview image itself.
    assert.equal(results[0]['previewUrl'], 'https://example.org/preview.png');
    assert.equal(results[0]['downloadUrl'], 'https://example.org/download');
    assert.equal(results[0]['description'], 'Ein Erklärvideo.');
    assert.equal(results[0]['nodeId'], 'n1');
  } finally { await client.close(); mock.restore(); }
});

/** A restricted hit whose repository preview answers a JPEG when asked with credit. */
function restrictedMock() {
  const locked = {
    ...makeNode('locked', 'SUPRA Einheit', { 'cclom:general_description': ['Redaktionsbestand.'] }),
    isPublic: false,
    preview: { url: 'https://repository.staging.openeduhub.net/edu-sharing/preview?nodeId=locked', isIcon: false },
  };
  return installFetchMock((url): MockResult => {
    if (url.includes('/preview?nodeId=locked')) {
      return { body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]), headers: { 'content-type': 'image/jpeg' } };
    }
    if (url.includes('/textContent')) return { json: { content: 'Text.' } };
    if (url.includes('/metadata')) return { json: { node: locked } };
    if (url.includes('/collections') || url.includes('/children')) return { json: { nodes: [] } };
    return { json: { nodes: [locked], pagination: { total: 1, from: 0, count: 1 } } };
  });
}

test('rich search ships the restricted preview in result _meta — same widget, same rule as search_wlo_all', async () => {
  const mock = restrictedMock();
  const client = await knowledgeClient({ mode: 'rich', widgetUri: WIDGET });
  try {
    const result = await client.callTool({ name: 'search', arguments: { query: 'SUPRA' } });
    const map = (result as { _meta?: Record<string, unknown> })._meta?.['wlo/previewData'] as
      Record<string, string> | undefined;
    assert.match(map?.['locked'] ?? '', /^data:image\/jpeg;base64,/);
    assert.ok(!JSON.stringify(result.structuredContent).includes('base64'), 'the model-facing payload stays clean');
    assertConventionShape(result.structuredContent);   // the enrichment never bends the convention
  } finally { await client.close(); mock.restore(); }
});

test('lean search fetches no preview at all — no widget exists to read the channel', async () => {
  const mock = restrictedMock();
  const client = await knowledgeClient();
  try {
    const result = await client.callTool({ name: 'search', arguments: { query: 'SUPRA' } });
    assert.equal((result as { _meta?: Record<string, unknown> })._meta?.['wlo/previewData'], undefined);
    assert.ok(!mock.calls.some(c => c.url.includes('/preview?')), 'the fetches are not paid in lean mode');
  } finally { await client.close(); mock.restore(); }
});

test('rich fetch ships the restricted preview for the detail view', async () => {
  const mock = restrictedMock();
  const client = await knowledgeClient({ mode: 'rich', widgetUri: WIDGET });
  try {
    const result = await client.callTool({ name: 'fetch', arguments: { id: 'locked' } });
    const map = (result as { _meta?: Record<string, unknown> })._meta?.['wlo/previewData'] as
      Record<string, string> | undefined;
    assert.match(map?.['locked'] ?? '', /^data:image\/jpeg;base64,/);
  } finally { await client.close(); mock.restore(); }
});

test('an unknown WLO_SEARCH_OUTPUT_MODE falls back to lean', () => {
  // Rich is the unmeasured option; a typo must not silently enable it.
  assert.equal(resolveSearchOutputMode('rich'), 'rich');
  assert.equal(resolveSearchOutputMode('lean'), 'lean');
  assert.equal(resolveSearchOutputMode('RICH'), 'rich', 'case-insensitive, like the other mode switches');
  assert.equal(resolveSearchOutputMode('richt'), 'lean');
  assert.equal(resolveSearchOutputMode(''), 'lean');
  assert.equal(resolveSearchOutputMode(undefined), 'lean');
});
