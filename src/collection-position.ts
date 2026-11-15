/**
 * collection-position.ts – "the set position, else the title": the third order
 * of sub-collections (chatbot team, S11, 2026-11-15).
 *
 * `stored` is the repository's own order — the position where one was set,
 * else the order of CREATION. For a curriculum someone arranged that is right;
 * for a branch nobody arranged it is arbitrary, and the answer does not say
 * which of the two it was. This module holds the rule that fits both, and the
 * flag that says which case held.
 *
 * Measured 2026-11-15 on staging (`npm run measure:tree`, 67 parents): the
 * children listing carries `ccm:collection_ordered_position` per child when
 * the projection asks for it — one string holding an integer; a child without
 * a position has NO such property. And positions TIE far more often than they
 * order: 46 of the 57 parents whose children carry one hold the same value
 * twice (the 30 subject portals all hold "1"), only 9 hold two different
 * values. So a position alone does not mean somebody arranged the branch —
 * which is why equal positions fall back to the title, and why the flag asks
 * for two DIFFERENT ones.
 */

import type { WloNode } from './wlo-types.js';
import { ORDER_POSITION_PROPERTY } from './wlo-node.js';
import { sortByTitle } from './reranker.js';

/** `title` and `stored` mean what they always meant; `position` is this module's rule. */
export type CollectionOrder = 'title' | 'stored' | 'position';

/**
 * The position set on a child, or undefined: absent, empty, or anything but a
 * plain integer. The repository writes one integer as a string (measured, see
 * above); `Number()` would also take "0x10", "1e3" and "1.5" for a position,
 * and past 2^53 two different values compare equal — so only digits within the
 * safe-integer range count, and everything else is "no position".
 */
export function positionOf(node: WloNode): number | undefined {
  const raw = node.properties?.[ORDER_POSITION_PROPERTY]?.[0]?.trim();
  if (raw === undefined || !/^-?\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : undefined;
}

/**
 * The children of ONE parent: those with a position in position order, then
 * those without one by title — and equal positions by title too, in the
 * collation `order: "title"` uses (`sortByTitle`), so a branch whose children
 * all hold the same position reads exactly like the alphabetical one.
 */
export function sortByPosition(nodes: WloNode[]): WloNode[] {
  const titled = sortByTitle(nodes);
  // `Array.prototype.sort` is stable: the title order survives among equals.
  const placed = titled.filter(n => positionOf(n) !== undefined).sort((a, b) => positionOf(a)! - positionOf(b)!);
  return [...placed, ...titled.filter(n => positionOf(n) === undefined)];
}

/**
 * Whether set positions ORDER these children: at least two of them hold
 * different positions. One position, or the same one on every child, orders
 * nothing — a client that sorts by itself is then right to sort by title.
 */
export function positionsDecide(nodes: WloNode[]): boolean {
  const seen = new Set<number>();
  for (const node of nodes) {
    const position = positionOf(node);
    if (position !== undefined) seen.add(position);
    if (seen.size > 1) return true;
  }
  return false;
}

/**
 * The flag an answer carries for ONE parent (`childrenPositioned`), from the
 * children that were `seen` and whether the listing was read to its end.
 *
 * - `true` whenever two different positions were SEEN: that is a fact whatever
 *   follows.
 * - `false` only over a listing read to its END. The listing comes
 *   position-ascending, so a cut prefix of equal positions is exactly where the
 *   unseen tail differs (60 children, 55 on "1": the first 50 said "nothing
 *   ordered" — review 2026-11-15).
 * - undefined otherwise — and for fewer than two children: there is nothing to
 *   order, and "sort those yourself" over a leaf is 26 characters about nothing.
 */
export function positionedFlag(seen: WloNode[], readToEnd: boolean): boolean | undefined {
  if (positionsDecide(seen)) return true;
  return readToEnd && seen.length >= 2 ? false : undefined;
}
