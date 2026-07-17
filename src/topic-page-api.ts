/**
 * topic-page-api.ts – Themenseiten (page_variant / page_config) API layer.
 *
 * Everything specific to WLO topic pages lives here: searching page
 * variants, resolving a variant back to its owning collection, listing a
 * collection's theme pages, and parsing the swimlane content structure.
 * Generic node/search access stays in `wlo-api.ts`.
 */

import type { SearchCriterion, WloNode } from './wlo-api.js';
import {
  BASE_URL,
  DISPLAY_PROPS,
  HEADERS,
  WLO_ROOT_COLLECTION_ID,
  wloFetch,
  buildTopicPageUrl,
  getChildCollections,
  getNodeMetadata,
  getNodeParents,
  stripStoreRef,
} from './wlo-api.js';
import { logUpstreamMiss } from './wlo-config.js';
import { nodeMatchesText, nodeTitle } from './node-match.js';

// Topic-page variants additionally need the page_variant fields
// (template flag, target group, swimlane config).
const TOPIC_PAGE_PROPS: string[] = [
  ...DISPLAY_PROPS,
  'ccm:page_variant_is_template',
  'ccm:page_variant_profiling_target_group',
  'ccm:page_variant_config',
];

export type TargetGroup = 'teacher' | 'learner' | 'general';

export interface ThemePageInfo {
  variantId: string;
  variantName: string;
  /**
   * Human-readable title of the page-variant node itself (`cm:title`,
   * e.g. "Seiten-Variante 1"). Distinct from `variantName`, which holds
   * the auto-generated technical `cm:name` ("PAGE_VARIANT_<uuid>").
   * Used as a display fallback when the owning collection can't be
   * resolved, so the UI never shows the raw PAGE_VARIANT/UUID string.
   */
  variantTitle?: string;
  targetGroup: string;
  educationalContexts: string[];
  isTemplate: boolean;
  topicPageUrl: string;
  collectionId?: string;
  collectionName?: string;
}

/**
 * POST /search/v1/queries/-home-/mds_oeh/page_variant
 * Search for page_variant nodes (Themenseiten-Varianten).
 * Supports filtering by is_template, target_group, and educationalcontext.
 * Does NOT support full-text search (ngsearchword returns 0).
 */
export async function searchPageVariants(
  options: {
    isTemplate?: boolean;
    targetGroup?: TargetGroup;
    educationalContext?: string;
  } = {},
  maxItems = 50,
): Promise<WloNode[]> {
  const criteria: SearchCriterion[] = [];
  criteria.push({
    property: 'ccm:page_variant_is_template',
    values: [String(options.isTemplate ?? false)],
  });
  if (options.targetGroup) {
    criteria.push({
      property: 'ccm:page_variant_profiling_target_group',
      values: [options.targetGroup],
    });
  }
  if (options.educationalContext) {
    criteria.push({
      property: 'ccm:educationalcontext',
      values: [options.educationalContext],
    });
  }

  const params = new URLSearchParams({
    contentType: 'ALL',
    maxItems: String(maxItems),
    skipCount: '0',
  });
  for (const p of TOPIC_PAGE_PROPS) params.append('propertyFilter', p);
  const url = `${BASE_URL}/search/v1/queries/-home-/mds_oeh/page_variant?${params}`;
  const body = JSON.stringify({ criteria });
  const res = await wloFetch(url, { method: 'POST', headers: HEADERS, body });
  if (!res.ok) { logUpstreamMiss('searchPageVariants', res); return []; }
  const data = await res.json() as { nodes?: WloNode[] };
  return data.nodes ?? [];
}

/**
 * Collections that HAVE a Themenseite, matched locally against the query.
 *
 * Needed because the keyword-collections endpoint cannot surface them
 * (live-verified 2026-07-17): it returns a FIXED reduced projection without
 * ``ccm:page_config_ref``, and the top-level subject portals — the collections
 * that actually carry Themenseiten — do not appear in its hits at all. The
 * root ``/children`` projection DOES include the config ref, so one bounded
 * call plus a local text match finds them.
 */
export async function searchTopicPageCollections(query: string, maxItems = 10): Promise<WloNode[]> {
  const q = query.trim();
  if (!q) return [];
  const portals = await getChildCollections(WLO_ROOT_COLLECTION_ID, 100);
  return portals
    .filter(n => n.properties?.['ccm:page_config_ref']?.[0] && nodeMatchesText(n, q))
    .slice(0, maxItems);
}

/**
 * Resolve a page-variant node back to its owning collection by walking
 * parent → page_config → collection. Returns { id, name } or null.
 *
 * This is needed for Mode C of search_wlo_topic_pages where we list all
 * variants but don't yet know which collection each belongs to.
 */
export async function resolveVariantCollection(
  variantId: string,
  parentCache?: Map<string, { id: string; name: string } | null>,
  knownParentId?: string,
): Promise<{ id: string; name: string } | null> {
  // Resolve ONE page_config parent → its owning collection (the node that
  // carries `ccm:page_config_ref`). Memoized by parent-id: sibling variants
  // of the same topic page share the same parent, so the (expensive) walk
  // runs only once per parent across a whole Mode-C batch.
  const resolveParent = async (pid: string): Promise<{ id: string; name: string } | null> => {
    if (parentCache?.has(pid)) return parentCache.get(pid)!;
    let result: { id: string; name: string } | null = null;
    for (const g of await getNodeParents(pid)) {
      const gprops = g.properties ?? {};
      if (gprops['ccm:page_config_ref']?.length) {
        const id = g.ref?.id ?? '';
        if (id) {
          result = { id, name: gprops['cclom:title']?.[0] ?? gprops['cm:name']?.[0] ?? g.name ?? '' };
          break;
        }
      }
    }
    parentCache?.set(pid, result);
    return result;
  };

  // Determine which parent(s) to resolve. A page variant lives under exactly
  // one page_config folder, so its known primary parent
  // (virtual:primaryparent_nodeid, present on every page_variant search hit)
  // is authoritative — use it directly and skip the variant→parents round-
  // trip entirely. We only fetch the parents list when no parent is known.
  const pids: string[] = knownParentId
    ? [knownParentId]
    : (await getNodeParents(variantId))
        .map(p => p.ref?.id)
        .filter((x): x is string => !!x);
  if (pids.length === 0) return null;
  // Parents resolved in parallel (usually one), each memoized by parent-id.
  const resolved = await Promise.all(pids.map(resolveParent));
  return resolved.find(r => r !== null) ?? null;
}

