/**
 * services/compendium.ts – getCompendiumTexts:
 * Bulk retrieval of the FULL editorial compendium text
 * (`ccm:oeh_collection_compendium_text`) for one or more collection nodes.
 *
 * Search hits carry only the `hasCompendium` signal (2026-08-20); this is the
 * bulk delivery path behind `includeCompendium` and `/api/compendium`, and it
 * returns the untruncated text — the authoritative prose overview. Backed by
 * `getNodesMetadata` (`-all-`, parallel, bounded), reused by REST + search
 * bundling.
 */

import { DISPLAY_PROPS, readNodeMetadata, type WloNode } from '../wlo-api.js';
import { formatNode } from '../formatter.js';
import { mapPool } from '../concurrency.js';
import { failureCode } from './failure-code.js';
import { codeOfStatus, type MissingCode } from './node-details.js';

export interface CompendiumEntry {
  nodeId: string;
  title: string;
  compendiumText: string | null;
  /**
   * Set when the collection could not be READ, with the reason. `compendiumText:
   * null` alone then says nothing: "no compendium text" is a statement about a
   * collection somebody looked at, and a 403 or a 503 looked at none.
   */
  unread?: MissingCode;
}

/** Reads at once — the pool `getNodesMetadata` ran this fan-out with. */
const COMPENDIUM_POOL = 8;

export async function getCompendiumTexts(nodeIds: string[]): Promise<CompendiumEntry[]> {
  if (nodeIds.length === 0) return [];

  // Projected, not `-all-`: this reads two fields and `DISPLAY_PROPS` names
  // both, including the full compendium text (the 500-char cap elsewhere is our
  // renderer's, not the API's). Measured read-only against the editorial
  // repository on 2026-08-03 — a `propertyFilter` returns every field it names
  // byte-identical to the `-all-` read, including a 4914-character description,
  // so the filter bounds WHICH properties come back and never their content.
  // The responses shrink ~43%.
  // One read per id WITH its status: the bulk helper drops every node that
  // did not resolve, and what is left cannot tell a collection without a text
  // from one that was refused or behind an outage.
  const reads = await mapPool(nodeIds, COMPENDIUM_POOL, async (id): Promise<WloNode | MissingCode> => {
    try {
      const { node, status } = await readNodeMetadata(id, DISPLAY_PROPS);
      return node ?? codeOfStatus(status);
    } catch (err) {
      return failureCode(err);
    }
  });

  return nodeIds.map((id, i) => {
    const node = reads[i] ?? 'upstream_error';
    if (typeof node === 'string') return { nodeId: id, title: '', compendiumText: null, unread: node };
    // The property directly, not FormattedNode: since 2026-08-20 `formatNode`
    // carries only the `hasCompendium` signal — this service IS the delivery
    // path the signal points at, so it must not read through the type that
    // deliberately dropped the text (found by the gap-fill test the moment the
    // drop landed: the tool would have answered null for every collection).
    const text = node.properties?.['ccm:oeh_collection_compendium_text']?.[0];
    return { nodeId: id, title: formatNode(node).title, compendiumText: text ?? null };
  });
}
