/**
 * topic-page-structure.ts – the CONTENT of a Themenseite: resolving a page
 * variant and parsing its `ccm:page_variant_config` into ordered swimlanes.
 *
 * Split out of `topic-page-api.ts` (2026-07-30): that module answers "which
 * Themenseiten exist and which collection owns them" — discovery against the
 * repository — while this one answers "what does one page actually show".
 * The two change for different reasons: discovery follows edu-sharing's search
 * and containment endpoints, this follows the page-builder's config schema.
 */

import type { WloNode } from './wlo-api.js';
import { getChildCollections, getNodeMetadata, stripStoreRef } from './wlo-api.js';
import { nodeTitle } from './node-match.js';
import { TOPIC_PAGE_PROPS, type TargetGroup } from './topic-page-api.js';

/** One item inside a swimlane: a widget plus the optional embedded node it shows. */
export interface SwimlaneItem {
  /** Widget type, e.g. "content-teaser", "ai-text", "wlo-collection-chips". */
  widget: string;
  /** Embedded content/collection nodeId (bare UUID), if the widget references one. */
  nodeId?: string;
}

/** One section of a Themenseite. */
export interface Swimlane {
  heading: string;
  /** Layout type, e.g. "container" or "accordion". */
  type: string;
  items: SwimlaneItem[];
}

/** Parsed content structure of a single page variant. */
export interface TopicPageStructure {
  collectionId?: string;
  variantId: string;
  variantTitle: string;
  /** Human-readable title of the OWNING collection (the page's real heading). */
  collectionTitle?: string;
  /** The collection's description — rendered as the page intro text. */
  description?: string;
  swimlanes: Swimlane[];
  /** Flat, de-duplicated list of every embedded nodeId across all swimlanes. */
  referencedNodeIds: string[];
}

/** Parse a ``ccm:page_variant_config`` JSON string into ordered swimlanes. */
function parsePageVariantConfig(raw: string | undefined): Swimlane[] {
  if (!raw) return [];
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { return []; }
  const swimlanes = parsed?.structure?.swimlanes;
  if (!Array.isArray(swimlanes)) return [];
  return swimlanes.map((sl: any): Swimlane => {
    const grid = Array.isArray(sl?.grid) ? sl.grid : [];
    const items: SwimlaneItem[] = grid
      .map((g: any): SwimlaneItem => ({
        widget: typeof g?.item === 'string' ? g.item : '',
        nodeId: g?.nodeId ? stripStoreRef(String(g.nodeId)) : undefined,
      }))
      .filter((it: SwimlaneItem) => it.widget || it.nodeId);
    return {
      heading: typeof sl?.heading === 'string' ? sl.heading : '',
      type: typeof sl?.type === 'string' ? sl.type : '',
      items,
    };
  });
}

/**
 * Why a Themenseite has no renderable content. Reported to callers so they can
 * act instead of guessing: a client was probing three candidate collections in
 * sequence because every miss looked identical (client report 2026-07-27).
 *   - `no_match`            — nothing to resolve from (no id, no query hit)
 *   - `node_not_found`      — the id does not resolve to a node
 *   - `no_page_config_ref`  — a real collection, but it has no Themenseite
 *   - `no_variant`          — the page config holds no usable (non-template) variant
 *   - `empty_config`        — a variant exists but configures zero swimlanes
 */
export type TopicPageMiss =
  | 'no_match'
  | 'node_not_found'
  | 'no_page_config_ref'
  | 'no_variant'
  | 'empty_config';

export interface TopicPageContentResult {
  structure: TopicPageStructure | null;
  /** Absent on success; set whenever there is nothing (renderable) to show. */
  reason?: TopicPageMiss;
}

/**
 * Resolve the CONTENT STRUCTURE of a Themenseite — its swimlane sections plus
 * the node IDs embedded in each. Pass a ``variantId`` directly (fast: one
 * fetch) or a ``collectionId`` (resolves the owning collection's page config
 * to a variant). ``targetGroup`` picks a specific variant when resolving by
 * collection. On a miss the structure is null (or empty) and ``reason`` says
 * which of the five distinct causes it was.
 */
