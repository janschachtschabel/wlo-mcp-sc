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
import { didNotAnswer, getChildCollectionsResult, readNodeMetadata } from '../wlo-api.js';
import { collectionTitleFromProperties } from '../node-match.js';
import { isCollectionNode } from '../node-kind.js';
import { isRefusal } from '../upstream-error.js';
import { mapPool } from '../concurrency.js';
import { positionedFlag, sortByPosition, type CollectionOrder } from '../collection-position.js';
import { sortByTitle } from '../reranker.js';
import { WLO_UPSTREAM_CONCURRENCY } from '../wlo-config.js';
import { countNodeContents, notReadable } from './collection-traversal.js';

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
/**
 * Content counts read at the same time: HALF of the process-wide gate
 * (`WLO_UPSTREAM_CONCURRENCY`, default 24 → 12), never more than 12. One call
 * must not occupy the gate every other caller shares, and the counts run after
 * the walk, so the half is all this call holds then. Measured 2026-11-15 on
 * the Physik portal (144 counts, `npm run measure:tree`): 8 at a time 2.75 s,
 * 12 at a time 1.76 s, 24 at a time 1.06 s — the repository scales, the gate
 * is what sets the limit.
 */
export const FLAT_TREE_COUNT_POOL = countPool(WLO_UPSTREAM_CONCURRENCY);
/** The rule above for a gate of `gateLimit` (0 = no gate): never 0, never above the gate. A function so every size is tested. */
export function countPool(gateLimit: number): number {
  return gateLimit > 0 ? Math.max(1, Math.min(12, Math.floor(gateLimit / 2))) : 12;
}
/**
 * How many parents `unreadParents` / `refusedParents` name each. A walk sends
 * at most `FLAT_TREE_LISTINGS_MAX` listings, so without a bound an outage of
 * the repository puts 400 ids into the head of every answer; past the bound
 * the total is said (`…ParentsTotal`).
 */
export const FLAT_TREE_PARENTS_NAMED_MAX = 50;

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
  /**
   * With `order: "stored"` or `"position"`: whether set positions order the
   * item's sub-collections. `true`: two different ones were SEEN in this call.
   * `false`: this call listed them to their end and positions order nothing
   * there — `position` lists them by title, `stored` as the repository does.
   * Absent: not listed to the end without two different positions in sight
   * (last level, a full page, unread, refused), or fewer than two
   * sub-collections — nothing is said.
   */
  childrenPositioned?: boolean;
}

export interface FlatTree {
  root: {
    nodeId: string; title: string;
    /** As on an item, for the start collection's own sub-collections. */
    childrenPositioned?: boolean;
  };
  depth: number;
  /** How many items this page holds. */
  count: number;
  skipCount: number;
  items: FlatTreeItem[];
  /**
   * The walk stopped at a full page: there is more, from `nextSkipCount` — an
   * offset the tool takes. Where the page steps past `FLAT_TREE_SKIP_MAX` it is
   * that bound, and the page there repeats the tail of this one
   * (`nextSkipCount < skipCount + count`).
   */
  more?: { nextSkipCount: number };
  /**
   * There IS more, and this page already starts AT `FLAT_TREE_SKIP_MAX`: no
   * further offset can be asked for, the rest is reached from a sub-collection
   * as the start. Never beside `more`.
   */
  skipLimitReached?: true;
  /** A listing below the start collection did not answer — the list may lack that branch. */
  incomplete?: true;
  /** A listing below the start collection was refused — that branch is not in the list. */
  restricted?: true;
  /** The walk stopped at its bound on listings before the page was full: deeper levels are missing. */
  walkCapped?: true;
  /**
   * Every parent whose sub-collection listing did not answer (in whole or from
   * a later page on) in THIS call's walk, in walk order — the start collection
   * included, and parents whose entry stands on another page. `incomplete`
   * says THAT a branch is missing; this says where. Up to
   * `FLAT_TREE_PARENTS_NAMED_MAX` ids. A parent the walk never asked (a full
   * page, `walkCapped`) is not in it: only what was observed.
   */
  unreadParents?: string[];
  /** The same for a listing the repository REFUSED (401/403/404) — beside `restricted`. */
  refusedParents?: string[];
  /** How many there are, set only where the list above names fewer. */
  unreadParentsTotal?: number;
  refusedParentsTotal?: number;
}

export interface FlatTreeOptions {
  rootId: string;
  depth: number;
  maxItems: number;
  skipCount: number;
  includeContentCounts: boolean;
  /**
   * The order of each parent's children. `stored` (default): as the repository
   * lists them. `title` / `position` sort them — per PARENT, before they join
   * the level, so the list is the same list on every page. `stored` and
   * `position` carry `childrenPositioned`.
   */
  order?: CollectionOrder;
}

interface Listing {
  nodes: WloNode[]; unread: boolean; refused: boolean; refusedStatus?: number; requests: number;
  /** Stopped at its share of the bound with children left. */
  cut?: true;
  /**
   * The repository's last page came back short: these are ALL the children.
   * Not set where the reading stopped at `budget` after a full page — there
   * may be more, and nothing may be said about the ones not seen.
   */
  complete?: true;
}

/**
 * Every sub-collection of one parent, in stored order, up to `budget` — a
 * parent is never cut at a page. A walk that SORTS passes an unbounded budget:
 * sorted over the first hundred of 130 children, a small page would start with
 * other entries than the same position of a larger one.
 */
