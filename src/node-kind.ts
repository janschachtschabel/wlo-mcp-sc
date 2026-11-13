/**
 * node-kind.ts – what kind of thing a repository node IS.
 *
 * `ccm:map` is the repository's general container, not "a collection": page
 * config folders, page variants, crawler folders and workspace folders report
 * it too. What makes a map a COLLECTION is the aspect `ccm:collection`
 * (measured 2026-11-12 against staging, `tests/live/node-kinds.test.ts`: every
 * collection carries it and a DTO `collection` object; a page-config folder and
 * a page variant carry neither).
 *
 * One place, because the tools decide by it which endpoint a node is sent to —
 * and a container that passes for a collection is deleted through the
 * collection endpoint under a preview promising that its materials survive.
 * A leaf module: `services/` and `tools/` both need it.
 */

import type { WloNode } from './wlo-types.js';
import { sanitizeText } from './text-sanitize.js';

export const CONTENT_TYPE = 'ccm:io';
export const CONTAINER_TYPE = 'ccm:map';
const COLLECTION_ASPECT = 'ccm:collection';

/** A collection — not merely a container. A node whose aspects were not sent is not one. */
export function isCollectionNode(node: Pick<WloNode, 'type' | 'aspects'>): boolean {
  return node.type === CONTAINER_TYPE && (node.aspects?.includes(COLLECTION_ASPECT) ?? false);
}

/** A single record — an original or a reference to one. */
export function isContentNode(node: Pick<WloNode, 'type'>): boolean {
  return node.type === CONTENT_TYPE;
}

/** Why a node is not what a write works on — a code for a program, a German clause for a person. */
export interface KindMismatch {
  code: 'not_a_collection' | 'is_a_collection' | 'is_a_folder' | 'refused';
  /** Completes "„<id>“ …". */
  reason: string;
}

/**
 * Why this node is not what the caller needs, or null when it is. The
 * repository checks none of this: each endpoint takes whatever id it is handed.
 * `collection` means a COLLECTION, not any `ccm:map`. One function for the
 * tools and the services behind the batch tools, so the same wrong id is
 * refused with the same code whichever tool it reaches.
 */
export function wrongKind(
  node: Pick<WloNode, 'type' | 'aspects'>,
  expected: 'content' | 'collection',
): KindMismatch | null {
  const collection = isCollectionNode(node);
  if (expected === 'collection') {
    if (collection) return null;
    if (isContentNode(node)) return { code: 'not_a_collection', reason: 'ist keine Sammlung, sondern ein einzelner Datensatz.' };
    return node.type === CONTAINER_TYPE
      ? { code: 'not_a_collection', reason: 'ist keine Sammlung, sondern ein Ordner.' }
      : { code: 'not_a_collection', reason: `ist keine Sammlung (Typ ${sanitizeText(node.type ?? 'unbekannt')}).` };
  }
  if (isContentNode(node)) return null;
  if (collection) return { code: 'is_a_collection', reason: 'ist eine Sammlung, kein einzelner Datensatz.' };
  return node.type === CONTAINER_TYPE
    ? { code: 'is_a_folder', reason: 'ist ein Ordner, kein einzelner Datensatz.' }
    : { code: 'refused', reason: `ist kein Datensatz (Typ ${sanitizeText(node.type ?? 'unbekannt')}).` };
}
