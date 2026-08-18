/**
 * services/collection-traversal.ts – walking the collection tree, bounded.
 *
 * Split out of `tools/collections.ts` when that file passed 450 lines, and
 * joined by the browse walk from `tools/browse.ts` on 2026-08-04: the functions
 * here answer "what is reachable from this collection", while a tool module
 * answers "what does the tool accept and return". They change for different
 * reasons — these follow how the repository's collection graph behaves, the
 * tool module follows its own contract.
 *
 * Collections form a DAG, not a tree: a sub-collection can hang under several
 * parents, so both walks de-duplicate by nodeId, and both cap their fan-out.
 * Without the caps a single public request expands into a hundred-plus parallel
 * upstream calls.
 */

import type { WloNode } from '../wlo-api.js';
import { getChildCollections, getChildCollectionsResult, getCollectionContents } from '../wlo-api.js';
import { rerankNodes, sortByTitle } from '../reranker.js';
import type { FormattedNode } from '../formatter.js';
import { formatNode, formatNodes } from '../formatter.js';
import { nodeMatchesText } from '../node-match.js';
import { mapPool } from '../concurrency.js';
import { log } from '../logger.js';

/**
 * Fallback collection search by tree traversal, used when the direct
 * keyword-collection search finds nothing. From the given level-1 child
 * collections it keeps those that match `query`, expands into a capped level 2,
 * and — only if nothing matched yet — a scored, capped level 3. The caps (O6)
 * stop the fallback from turning into a 100+-parallel-call avalanche; direct
 * level-1 matches are always preserved.
 */
export async function findCollectionsByTreeTraversal(level1: WloNode[], query: string): Promise<WloNode[]> {
  // De-dup by nodeId at insertion (audit Q-2): the same node can be reached more
  // than once across levels, and duplicates would make rows and `total` lie.
  const seen = new Set<string>();
  const matches: WloNode[] = [];
  const addMatches = (nodes: WloNode[]) => {
    for (const n of nodes) {
      if (!nodeMatchesText(n, query)) continue;
      const id = n.ref?.id ?? '';
      if (id) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      matches.push(n);
    }
  };
  addMatches(level1);

  const LEVEL2_PARENT_CAP = 25;
  const level2Parents = level1.slice(0, LEVEL2_PARENT_CAP);
  if (level1.length > LEVEL2_PARENT_CAP) {
    log.warn('collection search: level2 expansion capped', { from: level1.length, to: LEVEL2_PARENT_CAP, query });
  }
  const level2Results = await Promise.allSettled(
    level2Parents.map(parent => getChildCollections(parent.ref?.id ?? '', 50))
  );
  const allLevel2Nodes: WloNode[] = [];
  for (const r of level2Results) {
    if (r.status === 'fulfilled') {
      allLevel2Nodes.push(...r.value);
      addMatches(r.value);
    }
  }

  if (matches.length === 0) {
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const scoreNode = (n: WloNode): number => {
      const text = [
        n.properties?.['cm:name']?.[0] ?? '',
        n.properties?.['cclom:title']?.[0] ?? '',
        n.properties?.['cclom:general_description']?.[0] ?? '',
      ].join(' ').toLowerCase();
      return queryWords.reduce((s, w) => s + (text.includes(w) ? 1 : 0), 0);
    };
    const anyScored = allLevel2Nodes.some(n => scoreNode(n) > 0);
    const LEVEL3_PARENT_CAP = 15;
    const level2Candidates = anyScored
      ? [...allLevel2Nodes].sort((a, b) => scoreNode(b) - scoreNode(a)).slice(0, LEVEL3_PARENT_CAP)
      : allLevel2Nodes.slice(0, LEVEL3_PARENT_CAP);

    const level3Results = await Promise.allSettled(
      level2Candidates.map(parent => getChildCollections(parent.ref?.id ?? '', 30))
    );
    for (const r of level3Results) {
      if (r.status === 'fulfilled') addMatches(r.value);
    }
  }

  return matches;
}

/**
 * Cap for the LOCAL skip window of the recursive path: the BFS must gather
 * skip+max rows before slicing, so an unbounded skipCount would let one call
 * force a crawl of the whole subtree (amplification on a public endpoint).
 */
export const RECURSIVE_SKIP_MAX = 400;

/**
 * Cap on how many collections one walk may READ.
 *
 * The row target alone does not bound the walk: rows are only counted when they
 * are new, so a subtree whose sub-collections share their references — the
 * normal shape of a curated WLO tree — de-duplicates itself into a standstill
 * and the queue keeps draining. Every collection costs two sequential upstream
 * calls, and nothing aborts them once the caller has given up — the crawl
 * outlives the answer it was for.
 *
 * Deliberately no number here any more: this said "when the client's request
 * times out at 30 s", borrowed from `httpServer.requestTimeout`, which measured
 * 2026-08-17 does NOT bound the work on a request (a handler answering after
 * 35 s delivers its response). When a client gives up is invisible from here;
 * the cap stands on the cost of the walk, which is measurable, not on a deadline
 * that is not.
 */