export async function getTopicPageContent(
  opts: { collectionId?: string; variantId?: string; targetGroup?: TargetGroup },
): Promise<TopicPageContentResult> {
  const seedId = opts.variantId || opts.collectionId;
  if (!seedId) return { structure: null, reason: 'no_match' };

  const hasVariantConfig = (n: WloNode | null) => !!n?.properties?.['ccm:page_variant_config']?.[0];

  // Fast path: the caller knows BOTH ids — `findTopicPagesByQuery` returns them
  // together. Reading the variant and the collection in parallel replaces the
  // two-hop chain (collection → page-config folder children → variant) with a
  // single round-trip, and still yields the header the collection route was
  // chosen for.
  if (opts.variantId && opts.collectionId) {
    const [variant, collection] = await Promise.all([
      getNodeMetadata(opts.variantId),
      getNodeMetadata(opts.collectionId),
    ]);
    if (!variant) return { structure: null, reason: 'node_not_found' };
    const cProps = collection?.properties ?? {};
    return buildTopicPageStructure(variant, opts, {
      collectionTitle: (collection ? nodeTitle(collection) : '') || undefined,
      description: cProps['cclom:general_description']?.[0] || collection?.collection?.description || undefined,
    });
  }

  // Fetch the seed node. It may already be the page variant itself (carries
  // ccm:page_variant_config) or the owning collection (carries
  // ccm:page_config_ref pointing at the config folder). Handling both makes
  // the tool robust regardless of which id the caller passes.
  let variantNode: WloNode | null = await getNodeMetadata(seedId);
  if (!variantNode) return { structure: null, reason: 'node_not_found' };

  // Page header data: when the seed is the OWNING collection, its title and
  // description are the Themenseite's real heading + intro text (rendered by
  // the widget above the swimlanes). A variant seed has no collection context.
  let collectionTitle: string | undefined;
  let description: string | undefined;

  if (!hasVariantConfig(variantNode)) {
    const cProps = variantNode.properties ?? {};
    collectionTitle = nodeTitle(variantNode) || undefined;
    description = cProps['cclom:general_description']?.[0]
      || variantNode.collection?.description
      || undefined;
    const ref = cProps['ccm:page_config_ref']?.[0];
    if (!ref) return { structure: null, reason: 'no_page_config_ref' };
    // The page variants ARE the child collections of the page_config_ref folder:
    // they THEMSELVES carry ``ccm:page_variant_config`` (title e.g. "Variante_Ideal"
    // / "PAGE_VARIANT_…"). Previously their CONTENTS were searched by mistake —
    // but those are WIDGET_* nodes WITHOUT config → always 0 swimlanes. Now pick
    // the real (non-template) variant directly among the children. This also saves
    // the per-child getCollectionContents fan-out (fewer edu-sharing calls).
    const configChildren = await getChildCollections(stripStoreRef(ref), 50, 0, TOPIC_PAGE_PROPS);
    const variants = configChildren.filter(
      n => hasVariantConfig(n)
        && n.properties?.['ccm:page_variant_is_template']?.[0] !== 'true',
    );
    variantNode = (
      opts.targetGroup
        ? variants.find(
            n => n.properties?.['ccm:page_variant_profiling_target_group']?.[0] === opts.targetGroup,
          )
        : undefined
    ) ?? variants[0] ?? null;
  }

  if (!variantNode) return { structure: null, reason: 'no_variant' };
  return buildTopicPageStructure(variantNode, opts, { collectionTitle, description });
}

/** Parse a resolved variant node into the public structure (both resolve paths). */
function buildTopicPageStructure(
  variantNode: WloNode,
  opts: { collectionId?: string; variantId?: string },
  header: { collectionTitle?: string; description?: string },
): TopicPageContentResult {
  const vProps = variantNode.properties ?? {};
  const swimlanes = parsePageVariantConfig(vProps['ccm:page_variant_config']?.[0]);
  const referencedNodeIds = [
    ...new Set(
      swimlanes.flatMap(s => s.items.map(i => i.nodeId).filter((x): x is string => !!x)),
    ),
  ];
  const structure: TopicPageStructure = {
    collectionId: opts.collectionId,
    variantId: variantNode.ref?.id ?? opts.variantId ?? '',
    variantTitle: vProps['cclom:title']?.[0] || vProps['cm:title']?.[0] || '',
    ...(header.collectionTitle ? { collectionTitle: header.collectionTitle } : {}),
    ...(header.description ? { description: header.description } : {}),
    swimlanes,
    referencedNodeIds,
  };
  // The variant resolved but configures nothing renderable — a distinct case
  // from "no variant at all", and the header fields still travel with it.
  return swimlanes.length === 0 ? { structure, reason: 'empty_config' } : { structure };
}
