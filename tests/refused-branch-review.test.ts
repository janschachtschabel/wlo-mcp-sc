/**
 * refused-branch-review.test.ts – second review of the refused-branch change
 * (2026-11-14). What the first cut of the FIXES got wrong, each pinned here:
 *
 *   - `get_skill_for_task` put the notice in a block of its own and FIRST, so a
 *     client handing its model only block 0 lost the whole instruction;
 *   - `search_skill` changed an EXISTING answer (empty and merely incomplete);
 *   - the search widget showed "Keine Treffer gefunden." over an empty
 *     restricted answer — a field the renderer drops is no disclosure;
 *   - a tree node could carry a stale or a double mark;
 *   - a refused skills ROOT still had its whole subtree read before the error.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { RESTRICTED_NOTICE, buildCollectionTree } from '../src/services/collection-traversal.js';
import { SKILL_CONTENT_TYPE_URI } from '../src/services/skill-catalogue.js';
import { searchSkillsDetailed } from '../src/services/skills.js';
import { stopSkillRegistryCache } from '../src/services/skill-registry-cache.js';
import { registerSkillTools } from '../src/tools/skills.js';
import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { renderSearchResults } from '../src/apps/widgets/search-results/render.js';
import { renderBrowse } from '../src/apps/widgets/browse/render.js';
import { browseReducer, initialBrowseState } from '../src/apps/widgets/browse/state.js';
import { ClientGoneError } from '../src/request-scope.js';
import { installFetchMock, makeNode, strictClient, toolText, type MockResult } from './fetchMock.js';

const idOf = (url: string) => decodeURIComponent(new URL(url).pathname.match(/-home-\/([^/]+)\/(children|metadata)/)?.[1] ?? '');
const isFolders = (url: string) => new URL(url).searchParams.get('filter') === 'folders';
const page = (nodes: unknown[], total = nodes.length) => ({ json: { nodes, pagination: { total, from: 0, count: nodes.length } } });
const branch = (id: string, title: string) =>
  ({ ref: { id }, type: 'ccm:map', aspects: ['ccm:collection'], properties: { 'cm:title': [title], 'cclom:title': [title] } });
const skill = (id: string, title: string) => ({
  ...makeNode(id, title, { 'cclom:general_description': ['Plant eine Stunde.'], 'ccm:oeh_extendedType': [SKILL_CONTENT_TYPE_URI] }),
  mimetype: 'text/x-web-markdown', size: 120,
});
const blocks = (r: unknown) => (r as { content: Array<{ text: string }> }).content.map(c => c.text);

async function oneToolClient(): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerSkillTools(server, { collectionId: '', mode: 'one-tool' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  return c;
}

/** skills-root holds one skill; its sub-collection s-1 is closed when `closed`. */
function skillTree(closed: boolean, withSkill = true) {
  return installFetchMock((url): MockResult => {
    if (url.includes('eduservlet/download')) return { text: '# Stunde planen\n\nSchritt 1.' };
    if (url.includes('/metadata')) return { json: { node: skill('sk-1', 'Stunde planen') } };
    if (!url.includes('/children')) return { json: {} };
    const id = idOf(url);
    if (isFolders(url)) return id === 'skills-root' ? page([branch('s-1', 'Unter')]) : page([]);
    if (id === 's-1') return closed ? { status: 403, json: {} } : page([]);
    return id === 'skills-root' && withSkill ? page([skill('sk-1', 'Stunde planen')]) : page([]);
  });
}

// ── get_skill_for_task ──────────────────────────────────────────────────────

