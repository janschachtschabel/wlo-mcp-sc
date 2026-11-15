/**
 * tree-order-position-and-unread.test.ts – chatbot team, S11–S13, 2026-11-15.
 *
 *   - S11: `order: "position"` — per parent the children with a set position in
 *     position order, then the rest by title — and `childrenPositioned`, the
 *     flag that says whether positions ordered anything.
 *   - S12: a content count asks for NO item (`maxItems=0`), a few more at a time.
 *   - S13: the flat list names every parent whose sub-listing was not read in
 *     this call — the start collection and parents on other pages included.
 *
 * The mock proves what is sent and how an answer is read. That the listing
 * carries the position, what an unset one looks like and what `maxItems=0`
 * answers is measured (`npm run measure:tree`).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { positionOf, positionedFlag, positionsDecide, sortByPosition } from '../src/collection-position.js';
import { ORDER_POSITION_PROPERTY, getChildCollectionsResult } from '../src/wlo-node.js';
import { WLO_UPSTREAM_CONCURRENCY } from '../src/wlo-config.js';
import { RESTRICTED_NOTICE } from '../src/services/collection-traversal.js';
import {
  FLAT_TREE_COUNT_POOL, FLAT_TREE_PARENTS_NAMED_MAX, countPool, listCollectionTree, type FlatTree,
} from '../src/services/collection-tree-flat.js';
import { TREE_INCOMPLETE_NOTICE } from '../src/tools/collection-tree-list.js';
import { stopSkillRegistryCache } from '../src/services/skill-registry-cache.js';
import { installFetchMock, strictClient, toolText, type MockResult } from './fetchMock.js';

const idOf = (url: string) => decodeURIComponent(new URL(url).pathname.match(/-home-\/([^/]+)\//)?.[1] ?? '');
const param = (url: string, name: string) => new URL(url).searchParams.get(name);
const props = (url: string) => new URL(url).searchParams.getAll('propertyFilter');
const isFolders = (url: string) => param(url, 'filter') === 'folders';
const page = (nodes: unknown[], total = nodes.length) => ({ json: { nodes, pagination: { total, from: 0, count: nodes.length } } });
/** A sub-collection; `position` as the repository holds it — a string, or no property at all. */
const branch = (id: string, title: string, position?: string) => ({
  ref: { id }, type: 'ccm:map', aspects: ['ccm:collection'],
  properties: { 'cm:title': [title], ...(position === undefined ? {} : { [ORDER_POSITION_PROPERTY]: [position] }) },
});
const structured = <T>(r: unknown) => (r as { structuredContent: T }).structuredContent;
const blocks = (r: unknown) => (r as { content: Array<{ text: string }> }).content.map(b => b.text);

/** A repository holding `tree` (parent id → children, in the order the SERVER answers). */
function repository(tree: Record<string, unknown[]>, overrides: (url: string) => MockResult | undefined = () => undefined) {
  const listings: string[] = [];
  const counts: string[] = [];
  const mock = installFetchMock((url): MockResult => {
    const over = overrides(url);
    if (over) return over;
    if (url.includes('/metadata')) return { json: { node: branch(idOf(url), `Titel ${idOf(url)}`) } };
    if (!url.includes('/children')) return { json: {} };
    if (!isFolders(url)) { counts.push(url); return page([], 7); }
    listings.push(url);
    const all = tree[idOf(url)] ?? [];
    const skip = Number(param(url, 'skipCount') ?? 0);
    return page(all.slice(skip, skip + Number(param(url, 'maxItems') ?? 100)), all.length);
  });
  return { mock, listings, counts };
}
const folders = (id: string, status: number) => (url: string): MockResult | undefined =>
  (url.includes('/children') && isFolders(url) && idOf(url) === id ? { status, json: {} } : undefined);

/**
 * `top`: two different positions and one child without → positions decide.
 * `b-2`: the same position on every child (what the subject portals hold) → they do not.
 * `b-1`: nobody set anything.
 * Every list is in the order the repository answers a sorted listing: positioned first, then by creation.
 */
const MIXED = {
  top: [branch('b-2', 'Zweites', '0'), branch('b-1', 'Erstes', '1'), branch('b-9', 'Zuletzt angelegt'), branch('b-0', 'Angehängt')],
  'b-2': [branch('c-z', 'Zeta', '1'), branch('c-a', 'Alpha', '1'), branch('c-m', 'Mitte', '1')],
  'b-1': [branch('d-y', 'Ypsilon'), branch('d-b', 'Beta')],
};

const flat = (over: Partial<Parameters<typeof listCollectionTree>[0]> = {}) =>
  listCollectionTree({ rootId: 'top', depth: 4, maxItems: 250, skipCount: 0, includeContentCounts: false, ...over });

// ── S11: the rule ───────────────────────────────────────────────────────────

test('sortByPosition: positioned children by NUMBER, equal positions and the unpositioned by title', () => {
  const sorted = sortByPosition([
    branch('n', 'Ohne Z'), branch('p10', 'Zehn', '10'), branch('t2', 'Gleich B', '2'), branch('p9', 'Neun', '9'),
    branch('t1', 'gleich a', '2'), branch('m', 'ohne A'), branch('x', 'Leer', ''), branch('y', 'Kein Wert', 'abc'),
  ] as never);
  // 9 before 10 (a number, not a string); the tie at 2 by title, case-blind; an
  // empty or non-numeric value is no position.
  assert.deepEqual(sorted.map(n => n.ref?.id), ['t1', 't2', 'p9', 'p10', 'y', 'x', 'm', 'n']);
});

test('positionsDecide: only two DIFFERENT positions order anything', () => {
  assert.equal(positionsDecide([branch('a', 'A', '0'), branch('b', 'B', '1')] as never), true);
  assert.equal(positionsDecide([branch('a', 'A', '0'), branch('b', 'B'), branch('c', 'C', '3')] as never), true);
  // The subject portals: thirty children, every one at "1".
  assert.equal(positionsDecide([branch('a', 'A', '1'), branch('b', 'B', '1'), branch('c', 'C')] as never), false);
  assert.equal(positionsDecide([branch('a', 'A', '1')] as never), false);
  assert.equal(positionsDecide([branch('a', 'A'), branch('b', 'B')] as never), false);
  assert.equal(positionsDecide([]), false);
});

test('positionOf: a plain integer within the safe range, and nothing else', () => {
  const of = (raw: string) => positionOf(branch('x', 'X', raw) as never);
  for (const [raw, expected] of [
    ['0', 0], ['13', 13], ['-2', -2], [' 7 ', 7], ['007', 7], ['9007199254740991', 9007199254740991],
    // What `Number()` would take for a number — none of it is what the repository writes.
    ['0x10', undefined], ['1e3', undefined], ['1.5', undefined], ['+3', undefined], ['Infinity', undefined],
    ['', undefined], ['  ', undefined], ['abc', undefined], ['1 2', undefined],
    // Past 2^53 two different positions compare equal.
    ['9007199254740993', undefined], ['-9007199254740993', undefined],
  ] as const) assert.equal(of(raw), expected, JSON.stringify(raw));
  assert.equal(positionOf(branch('x', 'X') as never), undefined);
});