const RECURSIVE_VISIT_MAX = 50;

/**
 * BFS over a collection and its sub-collections, collecting file children
 * until `maxResults` rows are gathered or `RECURSIVE_VISIT_MAX` collections
 * have been read. Result rows are de-duplicated by
 * nodeId and filtered by `excluded`; when a query is given, each page is
 * reranked before collection. `totalHits` is the SUM of each visited
 * collection's backend total — an aggregate upper bound, not a de-duplicated
 * grand total (an item referenced in two sub-collections is counted twice).
 * It answers "how much is under here" roughly.
 */
export async function collectRecursiveContents(
  rootId: string,
  maxResults: number,
  excluded: Set<string>,
  query: string | undefined,
): Promise<{ nodes: FormattedNode[]; totalHits: number }> {
  const collectionQueue = [rootId];
  const visited = new Set<string>();
  const seenNodes = new Set<string>(); // de-dup result rows across sub-collections
  const nodes: FormattedNode[] = [];
  let totalHits = 0;

  while (collectionQueue.length > 0 && nodes.length < maxResults && visited.size < RECURSIVE_VISIT_MAX) {
    const cid = collectionQueue.shift()!;
    if (visited.has(cid)) continue;
    visited.add(cid);

    const filesResp = await getCollectionContents(cid, 'files', 50);
    totalHits += filesResp.pagination.total;
    let fileNodes = filesResp.nodes;
    if (excluded.size) fileNodes = fileNodes.filter(n => !excluded.has(n.ref?.id ?? ''));
    // Drop a node already emitted from an earlier sub-collection.
    fileNodes = fileNodes.filter(n => {
      const id = n.ref?.id;
      if (!id) return true;          // no id → cannot de-dup, keep
      if (seenNodes.has(id)) return false;
      seenNodes.add(id);
      return true;
    });
    if (query?.trim()) fileNodes = rerankNodes(fileNodes, query);
    nodes.push(...formatNodes(fileNodes));

    const subs = await getChildCollections(cid);
    for (const sub of subs) {
      const subId = sub.ref?.id ?? sub.properties?.['sys:node-uuid']?.[0];
      if (subId && !visited.has(subId)) collectionQueue.push(subId);
    }
  }
  if (visited.size >= RECURSIVE_VISIT_MAX && collectionQueue.length > 0) {
    log.warn('recursive contents: visit cap reached, subtree not fully walked', {
      rootId, visited: visited.size, queued: collectionQueue.length,
    });
  }
  return { nodes: nodes.slice(0, maxResults), totalHits };
}

/** One node of the browse tree: a formatted collection plus what the walk learned about it. */
export type CollectionTreeNode = FormattedNode & {
  fileCount?: number;
  children?: CollectionTreeNode[];
  /** First N content items, only when `contentPreview` was requested. */
  contentPreview?: FormattedNode[];
  /** Upstream holds more sub-collections than this listing shows. */
  hasMoreChildren?: boolean;
};

export interface CollectionTreeOptions {
  parentId: string;
  /** 1 = direct sub-collections only; 2 = also their children. */
  depth: number;
  /** Width of level 1. */
  maxResults: number;
  includeContentCounts: boolean;
  /** When set (1–5), attach the first N content items of every node in the tree. */
  contentPreview?: number;
}

export interface CollectionTree {
  nodes: CollectionTreeNode[];
  /** At least one branch holds more than was returned. */
  truncated: boolean;
}

// Width of the level-1 fan-out — one `/children` call per node, the
// dominant cost at depth 2 (four waves at width 5, ~2.9 s measured for
// a 20-child portal). Level-2 nodes do not recurse, so widening this
// does NOT multiply with the nested pool in the default case.
const TREE_CONCURRENCY = 10;
// The nested pool only performs I/O when includeContentCounts is set;
// kept narrow so that opt-in path stays bounded (10 × 4 = 40 in flight)
// rather than squaring the width above.
const TREE_CHILD_CONCURRENCY = 4;

// A depth-2 tree used to pull up to 30 sub-collections per node with no
// overall bound: a 15-node portal returned ~100 nodes, and every opt-in
// enrichment then cost one upstream call per node (11.7 s / 460 kB
// measured). The slice per parent is therefore derived from a total
// budget, DETERMINISTICALLY (same size for every parent, computed
// before the walk) rather than by a counter that concurrent workers
// would drain in arbitrary order. Nodes whose children were cut say so,
// so the model can offer a targeted drill-down instead of a silent slice.
const TREE_NODE_BUDGET = 150;
const TREE_CHILDREN_MAX = 10;
const TREE_CHILDREN_MIN = 3;