test('get_skill_for_task: a restricted answer is ONE block — the notice first, the instruction in the same block', async () => {
  const mock = skillTree(true);
  const client = await oneToolClient();
  try {
    const r = await client.callTool({ name: 'get_skill_for_task', arguments: { task: 'Stunde planen', collectionId: 'skills-root', includeSubcollections: true } });
    const b = blocks(r);
    assert.equal(b.length, 1, 'a client that hands its model block 0 only still gets the skill');
    assert.ok(b[0]!.startsWith(RESTRICTED_NOTICE));
    assert.match(b[0]!, /# Stunde planen/);
    assert.ok(b[0]!.indexOf(RESTRICTED_NOTICE) < b[0]!.indexOf('Schritt 1.'), 'server text ahead of the untrusted document');
  } finally { await client.close(); mock.restore(); }
});

test('get_skill_for_task: JSON gains two keys when restricted and is the picked object, unchanged, when not', async () => {
  for (const closed of [true, false]) {
    const mock = skillTree(closed);
    const client = await oneToolClient();
    try {
      const r = await client.callTool({ name: 'get_skill_for_task', arguments: { task: 'Stunde planen', collectionId: 'skills-root', includeSubcollections: true, outputFormat: 'json' } });
      const json = JSON.parse(blocks(r)[0]!) as Record<string, unknown>;
      assert.deepEqual(Object.keys(json).filter(k => k.startsWith('restricted')).sort(), closed ? ['restricted', 'restrictedNote'] : []);
      assert.ok(json['skill'] && Array.isArray(json['alternatives']));
    } finally { await client.close(); mock.restore(); }
  }
});

test('get_skill_for_task: nothing picked beside a closed skillset says so — never "Keine Skills gefunden"', async () => {
  const mock = skillTree(true, false);
  const client = await oneToolClient();
  try {
    const text = toolText(await client.callTool({ name: 'get_skill_for_task', arguments: { task: 'Stunde planen', collectionId: 'skills-root', includeSubcollections: true } }));
    assert.equal(text, RESTRICTED_NOTICE);
  } finally { await client.close(); mock.restore(); }
});

// ── search_skill: the existing case is what it was ──────────────────────────

test('search_skill: empty and merely INCOMPLETE prints what it always printed', async () => {
  const mock = installFetchMock((url): MockResult => (isFolders(url) ? { status: 503, json: {} } : page([])));
  const client = await strictClient();
  try {
    const text = blocks(await client.callTool({ name: 'search_skill', arguments: { collectionId: 'skills-root', includeSubcollections: true, query: 'x' } }))[0]!;
    assert.match(text, /^Keine Skills gefunden \(Suche: „x“\)\.\n\nHinweis: /);
    assert.doesNotMatch(text, /\n\n\n/);
  } finally { await client.close(); mock.restore(); }
});

test('search_skill: no text starts with blank lines or holds a run of them, whatever the combination', async () => {
  for (const [folders, files] of [[403, 200], [503, 403], [200, 403], [200, 200]] as const) {
    const mock = installFetchMock((url): MockResult => {
      const id = idOf(url);
      if (isFolders(url)) return id === 'skills-root' ? page([branch('s-1', 'Unter')]) : folders === 200 ? page([]) : { status: folders, json: {} };
      return id === 's-1' && files !== 200 ? { status: files, json: {} } : page([]);
    });
    const client = await strictClient();
    try {
      // An unresolvable filter adds the hint block ahead of everything.
      const text = blocks(await client.callTool({ name: 'search_skill',
        arguments: { collectionId: 'skills-root', includeSubcollections: true, discipline: 'Quatschfach' } }))[0]!;
      assert.doesNotMatch(text, /^\s|\n\n\n/, `${folders}/${files}: ${JSON.stringify(text.slice(0, 80))}`);
    } finally { await client.close(); mock.restore(); }
  }
});

// ── the skill walk ──────────────────────────────────────────────────────────

test('a refused skills ROOT ends the walk at once — its subtree is not read for an error', async () => {
  const mock = installFetchMock((url): MockResult => {
    const id = idOf(url);
    if (isFolders(url)) return id === 'skills-root' ? page([branch('s-1', 'A'), branch('s-2', 'B')]) : page([]);
    return id === 'skills-root' ? { status: 403, json: {} } : page([]);
  });
  try {
    await assert.rejects(searchSkillsDetailed({ collectionId: 'skills-root', includeSubcollections: true }), /nicht lesbar/);
    assert.deepEqual([...new Set(mock.calls.map(c => idOf(c.url)))], ['skills-root']);
  } finally { mock.restore(); }
});

// ── marks on a tree node ────────────────────────────────────────────────────

/** top → b-1. The COUNT read (maxItems=1) and the PREVIEW read (maxItems=2) of b-1 answer as given. */
function twoReads(count: number, preview: number) {
  return installFetchMock((url): MockResult => {
    if (!url.includes('/children')) return { json: {} };
    if (isFolders(url)) return idOf(url) === 'top' ? page([branch('b-1', 'Optik')]) : page([]);
    const status = new URL(url).searchParams.get('maxItems') === '1' ? count : preview;
    return status === 200 ? page([makeNode('f', 'Datei')], 7) : { status, json: {} };
  });
}
const walk = () => buildCollectionTree({ parentId: 'top', depth: 1, maxResults: 10, includeContentCounts: true, contentPreview: 2 });

test('a count that failed and a preview that answered: the contents WERE read — no "unread" mark beside them', async () => {
  const mock = twoReads(503, 200);
  try {
    const node = (await walk()).nodes[0]!;
    assert.equal(node.contentPreview?.length, 1);
    assert.equal('contentsUnread' in node, false);
    assert.equal('fileCount' in node, false, 'the count itself stays unknown');
  } finally { mock.restore(); }
});

test('a count that failed and a preview that was refused: refused is the answer — one mark, not two', async () => {
  const mock = twoReads(503, 403);
  try {
    const node = (await walk()).nodes[0]!;
    assert.deepEqual([node.contentsRefused, 'contentsUnread' in node], [true, false]);
  } finally { mock.restore(); }
});

test('a refused count is not asked again for a preview', async () => {
  const mock = twoReads(403, 200);
  try {
    const node = (await walk()).nodes[0]!;
    assert.equal(node.contentsRefused, true);
    assert.equal(mock.calls.filter(c => !isFolders(c.url) && idOf(c.url) === 'b-1').length, 1);
  } finally { mock.restore(); }
});

test('a read that ended because nobody waits any more is not turned into an "unread" mark', async () => {
  // `mapPool` stops on a hang-up and drops the item; what must not happen is a
  // mark that tells the next reader the repository failed.
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (isFolders(url)) return new Response(JSON.stringify(page([branch('b-1', 'Optik')]).json), { status: 200, headers: { 'content-type': 'application/json' } });
    throw new ClientGoneError();
  }) as typeof fetch;
  try {
    const tree = await buildCollectionTree({ parentId: 'top', depth: 1, maxResults: 10, includeContentCounts: true });
    assert.equal(tree.nodes.some(n => n.contentsUnread || n.contentsRefused), false);
  } finally { globalThis.fetch = real; }
});