test('positionedFlag: true from what was SEEN, false only over a listing read to its end, nothing below two children', () => {
  const tie = [branch('a', 'A', '1'), branch('b', 'B', '1')] as never[];
  const differ = [branch('a', 'A', '1'), branch('b', 'B', '2')] as never[];
  assert.equal(positionedFlag(differ, true), true);
  // Two different positions are a fact whatever follows them.
  assert.equal(positionedFlag(differ, false), true);
  assert.equal(positionedFlag(tie, true), false);
  // The listing is position-ascending: the unseen tail is exactly where a different one stands.
  assert.equal(positionedFlag(tie, false), undefined);
  // Nothing to order: no statement, read to the end or not.
  assert.equal(positionedFlag([], true), undefined);
  assert.equal(positionedFlag([branch('a', 'A', '1')] as never[], true), undefined);
  assert.equal(positionedFlag([branch('a', 'A', '1')] as never[], false), undefined);
});

test('the children listing asks for the position property only when told to', async () => {
  const { mock, listings } = repository({});
  try {
    await getChildCollectionsResult('x');
    await getChildCollectionsResult('x', 10, 0, undefined, { stored: true });
    await getChildCollectionsResult('x', 10, 0, undefined, { stored: true, withPosition: true });
    await getChildCollectionsResult('x', 10, 0, ['cm:title'], { stored: true, withPosition: true });
    assert.ok(!props(listings[0]!).includes(ORDER_POSITION_PROPERTY));
    assert.ok(!props(listings[1]!).includes(ORDER_POSITION_PROPERTY));
    assert.ok(props(listings[2]!).includes(ORDER_POSITION_PROPERTY));
    // The projection the caller asked for stays, the property is added to it.
    assert.deepEqual(props(listings[3]!), ['cm:title', ORDER_POSITION_PROPERTY]);
    assert.equal(param(listings[3]!, 'sortProperties'), ORDER_POSITION_PROPERTY);
  } finally { mock.restore(); }
});

// ── S11: browse_collection_tree and get_collection_overview ─────────────────

interface BrowseNode { nodeId: string; childrenPositioned?: boolean; children?: BrowseNode[] }
interface BrowseOut { results: BrowseNode[]; childrenPositioned?: boolean }