/**
 * Walk a collection's sub-tree to `depth`, bounded on every axis: fan-out width,
 * children per parent (from a total node budget), and cycles.
 *
 * Lived inside the `browse_collection_tree` handler until 2026-08-04. It is an
 * algorithm, and a tool module holds its schema and its rendering — the same
 * split the two walks above were extracted for. Out here it is reachable
 * without going through the MCP tool surface.
 *
 * Throws when the level-1 listing cannot be read: the tree IS that listing, and
 * an unread one must not be rendered as a collection that happens to have no
 * sub-topics.
 */
export async function buildCollectionTree(opts: CollectionTreeOptions): Promise<CollectionTree> {
  const { parentId, depth, maxResults, includeContentCounts, contentPreview } = opts;

  const level1Listing = await getChildCollectionsResult(parentId, maxResults);
  if (!level1Listing.reachable) {
    throw new Error(`Die Unter-Sammlungen von ${parentId} sind derzeit nicht abrufbar.`);
  }
  const sorted1 = sortByTitle(level1Listing.nodes);

  const childSlice = depth > 1
    ? Math.max(TREE_CHILDREN_MIN, Math.min(TREE_CHILDREN_MAX, Math.floor(TREE_NODE_BUDGET / Math.max(1, sorted1.length))))
    : 0;

  // Level-1 nodes are claimed BEFORE the walk starts, for the same reason
  // children are claimed at scheduling time (see below): a node that is
  // both a top-level entry and someone else's child would otherwise be
  // emitted twice — once where it was asked for, once nested.
  // Claiming them inside enrichOne ALMOST worked: its prefix runs
  // synchronously, so the first TREE_CONCURRENCY of them were registered
  // before any I/O. Number 11 onwards was not, which made the duplicate
  // depend on the pool width — the kind of bug that hides on small inputs.
  const visited = new Set<string>(
    sorted1.map(n => n.ref?.id).filter((id): id is string => !!id),
  );
  const enrichOne = async (n: WloNode, level: number): Promise<CollectionTreeNode> => {
    const f = formatNode(n) as CollectionTreeNode;
    const id = n.ref?.id;
    if (includeContentCounts && id) {
      const filesResp = await getCollectionContents(id, 'files', 1, 0);
      f.fileCount = filesResp.pagination.total;
    }
    if (level < depth && id) {
      // Fetch one more than shown: the extra hit proves there IS more
      // without spending a second round-trip on a count.
      const fetched = await getChildCollections(id, childSlice + 1);
      if (fetched.length > childSlice) f.hasMoreChildren = true;
      // Claim each child in `visited` at SCHEDULING time (synchronously in
      // this filter), not when its own enrichOne starts — otherwise two
      // parents sharing a child could both pass the check before either
      // marks it, emitting the same subtree twice. Claiming here makes the
      // placement deterministic (first parent in traversal order wins).
      const sortedChildren = sortByTitle(fetched).slice(0, childSlice).filter(c => {
        const cid = c.ref?.id;
        if (!cid) return true;
        if (visited.has(cid)) return false;
        visited.add(cid);
        return true;
      });
      const enriched = await mapPool(sortedChildren, TREE_CHILD_CONCURRENCY, c => enrichOne(c, level + 1));
      f.children = enriched.filter((c): c is CollectionTreeNode => c !== null);
    }
    return f;
  };

  const nodes = (await mapPool(sorted1, TREE_CONCURRENCY, n => enrichOne(n, 1)))
    .filter((n): n is CollectionTreeNode => n !== null);

  // Optional content preview: attach the first N files of each collection
  // in the tree. A single bounded pass over the flattened node list caps
  // upstream concurrency even for a wide depth-2 tree.
  if (contentPreview) {
    const flat: CollectionTreeNode[] = [];
    const collect = (ns: CollectionTreeNode[]) => {
      for (const n of ns) { flat.push(n); if (n.children) collect(n.children); }
    };
    collect(nodes);
    // One call per node in the (now bounded) tree — the widest fan-out
    // this walk can produce, so it runs at the level-1 width rather than 5.
    await mapPool(flat, TREE_CONCURRENCY, async (node) => {
      const resp = await getCollectionContents(node.nodeId, 'files', contentPreview, 0);
      node.contentPreview = formatNodes(resp.nodes).slice(0, contentPreview);
      return null;
    });
  }

  const anyTruncated = (ns: CollectionTreeNode[]): boolean =>
    ns.some(n => n.hasMoreChildren || anyTruncated(n.children ?? []));

  return { nodes, truncated: anyTruncated(nodes) };
}
