/**
 * refused-is-not-unreachable.test.ts – chatbot feedback 2026-11-13, D5–D7.
 *
 *   - D6: a listing the repository REFUSED (401/403/404) was answered. It is
 *     "not readable for this login" or "not there" — permanent — and must not
 *     be reported as "did not answer, try again" (`incomplete`,
 *     `childrenUnread`, `source_unreachable`).
 *   - D5: `search_skill` says WHY its walk is incomplete: an outage, or a bound.
 *   - D7: `incomplete: true` is in the JSON TEXT too, not only beside it.
 */

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { collectRecursiveContents } from '../src/services/collection-traversal.js';
import { searchSkillsDetailed } from '../src/services/skills.js';
import { stopSkillRegistryCache } from '../src/services/skill-registry-cache.js';
import { didNotAnswer, getChildCollectionsResult } from '../src/wlo-node.js';
import { connectedClient, installFetchMock, makeNode, toolText, type MockResult } from './fetchMock.js';

const idOf = (url: string) => decodeURIComponent(new URL(url).pathname.match(/-home-\/([^/]+)\/children/)?.[1] ?? '');
const page = (nodes: unknown[], total = nodes.length) => ({ json: { nodes, pagination: { total, from: 0, count: nodes.length } } });
const structured = (r: unknown) => (r as { structuredContent: Record<string, unknown> }).structuredContent;
const branch = (id: string, title: string) =>
  ({ ref: { id }, type: 'ccm:map', aspects: ['ccm:collection'], properties: { 'cm:title': [title] } });

// ── D6 ───────────────────────────────────────────────────────────────────────

for (const status of [401, 403, 404]) {
  test(`a child listing answered ${status} was ANSWERED — it carries the refusal, and didNotAnswer says no`, async () => {
    const mock = installFetchMock((): MockResult => ({ status, json: {} }));
    try {
      const listing = await getChildCollectionsResult('x');
      assert.deepEqual(listing, { nodes: [], reachable: false, refused: status });
      assert.equal(didNotAnswer(listing), false);
    } finally { mock.restore(); }
  });
}

for (const status of [429, 500, 503]) {
  test(`a child listing answered ${status} is still "did not find out"`, async () => {
    const mock = installFetchMock((): MockResult => ({ status, json: {} }));
    try {
      const listing = await getChildCollectionsResult('x');
      assert.deepEqual(listing, { nodes: [], reachable: false });
      assert.equal(didNotAnswer(listing), true);
    } finally { mock.restore(); }
  });
}

test('browse_collection_tree: a branch whose children are not readable for this login is not "try again"', async () => {
  stopSkillRegistryCache();
  const mock = installFetchMock((url): MockResult => {
    if (!url.includes('/children')) return { json: {} };
    if (new URL(url).searchParams.get('filter') !== 'folders') return page([]);
    if (idOf(url) === 'b-1') return { status: 403, json: {} };
    return idOf(url).startsWith('b-') ? page([]) : page([branch('b-1', 'Optik'), branch('b-2', 'Mechanik')]);
  });
  const client = await connectedClient();
  try {
    const r = await client.callTool({ name: 'browse_collection_tree', arguments: { nodeId: 'top', depth: 2 } });
    assert.doesNotMatch(toolText(r), /ließen sich gerade nicht lesen/);
    assert.doesNotMatch(JSON.stringify(structured(r)), /childrenUnread/);
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

test('browse_collection_tree: a root that is gone is an error that says so — not "derzeit nicht abrufbar", not an empty tree', async () => {
  stopSkillRegistryCache();
  const mock = installFetchMock((): MockResult => ({ status: 404, json: {} }));
  const client = await connectedClient();
  try {
    const r = await client.callTool({ name: 'browse_collection_tree', arguments: { nodeId: 'weg', depth: 2 } });
    assert.equal(r.isError, true, toolText(r));
    assert.match(toolText(r), /nicht gefunden oder .*nicht lesbar/);
    assert.doesNotMatch(toolText(r), /derzeit nicht/);
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

test('search_wlo_collections with a start node that is gone says so', async () => {
  stopSkillRegistryCache();
  const mock = installFetchMock((url): MockResult => (url.includes('/children') ? { status: 404, json: {} } : { json: {} }));
  const client = await connectedClient();
  try {
    const r = await client.callTool({ name: 'search_wlo_collections', arguments: { parentNodeId: 'weg' } });
    assert.equal(r.isError, true, toolText(r));
    assert.match(toolText(r), /nicht gefunden oder .*nicht lesbar/);
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

test('the recursive walk does not call a refused sub-listing an outage', async () => {
  const mock = installFetchMock((url): MockResult => {
    const folders = new URL(url).searchParams.get('filter') === 'folders';
    if (!folders) return page([makeNode(`f-${idOf(url)}`, 'Datei')]);
    if (idOf(url) === 'root') return page([branch('s-1', 'Unter')]);
    return { status: 403, json: {} };
  });
  try {
    const walk = await collectRecursiveContents('root', 50, new Set(), undefined);
    assert.notEqual(walk.incomplete, true);
  } finally { mock.restore(); }
});

test('get_topic_page_content: variants this login may not read are "no_variant" — not an outage', async () => {
  stopSkillRegistryCache();
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/coll-9/metadata')) {
      return { json: { node: { ...branch('coll-9', 'Optik'),
        properties: { 'cm:title': ['Optik'], 'ccm:page_config_ref': ['workspace://SpacesStore/cfg-9'] } } } };
    }
    if (url.includes('/cfg-9/children')) return { status: 403, json: {} };
    return page([]);
  });
  const client = await connectedClient();
  try {
    const r = await client.callTool({ name: 'get_topic_page_content', arguments: { collectionId: 'coll-9' } });
    assert.equal(structured(r)['reason'], 'no_variant', toolText(r));
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

// ── D5 ───────────────────────────────────────────────────────────────────────

test('a skill walk says WHY it is incomplete: an outage', async () => {
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('filter=folders')) return { status: 503, json: {} };
    if (url.includes('filter=files')) return page([]);
    return { json: {} };
  });
  try {
    const r = await searchSkillsDetailed({ collectionId: 'skills-root' });
    assert.equal(r.incomplete, true);
    assert.equal(r.incompleteReason, 'unreachable');
  } finally { mock.restore(); }
});

test('a skill walk says WHY it is incomplete: a bound — retrying changes nothing', async () => {
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('filter=folders')) return page([]);
    if (url.includes('filter=files')) return page([makeNode('m-1', 'Material')], 900);
    return { json: {} };
  });
  try {
    const r = await searchSkillsDetailed({ collectionId: 'skills-root' });
    assert.equal(r.incomplete, true);
    assert.equal(r.incompleteReason, 'limit');
  } finally { mock.restore(); }
});

test('a refused sub-listing does not make a skill walk incomplete', async () => {
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('filter=folders')) return { status: 403, json: {} };
    if (url.includes('filter=files')) return page([]);
    return { json: {} };
  });
  try {
    assert.notEqual((await searchSkillsDetailed({ collectionId: 'skills-root' })).incomplete, true);
  } finally { mock.restore(); }
});

