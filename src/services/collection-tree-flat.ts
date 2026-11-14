/**
 * services/collection-tree-flat.ts – a collection's sub-tree as a FLAT list
 * with paths, in the repository's own order, in pages (chatbot team, S2,
 * 2026-11-14).
 *
 * `buildCollectionTree` answers "show me this tree" and is cut in width per
 * parent so it stays readable. This walk answers "what is there" — the form a
 * comparison of a draft against the existing tree computes on, and the one a
 * tree created with `wlo_create_collection_tree` (depth 4, 250 nodes) can be
 * read back with. So it is not cut per parent: it reads every child, level by
 * level, and stops when the page is full.
 *
 * Level order, not depth-first: the collections of one level do not depend on
 * each other and are read a few at a time, and a walk that stops early has
 * read a PREFIX of the list — which is what makes `skipCount` mean the same
 * thing on every call.
 */

import type { WloNode } from '../wlo-api.js';
import { didNotAnswer, getChildCollectionsResult, getCollectionContents, readNodeMetadata } from '../wlo-api.js';
import { collectionTitleFromProperties } from '../node-match.js';
import { isCollectionNode } from '../node-kind.js';
import { isRefusal } from '../upstream-error.js';
import { mapPool } from '../concurrency.js';
import { notReadable, readNodeContents } from './collection-traversal.js';

/** As deep as `wlo_create_collection_tree` creates. */
export const FLAT_TREE_DEPTH_MAX = 4;
/** As many as that tool creates in one plan — one page reads a whole created tree back. */
export const FLAT_TREE_PAGE_MAX = 250;
/**
 * The walk gathers skip + page before it can slice, so an unbounded skip lets
 * one call force a crawl of a whole portal (same reason as `RECURSIVE_SKIP_MAX`).
 */
export const FLAT_TREE_SKIP_MAX = 500;
/**
 * Listings one call may send. The page size alone does not bound the walk: a
 * portal with few children per collection needs one listing per item, and every
 * page starts the walk again. Sized so a tree `wlo_create_collection_tree` can
 * create (250 nodes) is always read whole; a walk that hits the bound says so
 * (`walkCapped`) — the caller then starts at a sub-collection.
 */
export const FLAT_TREE_LISTINGS_MAX = 400;

/** The start node is no collection: a record, or a plain folder. */
export class NotACollectionError extends Error {}

const TITLE_PROPS = ['cm:title', 'cclom:title', 'cm:name'];
const CHILD_PAGE = 100;
/** Parents of one level listed at the same time. Each is one request per hundred children. */
const PARENT_POOL = 8;
const COUNT_POOL = 8;

export interface FlatTreeItem {
  nodeId: string;
  title: string;
  /** Titles from the start collection down to this one, both included. */
  path: string[];
  /** 1 = a direct sub-collection of the start collection. */
  depth: number;
  parentId: string;
  /** Direct contents (files and references), read from the listing — not the repository's counter, which lags. */
  contentCount?: number;
  /** Its sub-collections could not be listed this time: unknown, not absent. */
  childrenUnread?: true;
  /** The repository refused that listing (401/403/404): unknown, and no retry helps. */
  childrenRefused?: true;
  contentsRefused?: boolean;
  contentsUnread?: boolean;
}

export interface FlatTree {
  root: { nodeId: string; title: string };
  depth: number;
  /** How many items this page holds. */
  count: number;
  skipCount: number;
  items: FlatTreeItem[];
  /** The walk stopped at a full page: there is more, from `nextSkipCount`. */
  more?: { nextSkipCount: number };
  /** A listing below the start collection did not answer — the list may lack that branch. */
  incomplete?: true;
  /** A listing below the start collection was refused — that branch is not in the list. */
  restricted?: true;
  /** The walk stopped at its bound on listings before the page was full: deeper levels are missing. */
  walkCapped?: true;
}

export interface FlatTreeOptions {
  rootId: string;
  depth: number;
  maxItems: number;
  skipCount: number;
  includeContentCounts: boolean;
}

interface Listing { nodes: WloNode[]; unread: boolean; refused: boolean; refusedStatus?: number; requests: number; /** Stopped at its share of the bound with children left. */ cut?: true }

/** Every sub-collection of one parent, in stored order, up to `budget` — a parent is never cut at a page. */
async function listChildren(parentId: string, budget: number, maxRequests: number): Promise<Listing> {
  const nodes: WloNode[] = [];
  let requests = 0;
  for (let skip = 0; nodes.length < budget; skip += CHILD_PAGE) {
    // Its share of the walk's bound is spent and the last page was full: there may be more.
    if (requests >= maxRequests) return { nodes, unread: false, refused: false, requests, cut: true };
    requests += 1;
    const res = await getChildCollectionsResult(parentId, CHILD_PAGE, skip, TITLE_PROPS, { stored: true });
    if (!res.reachable) {
      // What earlier pages answered stays; the rest of this parent is what is unknown.
      return { nodes, unread: didNotAnswer(res), refused: res.refused !== undefined, ...(res.refused ? { refusedStatus: res.refused } : {}), requests };
    }
    nodes.push(...res.nodes);
    if (res.nodes.length < CHILD_PAGE) break;
  }
  return { nodes, unread: false, refused: false, requests };
}