test('browse_collection_tree order=position: position, else title — per parent, with the flag that says which', async () => {
  stopSkillRegistryCache();
  const { mock, listings } = repository(MIXED);
  const client = await strictClient();
  try {
    const r = await client.callTool({ name: 'browse_collection_tree', arguments: { nodeId: 'top', depth: 2, order: 'position' } });
    assert.equal(r.isError, undefined, toolText(r));
    const out = structured<BrowseOut>(r);
    // 0, 1, then the two without a position by title — not in the order of creation.
    assert.deepEqual(out.results.map(n => n.nodeId), ['b-2', 'b-1', 'b-0', 'b-9']);
    assert.equal(out.childrenPositioned, true);
    // The same position on every child: by title, and the flag says positions decided nothing.
    assert.deepEqual(out.results[0]!.children!.map(n => n.nodeId), ['c-a', 'c-m', 'c-z']);
    assert.equal(out.results[0]!.childrenPositioned, false);
    assert.deepEqual(out.results[1]!.children!.map(n => n.nodeId), ['d-b', 'd-y']);
    assert.equal(out.results[1]!.childrenPositioned, false);
    // The last level was not listed: nothing is claimed about ITS children.
    assert.ok(!('childrenPositioned' in out.results[0]!.children![0]!));
    assert.ok(listings.length >= 5 && listings.every(u =>
      param(u, 'sortProperties') === ORDER_POSITION_PROPERTY && props(u).includes(ORDER_POSITION_PROPERTY)));
    // The text follows the data and says where positions held.
    const text = toolText(r);
    assert.ok(text.indexOf('b-0') < text.indexOf('b-9'));
    assert.match(text.split('\n')[0]!, /erste Ebene in gesetzter Reihenfolge/);
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

test('browse_collection_tree: the default order neither asks for the position nor carries the flag', async () => {
  stopSkillRegistryCache();
  for (const order of [undefined, 'title'] as const) {
    const { mock, listings } = repository(MIXED);
    const client = await strictClient();
    try {
      const r = await client.callTool({ name: 'browse_collection_tree', arguments: { nodeId: 'top', depth: 2, ...(order ? { order } : {}) } });
      assert.ok(listings.every(u => !props(u).includes(ORDER_POSITION_PROPERTY) && param(u, 'sortProperties') === null), String(order));
      assert.doesNotMatch(JSON.stringify(structured(r)), /childrenPositioned/);
      assert.doesNotMatch(toolText(r), /gesetzter Reihenfolge|Positionen/);
    } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
  }
});

// The team reads with `stored` and sorts by itself where nothing was arranged:
// the flag is the alternative to `order: "position"`, so it has to come with
// `stored` too (follow-up of 2026-11-15).
test('browse_collection_tree order=stored: the repository\'s order, untouched — and the flag per parent', async () => {
  stopSkillRegistryCache();
  const { mock, listings } = repository(MIXED);
  const client = await strictClient();
  try {
    const r = await client.callTool({ name: 'browse_collection_tree', arguments: { nodeId: 'top', depth: 2, order: 'stored' } });
    assert.equal(r.isError, undefined, toolText(r));
    const out = structured<BrowseOut>(r);
    assert.deepEqual(out.results.map(n => n.nodeId), ['b-2', 'b-1', 'b-9', 'b-0']);
    assert.deepEqual(out.results[0]!.children!.map(n => n.nodeId), ['c-z', 'c-a', 'c-m']);
    assert.equal(out.childrenPositioned, true);
    assert.equal(out.results[0]!.childrenPositioned, false);
    assert.equal(out.results[1]!.childrenPositioned, false);
    assert.ok(!('childrenPositioned' in out.results[0]!.children![0]!));
    assert.ok(listings.every(u => param(u, 'sortProperties') === ORDER_POSITION_PROPERTY && props(u).includes(ORDER_POSITION_PROPERTY)));
    // The head line says which case held — and does not claim the `position` rule.
    const head = toolText(r).split('\n')[0]!;
    assert.match(head, /erste Ebene in gesetzter Reihenfolge/);
    assert.doesNotMatch(head, /sonst Titel/);
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
  // Nothing arranged: said as that, never as "by title" — `stored` does not sort.
  const flatRepo = repository({ top: MIXED['b-2'] });
  const second = await strictClient();
  try {
    const r = await second.callTool({ name: 'browse_collection_tree', arguments: { nodeId: 'top', order: 'stored' } });
    assert.equal(structured<BrowseOut>(r).childrenPositioned, false);
    const head = toolText(r).split('\n')[0]!;
    assert.match(head, /erste Ebene ohne unterscheidende Positionen/);
    assert.doesNotMatch(head, /nach Titel/);
  } finally { await second.close(); flatRepo.mock.restore(); stopSkillRegistryCache(); }
});

test('browse_collection_tree order=stored: a branch that was not read carries no flag', async () => {
  stopSkillRegistryCache();
  for (const status of [503, 403]) {
    const { mock } = repository(MIXED, folders('b-2', status));
    const client = await strictClient();
    try {
      const out = structured<BrowseOut>(await client.callTool({ name: 'browse_collection_tree', arguments: { nodeId: 'top', depth: 2, order: 'stored' } }));
      assert.ok(!('childrenPositioned' in out.results.find(n => n.nodeId === 'b-2')!));
      assert.equal(out.results.find(n => n.nodeId === 'b-1')!.childrenPositioned, false);
    } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
  }
});

test('browse_collection_tree order=position: a branch that was not read carries no flag', async () => {
  stopSkillRegistryCache();
  const { mock } = repository(MIXED, folders('b-2', 503));
  const client = await strictClient();
  try {
    const out = structured<BrowseOut>(await client.callTool({ name: 'browse_collection_tree', arguments: { nodeId: 'top', depth: 2, order: 'position' } }));
    const unread = out.results.find(n => n.nodeId === 'b-2')!;
    assert.ok(!('childrenPositioned' in unread));
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

// Review 2026-11-15: a negative from an incomplete read. The listing comes
// position-ascending, so a cut prefix of equal positions is exactly where the
// unseen tail differs.
const CUT_TIE = Array.from({ length: 60 }, (_, i) => branch(`k-${String(i).padStart(2, '0')}`, `Kind ${String(i).padStart(2, '0')}`, i < 55 ? '1' : '2'));
const CUT_SEEN = Array.from({ length: 60 }, (_, i) => branch(`k-${String(i).padStart(2, '0')}`, `Kind ${String(i).padStart(2, '0')}`, i < 10 ? '1' : '2'));

test('browse_collection_tree: over a CUT first level the flag is absent — unless two different positions were seen', async () => {
  stopSkillRegistryCache();
  for (const order of ['stored', 'position'] as const) {
    let repo = repository({ top: CUT_TIE });
    let client = await strictClient();
    try {
      const r = await client.callTool({ name: 'browse_collection_tree', arguments: { nodeId: 'top', maxResults: 50, order } });
      const out = structured<BrowseOut & { truncated?: boolean }>(r);
      assert.equal(out.truncated, true);
      assert.equal(out.results.length, 50);
      assert.ok(!('childrenPositioned' in out), order);
      // The text says nothing it does not know about the first level.
      const head = toolText(r).split('\n')[0]!;
      assert.doesNotMatch(head, /erste Ebene|nach Titel|ohne unterscheidende/);
      if (order === 'position') assert.match(head, / — Reihenfolge: gesetzte Position, sonst Titel$/);
      else assert.doesNotMatch(head, /Reihenfolge/);
    } finally { await client.close(); repo.mock.restore(); stopSkillRegistryCache(); }
    repo = repository({ top: CUT_SEEN });
    client = await strictClient();
    try {
      const r = await client.callTool({ name: 'browse_collection_tree', arguments: { nodeId: 'top', maxResults: 50, order } });
      assert.equal(structured<BrowseOut>(r).childrenPositioned, true, order);
      assert.match(toolText(r).split('\n')[0]!, /erste Ebene in gesetzter Reihenfolge/);
    } finally { await client.close(); repo.mock.restore(); stopSkillRegistryCache(); }
  }
});

test('browse_collection_tree: the same on a child level cut at hasMoreChildren', async () => {
  stopSkillRegistryCache();
  // Two nodes on level 1 → ten children shown per parent, eleven asked for.
  const tree = { top: [branch('b-1', 'Eins', '1'), branch('b-2', 'Zwei', '2')], 'b-1': CUT_TIE.slice(0, 15), 'b-2': [...CUT_SEEN.slice(5, 20)] };
  for (const order of ['stored', 'position'] as const) {
    const { mock } = repository(tree);
    const client = await strictClient();
    try {
      const out = structured<BrowseOut>(await client.callTool({ name: 'browse_collection_tree', arguments: { nodeId: 'top', depth: 2, order } }));
      const [tie, seen] = out.results as Array<BrowseNode & { hasMoreChildren?: boolean }>;
      assert.equal(tie!.hasMoreChildren, true);
      assert.ok(!('childrenPositioned' in tie!), order);
      assert.equal(seen!.hasMoreChildren, true);
      assert.equal(seen!.childrenPositioned, true, order);
    } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
  }
});

test('get_collection_overview: over a CUT list of sub-collections the flag is absent, and the text does not say which case held', async () => {
  stopSkillRegistryCache();
  for (const [order, line] of [['stored', undefined], ['position', 'Reihenfolge: gesetzte Position, sonst Titel.']] as const) {
    const { mock } = repository({ top: CUT_TIE });
    const client = await strictClient();
    try {
      const r = await client.callTool({ name: 'get_collection_overview', arguments: { collectionId: 'top', include: ['subcollections'], maxSubcollections: 50, order } });
      const out = structured<{ subcollectionsTruncated?: boolean; subcollectionsPositioned?: boolean }>(r);
      assert.equal(out.subcollectionsTruncated, true);
      assert.ok(!('subcollectionsPositioned' in out), order);
      assert.doesNotMatch(toolText(r), /Hier:|nach Titel|keine unterscheidenden|in gesetzter Reihenfolge/);
      assert.equal(toolText(r).split('\n').find(l => l.startsWith('Reihenfolge')), line);
    } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
  }
});

test('fewer than two sub-collections: no flag in any of the three tools — there is nothing to order', async () => {
  stopSkillRegistryCache();
  const tree = { top: [branch('b-1', 'Eins', '1'), branch('b-2', 'Zwei', '2')], 'b-1': [branch('c-1', 'Einzelkind', '4')] };
  const { mock } = repository(tree);
  const client = await strictClient();
  try {
    const listed = await flat({ order: 'stored' });
    assert.equal(listed.root.childrenPositioned, true);
    assert.ok(listed.items.every(i => !('childrenPositioned' in i)), JSON.stringify(listed.items));
    const browsed = structured<BrowseOut>(await client.callTool({ name: 'browse_collection_tree', arguments: { nodeId: 'top', depth: 2, order: 'stored' } }));
    assert.equal(browsed.childrenPositioned, true);
    assert.ok(browsed.results.every(n => !('childrenPositioned' in n)));
    for (const id of ['b-1', 'b-2']) {
      const r = await client.callTool({ name: 'get_collection_overview', arguments: { collectionId: id, include: ['subcollections'], order: 'position' } });
      assert.ok(!('subcollectionsPositioned' in structured<object>(r)), id);
    }
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

test('browse_collection_tree: a child level is cut in the repository\'s order BEFORE `position` sorts it; `title` keeps its own rule', async () => {
  stopSkillRegistryCache();
  // Eleven children without a position, created in reverse alphabetical order;
  // ten are shown. The eleventh — the one cut — is the alphabetically FIRST.
  const kids = Array.from({ length: 11 }, (_, i) => branch(`c-${String(10 - i).padStart(2, '0')}`, `Kind ${String(10 - i).padStart(2, '0')}`));
  const tree = { top: [branch('b-1', 'Eins'), branch('b-2', 'Zwei')], 'b-1': kids };
  const ids = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `c-${String(from + i).padStart(2, '0')}`);
  for (const [order, expected] of [
    // The first ten created (c-10 … c-01), then by title.
    ['position', ids(1, 10)],
    // What it always did: sorted over everything fetched, then cut.
    ['title', ids(0, 9)],
    ['stored', ids(1, 10).reverse()],
  ] as const) {
    const { mock } = repository(tree);
    const client = await strictClient();
    try {
      const out = structured<BrowseOut>(await client.callTool({ name: 'browse_collection_tree', arguments: { nodeId: 'top', depth: 2, order } }));
      assert.deepEqual(out.results.find(n => n.nodeId === 'b-1')!.children!.map(n => n.nodeId), expected, order);
    } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
  }
});

test('get_collection_overview order=position: sorted by the rule, and subcollectionsPositioned says which case held', async () => {
  stopSkillRegistryCache();
  for (const [id, ids, flag] of [['top', ['b-2', 'b-1', 'b-0', 'b-9'], true], ['b-2', ['c-a', 'c-m', 'c-z'], false]] as const) {
    const { mock } = repository(MIXED);
    const client = await strictClient();
    try {
      const r = await client.callTool({ name: 'get_collection_overview', arguments: { collectionId: id, include: ['subcollections'], order: 'position' } });
      assert.equal(r.isError, undefined, toolText(r));
      const out = structured<{ subcollections: Array<{ nodeId: string }>; subcollectionsPositioned?: boolean }>(r);
      assert.deepEqual(out.subcollections.map(s => s.nodeId), ids);
      assert.equal(out.subcollectionsPositioned, flag);
    } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
  }
  // The default order: the field does not exist, and the position is not asked for.
  const { mock, listings } = repository(MIXED);
  const client = await strictClient();
  try {
    const r = await client.callTool({ name: 'get_collection_overview', arguments: { collectionId: 'top', include: ['subcollections'] } });
    assert.ok(!('subcollectionsPositioned' in structured<object>(r)));
    assert.ok(listings.length > 0 && listings.every(u => !props(u).includes(ORDER_POSITION_PROPERTY)));
    assert.doesNotMatch(toolText(r), /Reihenfolge|Positionen/);
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

test('get_collection_overview order=stored: the repository\'s order, and subcollectionsPositioned all the same', async () => {
  stopSkillRegistryCache();
  for (const [id, ids, flag, said] of [
    ['top', ['b-2', 'b-1', 'b-9', 'b-0'], true, 'Reihenfolge: in gesetzter Reihenfolge.'],
    // Nothing arranged — and `stored` did not sort by title, so the text must not say it did.
    ['b-2', ['c-z', 'c-a', 'c-m'], false, 'Reihenfolge: keine unterscheidenden Positionen gesetzt.'],
  ] as const) {
    const { mock } = repository(MIXED);
    const client = await strictClient();
    try {
      const r = await client.callTool({ name: 'get_collection_overview', arguments: { collectionId: id, include: ['subcollections'], order: 'stored' } });
      assert.equal(r.isError, undefined, toolText(r));
      const out = structured<{ subcollections: Array<{ nodeId: string }>; subcollectionsPositioned?: boolean }>(r);
      assert.deepEqual(out.subcollections.map(s => s.nodeId), ids);
      assert.equal(out.subcollectionsPositioned, flag);
      // The line a client reads keeps its prefix for every order; the note
      // about the order stands on a line of its own, after the list.
      const lines = toolText(r).split('\n');
      const at = lines.findIndex(l => l.startsWith('Untersammlungen'));
      assert.match(lines[at]!, new RegExp(`^Untersammlungen: ${ids[0]} \\(7\\) „`));
      assert.equal(lines[at + 1], said);
    } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
  }
  // `position`: the rule, then which of its two cases held here.
  for (const [id, said] of [
    ['top', 'Reihenfolge: gesetzte Position, sonst Titel. Hier: in gesetzter Reihenfolge.'],
    ['b-2', 'Reihenfolge: gesetzte Position, sonst Titel. Hier: nach Titel (keine unterscheidenden Positionen gesetzt).'],
  ] as const) {
    const { mock } = repository(MIXED);
    const client = await strictClient();
    try {
      const lines = toolText(await client.callTool({ name: 'get_collection_overview', arguments: { collectionId: id, include: ['subcollections'], order: 'position' } })).split('\n');
      const at = lines.findIndex(l => l.startsWith('Untersammlungen'));
      assert.match(lines[at]!, /^Untersammlungen: \S+ \(7\) „/);
      assert.equal(lines[at + 1], said);
    } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
  }
});

// ── S11: list_collection_tree ───────────────────────────────────────────────

test('list_collection_tree: the default (stored) keeps its request and its order — plus the position in the projection, and the flag', async () => {
  const { mock, listings } = repository(MIXED);
  try {
    const tree = await flat();
    // The order of the answer is the repository's, as before the flag existed.
    assert.deepEqual(tree.items.map(i => i.nodeId), ['b-2', 'b-1', 'b-9', 'b-0', 'c-z', 'c-a', 'c-m', 'd-y', 'd-b']);
    assert.deepEqual(Object.keys(tree), ['root', 'depth', 'count', 'skipCount', 'items']);
    assert.deepEqual(tree.root, { nodeId: 'top', title: 'Titel top', childrenPositioned: true });
    // Every item's listing was read to its end in this call: the two parents
    // with children to order say which case held, a leaf says nothing.
    assert.deepEqual(tree.items.map(i => i.childrenPositioned), [false, false, ...Array.from({ length: 7 }, () => undefined)]);
    assert.ok(tree.items.slice(2).every(i => !('childrenPositioned' in i)));
    // The request: what it always was, with ONE property more.
    for (const u of listings) {
      const q = new URL(u).searchParams;
      assert.deepEqual([...new Set(q.keys())].sort(), ['filter', 'maxItems', 'propertyFilter', 'skipCount', 'sortAscending', 'sortProperties']);
      assert.deepEqual([q.get('filter'), q.get('maxItems'), q.get('skipCount'), q.get('sortProperties'), q.get('sortAscending')],
        ['folders', '100', '0', ORDER_POSITION_PROPERTY, 'true']);
      assert.deepEqual(props(u), ['cm:title', 'cclom:title', 'cm:name', ORDER_POSITION_PROPERTY]);
    }
    // Naming the default changes nothing.
    assert.deepEqual(await flat({ order: 'stored' }), tree);
  } finally { mock.restore(); }
});

test('list_collection_tree order=stored: positions that decide are flagged at the parent, the order stays the repository\'s', async () => {
  // Stored order of `b-1`: position 2, position 5, then one without.
  const { mock } = repository({ ...MIXED, 'b-1': [branch('d-2', 'Zwei', '2'), branch('d-1', 'Eins', '5'), branch('d-0', 'Alpha')] });
  try {
    const tree = await flat();
    assert.deepEqual(tree.items.filter(i => i.parentId === 'b-1').map(i => i.nodeId), ['d-2', 'd-1', 'd-0']);
    assert.equal(tree.items.find(i => i.nodeId === 'b-1')!.childrenPositioned, true);
    assert.equal(tree.items.find(i => i.nodeId === 'b-2')!.childrenPositioned, false);
  } finally { mock.restore(); }
});

test('list_collection_tree order=stored: no flag where the listing was not read to its END in this call', async () => {
  // `stored` stops reading a parent once the page is full: 130 children, the
  // first hundred all at "1", and the page needs six. "Positions order nothing"
  // over the hundred read would be a statement about the thirty not seen.
  const kids = Array.from({ length: 130 }, (_, i) => branch(`k-${i}`, `Kind ${i}`, i < 100 ? '1' : String(i)));
  let repo = repository({ top: kids });
  try {
    const tree = await flat({ depth: 1, maxItems: 5 });
    assert.equal(repo.listings.length, 1);
    assert.ok(!('childrenPositioned' in tree.root));
  } finally { repo.mock.restore(); }
  // Read to its end, the same parent says it.
  repo = repository({ top: kids });
  try {
    const tree = await flat({ depth: 1 });
    assert.equal(repo.listings.length, 2);
    assert.equal(tree.root.childrenPositioned, true);
    // The last level: nobody listed the children of its items.
    assert.ok(tree.items.every(i => !('childrenPositioned' in i)));
  } finally { repo.mock.restore(); }
  // Not read and refused are not "not positioned" either.
  for (const status of [503, 403]) {
    repo = repository(MIXED, folders('b-2', status));
    try {
      const tree = await flat();
      assert.ok(!('childrenPositioned' in tree.items.find(i => i.nodeId === 'b-2')!));
      assert.equal(tree.items.find(i => i.nodeId === 'b-1')!.childrenPositioned, false);
    } finally { repo.mock.restore(); }
  }
});

test('list_collection_tree order=position: each parent\'s children sorted BEFORE they join the level', async () => {
  const { mock, listings } = repository(MIXED);
  try {
    const tree = await flat({ order: 'position' });
    // Level 1 by the rule; level 2 follows the parents in THAT order, each parent's children by the rule.
    assert.deepEqual(tree.items.map(i => i.nodeId), ['b-2', 'b-1', 'b-0', 'b-9', 'c-a', 'c-m', 'c-z', 'd-b', 'd-y']);
    assert.equal(tree.root.childrenPositioned, true);
    const flag = (id: string) => tree.items.find(i => i.nodeId === id)!.childrenPositioned;
    assert.equal(flag('b-2'), false);
    assert.equal(flag('b-1'), false);
    // Listed and childless: read, and nothing to order — so nothing is said.
    assert.equal(flag('b-0'), undefined);
    assert.ok(listings.every(u => props(u).includes(ORDER_POSITION_PROPERTY)));
  } finally { mock.restore(); }
});

test('list_collection_tree order=title: every parent alphabetical, no flag', async () => {
  const { mock } = repository(MIXED);
  try {
    const tree = await flat({ order: 'title' });
    assert.deepEqual(tree.items.map(i => i.nodeId), ['b-0', 'b-1', 'b-9', 'b-2', 'd-b', 'd-y', 'c-a', 'c-m', 'c-z']);
    assert.doesNotMatch(JSON.stringify(tree), /childrenPositioned/);
  } finally { mock.restore(); }
});

test('list_collection_tree order=position: pages are one stable list — a long parent is read to its end before it is sorted', async () => {
  // 130 children without a position, created in REVERSE alphabetical order: the
  // first listing page (100) does not hold the alphabetically first ones.
  const kids = Array.from({ length: 130 }, (_, i) => branch(`k-${i}`, `Kind ${String(129 - i).padStart(3, '0')}`));
  const expected = [...kids].reverse().map(k => k.ref.id);
  const one = repository({ top: kids });
  try {
    // A page of five still needs both listing pages: sorted over the first hundred alone, it would start elsewhere.
    const first = await flat({ depth: 1, maxItems: 5, order: 'position' });
    assert.deepEqual(first.items.map(i => i.nodeId), expected.slice(0, 5));
    assert.equal(one.listings.length, 2);
  } finally { one.mock.restore(); }
  const { mock } = repository({ top: kids });
  try {
    const paged: string[] = [];
    for (let skipCount = 0, guard = 0; guard < 10; guard++) {
      const t = await flat({ depth: 1, maxItems: 60, skipCount, order: 'position' });
      paged.push(...t.items.map(i => i.nodeId));
      if (!t.more) break;
      skipCount = t.more.nextSkipCount;
    }
    assert.deepEqual(paged, expected);
  } finally { mock.restore(); }
});

test('list_collection_tree order=position: a parent whose children were not listed in this call carries no flag', async () => {
  // The page is full after level 1: nobody listed the children of its items.
  let repo = repository(MIXED);
  try {
    const tree = await flat({ maxItems: 3, order: 'position' });
    assert.equal(tree.root.childrenPositioned, true);
    assert.ok(tree.items.every(i => !('childrenPositioned' in i)));
  } finally { repo.mock.restore(); }
  // Not read is not "not positioned" either.
  repo = repository(MIXED, folders('b-2', 503));
  try {
    const tree = await flat({ order: 'position' });
    assert.ok(!('childrenPositioned' in tree.items.find(i => i.nodeId === 'b-2')!));
    assert.equal(tree.items.find(i => i.nodeId === 'b-1')!.childrenPositioned, false);
  } finally { repo.mock.restore(); }
});

test('list_collection_tree (tool): takes order, declares the flag, and says in the first block where positions held', async () => {
  const { mock } = repository({ ...MIXED, 'b-1': [branch('d-2', 'Zwei', '2'), branch('d-1', 'Eins', '5')] });
  const client = await strictClient();
  try {
    const r = await client.callTool({ name: 'list_collection_tree', arguments: { nodeId: 'top', order: 'position' } });
    assert.equal(r.isError, undefined, toolText(r));
    assert.equal(structured<FlatTree>(r).root.childrenPositioned, true);
    const lines = blocks(r)[0]!.split('\n');
    assert.equal(lines[1], 'Reihenfolge: gesetzte Position, sonst Titel. Erste Ebene: in gesetzter Reihenfolge.');
    assert.ok(lines.findIndex(l => l.includes('nodeId: b-0')) < lines.findIndex(l => l.includes('nodeId: b-9')));
    // The item lines keep the form they had: the flag per entry is DATA
    // (`childrenPositioned`), and ONE head line speaks about the first level.
    assert.equal(structured<FlatTree>(r).items.find(i => i.nodeId === 'b-1')!.childrenPositioned, true);
    assert.equal(lines.find(l => l.includes('nodeId: b-1')), '- nodeId: b-1 [Ebene 1] — „Titel top“ › „Erstes“');
    assert.equal(lines.filter(l => /gesetzter Reihenfolge|Positionen/.test(l)).length, 1);
    const json = await client.callTool({ name: 'list_collection_tree', arguments: { nodeId: 'b-2', order: 'position', outputFormat: 'json' } });
    assert.equal((JSON.parse(blocks(json)[0]!) as FlatTree).root.childrenPositioned, false);
    // JSON: block 0 carries the field; no block of prose repeats it.
    assert.equal(blocks(json).length, 1);
    const said = await client.callTool({ name: 'list_collection_tree', arguments: { nodeId: 'b-2', order: 'position' } });
    assert.equal(blocks(said)[0]!.split('\n')[1], 'Reihenfolge: gesetzte Position, sonst Titel. Erste Ebene: nach Titel (keine unterscheidenden Positionen gesetzt).');
    // Not over an empty list: it says that it is empty, and nothing about an order.
    const empty = await client.callTool({ name: 'list_collection_tree', arguments: { nodeId: 'b-0', order: 'position' } });
    assert.deepEqual(blocks(empty)[0]!.split('\n').slice(1), ['Diese Sammlung hat keine Untersammlungen.']);
    // The default (`stored`) does not claim the `position` rule; it says which
    // case held on the first level and marks the parents where positions decide.
    const plain = await client.callTool({ name: 'list_collection_tree', arguments: { nodeId: 'top' } });
    const stored = blocks(plain)[0]!.split('\n');
    assert.doesNotMatch(blocks(plain)[0]!, /sonst Titel|nach Titel/);
    assert.equal(stored[1], 'Erste Ebene: in gesetzter Reihenfolge.');
    assert.ok(stored.findIndex(l => l.includes('nodeId: b-9')) < stored.findIndex(l => l.includes('nodeId: b-0')));
    // The item lines of the DEFAULT answer are the ones a client parsed before the flag existed.
    assert.equal(stored.find(l => l.includes('nodeId: b-1')), '- nodeId: b-1 [Ebene 1] — „Titel top“ › „Erstes“');
    assert.equal(stored.filter(l => /gesetzter Reihenfolge|Positionen/.test(l)).length, 1);
    assert.equal(structured<FlatTree>(plain).root.childrenPositioned, true);
    const none = await client.callTool({ name: 'list_collection_tree', arguments: { nodeId: 'b-2' } });
    assert.equal(blocks(none)[0]!.split('\n')[1], 'Erste Ebene: keine unterscheidenden Positionen gesetzt.');
    // JSON, default order: one block, as before the flag existed — the field is in it.
    const noneJson = await client.callTool({ name: 'list_collection_tree', arguments: { nodeId: 'b-2', outputFormat: 'json' } });
    assert.equal(blocks(noneJson).length, 1);
    assert.equal((JSON.parse(blocks(noneJson)[0]!) as FlatTree).root.childrenPositioned, false);
    // `title` neither asks nor says.
    const titled = await client.callTool({ name: 'list_collection_tree', arguments: { nodeId: 'top', order: 'title' } });
    assert.doesNotMatch(blocks(titled)[0]!, /Reihenfolge|Positionen/);
  } finally { await client.close(); mock.restore(); }
});

test('list_collection_tree (tool, stored): the notices a client recognises keep their place; an empty list says only that it is empty', async () => {
  const repo = repository(MIXED, folders('b-2', 503));
  const client = await strictClient();
  try {
    const lines = blocks(await client.callTool({ name: 'list_collection_tree', arguments: { nodeId: 'top' } }))[0]!.split('\n');
    assert.equal(lines[1], TREE_INCOMPLETE_NOTICE);
    assert.equal(lines[3], 'Erste Ebene: in gesetzter Reihenfolge.');
    const empty = await client.callTool({ name: 'list_collection_tree', arguments: { nodeId: 'b-0' } });
    assert.deepEqual(blocks(empty)[0]!.split('\n').slice(1), ['Diese Sammlung hat keine Untersammlungen.']);
  } finally { await client.close(); repo.mock.restore(); }
});

// ── S12: the content count ──────────────────────────────────────────────────

test('list_collection_tree: a content count asks for no item and one property — the total is all it reads', async () => {
  const { mock, counts } = repository(MIXED);
  try {
    const tree = await flat({ depth: 1, includeContentCounts: true });
    assert.equal(counts.length, 4);
    for (const url of counts) {
      assert.equal(param(url, 'filter'), 'files');
      assert.equal(param(url, 'maxItems'), '0');
      assert.deepEqual(props(url), ['cm:name']);
    }
    assert.deepEqual(tree.items.map(i => i.contentCount), [7, 7, 7, 7]);
  } finally { mock.restore(); }
});

// The same request wherever only the NUMBER is needed (follow-up of 2026-11-15):
// 307 ms against 139 ms per call, same total on 144 collections.
const isCountRequest = (url: string) => param(url, 'filter') === 'files' && param(url, 'maxItems') === '0' && props(url).join() === 'cm:name';

test('browse_collection_tree: a content count asks for no item and one property', async () => {
  stopSkillRegistryCache();
  const { mock, counts } = repository(MIXED);
  const client = await strictClient();
  try {
    const r = await client.callTool({ name: 'browse_collection_tree', arguments: { nodeId: 'top', depth: 2, includeContentCounts: true } });
    assert.equal(counts.length, 9);
    assert.ok(counts.every(isCountRequest), counts.find(u => !isCountRequest(u)));
    const out = structured<{ results: Array<{ fileCount?: number; children?: Array<{ fileCount?: number }> }> }>(r);
    assert.ok(out.results.every(n => n.fileCount === 7 && (n.children ?? []).every(c => c.fileCount === 7)));
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

test('browse_collection_tree: the preview still reads its items — one count and one preview request per node, no third', async () => {
  stopSkillRegistryCache();
  const { mock, counts } = repository(MIXED);
  const client = await strictClient();
  try {
    await client.callTool({ name: 'browse_collection_tree', arguments: { nodeId: 'top', includeContentCounts: true, includeContentPreview: 2 } });
    assert.equal(counts.filter(isCountRequest).length, 4);
    const previews = counts.filter(u => !isCountRequest(u));
    assert.equal(previews.length, 4);
    assert.ok(previews.every(u => param(u, 'maxItems') === '2' && props(u).length > 1));
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

test('get_collection_overview: the sub-collections are counted with the count request', async () => {
  stopSkillRegistryCache();
  const { mock, counts } = repository(MIXED);
  const client = await strictClient();
  try {
    const r = await client.callTool({ name: 'get_collection_overview', arguments: { collectionId: 'top', include: ['subcollections'] } });
    assert.equal(counts.length, 4);
    assert.ok(counts.every(isCountRequest));
    assert.ok(structured<{ subcollections: Array<{ contentCount?: number }> }>(r).subcollections.every(s => s.contentCount === 7));
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

test('get_collection_overview: contents with maxContents=0 need only the number; with items asked for, the listing is read as before', async () => {
  stopSkillRegistryCache();
  const { mock, counts } = repository(MIXED);
  const client = await strictClient();
  try {
    const none = await client.callTool({ name: 'get_collection_overview', arguments: { collectionId: 'top', include: ['contents'], maxContents: 0 } });
    assert.equal(counts.length, 1);
    assert.ok(isCountRequest(counts[0]!));
    assert.deepEqual(structured<{ contents: unknown }>(none).contents, { total: 7, items: [], truncated: true });
    await client.callTool({ name: 'get_collection_overview', arguments: { collectionId: 'top', include: ['contents'], maxContents: 3 } });
    assert.equal(counts.length, 2);
    assert.ok(param(counts[1]!, 'maxItems') === '3' && props(counts[1]!).length > 1);
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

for (const [status, mark, other] of [[503, 'contentsUnread', 'contentsRefused'], [403, 'contentsRefused', 'contentsUnread']] as const) {
  test(`a count answered ${status} marks the node (${mark}) in all three tools — never drops it, never reads as 0`, async () => {
    stopSkillRegistryCache();
    const failing = (url: string): MockResult | undefined =>
      (url.includes('/children') && !isFolders(url) && idOf(url) === 'b-1' ? { status, json: {} } : undefined);
    type Marked = { nodeId: string; fileCount?: number; contentCount?: number; contentsUnread?: boolean; contentsRefused?: boolean };
    const check = (nodes: Marked[]) => {
      assert.deepEqual(nodes.map(n => n.nodeId).sort(), ['b-0', 'b-1', 'b-2', 'b-9']);
      const hit = nodes.find(n => n.nodeId === 'b-1')!;
      assert.equal(hit[mark], true);
      assert.ok(!(other in hit) && !('fileCount' in hit) && !('contentCount' in hit));
      assert.ok(nodes.filter(n => n !== hit).every(n => (n.fileCount ?? n.contentCount) === 7 && !n.contentsUnread && !n.contentsRefused));
    };
    let repo = repository(MIXED, failing);
    try { check((await flat({ depth: 1, includeContentCounts: true })).items); } finally { repo.mock.restore(); }
    repo = repository(MIXED, failing);
    const client = await strictClient();
    try {
      check(structured<{ results: Marked[] }>(await client.callTool({ name: 'browse_collection_tree', arguments: { nodeId: 'top', includeContentCounts: true } })).results);
      check(structured<{ subcollections: Marked[] }>(await client.callTool({ name: 'get_collection_overview', arguments: { collectionId: 'top', include: ['subcollections'] } })).subcollections);
    } finally { await client.close(); repo.mock.restore(); stopSkillRegistryCache(); }
  });
}

test('list_collection_tree: the counts take at most half of the upstream gate', () => {
  // The rule, over every size of gate — not only the one this process started with.
  for (const [gate, pool] of [[0, 12], [1, 1], [2, 1], [3, 1], [8, 4], [24, 12], [100, 12]] as const) {
    assert.equal(countPool(gate), pool, `gate ${gate}`);
    // Never 0 (nothing would be counted), never above the gate.
    assert.ok(countPool(gate) >= 1 && (gate === 0 || countPool(gate) <= gate));
  }
  assert.equal(FLAT_TREE_COUNT_POOL, countPool(WLO_UPSTREAM_CONCURRENCY));
});

test('list_collection_tree: no more counts are in flight than the pool allows', async () => {
  const kids = Array.from({ length: 60 }, (_, i) => branch(`k-${i}`, `Kind ${i}`));
  let open = 0;
  let peak = 0;
  const realFetch = globalThis.fetch;
  const { mock } = repository({ top: kids });
  const mocked = globalThis.fetch;
  // Around the mock: each count stays open for a tick, so the pool width shows.
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = String(input instanceof Request ? input.url : input);
    const counted = url.includes('/children') && !isFolders(url);
    if (counted) { open += 1; peak = Math.max(peak, open); await new Promise(resolve => setTimeout(resolve, 2)); }
    try { return await mocked(input, init); } finally { if (counted) open -= 1; }
  }) as typeof fetch;
  try {
    const tree = await flat({ depth: 1, includeContentCounts: true });
    assert.equal(tree.items.filter(i => i.contentCount === 7).length, 60);
    assert.equal(peak, FLAT_TREE_COUNT_POOL);
  } finally { globalThis.fetch = mocked; mock.restore(); assert.equal(globalThis.fetch, realFetch); }
});

// ── S13: where the list could not read ──────────────────────────────────────

for (const [status, field, other] of [[503, 'unreadParents', 'refusedParents'], [403, 'refusedParents', 'unreadParents']] as const) {
  test(`list_collection_tree: a branch listing answered ${status} is named in ${field}`, async () => {
    const { mock } = repository(MIXED, folders('b-2', status));
    try {
      const tree = await flat();
      assert.deepEqual(tree[field], ['b-2']);
      assert.equal(tree[other], undefined);
    } finally { mock.restore(); }
  });
}

test('list_collection_tree: a parent on ANOTHER page is named — the page holds no entry that could say it', async () => {
  const { mock } = repository(MIXED, folders('b-2', 503));
  try {
    // Page 2 of the list: level 2 only. The unread parent stands on page 1.
    const tree = await flat({ maxItems: 4, skipCount: 4 });
    assert.deepEqual(tree.items.map(i => i.nodeId), ['d-y', 'd-b']);
    assert.ok(tree.items.every(i => !i.childrenUnread));
    assert.equal(tree.incomplete, true);
    assert.deepEqual(tree.unreadParents, ['b-2']);
  } finally { mock.restore(); }
});

test('list_collection_tree: the START collection, listed in part, is named — there is no entry for it at all', async () => {
  const kids = Array.from({ length: 130 }, (_, i) => branch(`k-${i}`, `Kind ${i}`));
  for (const [status, field] of [[503, 'unreadParents'], [403, 'refusedParents']] as const) {
    const { mock } = repository({ top: kids }, url =>
      (url.includes('/children') && isFolders(url) && param(url, 'skipCount') === '100' ? { status, json: {} } : undefined));
    try {
      const tree = await flat({ depth: 1 });
      assert.equal(tree.count, 100);
      assert.deepEqual(tree[field], ['top']);
    } finally { mock.restore(); }
  }
});

test('list_collection_tree: outage and refusal in one walk stay apart, in walk order', async () => {
  const { mock } = repository({ ...MIXED, 'c-a': [branch('e-1', 'Tief')] }, url =>
    folders('b-1', 403)(url) ?? folders('c-z', 503)(url) ?? folders('b-9', 503)(url));
  try {
    const tree = await flat();
    assert.deepEqual(tree.unreadParents, ['b-9', 'c-z']);
    assert.deepEqual(tree.refusedParents, ['b-1']);
    assert.equal(tree.incomplete, true);
    assert.equal(tree.restricted, true);
  } finally { mock.restore(); }
});

test('list_collection_tree: a walk that read everything names nobody', async () => {
  const { mock } = repository(MIXED);
  try {
    const tree = await flat();
    assert.ok(!('unreadParents' in tree) && !('refusedParents' in tree));
  } finally { mock.restore(); }
});

test('list_collection_tree: a parent the walk never asked is not named — only what was observed', async () => {
  // The page is full after level 1, so `b-2` (which would answer 503) is never listed.
  const { mock, listings } = repository(MIXED, folders('b-2', 503));
  try {
    const tree = await flat({ maxItems: 3 });
    assert.deepEqual(listings.map(idOf), ['top']);
    assert.ok(!('unreadParents' in tree) && tree.incomplete === undefined);
    assert.deepEqual(tree.more, { nextSkipCount: 3 });
  } finally { mock.restore(); }
});

test('list_collection_tree: the named parents are bounded, and the bound is said', async () => {
  const n = FLAT_TREE_PARENTS_NAMED_MAX + 10;
  const kids = Array.from({ length: n }, (_, i) => branch(`k-${i}`, `Kind ${i}`));
  const { mock } = repository({ top: kids }, url =>
    (url.includes('/children') && isFolders(url) && idOf(url).startsWith('k-') ? { status: 500, json: {} } : undefined));
  try {
    const tree = await flat({ depth: 2 });
    assert.equal(tree.unreadParents!.length, FLAT_TREE_PARENTS_NAMED_MAX);
    assert.deepEqual(tree.unreadParents!.slice(0, 2), ['k-0', 'k-1']);
    assert.equal(tree.unreadParentsTotal, n);
    assert.equal(tree.refusedParentsTotal, undefined);
  } finally { mock.restore(); }
  // Below the bound there is no total: the list is the whole.
  const small = repository(MIXED, folders('b-2', 500));
  try { assert.ok(!('unreadParentsTotal' in await flat())); } finally { small.mock.restore(); }
});

test('list_collection_tree (tool): the affected parents stand in the first block and in the JSON payload', async () => {
  let repo = repository(MIXED, url => folders('b-2', 403)(url) ?? folders('b-1', 503)(url));
  let client = await strictClient();
  try {
    const md = await client.callTool({ name: 'list_collection_tree', arguments: { nodeId: 'top' } });
    assert.equal(md.isError, undefined, toolText(md));
    assert.equal(blocks(md).length, 1);
    const lines = blocks(md)[0]!.split('\n');
    // The notices a client recognises keep their wording and their place; the ids follow each.
    assert.equal(lines[1], TREE_INCOMPLETE_NOTICE);
    assert.equal(lines[2], 'Unterliste gerade nicht gelesen bei: nodeId: b-1.');
    assert.equal(lines[3], RESTRICTED_NOTICE);
    assert.equal(lines[4], 'Unterliste mit dieser Anmeldung nicht lesbar bei: nodeId: b-2.');
    const out = structured<FlatTree>(md);
    assert.deepEqual([out.unreadParents, out.refusedParents], [['b-1'], ['b-2']]);
  } finally { await client.close(); repo.mock.restore(); }

  const kids = Array.from({ length: 130 }, (_, i) => branch(`k-${i}`, `Kind ${i}`));
  repo = repository({ top: kids }, url =>
    (url.includes('/children') && isFolders(url) && param(url, 'skipCount') === '100' ? { status: 503, json: {} } : undefined));
  client = await strictClient();
  try {
    const json = await client.callTool({ name: 'list_collection_tree', arguments: { nodeId: 'top', depth: 1, outputFormat: 'json' } });
    const parsed = JSON.parse(blocks(json)[0]!) as FlatTree;
    assert.deepEqual(parsed.unreadParents, ['top']);
    assert.deepEqual(structured<FlatTree>(json).unreadParents, ['top']);
    assert.equal(blocks(json)[1], TREE_INCOMPLETE_NOTICE);
    assert.equal(blocks(json)[2], 'Unterliste gerade nicht gelesen bei: nodeId: top (Start-Sammlung).');
  } finally { await client.close(); repo.mock.restore(); }
});

test('list_collection_tree (tool): a capped list of parents says how many there are', async () => {
  const n = FLAT_TREE_PARENTS_NAMED_MAX + 3;
  const kids = Array.from({ length: n }, (_, i) => branch(`k-${i}`, `Kind ${i}`));
  const { mock } = repository({ top: kids }, url =>
    (url.includes('/children') && isFolders(url) && idOf(url).startsWith('k-') ? { status: 403, json: {} } : undefined));
  const client = await strictClient();
  try {
    const r = await client.callTool({ name: 'list_collection_tree', arguments: { nodeId: 'top', depth: 2 } });
    assert.equal(structured<FlatTree>(r).refusedParentsTotal, n);
    assert.match(blocks(r)[0]!, new RegExp(`nicht lesbar bei: nodeId: k-0, .* \\(die ersten ${FLAT_TREE_PARENTS_NAMED_MAX} von ${n}\\)\\.`));
  } finally { await client.close(); mock.restore(); }
});
