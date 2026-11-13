/**
 * services/write/collection-fields.ts – where a COLLECTION keeps its title and
 * description.
 *
 * The metadata tools are open for collections (user decision 2026-11-13:
 * editors maintain a collection's subject, level and keywords like a record's).
 * Their `title` / `description` parameters name `cclom:title` /
 * `cclom:general_description`, which is where a RECORD keeps them. A collection
 * keeps them in `cm:title` / `cm:description` — what the collection endpoint
 * writes and the collection view reads.
 *
 * Measured against staging on 2026-11-13
 * (`tests/live/collection-metadata.test.ts`): the node metadata route stores
 * `cclom:title` on a collection as a SECOND field. `collection.title` stays
 * what it was — so the write reads back as stored while the collection still
 * shows its old title — and the node's own DTO `title` follows the new field
 * from then on; a later rename no longer reaches it. The same route stores
 * `cm:title` / `cm:description` where the collection reads them.
 *
 * One place, used by every tool that writes or proposes metadata: a tool that
 * forgets it writes the field nobody reads.
 */

import { isCollectionNode } from '../../node-kind.js';
import { collectionTitleFromProperties, titleFromProperties } from '../../node-match.js';
import type { WloNode } from '../../wlo-types.js';

const ON_A_COLLECTION: Readonly<Record<string, string>> = {
  'cclom:title': 'cm:title',
  'cclom:general_description': 'cm:description',
};

type Kind = Pick<WloNode, 'type' | 'aspects'>;

/** The property that carries `property`'s meaning on THIS node. */
export function propertyOn(node: Kind, property: string): string {
  return isCollectionNode(node) ? (ON_A_COLLECTION[property] ?? property) : property;
}

/** Desired values, keyed by the properties this node keeps them in. */
export function desiredOn(node: Kind, desired: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(desired).map(([property, values]) => [propertyOn(node, property), values]));
}

/**
 * The title a PERSON knows this node by — for a collection the collection's
 * (`cm:title` first), for a record the record's. The sentences a confirm token
 * binds to name the node with it: a collection that still carries a stray
 * `cclom:title` (what these tools wrote before 2026-11-13) was otherwise named
 * by a title its own view does not show (review of D2).
 */
export function titleOn(node: Kind, properties: Record<string, string[]> | undefined): string {
  return (isCollectionNode(node) ? collectionTitleFromProperties(properties) : titleFromProperties(properties)) ?? '';
}