/**
 * Throws when the start collection cannot be read or listed: the list IS that
 * listing, and an unread one must not come back as a collection without
 * sub-collections.
 */
export async function listCollectionTree(opts: FlatTreeOptions): Promise<FlatTree> {
  const { rootId, depth, maxItems, skipCount } = opts;

  const start = await readNodeMetadata(rootId, TITLE_PROPS);
  if (!start.node) {
    if (isRefusal(start.status)) throw new Error(notReadable(rootId, start.status));
    throw new Error(`Die Sammlung ${rootId} ist derzeit nicht abrufbar${start.status ? ` (HTTP ${start.status})` : ''}.`);
  }
  // A record has no sub-collections and a folder is no collection: "keine
  // Untersammlungen" over either would be an answer to a question nobody asked.
  if (!isCollectionNode(start.node)) throw new NotACollectionError(`${rootId} ist keine Sammlung.`);
  const rootTitle = collectionTitleFromProperties(start.node.properties) || start.node.title || rootId;

  // One more than the page: the extra item is the proof that there is more.
  const need = skipCount + maxItems + 1;
  const items: FlatTreeItem[] = [];
  // Collections form a DAG: the first parent, in walk order, keeps a shared child.
  const seen = new Set<string>([rootId]);
  let unread = 0;
  let refused = 0;
  let requests = 0;
  let walkCapped = false;
  let level: Array<{ id: string; path: string[]; item?: FlatTreeItem }> = [{ id: rootId, path: [rootTitle] }];

  walk: for (let at = 1; at <= depth && level.length > 0 && items.length < need; at++) {
    const next: typeof level = [];
    for (let i = 0; i < level.length && items.length < need;) {
      // The bound is spent while the page still needs parents listed: the walk
      // ENDS here — going on one level down would leave a hole in the list.
      const left = FLAT_TREE_LISTINGS_MAX - requests;
      if (left <= 0) { walkCapped = true; break walk; }
      const group = level.slice(i, i + Math.min(PARENT_POOL, left));
      i += group.length;
      // Not `mapPool`: it turns a throw into null. A listing REPORTS an outage
      // and throws only when nobody waits any more — and that must end the walk.
      // Each parent gets an equal share of what is left, so the bound holds
      // whatever the paging inside one parent needs.
      const share = Math.max(1, Math.floor(left / group.length));
      const listings = await Promise.all(group.map(parent => listChildren(parent.id, need, share)));
      let cut = false;
      for (let g = 0; g < group.length; g++) {
        const parent = group[g]!;
        const listing = listings[g]!;
        requests += listing.requests;
        if (listing.cut) cut = true;
        if (!parent.item) {
          if (listing.refusedStatus && listing.nodes.length === 0) throw new Error(notReadable(rootId, listing.refusedStatus));
          if (listing.unread && listing.nodes.length === 0) throw new Error(`Die Unter-Sammlungen von ${rootId} sind derzeit nicht abrufbar.`);
        }
        if (listing.unread) { unread += 1; if (parent.item) parent.item.childrenUnread = true; }
        if (listing.refused) { refused += 1; if (parent.item) parent.item.childrenRefused = true; }
        for (const node of listing.nodes) {
          const id = node.ref?.id;
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const title = collectionTitleFromProperties(node.properties) || node.title || '';
          const item: FlatTreeItem = { nodeId: id, title, path: [...parent.path, title], depth: at, parentId: parent.id };
          items.push(item);
          next.push({ id, path: item.path, item });
        }
      }
      // A parent was left half-listed: everything after it in the list is unknown.
      if (cut && items.length < need) { walkCapped = true; break walk; }
    }
    level = next;
  }

  const page = items.slice(skipCount, skipCount + maxItems);
  if (opts.includeContentCounts) {
    await mapPool(page, COUNT_POOL, async (item) => {
      const res = await readNodeContents(item, () => getCollectionContents(item.nodeId, 'files', 1, 0, TITLE_PROPS));
      if (res) item.contentCount = res.pagination.total;
      return null;
    });
  }

  return {
    root: { nodeId: rootId, title: rootTitle },
    depth,
    count: page.length,
    skipCount,
    items: page,
    ...(items.length > skipCount + maxItems ? { more: { nextSkipCount: skipCount + maxItems } } : {}),
    ...(unread > 0 ? { incomplete: true as const } : {}),
    ...(refused > 0 ? { restricted: true as const } : {}),
    // Only where it cost something: a page that is full is answered by `more`.
    ...(walkCapped && items.length < need ? { walkCapped: true as const } : {}),
  };
}
