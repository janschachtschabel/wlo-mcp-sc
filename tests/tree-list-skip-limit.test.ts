/**
 * `more.nextSkipCount` named an offset the tool itself refuses: `skipCount` is
 * accepted up to FLAT_TREE_SKIP_MAX, and a page that ended past it still said
 * "continue at 750". A `more` nobody can follow is a dead end — where the list
 * goes on beyond the bound, the answer says THAT, and how to go on instead.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FLAT_TREE_PAGE_MAX, FLAT_TREE_SKIP_MAX, listCollectionTree } from '../src/services/collection-tree-flat.js';
import { collectionTreeListSchema } from '../src/tools/collection-tree-list.js';
import { connectedClient, installFetchMock, toolText, type MockResult } from './fetchMock.js';

const branch = (id: string, title: string) =>
  ({ ref: { id }, type: 'ccm:map', aspects: ['ccm:collection'], properties: { 'cm:title': [title] } });

/** A start collection `top` with `n` direct sub-collections and nothing below them. */
function flat(n: number) {
  const children = Array.from({ length: n }, (_, i) => branch(`c-${i}`, `Kind ${i}`));
  return installFetchMock((url): MockResult => {
    const u = new URL(url);
    const id = decodeURIComponent(u.pathname.match(/-home-\/([^/]+)\//)?.[1] ?? '');
    if (url.includes('/metadata')) return { json: { node: branch(id, `Titel ${id}`) } };
    if (!url.includes('/children')) return { json: {} };
    const all = id === 'top' ? children : [];
    const skip = Number(u.searchParams.get('skipCount') ?? 0);
    const nodes = all.slice(skip, skip + Number(u.searchParams.get('maxItems') ?? 100));
    return { json: { nodes, pagination: { total: all.length, from: skip, count: nodes.length } } };
  });
}

const read = (skipCount: number, maxItems = FLAT_TREE_PAGE_MAX) =>
  listCollectionTree({ rootId: 'top', depth: 1, maxItems, skipCount, includeContentCounts: false });

test('every `more` names an offset the tool accepts', async () => {
  const mock = flat(900);
  try {
    for (let skip = 0; ;) {
      const tree = await read(skip);
      if (!tree.more) {
        assert.equal(tree.skipLimitReached, true, 'the list goes on, and says so');
        assert.equal(skip + tree.count, FLAT_TREE_SKIP_MAX + FLAT_TREE_PAGE_MAX, 'the last page that can be asked for');
        break;
      }
      assert.ok(tree.more.nextSkipCount <= FLAT_TREE_SKIP_MAX, `nextSkipCount ${tree.more.nextSkipCount} would be refused`);
      skip = tree.more.nextSkipCount;
    }
  } finally { mock.restore(); }
});

test('the list ENDING on the last reachable page is an end, not a limit', async () => {
  const mock = flat(FLAT_TREE_SKIP_MAX + FLAT_TREE_PAGE_MAX);
  try {
    const tree = await read(FLAT_TREE_SKIP_MAX);
    assert.equal(tree.count, FLAT_TREE_PAGE_MAX);
    assert.equal(tree.more, undefined);
    assert.equal(tree.skipLimitReached, undefined);
  } finally { mock.restore(); }
});

// CONTRACT CHANGED 2026-11-14: this page used to carry `skipLimitReached` —
// "the following entries cannot be had from here" — although the bound itself
// is an offset the tool takes and reaches part of them. It names the bound now;
// the limit is said on the page AT the bound.
test('a smaller page that would step past the bound names the bound — an offset the tool accepts', async () => {
  const mock = flat(900);
  try {
    const tree = await read(FLAT_TREE_SKIP_MAX - 50, 100);
    assert.deepEqual(tree.more, { nextSkipCount: FLAT_TREE_SKIP_MAX }, 'not 550, which would be refused');
    assert.equal(tree.skipLimitReached, undefined);
    assert.equal((await read(FLAT_TREE_SKIP_MAX, 100)).skipLimitReached, true);
  } finally { mock.restore(); }
});

test('list_collection_tree (tool): the limit is declared, and said in block 0 instead of "nächste Seite"', async () => {
  assert.ok('skipLimitReached' in collectionTreeListSchema.shape);
  const mock = flat(900);
  const client = await connectedClient();
  try {
    const args = { nodeId: 'top', depth: 1, skipCount: FLAT_TREE_SKIP_MAX };
    const md = await client.callTool({ name: 'list_collection_tree', arguments: args });
    const first = (md.content as { text: string }[])[0]!.text;
    assert.doesNotMatch(first, /nächste Seite mit skipCount/);
    assert.match(first, /Die Liste geht weiter/);
    assert.match(first, /Untersammlung als Start/);
    assert.equal((md.structuredContent as { skipLimitReached?: boolean }).skipLimitReached, true);

    const json = await client.callTool({ name: 'list_collection_tree', arguments: { ...args, outputFormat: 'json' } });
    const blocks = json.content as { text: string }[];
    assert.equal(JSON.parse(blocks[0]!.text).skipLimitReached, true);
    assert.match(toolText(json), /Die Liste geht weiter/);
  } finally { await client.close(); mock.restore(); }
});