test('search_skill carries the reason in JSON and says it in the text', async () => {
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('filter=folders')) return { status: 503, json: {} };
    if (url.includes('filter=files')) return page([]);
    return { json: {} };
  });
  const client = await connectedClient();
  try {
    const json = await client.callTool({ name: 'search_skill', arguments: { collectionId: 'skills-root', includeSubcollections: true, outputFormat: 'json' } });
    const payload = JSON.parse((json as { content: Array<{ text: string }> }).content[0]!.text) as Record<string, unknown>;
    assert.equal(payload['incomplete'], true);
    assert.equal(payload['incompleteReason'], 'unreachable');
    const text = toolText(await client.callTool({ name: 'search_skill', arguments: { collectionId: 'skills-root', includeSubcollections: true } }));
    assert.match(text, /hat gerade nicht geantwortet/);
  } finally { await client.close(); mock.restore(); }
});

// ── D7 ───────────────────────────────────────────────────────────────────────

test('search_wlo_collections: incomplete is IN the JSON text, with hits and without', async () => {
  stopSkillRegistryCache();
  const hit = { ...makeNode('k-1', 'Optik Grundlagen'), type: 'ccm:map', aspects: ['ccm:collection'], isDirectory: true };
  for (const nodes of [[hit], []]) {
    const mock = installFetchMock((url): MockResult => {
      if (url.includes('/mds_oeh/collections')) return { json: { nodes } };
      if (url.includes('/collection/v1/collections/-home-/search')) return { status: 503, json: {} };
      if (url.includes('/children')) return page([]);
      return { json: {} };
    });
    const client = await connectedClient();
    try {
      const r = await client.callTool({ name: 'search_wlo_collections', arguments: { query: 'Optik', outputFormat: 'json' } });
      const payload = JSON.parse((r as { content: Array<{ text: string }> }).content[0]!.text) as Record<string, unknown>;
      assert.equal(payload['incomplete'], true, `${nodes.length} hits: ${toolText(r).slice(0, 200)}`);
      assert.equal(structured(r)['incomplete'], true);
    } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
  }
});

