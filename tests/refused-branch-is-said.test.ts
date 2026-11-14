/**
 * refused-branch-is-said.test.ts – chatbot team, answer of 2026-11-14 (points 1 and 2).
 *
 * D6 stopped a REFUSED sub-listing (401/403/404) from being reported as an
 * outage — and left nothing in its place: a branch this login may not read was
 * silently an empty one, and the tree looked complete. A model then says "there
 * is nothing more there". Refused is neither "try again" nor "empty": it is
 * said, with a field of its own (`childrenRefused` on a tree node, `restricted`
 * on a list answer) and a sentence that does not promise a retry.
 *
 * Point 2: the same refusal met on a sub-collection's CONTENTS ended the whole
 * recursive call. Both are now treated alike: the branch is left out and marked.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RESTRICTED_NOTICE, collectRecursiveContents, findCollectionsByTreeTraversal } from '../src/services/collection-traversal.js';
import { searchSkillsDetailed } from '../src/services/skills.js';
import { stopSkillRegistryCache } from '../src/services/skill-registry-cache.js';
import type { WloNode } from '../src/wlo-api.js';
import { installFetchMock, makeNode, strictClient, toolText, type MockResult } from './fetchMock.js';

const idOf = (url: string) => decodeURIComponent(new URL(url).pathname.match(/-home-\/([^/]+)\/children/)?.[1] ?? '');
const isFolders = (url: string) => new URL(url).searchParams.get('filter') === 'folders';
const page = (nodes: unknown[], total = nodes.length) => ({ json: { nodes, pagination: { total, from: 0, count: nodes.length } } });
const structured = (r: unknown) => (r as { structuredContent: Record<string, unknown> }).structuredContent;
const firstJson = (r: unknown) => JSON.parse((r as { content: Array<{ text: string }> }).content[0]!.text) as Record<string, unknown>;
const branch = (id: string, title: string) =>
  ({ ref: { id }, type: 'ccm:map', aspects: ['ccm:collection'], properties: { 'cm:title': [title], 'cclom:title': [title] } });

test('the notice promises no retry', () => {
  assert.match(RESTRICTED_NOTICE, /mit dieser Anmeldung nicht lesbar/);
  assert.doesNotMatch(RESTRICTED_NOTICE, /später|Später|erneut versuchen|gerade nicht/);
});

// ── browse_collection_tree ──────────────────────────────────────────────────

for (const status of [401, 403, 404]) {
  test(`browse_collection_tree: a branch answered ${status} is marked childrenRefused and said — not empty, not "later"`, async () => {
    stopSkillRegistryCache();
    const mock = installFetchMock((url): MockResult => {
      if (!url.includes('/children')) return { json: {} };
      if (!isFolders(url)) return page([]);
      if (idOf(url) === 'b-1') return { status, json: {} };
      return idOf(url).startsWith('b-') ? page([]) : page([branch('b-1', 'Optik'), branch('b-2', 'Mechanik')]);
    });
    const client = await strictClient();
    try {
      const r = await client.callTool({ name: 'browse_collection_tree', arguments: { nodeId: 'top', depth: 2 } });
      const results = structured(r)['results'] as Array<Record<string, unknown>>;
      const closed = results.find(n => n['nodeId'] === 'b-1')!;
      const open = results.find(n => n['nodeId'] === 'b-2')!;
      assert.equal(closed['childrenRefused'], true);
      assert.equal('childrenUnread' in closed, false);
      assert.equal('childrenRefused' in open, false, 'a readable branch carries no such key');
      const text = toolText(r);
      assert.match(text, /Unterthemen von „?Optik.*mit dieser Anmeldung nicht lesbar/s);
      assert.doesNotMatch(text, /Später erneut|ließen sich gerade nicht lesen/);
    } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
  });
}

test('browse_collection_tree: an OUTAGE keeps its own mark and sentence', async () => {
  stopSkillRegistryCache();
  const mock = installFetchMock((url): MockResult => {
    if (!url.includes('/children')) return { json: {} };
    if (!isFolders(url)) return page([]);
    if (idOf(url) === 'b-1') return { status: 503, json: {} };
    return idOf(url).startsWith('b-') ? page([]) : page([branch('b-1', 'Optik')]);
  });
  const client = await strictClient();
  try {
    const r = await client.callTool({ name: 'browse_collection_tree', arguments: { nodeId: 'top', depth: 2 } });
    const node = (structured(r)['results'] as Array<Record<string, unknown>>)[0]!;
    assert.equal(node['childrenUnread'], true);
    assert.equal('childrenRefused' in node, false);
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

// ── the recursive walk (get_collection_contents with includeSubcollections) ──

/** root → s-1 (closed in the given way), s-2 (open). Every open collection holds one file. */
function walkMock(closed: 'listing' | 'contents', status = 403) {
  return installFetchMock((url): MockResult => {
    if (!url.includes('/children')) return { json: {} };
    const id = idOf(url);
    if (isFolders(url)) {
      if (id === 'root') return page([branch('s-1', 'Geschlossen'), branch('s-2', 'Offen')]);
      return id === 's-1' && closed === 'listing' ? { status, json: {} } : page([]);
    }
    if (id === 's-1' && closed === 'contents') return { status, json: {} };
    return page([makeNode(`f-${id}`, `Datei ${id}`)]);
  });
}