test('get_collection_overview: a sub-collection whose count did not answer says THAT — not a bare question mark', async () => {
  stopSkillRegistryCache();
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/children')) {
      if (isFolders(url)) return idOf(url) === 'top' ? page([branch('b-1', 'Optik')]) : page([]);
      return { status: 503, json: {} };
    }
    return url.includes('/metadata') ? { json: { node: branch('top', 'Physik') } } : { json: {} };
  });
  const client = await strictClient();
  try {
    const r = await client.callTool({ name: 'get_collection_overview', arguments: { collectionId: 'top', include: ['subcollections'], outputFormat: 'json' } });
    assert.equal(r.isError, undefined, toolText(r));
    const sub = ((r.structuredContent as { subcollections: Array<Record<string, unknown>> }).subcollections)[0]!;
    assert.deepEqual([sub['nodeId'], sub['contentsUnread'], 'contentCount' in sub], ['b-1', true, false]);
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

// ── Markdown: the notice is in the block a one-block client reads ───────────

test('get_collection_contents (Markdown): the restricted notice is in block 0', async () => {
  stopSkillRegistryCache();
  const mock = installFetchMock((url): MockResult => {
    if (!url.includes('/children')) return { json: {} };
    if (isFolders(url)) return idOf(url) === 'root' ? page([branch('s-1', 'Zu')]) : page([]);
    return idOf(url) === 's-1' ? { status: 403, json: {} } : page([makeNode('f-1', 'Datei')]);
  });
  const client = await strictClient();
  try {
    const b = blocks(await client.callTool({ name: 'get_collection_contents', arguments: { nodeId: 'root', includeSubcollections: true } }));
    assert.ok(b[0]!.includes(RESTRICTED_NOTICE));
    assert.equal(b.filter(t => t.includes(RESTRICTED_NOTICE)).length, 1, 'said once');
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

// ── widgets ─────────────────────────────────────────────────────────────────

test('search widget: an empty RESTRICTED list is not "Keine Treffer gefunden."', () => {
  const html = renderSearchResults({ total: 0, count: 0, results: [], restricted: true } as never, 'de');
  assert.doesNotMatch(html, /Keine Treffer gefunden/);
  assert.match(html, /mit dieser Anmeldung nicht lesbar/);
  assert.match(renderSearchResults({ total: 0, count: 0, results: [] } as never, 'de'), /Keine Treffer gefunden/);
  assert.match(renderSearchResults({ total: 0, count: 0, results: [], restricted: true } as never, 'en'), /not readable with this login/);
});

test('search widget: a restricted list WITH hits says so above them', () => {
  const hit = { nodeId: 'c1', title: 'Optik', description: '', disciplines: [], educationalContexts: [], learningResourceTypes: [],
    url: '', contentUrl: '', previewUrl: '', previewIsIcon: true, license: '', publisher: '', nodeType: 'collection', topicPageUrl: '' };
  const html = renderSearchResults({ total: 1, count: 1, results: [hit], restricted: true } as never, 'de');
  assert.match(html, /mit dieser Anmeldung nicht lesbar/);
  assert.match(html, /Optik/);
  assert.doesNotMatch(renderSearchResults({ total: 1, count: 1, results: [hit] } as never, 'de'), /mit dieser Anmeldung nicht lesbar/);
});

test('browse widget: a closed or unread branch is marked — not a plain childless one', () => {
  const base = { title: 'Optik', nodeType: 'collection', description: '', disciplines: [], educationalContexts: [],
    learningResourceTypes: [], url: '', contentUrl: '', previewUrl: '', previewIsIcon: true, license: '', publisher: '', topicPageUrl: '' };
  const render = (extra: Record<string, unknown>) => renderBrowse(
    browseReducer(initialBrowseState(), { type: 'init', roots: [{ ...base, nodeId: 'b1', ...extra }] as never, rootLabel: '' }), 'de', { canFollowUp: false });
  assert.match(render({ childrenRefused: true }), /mit dieser Anmeldung nicht lesbar/);
  assert.match(render({ contentsRefused: true }), /mit dieser Anmeldung nicht lesbar/);
  assert.match(render({ childrenUnread: true }), /gerade nicht lesbar/);
  assert.match(render({ contentsUnread: true }), /gerade nicht lesbar/);
  assert.doesNotMatch(render({}), /nicht lesbar/);
});