/**
 * Given a collection nodeId, check if it has ccm:page_config_ref and resolve
 * the theme page variants underneath it.
 * Returns an array of ThemePageInfo with variant details.
 */
export async function getCollectionThemePages(
  collectionId: string,
  targetGroup?: TargetGroup,
): Promise<ThemePageInfo[]> {
  const node = await getNodeMetadata(collectionId);
  if (!node) return [];

  const props = node.properties ?? {};
  const pageConfigRef = props['ccm:page_config_ref']?.[0];
  if (!pageConfigRef) return [];

  const configId = stripStoreRef(pageConfigRef);

  // The page VARIANTS are the DIRECT children of the config folder: they
  // THEMSELVES carry ``ccm:page_variant_config`` (live-verified 2026-07-17;
  // mirrors getTopicPageContent below). Reading the children's CONTENTS
  // instead — the previous behaviour — hit WIDGET_* nodes without variant
  // metadata (wrong variantId, targetGroup "nicht gesetzt"). Reading one
  // level also drops the per-child fan-out (one upstream call instead of N).
  const configChildren = await getChildCollections(configId, 50, 0, TOPIC_PAGE_PROPS);
  const collectionName = props['cclom:title']?.[0] || props['cm:name']?.[0] || node.name || '';
  const topicPageUrl = buildTopicPageUrl(collectionId, pageConfigRef) ?? '';

  const out: ThemePageInfo[] = [];
  for (const variant of configChildren) {
    const vProps = variant.properties ?? {};
    if (!vProps['ccm:page_variant_config']?.[0]) continue; // not a variant node
    if (vProps['ccm:page_variant_is_template']?.[0] === 'true') continue;

    const vTargetGroup = vProps['ccm:page_variant_profiling_target_group']?.[0] || '';
    if (targetGroup && vTargetGroup && vTargetGroup !== targetGroup) continue;

    out.push({
      variantId: variant.ref?.id ?? '',
      variantName: vProps['cm:name']?.[0] || variant.name || '',
      variantTitle: vProps['cclom:title']?.[0] || vProps['cm:title']?.[0] || '',
      targetGroup: vTargetGroup || 'nicht gesetzt',
      educationalContexts: vProps['ccm:educationalcontext'] ?? [],
      isTemplate: false,
      topicPageUrl,
      collectionId,
      collectionName,
    });
  }
  return out;
}

// ── Theme page CONTENT (swimlane structure) ───────────────────────────────────

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
 * Resolve the CONTENT STRUCTURE of a Themenseite — its swimlane sections plus
 * the node IDs embedded in each. Pass a ``variantId`` directly (fast: one
 * fetch) or a ``collectionId`` (resolves the owning collection's page config
 * to a variant). ``targetGroup`` picks a specific variant when resolving by
 * collection. Returns null when nothing resolvable.
 */
export async function getTopicPageContent(
  opts: { collectionId?: string; variantId?: string; targetGroup?: TargetGroup },
): Promise<TopicPageStructure | null> {
  const seedId = opts.variantId || opts.collectionId;
  if (!seedId) return null;

  // Fetch the seed node. It may already be the page variant itself (carries
  // ccm:page_variant_config) or the owning collection (carries
  // ccm:page_config_ref pointing at the config folder). Handling both makes
  // the tool robust regardless of which id the caller passes.
  let variantNode: WloNode | null = await getNodeMetadata(seedId);
  const hasVariantConfig = (n: WloNode | null) => !!n?.properties?.['ccm:page_variant_config']?.[0];

  // Page header data: when the seed is the OWNING collection, its title and
  // description are the Themenseite's real heading + intro text (rendered by
  // the widget above the swimlanes). A variant seed has no collection context.
  let collectionTitle: string | undefined;
  let description: string | undefined;

  if (variantNode && !hasVariantConfig(variantNode)) {
    const cProps = variantNode.properties ?? {};
    collectionTitle = nodeTitle(variantNode) || undefined;
    description = cProps['cclom:general_description']?.[0]
      || variantNode.collection?.description
      || undefined;
    const ref = cProps['ccm:page_config_ref']?.[0];
    if (!ref) return null;
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

  if (!variantNode) return null;

  const vProps = variantNode.properties ?? {};
  const swimlanes = parsePageVariantConfig(vProps['ccm:page_variant_config']?.[0]);
  const referencedNodeIds = [
    ...new Set(
      swimlanes.flatMap(s => s.items.map(i => i.nodeId).filter((x): x is string => !!x)),
    ),
  ];
  return {
    collectionId: opts.collectionId,
    variantId: variantNode.ref?.id ?? opts.variantId ?? '',
    variantTitle: vProps['cclom:title']?.[0] || vProps['cm:title']?.[0] || '',
    ...(collectionTitle ? { collectionTitle } : {}),
    ...(description ? { description } : {}),
    swimlanes,
    referencedNodeIds,
  };
}
