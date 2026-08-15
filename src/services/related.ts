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
import { log } from '../logger.js';

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
  /**
   * The collection whose approved skills apply to this answer — the only place
   * an approved-skills registry could hang for a "more like this" query.
   *
   * Which one that is depends on the SEED, and naming it after the siblings got
   * it wrong for half the callers: this tool takes "eine nodeId eines Inhalts
   * ODER einer Sammlung".
   *
   *   - seed is a collection → the SEED. It is what the caller named, and its
   *     `virtual:primaryparent_nodeid` is the collection above it, which the
   *     caller never mentioned.
   *   - seed is a material → the parent the siblings were read from, and only
   *     when siblings were asked for. Without them this is a question about one
   *     material and no collection is in play.
   *
   * For the material case it is set even if the sibling listing then failed:
   * whether that collection declares skills is a separate question from whether
   * its contents could be read.
   */
  registryCollectionId?: string;
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
    // A collection seed IS the collection in play, whether or not siblings were
    // asked for — see `registryCollectionId`.
    ...(seedFmt.nodeType === 'collection' ? { registryCollectionId: opts.nodeId } : {}),
  };

  if (opts.includeSiblings) {
    // The primary-parent id is carried on the node itself; works for file nodes
    // too (unlike /parents, which 500s for ccm:io — see getNodeParents).
    const parentId = props['virtual:primaryparent_nodeid']?.[0];
    result.siblings = [];
    if (parentId) {
      // Only for a MATERIAL seed: a collection seed already claimed the field
      // above, and overwriting it here would answer about the level above the
      // one the caller named.
      result.registryCollectionId ??= parentId;
      // Degrade, never fail: the parent collection can be unreadable for the
      // anonymous user (live-found: 403 Forbidden) and getCollectionContents
      // throws. Siblings are an OPTIONAL enrichment — losing them must not
      // discard the related results already fetched above.
      try {
        const sib = await getCollectionContents(parentId, 'files', maxResults + 1, 0);
        result.siblings = formatNodes(sib.nodes).filter(n => n.nodeId !== opts.nodeId).slice(0, maxResults);
      } catch (err) {
        log.warn('related: siblings lookup failed, continuing without', {
          parentId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return result;
}