test('the recursive walk: a refused sub-LISTING is reported as restricted — and is still no outage', async () => {
  const mock = walkMock('listing');
  try {
    const walk = await collectRecursiveContents('root', 50, new Set(), undefined);
    assert.equal(walk.restricted, true);
    assert.notEqual(walk.incomplete, true);
    assert.deepEqual(walk.nodes.map(n => n.nodeId).sort(), ['f-root', 'f-s-1', 'f-s-2']);
  } finally { mock.restore(); }
});

for (const status of [401, 403, 404]) {
  test(`the recursive walk: a sub-collection whose CONTENTS answer ${status} is left out and marked — the rest is delivered`, async () => {
    const mock = walkMock('contents', status);
    try {
      const walk = await collectRecursiveContents('root', 50, new Set(), undefined);
      assert.equal(walk.restricted, true);
      assert.notEqual(walk.incomplete, true);
      assert.deepEqual(walk.nodes.map(n => n.nodeId).sort(), ['f-root', 'f-s-2']);
    } finally { mock.restore(); }
  });
}

test('the recursive walk: an OUTAGE on a sub-collection still ends the call — it is no refusal', async () => {
  const mock = walkMock('contents', 503);
  try {
    await assert.rejects(collectRecursiveContents('root', 50, new Set(), undefined));
  } finally { mock.restore(); }
});

test('the recursive walk: a refused START node is still an error, never an empty list', async () => {
  const mock = installFetchMock((): MockResult => ({ status: 403, json: {} }));
  try {
    await assert.rejects(collectRecursiveContents('root', 50, new Set(), undefined), /403/);
  } finally { mock.restore(); }
});

test('the recursive walk: nothing refused, nothing said', async () => {
  const mock = installFetchMock((url): MockResult => (isFolders(url) ? page([]) : page([makeNode('f-1', 'Datei')])));
  try {
    assert.equal('restricted' in await collectRecursiveContents('root', 50, new Set(), undefined), false);
  } finally { mock.restore(); }
});

