/**
 * services-collection-tree.test.ts – the bounded browse walk, asserted on the
 * STRUCTURE it returns.
 *
 * The walk lived inside the `browse_collection_tree` handler until 2026-08-04,
 * so every property below could only be checked through rendered markdown —
 * `countOccurrences(text, 'Gamma') === 1` infers a tree from a string. These
 * assert the tree itself, which no rendering change can fake either way.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildCollectionTree } from '../src/services/collection-traversal.js';
import { installFetchMock, makeNode } from './fetchMock.js';

const folders = (nodes: ReturnType<typeof makeNode>[]) => ({ json: { nodes } });

/** Serve `/children` from a map of parentId → children; everything else empty. */
function childrenMock(tree: Record<string, ReturnType<typeof makeNode>[]>) {
  return installFetchMock((url) => {
    const m = new URL(url).pathname.match(/-home-\/([^/]+)\/children/);
    const id = m ? decodeURIComponent(m[1]!) : '';
    return folders(tree[id] ?? []);
  });
}

test('buildCollectionTree: a child shared by two parents is placed under exactly one', async () => {
  const mock = childrenMock({
    root: [makeNode('A', 'Alpha'), makeNode('B', 'Beta')],
    A: [makeNode('C', 'Gamma')],
    B: [makeNode('C', 'Gamma')],
  });
  try {
    const { nodes } = await buildCollectionTree({
      parentId: 'root', depth: 2, maxResults: 50, includeContentCounts: false,
    });
    const placements = nodes.flatMap(n => (n.children ?? []).filter(c => c.nodeId === 'C'));
    assert.equal(placements.length, 1, 'the DAG child must be emitted once, not under both parents');
    // Deterministic, not raced: first parent in traversal order wins.
    assert.equal(nodes.find(n => n.children?.some(c => c.nodeId === 'C'))?.nodeId, 'A');
  } finally {
    mock.restore();
  }
});

test('buildCollectionTree: the per-parent child slice is derived from the node budget', async () => {
  // 150/2 = 75 → clamped to the max of 10. Each parent is asked for slice+1,
  // so the extra hit that proves "there is more" is what sets hasMoreChildren.
  const many = Array.from({ length: 12 }, (_, i) => makeNode(`c${i}`, `Kind${i}`));
  const mock = childrenMock({ root: [makeNode('A', 'Alpha'), makeNode('B', 'Beta')], A: many, B: [] });
  try {
    const { nodes, truncated } = await buildCollectionTree({
      parentId: 'root', depth: 2, maxResults: 50, includeContentCounts: false,
    });
    const alpha = nodes.find(n => n.nodeId === 'A')!;
    assert.equal(alpha.children?.length, 10, 'clamped to TREE_CHILDREN_MAX');
    assert.equal(alpha.hasMoreChildren, true);
    assert.equal(truncated, true, 'a cut branch must be disclosed to the caller');
  } finally {
    mock.restore();
  }
});

test('buildCollectionTree: a wide level 1 shrinks the slice toward the minimum', async () => {
  // 30 parents → 150/30 = 5 children each; below the max, above the min of 3.
  const parents = Array.from({ length: 30 }, (_, i) => makeNode(`p${i}`, `Portal${i}`));
  const kids = Array.from({ length: 8 }, (_, i) => makeNode(`k${i}`, `Kind${i}`));
  const mock = childrenMock({ root: parents, p0: kids });
  try {
    const { nodes } = await buildCollectionTree({
      parentId: 'root', depth: 2, maxResults: 50, includeContentCounts: false,
    });
    assert.equal(nodes.find(n => n.nodeId === 'p0')?.children?.length, 5);
  } finally {
    mock.restore();
  }
});

test('buildCollectionTree: depth 1 does not descend at all', async () => {
  const mock = childrenMock({ root: [makeNode('A', 'Alpha')], A: [makeNode('C', 'Gamma')] });
  try {
    const { nodes, truncated } = await buildCollectionTree({
      parentId: 'root', depth: 1, maxResults: 50, includeContentCounts: false,
    });
    assert.equal(nodes[0]?.children, undefined);
    assert.equal(truncated, false);
  } finally {
    mock.restore();
  }
});

test('buildCollectionTree: an unreadable level-1 listing throws instead of reading as empty', async () => {
  // The tree IS that listing. Returning [] here would tell the caller the
  // collection has no sub-topics, which is a statement about WLO, not about
  // a failed read.
  const mock = installFetchMock(() => ({ status: 503, json: {} }));
  try {
    await assert.rejects(
      () => buildCollectionTree({
        parentId: 'root', depth: 1, maxResults: 50, includeContentCounts: false,
      }),
      /nicht abrufbar/,
    );
  } finally {
    mock.restore();
  }
});
