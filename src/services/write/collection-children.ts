/**
 * services/write/collection-children.ts – reading ALL children of a collection
 * for a write decision (audit 2026-11-14, W2).
 *
 * A write that depends on "what is under this collection" — is there a
 * namesake, does the list name every child — needs the WHOLE listing or the
 * knowledge that it does not have it. Five modules each carried that loop, and
 * the two that looked a sub-collection up by title disagreed on which title:
 * the tree read the record chain (`cclom:title` first), so a renamed collection
 * with a leftover `cclom:title` was not found and `merge` created a second one.
 *
 * - `readWholeListing` is the loop: whole, `unread`, or `too_many` — never a
 *   prefix that passes for the list.
 * - `subCollectionsByTitle` is the ONE lookup by normalised COLLECTION title,
 *   for the tree (`merge`, the look before a create) and the move (namesake).
 */

import { getChildCollectionsResult } from '../../wlo-node.js';
import { collectionTitleFromProperties } from '../../node-match.js';
import type { WloNode } from '../../wlo-types.js';

/** One page of a child listing that is read for its entries (references, positions). */
export const LISTING_PAGE = 100;

/** One page of sub-collections read only for title and id — larger, the rows are small. */
const SUBCOLLECTION_PAGE = 500;
/**
 * Sub-collections one parent may hold for a title lookup to count as complete
 * (four pages, the last one not full). Beyond it the answer is "could not find
 * out": a namesake past the last page read is what the lookup exists to find.
 */
export const SUBCOLLECTIONS_MAX = 4 * SUBCOLLECTION_PAGE - 1;

const TITLE_PROPS = ['cm:title', 'cclom:title', 'cm:name'];

/**
 * Every entry of a paged listing — or why not. `page` answers null when the
 * listing did not answer. `too_many`: more than `max` entries; what was read
 * is then NOT handed back, because a caller would take it for the list.
 */
export async function readWholeListing<T>(
  page: (skip: number, size: number) => Promise<T[] | null>, pageSize: number, max: number,
): Promise<T[] | 'unread' | 'too_many'> {
  const out: T[] = [];
  for (let skip = 0; skip <= max; skip += pageSize) {
    const entries = await page(skip, pageSize);
    if (!entries) return 'unread';
    out.push(...entries);
    if (out.length > max) return 'too_many';
    if (entries.length < pageSize) return out;
  }
  return 'too_many';
}

/** All sub-collections of `parentId` as nodes. Refused or unanswered alike: `unread` — nothing was learned. */
export function listSubCollections(
  parentId: string,
  opts: { pageSize: number; max: number; props: string[]; /** In the stored order instead of the order of creation. */ stored?: boolean },
): Promise<WloNode[] | 'unread' | 'too_many'> {
  return readWholeListing(async (skip, size) => {
    const res = await getChildCollectionsResult(parentId, size, skip, opts.props, { stored: opts.stored === true });
    return res.reachable ? res.nodes : null;
  }, opts.pageSize, opts.max);
}

/** Case, edge and inner spacing do not make a different collection. */
export function normTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** A collection's own title as the repository holds it — for COMPARING. Display goes through `sanitizeText`, which caps. */
export function rawCollectionTitle(node: WloNode): string {
  return collectionTitleFromProperties(node.properties) || node.title || '';
}

/**
 * The sub-collections of `parentId` by normalised COLLECTION title → nodeId, or
 * null when that could not be found out (unreadable, or more than
 * `SUBCOLLECTIONS_MAX`). `cm:title` first: it is what the collection endpoint
 * writes, and a `cclom:title` beside it can be a leftover that hides a namesake.
 * Of two namesakes the first listed is kept.
 */
export async function subCollectionsByTitle(parentId: string): Promise<Map<string, string> | null> {
  const nodes = await listSubCollections(parentId, { pageSize: SUBCOLLECTION_PAGE, max: SUBCOLLECTIONS_MAX, props: TITLE_PROPS });
  if (typeof nodes === 'string') return null;
  const byTitle = new Map<string, string>();
  for (const node of nodes) {
    const title = normTitle(rawCollectionTitle(node));
    const id = node.ref?.id;
    if (title && id && !byTitle.has(title)) byTitle.set(title, id);
  }
  return byTitle;
}
