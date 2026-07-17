/**
 * services/compendium.ts – getCompendiumTexts:
 * Bulk retrieval of the FULL editorial compendium text
 * (`ccm:oeh_collection_compendium_text`) for one or more collection nodes.
 *
 * Unlike collection search/browse (which carry the compendium via DISPLAY_PROPS
 * and truncate it to 500 chars in markdown), this returns the untruncated text
 * — the authoritative prose overview of a collection. Backed by
 * `getNodesMetadata` (`-all-`, parallel, bounded), reused by REST + search
 * bundling.
 */

import { getNodesMetadata } from '../wlo-api.js';
import { formatNode } from '../formatter.js';

export interface CompendiumEntry {
  nodeId: string;
  title: string;
  compendiumText: string | null;
}

export async function getCompendiumTexts(nodeIds: string[]): Promise<CompendiumEntry[]> {
  if (nodeIds.length === 0) return [];

  const nodes = await getNodesMetadata(nodeIds);
  // getNodesMetadata drops nodes that failed to resolve, so map what came back
  // by its canonical id and build one entry per REQUESTED id (order preserved;
  // a missing/failed node yields a null-text entry rather than vanishing).
  const byId = new Map(nodes.map(n => [n.ref?.id, n] as const));

  return nodeIds.map(id => {
    const node = byId.get(id);
    if (!node) return { nodeId: id, title: '', compendiumText: null };
    const f = formatNode(node);
    return { nodeId: id, title: f.title, compendiumText: f.compendiumText ?? null };
  });
}
