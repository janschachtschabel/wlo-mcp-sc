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

import { DISPLAY_PROPS, getNodesMetadata } from '../wlo-api.js';
import { formatNode } from '../formatter.js';

export interface CompendiumEntry {
  nodeId: string;
  title: string;
  compendiumText: string | null;
}

export async function getCompendiumTexts(nodeIds: string[]): Promise<CompendiumEntry[]> {
  if (nodeIds.length === 0) return [];

  // Projected, not `-all-`: this reads two fields and `DISPLAY_PROPS` names
  // both, including the full compendium text (the 500-char cap elsewhere is our
  // renderer's, not the API's). Measured read-only against the editorial
  // repository on 2026-08-03 — a `propertyFilter` returns every field it names
  // byte-identical to the `-all-` read, including a 4914-character description,
  // so the filter bounds WHICH properties come back and never their content.
  // The responses shrink ~43%.
  const nodes = await getNodesMetadata(nodeIds, undefined, DISPLAY_PROPS);
  // getNodesMetadata drops nodes that failed to resolve, so map what came back
  // by its canonical id and build one entry per REQUESTED id (order preserved;
  // a missing/failed node yields a null-text entry rather than vanishing).
  const byId = new Map(nodes.map(n => [n.ref?.id, n] as const));

  return nodeIds.map(id => {
    const node = byId.get(id);
    if (!node) return { nodeId: id, title: '', compendiumText: null };
    // The property directly, not FormattedNode: since 2026-08-20 `formatNode`
    // carries only the `hasCompendium` signal — this service IS the delivery
    // path the signal points at, so it must not read through the type that
    // deliberately dropped the text (found by the gap-fill test the moment the
    // drop landed: the tool would have answered null for every collection).
    const text = node.properties?.['ccm:oeh_collection_compendium_text']?.[0];
    return { nodeId: id, title: formatNode(node).title, compendiumText: text ?? null };
  });
}
