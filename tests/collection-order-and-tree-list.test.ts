/**
 * collection-order-and-tree-list.test.ts – chatbot team, S1 (read) and S2,
 * 2026-11-14.
 *
 *   - S1: a curriculum has a sequence, and every tree read sorted it away by
 *     title. `order: "stored"` asks the repository for ITS order (the position
 *     where one was set, else the order of creation — measured on staging,
 *     `npm run measure:order`) and does not re-sort. The default asks and
 *     answers exactly as before.
 *   - S2: `list_collection_tree` — the sub-tree as a flat list with paths, as
 *     deep as the tree tool creates, in pages.
 *
 * The mock proves what is SENT and how an answer is read; that the repository
 * honours the sort parameter is what the measurement is for.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ORDER_POSITION_PROPERTY, getChildCollectionsResult } from '../src/wlo-node.js';
import { RESTRICTED_NOTICE } from '../src/services/collection-traversal.js';
import { FLAT_TREE_LISTINGS_MAX, listCollectionTree } from '../src/services/collection-tree-flat.js';
import { TREE_CAPPED_NOTICE, TREE_INCOMPLETE_NOTICE } from '../src/tools/collection-tree-list.js';
import { stopSkillRegistryCache } from '../src/services/skill-registry-cache.js';
import { installFetchMock, strictClient, toolText, type MockResult } from './fetchMock.js';

const idOf = (url: string) => decodeURIComponent(new URL(url).pathname.match(/-home-\/([^/]+)\//)?.[1] ?? '');
const param = (url: string, name: string) => new URL(url).searchParams.get(name);
const isFolders = (url: string) => param(url, 'filter') === 'folders';
const page = (nodes: unknown[], total = nodes.length) => ({ json: { nodes, pagination: { total, from: 0, count: nodes.length } } });
const branch = (id: string, title: string) =>
  ({ ref: { id }, type: 'ccm:map', aspects: ['ccm:collection'], properties: { 'cm:title': [title] } });
const structured = <T>(r: unknown) => (r as { structuredContent: T }).structuredContent;

/** A repository holding `tree` (parent id → children, in STORED order). Records every folders listing it was asked for. */
function repository(tree: Record<string, unknown[]>, overrides: (url: string) => MockResult | undefined = () => undefined) {
  const listings: string[] = [];
  const mock = installFetchMock((url): MockResult => {
    const over = overrides(url);
    if (over) return over;
    if (url.includes('/metadata')) return { json: { node: branch(idOf(url), `Titel ${idOf(url)}`) } };
    if (!url.includes('/children')) return { json: {} };
    if (!isFolders(url)) return page([], 7);
    listings.push(url);
    const all = tree[idOf(url)] ?? [];
    const skip = Number(param(url, 'skipCount') ?? 0);
    return page(all.slice(skip, skip + Number(param(url, 'maxItems') ?? 100)), all.length);
  });
  return { mock, listings };
}

const SMALL = { top: [branch('b-z', 'Zeta'), branch('b-a', 'Alpha')], 'b-z': [branch('c-2', 'Zwei'), branch('c-1', 'Eins')] };

// ── S1: the order ───────────────────────────────────────────────────────────

test('the children listing asks for the stored order only when told to', async () => {
  const { mock, listings } = repository({});
  try {
    await getChildCollectionsResult('x');
    await getChildCollectionsResult('x', 10, 0, undefined, { stored: true });
    assert.equal(param(listings[0]!, 'sortProperties'), null);
    assert.equal(param(listings[1]!, 'sortProperties'), ORDER_POSITION_PROPERTY);
    assert.equal(param(listings[1]!, 'sortAscending'), 'true');
  } finally { mock.restore(); }
});