test('search_wlo_collections: a complete answer carries no such key in its JSON text', async () => {
  stopSkillRegistryCache();
  const hit = { ...makeNode('k-1', 'Optik Grundlagen'), type: 'ccm:map', aspects: ['ccm:collection'], isDirectory: true };
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/mds_oeh/collections')) return { json: { nodes: [hit] } };
    if (url.includes('/collection/v1/collections/-home-/search')) return { json: { collections: [] } };
    return page([]);
  });
  const client = await connectedClient();
  try {
    const r = await client.callTool({ name: 'search_wlo_collections', arguments: { query: 'Optik', outputFormat: 'json' } });
    const payload = JSON.parse((r as { content: Array<{ text: string }> }).content[0]!.text) as Record<string, unknown>;
    assert.equal('incomplete' in payload, false);
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

test('search_wlo_topic_pages: a partial answer says incomplete in its JSON text', async () => {
  stopSkillRegistryCache();
  const owner = { ...branch('k-1', 'Optik'),
    properties: { 'cm:title': ['Optik'], 'ccm:page_config_ref': ['workspace://SpacesStore/cfg-1'] } };
  const variant = { ref: { id: 'v-1' }, type: 'ccm:map',
    properties: { 'cm:title': ['Optik'], 'ccm:page_variant_config': ['{"structure":{"swimlanes":[]}}'] } };
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/mds_oeh/collections')) return { json: { nodes: [owner] } };
    if (url.includes('/collection/v1/collections/-home-/search')) return { status: 503, json: {} };
    if (url.includes('/k-1/metadata')) return { json: { node: owner } };
    if (url.includes('/cfg-1/children')) return page([variant]);
    if (url.includes('/children')) return page([]);
    return { json: {} };
  });
  const client = await connectedClient();
  try {
    const r = await client.callTool({ name: 'search_wlo_topic_pages', arguments: { query: 'Optik', outputFormat: 'json' } });
    assert.equal(structured(r)['incomplete'], true, toolText(r).slice(0, 300));
    const payload = JSON.parse((r as { content: Array<{ text: string }> }).content[0]!.text) as Record<string, unknown>;
    assert.ok(Array.isArray(payload['results']) && (payload['results'] as unknown[]).length === 1, 'the fixture must yield a hit');
    assert.equal(payload['incomplete'], true);
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

// ── review of D5/D6 ──────────────────────────────────────────────────────────

const errorCode = (r: unknown) => ((r as { structuredContent?: { error?: { code?: string } } }).structuredContent?.error?.code);

test('a skill walk: a sub-collection whose CONTENTS this login may not read is no outage', async () => {
  const mock = installFetchMock((url): MockResult => {
    const folders = url.includes('filter=folders');
    if (idOf(url) === 'skills-root') return folders ? page([branch('s-1', 'Geschlossen')]) : page([]);
    return folders ? page([]) : { status: 403, json: {} };
  });
  try {
    const r = await searchSkillsDetailed({ collectionId: 'skills-root', includeSubcollections: true });
    assert.notEqual(r.incomplete, true, JSON.stringify(r));
  } finally { mock.restore(); }
});

test('a skill walk over a root that is gone says so — not "derzeit nicht abrufbar"', async () => {
  const mock = installFetchMock((): MockResult => ({ status: 404, json: {} }));
  try {
    await assert.rejects(searchSkillsDetailed({ collectionId: 'weg' }), /nicht gefunden oder .*nicht lesbar/);
  } finally { mock.restore(); }
});

test('a refused start node carries the code of a refusal, not of an outage', async () => {
  stopSkillRegistryCache();
  for (const [status, code] of [[404, 'not_found'], [403, 'forbidden']] as const) {
    const mock = installFetchMock((): MockResult => ({ status, json: {} }));
    const client = await connectedClient();
    try {
      const tree = await client.callTool({ name: 'browse_collection_tree', arguments: { nodeId: 'weg', depth: 2 } });
      assert.equal(errorCode(tree), code, toolText(tree));
      const contents = await client.callTool({ name: 'get_collection_contents', arguments: { nodeId: 'weg' } });
      assert.equal(contents.isError, true);
      assert.equal(errorCode(contents), code, toolText(contents));
      const portals = await client.callTool({ name: 'get_subject_portals', arguments: {} });
      assert.equal(portals.isError, true);
      assert.doesNotMatch(toolText(portals), /derzeit/);
      assert.equal(errorCode(portals), code);
    } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
  }
});

// ── the wordings a client recognises ────────────────────────────────────────

test('the four notice wordings the chatbot matches on are still in the source', () => {
  // Until every outage has a field in every format, the chatbot recognises
  // these (its feedback of 2026-11-13, on D7). Changing one is a change of
  // contract in practice: tell them first, then change the test.
  const src = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  assert.match(src('services/collection-search.ts'), /hat nicht \(vollständig\) geantwortet/);
  assert.match(src('services/collection-search.ts'), /war nur teilweise erreichbar/);
  assert.match(src('tools/browse.ts'), /ließen sich gerade nicht lesen/);
  assert.match(src('tools/collections.ts'), /ließ sich gerade nicht lesen/);
  assert.match(src('tools/wikipedia.ts'), /Wikipedia hat gerade nicht geantwortet/);
  assert.match(src('tools/content-search.ts'), /Wikipedia hat gerade nicht geantwortet/);
});