async function listChildren(parentId: string, budget: number, maxRequests: number, withPosition: boolean): Promise<Listing> {
  const nodes: WloNode[] = [];
  let requests = 0;
  for (let skip = 0; nodes.length < budget; skip += CHILD_PAGE) {
    // Its share of the walk's bound is spent and the last page was full: there may be more.
    if (requests >= maxRequests) return { nodes, unread: false, refused: false, requests, cut: true };
    requests += 1;
    const res = await getChildCollectionsResult(parentId, CHILD_PAGE, skip, TITLE_PROPS, { stored: true, ...(withPosition ? { withPosition: true } : {}) });
    if (!res.reachable) {
      // What earlier pages answered stays; the rest of this parent is what is unknown.
      return { nodes, unread: didNotAnswer(res), refused: res.refused !== undefined, ...(res.refused ? { refusedStatus: res.refused } : {}), requests };
    }
    nodes.push(...res.nodes);
    if (res.nodes.length < CHILD_PAGE) return { nodes, unread: false, refused: false, requests, complete: true };
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
  const order = opts.order ?? 'stored';
  const byPosition = order === 'position';
  // `stored` reads the position too, though it sorts nothing: its caller sorts
  // by itself where nothing was arranged, and the flag is what says where.
  // The property in the projection is the whole difference to the request
  // `stored` always sent (measured to cost nothing); `title` does not ask.
  const flagged = order !== 'title';
  const arrange =(nodes: WloNode[]): WloNode[] => (byPosition ? sortByPosition(nodes) : order === 'title' ? sortByTitle(nodes) : nodes);
  // A sorted parent is read to its end (see `listChildren`); the bound on listings still holds.
  const childBudget = order === 'stored' ? need : Infinity;
  let rootPositioned: boolean | undefined;
  // Parents whose listing was not read, in walk order — of the WHOLE walk of
  // this call, which is more than the page: the start collection has no entry,
  // and a parent of this page's entries may stand on an earlier one.
  const unreadParents: string[] = [];
  const refusedParents: string[] = [];
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
      const listings = await Promise.all(group.map(parent => listChildren(parent.id, childBudget, share, flagged)));
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
        if (listing.unread) { unreadParents.push(parent.id); if (parent.item) parent.item.childrenUnread = true; }
        if (listing.refused) { refusedParents.push(parent.id); if (parent.item) parent.item.childrenRefused = true; }
        // "No" only over a listing read to its END: over a part of the children
        // it would be a statement about the ones not seen (`positionedFlag`).
        // `complete` and not "nothing went wrong": a `stored` walk stops
        // reading a parent once the page is full, with no failure to show for it.
        const positioned = flagged ? positionedFlag(listing.nodes, listing.complete === true) : undefined;
        if (positioned !== undefined) {
          if (parent.item) parent.item.childrenPositioned = positioned; else rootPositioned = positioned;
        }
        for (const node of arrange(listing.nodes)) {
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
    await mapPool(page, FLAT_TREE_COUNT_POOL, async (item) => {
      const count = await countNodeContents(item);
      if (count !== undefined) item.contentCount = count;
      return null;
    });
  }

  return {
    root: { nodeId: rootId, title: rootTitle, ...(rootPositioned !== undefined ? { childrenPositioned: rootPositioned } : {}) },
    depth,
    count: page.length,
    skipCount,
    items: page,
    // A `more` must name an offset the tool ACCEPTS. Past `FLAT_TREE_SKIP_MAX`
    // it named one the schema refuses — a dead end that read like a way on.
    //
    // A page that steps PAST the bound (page sizes that do not divide it:
    // 450 + 100) is not at the limit yet — the bound itself is an offset the
    // tool takes, and it reaches part of what follows. So `more` names the
    // bound then (that page repeats the tail of this one, which the tool text
    // says), and `skipLimitReached` is left for the page AT the bound, from
    // where no further offset exists.
    ...(items.length <= skipCount + maxItems ? {}
      : skipCount < FLAT_TREE_SKIP_MAX ? { more: { nextSkipCount: Math.min(skipCount + maxItems, FLAT_TREE_SKIP_MAX) } }
        : { skipLimitReached: true as const }),
    ...(unreadParents.length > 0 ? { incomplete: true as const } : {}),
    ...(refusedParents.length > 0 ? { restricted: true as const } : {}),
    // Only where it cost something: a page that is full is answered by `more`.
    ...(walkCapped && items.length < need ? { walkCapped: true as const } : {}),
    ...named('unreadParents', unreadParents),
    ...named('refusedParents', refusedParents),
  };
}

/** The parents of one cause: the first `FLAT_TREE_PARENTS_NAMED_MAX`, and their number where that is fewer than all. */
function named<K extends 'unreadParents' | 'refusedParents'>(key: K, ids: string[]): Partial<Pick<FlatTree, K | `${K}Total`>> {
  if (ids.length === 0) return {};
  return {
    [key]: ids.slice(0, FLAT_TREE_PARENTS_NAMED_MAX),
    ...(ids.length > FLAT_TREE_PARENTS_NAMED_MAX ? { [`${key}Total`]: ids.length } : {}),
  } as Partial<Pick<FlatTree, K | `${K}Total`>>;
}