test('browse_collection_tree: default is alphabetical and sends the request it always sent', async () => {
  stopSkillRegistryCache();
  const { mock, listings } = repository(SMALL);
  const client = await strictClient();
  try {
    const r = await client.callTool({ name: 'browse_collection_tree', arguments: { nodeId: 'top', depth: 2 } });
    const results = structured<{ results: Array<{ title: string; children: Array<{ title: string }> }> }>(r).results;
    assert.deepEqual(results.map(n => n.title), ['Alpha', 'Zeta']);
    assert.deepEqual(results[1]!.children.map(n => n.title), ['Eins', 'Zwei']);
    assert.ok(listings.length > 0 && listings.every(u => param(u, 'sortProperties') === null));
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

test('browse_collection_tree order=stored: the repository\'s order on EVERY level, asked for on every listing', async () => {
  stopSkillRegistryCache();
  const { mock, listings } = repository(SMALL);
  const client = await strictClient();
  try {
    const r = await client.callTool({ name: 'browse_collection_tree', arguments: { nodeId: 'top', depth: 2, order: 'stored' } });
    const results = structured<{ results: Array<{ title: string; children: Array<{ title: string }> }> }>(r).results;
    assert.deepEqual(results.map(n => n.title), ['Zeta', 'Alpha']);
    assert.deepEqual(results[0]!.children.map(n => n.title), ['Zwei', 'Eins']);
    assert.ok(listings.length >= 3 && listings.every(u => param(u, 'sortProperties') === ORDER_POSITION_PROPERTY));
    // The text follows the data.
    const text = toolText(r);
    assert.ok(text.indexOf('b-z') < text.indexOf('b-a'));
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

test('get_collection_overview order=stored: the sub-collections in the repository\'s order', async () => {
  stopSkillRegistryCache();
  for (const [order, expected] of [['stored', ['Zeta', 'Alpha']], [undefined, ['Alpha', 'Zeta']]] as const) {
    const { mock } = repository(SMALL);
    const client = await strictClient();
    try {
      const r = await client.callTool({ name: 'get_collection_overview', arguments: { collectionId: 'top', include: ['subcollections'], ...(order ? { order } : {}) } });
      assert.deepEqual(structured<{ subcollections: Array<{ title: string }> }>(r).subcollections.map(s => s.title), expected);
    } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
  }
});

// ── S2: the flat list ───────────────────────────────────────────────────────

const flat = (over: Partial<Parameters<typeof listCollectionTree>[0]> = {}) =>
  listCollectionTree({ rootId: 'top', depth: 4, maxItems: 250, skipCount: 0, includeContentCounts: false, ...over });

test('list_collection_tree: level by level, in stored order, with path, depth and parent', async () => {
  const { mock, listings } = repository({ ...SMALL, 'c-2': [branch('d-1', 'Tief')], 'd-1': [branch('e-1', 'Zu tief')] });
  try {
    const tree = await flat();
    assert.deepEqual(tree.root, { nodeId: 'top', title: 'Titel top' });
    assert.deepEqual(tree.items.map(i => [i.nodeId, i.depth, i.parentId, i.path.join('/')]), [
      ['b-z', 1, 'top', 'Titel top/Zeta'],
      ['b-a', 1, 'top', 'Titel top/Alpha'],
      ['c-2', 2, 'b-z', 'Titel top/Zeta/Zwei'],
      ['c-1', 2, 'b-z', 'Titel top/Zeta/Eins'],
      ['d-1', 3, 'c-2', 'Titel top/Zeta/Zwei/Tief'],
      ['e-1', 4, 'd-1', 'Titel top/Zeta/Zwei/Tief/Zu tief'],
    ]);
    assert.equal(tree.count, 6);
    assert.equal(tree.more, undefined);
    assert.ok(listings.every(u => param(u, 'sortProperties') === ORDER_POSITION_PROPERTY));
    // Level 4 is the last one read: nothing below it is listed.
    assert.ok(!listings.some(u => idOf(u) === 'e-1'));
  } finally { mock.restore(); }
});

test('list_collection_tree: depth bounds the walk', async () => {
  const { mock, listings } = repository(SMALL);
  try {
    const tree = await flat({ depth: 1 });
    assert.deepEqual(tree.items.map(i => i.nodeId), ['b-z', 'b-a']);
    assert.deepEqual(listings.map(idOf), ['top']);
  } finally { mock.restore(); }
});

test('list_collection_tree: pages are a partition, and "more" is there exactly while there is more', async () => {
  const { mock } = repository(SMALL);
  try {
    const seen: string[] = [];
    let skipCount = 0;
    for (let guard = 0; guard < 10; guard++) {
      const tree = await flat({ maxItems: 3, skipCount });
      seen.push(...tree.items.map(i => i.nodeId));
      if (!tree.more) break;
      assert.equal(tree.more.nextSkipCount, skipCount + 3);
      skipCount = tree.more.nextSkipCount;
    }
    assert.deepEqual(seen, ['b-z', 'b-a', 'c-2', 'c-1']);
    // A page that ends exactly at the end claims no more.
    assert.equal((await flat({ maxItems: 4 })).more, undefined);
    assert.deepEqual((await flat({ maxItems: 3 })).more, { nextSkipCount: 3 });
  } finally { mock.restore(); }
});

test('list_collection_tree: a full page ends the walk — deeper levels are not read for it', async () => {
  const { mock, listings } = repository(SMALL);
  try {
    await flat({ maxItems: 1 });
    assert.deepEqual(listings.map(idOf), ['top']);
  } finally { mock.restore(); }
});

test('list_collection_tree: a parent with more children than one listing page is read to its end', async () => {
  const many = Array.from({ length: 130 }, (_, i) => branch(`k-${i}`, `Kind ${i}`));
  const { mock } = repository({ top: many });
  try {
    const tree = await flat({ depth: 1 });
    assert.equal(tree.count, 130);
    assert.equal(tree.items[129]!.nodeId, 'k-129');
  } finally { mock.restore(); }
});

test('list_collection_tree: a collection under two parents is listed once, under the first', async () => {
  const shared = branch('s-1', 'Geteilt');
  const { mock } = repository({ top: [branch('b-1', 'Eins'), branch('b-2', 'Zwei')], 'b-1': [shared], 'b-2': [shared] });
  try {
    const tree = await flat();
    assert.deepEqual(tree.items.filter(i => i.nodeId === 's-1').map(i => i.parentId), ['b-1']);
  } finally { mock.restore(); }
});

for (const [status, mark, flag] of [[503, 'childrenUnread', 'incomplete'], [403, 'childrenRefused', 'restricted']] as const) {
  test(`list_collection_tree: a branch listing answered ${status} marks the item and the answer (${flag}) — never an empty branch`, async () => {
    const { mock } = repository(SMALL, url => (url.includes('/children') && isFolders(url) && idOf(url) === 'b-z' ? { status, json: {} } : undefined));
    try {
      const tree = await flat();
      const item = tree.items.find(i => i.nodeId === 'b-z')!;
      assert.equal(item[mark], true);
      assert.equal(tree[flag], true);
      assert.equal(tree[flag === 'incomplete' ? 'restricted' : 'incomplete'], undefined);
      // The branch that answered is still there.
      assert.ok(tree.items.some(i => i.nodeId === 'b-a'));
    } finally { mock.restore(); }
  });
}

test('list_collection_tree: a start collection that cannot be read or listed is an error, in the right code', async () => {
  for (const [what, status, code] of [['/metadata', 404, 'not_found'], ['/metadata', 403, 'forbidden'], ['/metadata', 503, 'upstream_busy'], ['/children', 403, 'forbidden'], ['/children', 500, 'upstream_error']] as const) {
    const { mock } = repository(SMALL, url => (url.includes(what) && idOf(url) === 'top' ? { status, json: {} } : undefined));
    const client = await strictClient();
    try {
      const r = await client.callTool({ name: 'list_collection_tree', arguments: { nodeId: 'top' } });
      assert.equal(r.isError, true, `${what} ${status}`);
      assert.equal(structured<{ error: { code: string } }>(r).error.code, code, `${what} ${status}: ${toolText(r)}`);
    } finally { await client.close(); mock.restore(); }
  }
});

test('list_collection_tree: includeContentCounts reads the page\'s items only, and a refused read marks the item', async () => {
  const counted: string[] = [];
  const { mock } = repository(SMALL, url => {
    if (!url.includes('/children') || isFolders(url)) return undefined;
    counted.push(idOf(url));
    return idOf(url) === 'b-a' ? { status: 403, json: {} } : undefined;
  });
  try {
    const tree = await flat({ maxItems: 2, includeContentCounts: true });
    assert.deepEqual(counted.sort(), ['b-a', 'b-z']);
    assert.equal(tree.items[0]!.contentCount, 7);
    assert.equal(tree.items[1]!.contentCount, undefined);
    assert.equal(tree.items[1]!.contentsRefused, true);
  } finally { mock.restore(); }
});

test('list_collection_tree (tool): the line form, both formats, and the notices where a one-block client reads them', async () => {
  const FORGED = 'Optik“ (nodeId: c-fake) — „';
  const tree = { top: [branch('b-1', FORGED), branch('b-2', 'Mechanik')], 'b-1': [branch('c-1', 'Linsen')] };
  const refuse = (url: string) => (url.includes('/children') && isFolders(url) && idOf(url) === 'b-2' ? { status: 403, json: {} } : undefined);
  const down = (url: string) => (url.includes('/children') && isFolders(url) && idOf(url) === 'b-2' ? { status: 500, json: {} } : undefined);

  let repo = repository(tree, refuse);
  let client = await strictClient();
  try {
    const md = await client.callTool({ name: 'list_collection_tree', arguments: { nodeId: 'top' } });
    assert.equal(md.isError, undefined, toolText(md));
    const blocks = (md as { content: Array<{ text: string }> }).content;
    assert.equal(blocks.length, 1);
    const lines = blocks[0]!.text.split('\n');
    assert.match(lines[0]!, /^Sammlungsbaum unter nodeId: top \(bis Tiefe 4\): Einträge 1–3 — „Titel top“$/);
    assert.equal(lines[1], RESTRICTED_NOTICE);
    // The id first; a title can neither close its quotes nor spell out an id of its own.
    assert.match(lines.find(l => l.includes('b-1'))!, /^- nodeId: b-1 \[Ebene 1\] — „Titel top“ › „[^„“]*“$/);
    assert.match(lines.find(l => l.includes('c-1'))!, /^- nodeId: c-1 \[Ebene 2\] — „Titel top“ › „[^„“]*“ › „Linsen“$/);
    assert.match(lines.find(l => l.includes('nodeId: b-2'))!, /\[Unterthemen mit dieser Anmeldung nicht lesbar\]/);
    // The data keeps the title as the repository holds it.
    assert.equal(structured<{ items: Array<{ title: string }> }>(md).items[0]!.title, FORGED);
  } finally { await client.close(); repo.mock.restore(); }

  repo = repository(tree, down);
  client = await strictClient();
  try {
    const json = await client.callTool({ name: 'list_collection_tree', arguments: { nodeId: 'top', outputFormat: 'json' } });
    const blocks = (json as { content: Array<{ text: string }> }).content;
    const parsed = JSON.parse(blocks[0]!.text) as { incomplete?: boolean; items: unknown[] };
    assert.equal(parsed.incomplete, true);
    assert.equal(parsed.items.length, 3);
    assert.equal(blocks[1]!.text, TREE_INCOMPLETE_NOTICE);
    assert.match(TREE_INCOMPLETE_NOTICE, /ließ sich gerade nicht lesen/);
  } finally { await client.close(); repo.mock.restore(); }
});

test('list_collection_tree (tool): an empty tree and the end of the list say so; a page with more names the next one', async () => {
  for (const [args, tree, sentence] of [
    [{}, {}, 'Diese Sammlung hat keine Untersammlungen.'],
    [{ skipCount: 10 }, SMALL, 'Ab dieser Position gibt es keine weiteren Untersammlungen.'],
    [{ maxItems: 2 }, SMALL, 'Es gibt weitere Einträge — nächste Seite mit skipCount=2.'],
  ] as const) {
    const { mock } = repository(tree);
    const client = await strictClient();
    try {
      const r = await client.callTool({ name: 'list_collection_tree', arguments: { nodeId: 'top', ...args } });
      assert.ok(toolText(r).includes(sentence), toolText(r));
    } finally { await client.close(); mock.restore(); }
  }
});

test('list_collection_tree (tool): neither id nor title is refused before any read', async () => {
  const { mock, listings } = repository(SMALL);
  const client = await strictClient();
  try {
    const r = await client.callTool({ name: 'list_collection_tree', arguments: {} });
    assert.equal(structured<{ error: { code: string } }>(r).error.code, 'invalid_input');
    assert.equal(listings.length, 0);
  } finally { await client.close(); mock.restore(); }
});

// ── review of package 1 (2026-11-14) ────────────────────────────────────────

const many = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => branch(`${prefix}-${i}`, `${prefix} ${i}`));

test('list_collection_tree: a LATER page of one parent that does not answer keeps what came and says incomplete', async () => {
  const { mock } = repository({ top: many('k', 130) }, url =>
    (url.includes('/children') && isFolders(url) && param(url, 'skipCount') === '100' ? { status: 503, json: {} } : undefined));
  try {
    const tree = await flat({ depth: 1 });
    assert.equal(tree.count, 100);
    assert.equal(tree.incomplete, true);
  } finally { mock.restore(); }
});

test('list_collection_tree: a small page over a long child list sends one listing, and paging across the listing boundary equals the whole', async () => {
  const kids = many('k', 130);
  const one = repository({ top: kids });
  try {
    await flat({ depth: 1, maxItems: 5 });
    assert.equal(one.listings.length, 1);
  } finally { one.mock.restore(); }
  const { mock } = repository({ top: kids });
  try {
    const paged: string[] = [];
    for (let skipCount = 0, guard = 0; guard < 10; guard++) {
      const t = await flat({ depth: 1, maxItems: 60, skipCount });
      paged.push(...t.items.map(i => i.nodeId));
      if (!t.more) break;
      skipCount = t.more.nextSkipCount;
    }
    assert.deepEqual(paged, kids.map(k => k.ref.id));
  } finally { mock.restore(); }
});

test('list_collection_tree: a cycle and the start collection as its own descendant end the walk — each id once', async () => {
  const { mock } = repository({ top: [branch('a', 'A')], a: [branch('top', 'Start'), branch('a', 'A'), branch('b', 'B')], b: [branch('a', 'A')] });
  try {
    assert.deepEqual((await flat()).items.map(i => i.nodeId), ['a', 'b']);
  } finally { mock.restore(); }
});

test('list_collection_tree: a count that did not answer marks the item as unread — not refused, not zero', async () => {
  const { mock } = repository(SMALL, url => (url.includes('/children') && !isFolders(url) && idOf(url) === 'b-a' ? { status: 500, json: {} } : undefined));
  try {
    const item = (await flat({ depth: 1, includeContentCounts: true })).items.find(i => i.nodeId === 'b-a')!;
    assert.deepEqual([item.contentCount, item.contentsUnread, item.contentsRefused], [undefined, true, undefined]);
  } finally { mock.restore(); }
});

test('list_collection_tree (tool): an empty page beside an unread branch does not say "keine weiteren"', async () => {
  const { mock } = repository(SMALL, url => (url.includes('/children') && isFolders(url) && idOf(url) === 'b-z' ? { status: 503, json: {} } : undefined));
  const client = await strictClient();
  try {
    const text = toolText(await client.callTool({ name: 'list_collection_tree', arguments: { nodeId: 'top', skipCount: 10 } }));
    assert.ok(text.includes(TREE_INCOMPLETE_NOTICE));
    assert.doesNotMatch(text, /keine weiteren Untersammlungen|hat keine Untersammlungen/);
  } finally { await client.close(); mock.restore(); }
});

test('list_collection_tree (tool): a record or a plain folder as the start is not_a_collection — not "keine Untersammlungen"', async () => {
  const record = { ref: { id: 'top' }, type: 'ccm:io', properties: { 'cclom:title': ['Arbeitsblatt'] } };
  const folder = { ref: { id: 'top' }, type: 'ccm:map', properties: { 'cm:name': ['Ablage'] } };
  for (const node of [record, folder]) {
    const { mock, listings } = repository({}, url => (url.includes('/metadata') ? { json: { node } } : undefined));
    const client = await strictClient();
    try {
      const r = await client.callTool({ name: 'list_collection_tree', arguments: { nodeId: 'top' } });
      assert.equal(r.isError, true);
      assert.equal(structured<{ error: { code: string } }>(r).error.code, 'not_a_collection');
      assert.equal(listings.length, 0);
    } finally { await client.close(); mock.restore(); }
  }
});

/**
 * 300 chains of three: one listing per item below the first level. A page from
 * position 500 needs 751 items — 1 + 300 listings for two levels (600 items),
 * and 151 more for the third: past the bound.
 */
function wideTree(): Record<string, unknown[]> {
  const tree: Record<string, unknown[]> = { top: many('p', 300) };
  for (let i = 0; i < 300; i++) { tree[`p-${i}`] = [branch(`q-${i}`, 'Mitte')]; tree[`q-${i}`] = [branch(`r-${i}`, 'Blatt')]; }
  return tree;
}

test('list_collection_tree: the walk is bounded in LISTINGS — past the bound it stops, says walkCapped, and leaves no hole', async () => {
  let repo = repository(wideTree());
  try {
    const capped = await flat({ depth: 3, maxItems: 250, skipCount: 500 });
    assert.equal(repo.listings.length, FLAT_TREE_LISTINGS_MAX);
    assert.equal(capped.walkCapped, true);
    assert.equal(capped.more, undefined);
    // Levels 1 and 2 are whole (600); of level 3 only what the bound allowed, in order — a prefix.
    assert.deepEqual(capped.items.slice(0, 100).map(i => i.depth), Array(100).fill(2));
    assert.ok(capped.items.length > 100 && capped.items.slice(100).every(i => i.depth === 3));
    assert.equal(capped.items[100]!.nodeId, 'r-0');
    // 400 requests: 4 for the root (300 children in pages of 100, and the empty one that ends it),
    // 300 on level 1, 96 on level 2 — so 96 items of level 3.
    assert.equal(capped.count, 196);
  } finally { repo.mock.restore(); }
  // A page the bound does not touch says nothing of it.
  repo = repository(wideTree());
  try {
    const first = await flat({ depth: 3, maxItems: 250 });
    assert.equal(first.walkCapped, undefined);
    assert.deepEqual(first.more, { nextSkipCount: 250 });
    // The root alone fills it: three pages of its 300 children.
    assert.equal(repo.listings.length, 3);
  } finally { repo.mock.restore(); }
});

test('list_collection_tree (tool): a capped walk says so in the first block', async () => {
  const { mock } = repository(wideTree());
  const client = await strictClient();
  try {
    const r = await client.callTool({ name: 'list_collection_tree', arguments: { nodeId: 'top', depth: 3, skipCount: 500 } });
    assert.equal(structured<{ walkCapped?: boolean }>(r).walkCapped, true);
    assert.ok((r as { content: Array<{ text: string }> }).content[0]!.text.includes(TREE_CAPPED_NOTICE));
  } finally { await client.close(); mock.restore(); }
});

test('browse_collection_tree order=stored: a cut keeps the FIRST of the stored order, on level 1 and below', async () => {
  stopSkillRegistryCache();
  // Stored order Z, Y, X …: alphabetical order would keep the other end.
  const kids = Array.from({ length: 12 }, (_, i) => branch(`c-${i}`, `Kind ${String.fromCharCode(90 - i)}`));
  const { mock } = repository({ top: [branch('b-z', 'Zeta'), branch('b-m', 'Mitte'), branch('b-a', 'Alpha')], 'b-z': kids });
  const client = await strictClient();
  try {
    const r = await client.callTool({ name: 'browse_collection_tree', arguments: { nodeId: 'top', depth: 2, order: 'stored', maxResults: 2 } });
    const out = structured<{ results: Array<{ nodeId: string; hasMoreChildren?: boolean; children: Array<{ nodeId: string }> }>; truncatedAt?: string }>(r);
    assert.deepEqual(out.results.map(n => n.nodeId), ['b-z', 'b-m']);
    assert.equal(out.truncatedAt, 'top');
    assert.equal(out.results[0]!.hasMoreChildren, true);
    assert.deepEqual(out.results[0]!.children.map(n => n.nodeId), kids.slice(0, 10).map(k => k.ref.id));
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

test('list_collection_tree: the bound holds when ONE parent near it needs many pages — it is cut, and the walk says so', async () => {
  // 4 requests for the root's 300 children, 300 for level 1, 88 for childless level-2
  // parents: 8 left for the last group — whose last parent holds 800 children.
  const tree: Record<string, unknown[]> = { top: many('p', 300) };
  for (let i = 0; i < 300; i++) tree[`p-${i}`] = [branch(`q-${i}`, 'Mitte')];
  tree['q-95'] = many('z', 800);
  const repo = repository(tree);
  try {
    const t = await flat({ depth: 3, maxItems: 250, skipCount: 500 });
    assert.ok(repo.listings.length <= FLAT_TREE_LISTINGS_MAX, `${repo.listings.length} requests`);
    assert.equal(t.walkCapped, true);
    // One page of the 800 came; the rest is what the bound cost.
    assert.equal(t.count, 200);
    assert.equal(t.more, undefined);
  } finally { repo.mock.restore(); }
});