test('get_collection_contents: restricted is in structuredContent, in the JSON text and said in Markdown', async () => {
  stopSkillRegistryCache();
  const mock = walkMock('contents');
  const client = await strictClient();
  try {
    const args = { nodeId: 'root', includeSubcollections: true };
    const json = await client.callTool({ name: 'get_collection_contents', arguments: { ...args, outputFormat: 'json' } });
    assert.equal(json.isError, undefined, toolText(json));
    assert.equal(structured(json)['restricted'], true);
    assert.equal(firstJson(json)['restricted'], true);
    assert.equal('incomplete' in structured(json), false);
    assert.ok(toolText(json).includes(RESTRICTED_NOTICE), 'JSON mode: the sentence is its own block');
    const md = await client.callTool({ name: 'get_collection_contents', arguments: args });
    assert.ok(toolText(md).includes(RESTRICTED_NOTICE));
    assert.match(toolText(md), /Datei s-2/);
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

// ── the tree search behind search_wlo_collections ───────────────────────────

test('the tree search counts refused sub-lists apart from unread ones', async () => {
  const mock = installFetchMock((url): MockResult => {
    if (idOf(url) === 'a') return { status: 403, json: {} };
    if (idOf(url) === 'b') return { status: 503, json: {} };
    return page([branch('c-1', 'Optik Grundlagen')]);
  });
  try {
    const level1 = [branch('a', 'Physik'), branch('b', 'Chemie'), branch('c', 'Biologie')] as unknown as WloNode[];
    const out = await findCollectionsByTreeTraversal(level1, 'Optik');
    assert.deepEqual([out.unread, out.refused, out.matches.length], [1, 1, 1]);
  } finally { mock.restore(); }
});

test('the tree search counts a refused sub-list on its third level too', async () => {
  const mock = installFetchMock((url): MockResult => (idOf(url) === 'a' ? page([branch('x', 'Mechanik')]) : { status: 404, json: {} }));
  try {
    const out = await findCollectionsByTreeTraversal([branch('a', 'Physik')] as unknown as WloNode[], 'Optik');
    assert.deepEqual([out.unread, out.refused, out.matches.length], [0, 1, 0]);
  } finally { mock.restore(); }
});

test('search_wlo_collections: a tree search that met a closed branch says restricted — with hits and without', async () => {
  stopSkillRegistryCache();
  for (const hits of [[branch('c-1', 'Optik Grundlagen')], []]) {
    const mock = installFetchMock((url): MockResult => {
      if (!url.includes('/children')) return { json: { nodes: [] } };
      if (!isFolders(url)) return page([]);
      const id = idOf(url);
      if (id === 'start') return page([branch('a', 'Physik'), branch('c', 'Biologie')]);
      if (id === 'a') return { status: 403, json: {} };
      return id === 'c' ? page(hits) : page([]);
    });
    const client = await strictClient();
    try {
      const args = { query: 'Optik', parentNodeId: 'start' };
      const json = await client.callTool({ name: 'search_wlo_collections', arguments: { ...args, outputFormat: 'json' } });
      assert.equal(json.isError, undefined, toolText(json));
      assert.equal(structured(json)['restricted'], true, `${hits.length} hits`);
      assert.equal(firstJson(json)['restricted'], true);
      assert.equal('incomplete' in structured(json), false);
      const md = toolText(await client.callTool({ name: 'search_wlo_collections', arguments: args }));
      assert.ok(md.includes(RESTRICTED_NOTICE), md.slice(0, 300));
      // "Keine Sammlungen gefunden" is a statement about the catalogue — not over a closed branch.
      if (!hits.length) assert.doesNotMatch(md, /Keine Sammlungen gefunden/);
    } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
  }
});

// ── the skill walk ──────────────────────────────────────────────────────────

for (const closed of ['listing', 'contents'] as const) {
  test(`a skill walk that met a closed sub-collection (${closed}) says restricted — and is not incomplete`, async () => {
    const mock = installFetchMock((url): MockResult => {
      const id = idOf(url);
      if (id === 'skills-root') return isFolders(url) ? page([branch('s-1', 'Geschlossen')]) : page([]);
      if (isFolders(url)) return closed === 'listing' ? { status: 403, json: {} } : page([]);
      return closed === 'contents' ? { status: 403, json: {} } : page([]);
    });
    try {
      const r = await searchSkillsDetailed({ collectionId: 'skills-root', includeSubcollections: true });
      assert.equal(r.restricted, true, JSON.stringify(r));
      assert.notEqual(r.incomplete, true);
    } finally { mock.restore(); }
  });
}

test('search_skill: restricted is in the JSON and said in the text; an open tree says nothing', async () => {
  let closed = true;
  const mock = installFetchMock((url): MockResult => {
    if (isFolders(url)) return idOf(url) === 'skills-root' ? page([branch('s-1', 'Unter')]) : page([]);
    return closed && idOf(url) === 's-1' ? { status: 403, json: {} } : page([]);
  });
  const client = await strictClient();
  try {
    const args = { collectionId: 'skills-root', includeSubcollections: true };
    const json = firstJson(await client.callTool({ name: 'search_skill', arguments: { ...args, outputFormat: 'json' } }));
    assert.equal(json['restricted'], true);
    assert.equal(json['restrictedNote'], RESTRICTED_NOTICE);
    assert.ok(toolText(await client.callTool({ name: 'search_skill', arguments: args })).includes(RESTRICTED_NOTICE));
    closed = false;
    const open = firstJson(await client.callTool({ name: 'search_skill', arguments: { ...args, outputFormat: 'json' } }));
    assert.equal('restricted' in open, false);
  } finally { await client.close(); mock.restore(); }
});

// ── Review of 2026-11-14 ────────────────────────────────────────────────────

/** top → b-1, b-2; b-1's FILE listing answers `status`, everything else is open and empty. */
function countMock(status: number) {
  return installFetchMock((url): MockResult => {
    if (!url.includes('/children')) return { json: {} };
    if (isFolders(url)) return idOf(url) === 'top' ? page([branch('b-1', 'Optik'), branch('b-2', 'Mechanik')]) : page([]);
    return idOf(url) === 'b-1' ? { status, json: {} } : page([makeNode('f', 'Datei')], 7);
  });
}

for (const withWhat of ['includeContentCounts', 'includeContentPreview'] as const) {
  test(`browse_collection_tree with ${withWhat}: a branch whose contents are refused STAYS in the tree and is marked`, async () => {
    stopSkillRegistryCache();
    const mock = countMock(403);
    const client = await strictClient();
    try {
      const r = await client.callTool({ name: 'browse_collection_tree',
        arguments: { nodeId: 'top', ...(withWhat === 'includeContentCounts' ? { includeContentCounts: true } : { includeContentPreview: 2 }) } });
      assert.equal(r.isError, undefined, toolText(r));
      const results = structured(r)['results'] as Array<Record<string, unknown>>;
      assert.deepEqual(results.map(n => n['nodeId']).sort(), ['b-1', 'b-2'], 'the closed branch is still there');
      const closed = results.find(n => n['nodeId'] === 'b-1')!;
      assert.equal(closed['contentsRefused'], true);
      assert.equal('fileCount' in closed, false);
      assert.equal('contentsRefused' in results.find(n => n['nodeId'] === 'b-2')!, false);
      assert.match(toolText(r), /Inhalte von „Optik“ sind mit dieser Anmeldung nicht lesbar/);
    } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
  });
}

test('browse_collection_tree with counts: an OUTAGE on one branch keeps the branch too — marked unread, not refused', async () => {
  stopSkillRegistryCache();
  const mock = countMock(503);
  const client = await strictClient();
  try {
    const r = await client.callTool({ name: 'browse_collection_tree', arguments: { nodeId: 'top', includeContentCounts: true } });
    const results = structured(r)['results'] as Array<Record<string, unknown>>;
    const node = results.find(n => n['nodeId'] === 'b-1')!;
    assert.ok(node, 'still in the tree');
    assert.equal(node['contentsUnread'], true);
    assert.equal('contentsRefused' in node, false);
    assert.match(toolText(r), /Inhalte von „Optik“ ließen sich gerade nicht lesen/);
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

test('get_collection_overview: a sub-collection with refused contents stays listed and says so', async () => {
  stopSkillRegistryCache();
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/children')) {
      if (isFolders(url)) return idOf(url) === 'top' ? page([branch('b-1', 'Optik'), branch('b-2', 'Mechanik')]) : page([]);
      return idOf(url) === 'b-1' ? { status: 403, json: {} } : page([], 7);
    }
    if (url.includes('/metadata')) return { json: { node: branch('top', 'Physik') } };
    return { json: {} };
  });
  const client = await strictClient();
  try {
    const r = await client.callTool({ name: 'get_collection_overview', arguments: { collectionId: 'top', include: ['subcollections'], outputFormat: 'json' } });
    assert.equal(r.isError, undefined, toolText(r));
    const subs = structured(r)['subcollections'] as Array<Record<string, unknown>>;
    assert.deepEqual(subs.map(s => s['nodeId']).sort(), ['b-1', 'b-2']);
    assert.equal(subs.find(s => s['nodeId'] === 'b-1')!['contentsRefused'], true);
    assert.equal('contentsRefused' in subs.find(s => s['nodeId'] === 'b-2')!, false);
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

test('browse_collection_tree: childrenRefused is set on the third level too', async () => {
  stopSkillRegistryCache();
  const mock = installFetchMock((url): MockResult => {
    if (!url.includes('/children') || !isFolders(url)) return url.includes('/children') ? page([]) : { json: {} };
    const id = idOf(url);
    if (id === 'top') return page([branch('l1', 'Eins')]);
    if (id === 'l1') return page([branch('l2', 'Zwei')]);
    return { status: 403, json: {} };
  });
  const client = await strictClient();
  try {
    const r = await client.callTool({ name: 'browse_collection_tree', arguments: { nodeId: 'top', depth: 3 } });
    const l1 = (structured(r)['results'] as Array<{ children?: Array<Record<string, unknown>> }>)[0]!;
    assert.equal(l1.children![0]!['childrenRefused'], true);
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

test('the recursive walk: a refused sub-collection the walk never REACHES is not reported', async () => {
  const mock = walkMock('contents');
  try {
    // One row is enough, and the root supplies it: s-1 is read in the next group or not at all.
    const walk = await collectRecursiveContents('root', 1, new Set(), undefined);
    assert.equal('restricted' in walk, false);
  } finally { mock.restore(); }
});

test('get_collection_contents: empty AND restricted does not say "Sammlung ist leer"; the notice comes before _queryMeta, block 0 stays JSON', async () => {
  stopSkillRegistryCache();
  const mock = installFetchMock((url): MockResult => {
    if (!url.includes('/children')) return { json: {} };
    if (isFolders(url)) return idOf(url) === 'root' ? page([branch('s-1', 'Geschlossen')]) : page([]);
    return idOf(url) === 's-1' ? { status: 403, json: {} } : page([]);
  });
  const client = await strictClient();
  try {
    const args = { nodeId: 'root', includeSubcollections: true };
    const md = toolText(await client.callTool({ name: 'get_collection_contents', arguments: args }));
    assert.doesNotMatch(md, /Sammlung ist leer/);
    assert.ok(md.includes(RESTRICTED_NOTICE));
    const json = await client.callTool({ name: 'get_collection_contents', arguments: { ...args, outputFormat: 'json' } });
    const blocks = (json as { content: Array<{ text: string }> }).content.map(c => c.text);
    assert.equal((JSON.parse(blocks[0]!) as { restricted?: boolean }).restricted, true);
    const notice = blocks.indexOf(RESTRICTED_NOTICE);
    assert.ok(notice > 0 && notice < blocks.length - 1, `notice at ${notice} of ${blocks.length}`);
    assert.match(blocks[blocks.length - 1]!, /_queryMeta/);
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

test('search_wlo_collections: no hit beside a closed branch says BOTH — nothing in what was readable, and that a part was not', async () => {
  stopSkillRegistryCache();
  const mock = installFetchMock((url): MockResult => {
    if (!url.includes('/children')) return { json: { nodes: [] } };
    if (!isFolders(url)) return page([]);
    const id = idOf(url);
    return id === 'start' ? page([branch('a', 'Physik')]) : id === 'a' ? { status: 403, json: {} } : page([]);
  });
  const client = await strictClient();
  try {
    const md = toolText(await client.callTool({ name: 'search_wlo_collections', arguments: { query: 'Optik', parentNodeId: 'start' } }));
    assert.match(md, /In den lesbaren Teilen .*keine Sammlung.*Optik/s);
    assert.ok(md.includes(RESTRICTED_NOTICE));
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

test('search_skill: an empty list beside a closed skillset is not "Keine Skills gefunden"', async () => {
  const mock = installFetchMock((url): MockResult => {
    if (isFolders(url)) return idOf(url) === 'skills-root' ? page([branch('s-1', 'Unter')]) : page([]);
    return idOf(url) === 's-1' ? { status: 403, json: {} } : page([]);
  });
  const client = await strictClient();
  try {
    const text = toolText(await client.callTool({ name: 'search_skill', arguments: { collectionId: 'skills-root', includeSubcollections: true } }));
    assert.doesNotMatch(text, /Keine Skills gefunden/);
    assert.ok(text.includes(RESTRICTED_NOTICE));
  } finally { await client.close(); mock.restore(); }
});

test('a skill walk reads BELOW a sub-collection whose contents are refused, when its listing answers', async () => {
  const mock = installFetchMock((url): MockResult => {
    const id = idOf(url);
    if (isFolders(url)) return id === 'skills-root' ? page([branch('s-1', 'Zu')]) : id === 's-1' ? page([branch('s-2', 'Darunter')]) : page([]);
    return id === 's-1' ? { status: 403, json: {} } : page([]);
  });
  try {
    const r = await searchSkillsDetailed({ collectionId: 'skills-root', includeSubcollections: true });
    assert.equal(r.restricted, true);
    assert.ok(mock.calls.some(c => idOf(c.url) === 's-2'), 's-2 was read');
  } finally { mock.restore(); }
});

test('the picked-skill path carries restricted too — nothing picked beside a closed skillset is not "none"', async () => {
  const mock = installFetchMock((url): MockResult => {
    if (isFolders(url)) return idOf(url) === 'skills-root' ? page([branch('s-1', 'Unter')]) : page([]);
    return idOf(url) === 's-1' ? { status: 403, json: {} } : page([]);
  });
  try {
    const { pickBestSkillResult } = await import('../src/services/skills.js');
    const r = await pickBestSkillResult({ query: 'Stunde planen', collectionId: 'skills-root', includeSubcollections: true });
    assert.deepEqual([r.picked, r.incomplete, r.restricted], [null, false, true]);
  } finally { mock.restore(); }
});

test('the phrase the chatbot recognises a refusal by is still in every sentence that states one', async () => {
  // Their note of 2026-11-14 (§7): the client passes a sentence with
  // "mit dieser Anmeldung nicht lesbar" on to the model and does NOT count it as
  // an outage. Rewording one of these is a change of contract in practice:
  // tell them first, then change this test.
  const { readFileSync } = await import('node:fs');
  const src = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  const PHRASE = /mit dieser Anmeldung nicht lesbar/g;
  assert.match(RESTRICTED_NOTICE, PHRASE);
  assert.equal(src('tools/browse.ts').match(PHRASE)?.length, 2, 'the two tree lines: sub-topics and contents');
  assert.equal(src('tools/collection-overview.ts').match(PHRASE)?.length, 1);
  assert.match(src('services/collection-traversal.ts'), /nicht gefunden oder ist mit dieser Anmeldung nicht lesbar/);
});
