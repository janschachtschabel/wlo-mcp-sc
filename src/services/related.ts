/**
 * services/related.ts – get_related_content business logic.
 *
 * Given a seed nodeId, find other WLO content that shares its subject(s) and
 * educational level(s): fetch the seed's metadata, use its `ccm:taxonid`
 * (disciplines) and `ccm:educationalcontext` (levels) as ngsearch filters, and
 * exclude the seed from the results. Optionally also return the seed's siblings
 * — the other contents of its primary parent collection.
 */

import type { SearchCriterion } from '../wlo-api.js';
import { getCollectionContents, getNodeMetadata, ngsearch } from '../wlo-api.js';
import type { FormattedNode } from '../formatter.js';
import { formatNode, formatNodes } from '../formatter.js';

export interface RelatedContentOptions {
  nodeId: string;
  maxResults?: number;
  includeSiblings?: boolean;
}

export interface RelatedContentResult {
  seedNodeId: string;
  seedTitle: string;
  /** The seed's disciplines/levels the relation is based on (labels). */
  disciplines: string[];
  educationalContexts: string[];
  results: FormattedNode[];
  /** Only present when includeSiblings was requested. */
  siblings?: FormattedNode[];
}

/** Returns null when the seed node cannot be resolved. */
export async function getRelatedContent(
  opts: RelatedContentOptions,
): Promise<RelatedContentResult | null> {
  const seed = await getNodeMetadata(opts.nodeId);
  if (!seed) return null;

  const props = seed.properties ?? {};
  const disciplineUris = props['ccm:taxonid'] ?? [];
  const contextUris = props['ccm:educationalcontext'] ?? [];
  const maxResults = opts.maxResults ?? 8;
  const seedFmt = formatNode(seed);

  const criteria: SearchCriterion[] = [];
  if (disciplineUris.length) criteria.push({ property: 'ccm:taxonid', values: disciplineUris });
  if (contextUris.length) criteria.push({ property: 'ccm:educationalcontext', values: contextUris });

  // Nothing to relate on → no search, empty results (not an error).
  let results: FormattedNode[] = [];
  if (criteria.length) {
    // Over-fetch by one so removing the seed still yields up to maxResults.
    const resp = await ngsearch(criteria, 'FILES', maxResults + 1, 0);
    results = formatNodes(resp.nodes).filter(n => n.nodeId !== opts.nodeId).slice(0, maxResults);
  }

  const result: RelatedContentResult = {
    seedNodeId: opts.nodeId,
    seedTitle: seedFmt.title,
    disciplines: seedFmt.disciplines,
    educationalContexts: seedFmt.educationalContexts,
    results,
  };

  if (opts.includeSiblings) {
    // The primary-parent id is carried on the node itself; works for file nodes
    // too (unlike /parents, which 500s for ccm:io — see getNodeParents).
    const parentId = props['virtual:primaryparent_nodeid']?.[0];
    if (parentId) {
      const sib = await getCollectionContents(parentId, 'files', maxResults + 1, 0);
      result.siblings = formatNodes(sib.nodes).filter(n => n.nodeId !== opts.nodeId).slice(0, maxResults);
    } else {
      result.siblings = [];
    }
  }

  return result;
}
