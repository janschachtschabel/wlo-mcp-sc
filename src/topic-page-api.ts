/**
 * topic-page-api.ts – Themenseiten (page_variant / page_config) DISCOVERY.
 *
 * Finding topic pages in the repository lives here: searching page variants,
 * finding collections that own one, resolving a variant back to its owning
 * collection, and listing a collection's theme pages. Parsing what a page
 * SHOWS is `topic-page-structure.ts`; generic node/search access stays in
 * `wlo-api.ts`.
 */

import type { SearchCriterion, WloNode } from './wlo-api.js';
import {
  BASE_URL,
  DISPLAY_PROPS,
  WLO_ROOT_COLLECTION_ID,
  appendPropertyFilter,
  buildTopicPageUrl,
  getChildCollections,
  getNodeMetadata,
  stripStoreRef,
} from './wlo-api.js';
import { HEADERS, wloFetch, logUpstreamMiss } from './wlo-fetch.js';
import { readJson } from './read-json.js';
import { nodeMatchesText } from './node-match.js';

// Topic-page variants additionally need the page_variant fields
// (template flag, target group, swimlane config). Exported because
// `topic-page-structure.ts` reads the same projection off the config folder.
export const TOPIC_PAGE_PROPS: string[] = [
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
  appendPropertyFilter(params, TOPIC_PAGE_PROPS);
  const url = `${BASE_URL}/search/v1/queries/-home-/mds_oeh/page_variant?${params}`;
  const body = JSON.stringify({ criteria });
  const res = await wloFetch(url, { method: 'POST', headers: HEADERS, body });
  if (!res.ok) { logUpstreamMiss('searchPageVariants', res); return []; }
  const data = await readJson<{ nodes?: WloNode[] }>(res, 'searchPageVariants');
  return data?.nodes ?? [];
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

/** The collection that owns a Themenseite, as resolved from a page variant. */
export interface TopicPageOwner {
  id: string;
  name: string;
  /**
   * The owner's own (active) `ccm:page_config_ref`, carried out of the read
   * that already had to check it to identify this node as an owner — so the
   * caller needs no further metadata fetch (Mode-C latency, 2026-07-27).
   */
  pageConfigRef: string;
}

/** Per-batch memo of parent-id → owner resolution (see resolveVariantCollection). */
export type TopicPageOwnerCache = Map<string, Promise<TopicPageOwner | null>>;

/** Enough to hop one level up the containment chain. */
const PARENT_REF_PROPS: string[] = ['virtual:primaryparent_nodeid'];

/** The only fields read off the owning collection. */
const OWNER_PROPS: string[] = ['ccm:page_config_ref', 'cclom:title', 'cm:name'];

/** One containment hop: the node's primary parent id, or '' when unavailable. */
async function primaryParentOf(nodeId: string): Promise<string> {
  const node = await getNodeMetadata(nodeId, PARENT_REF_PROPS);
  return stripStoreRef(node?.properties?.['virtual:primaryparent_nodeid']?.[0]);
}

/**
 * Resolve a page-variant node back to its owning collection, hopping
 * variant → page_config folder → collection via `virtual:primaryparent_nodeid`.
 * Returns the owner or null.
 *
 * This is needed for Mode C of search_wlo_topic_pages where we list all
 * variants but don't yet know which collection each belongs to.
 */
export async function resolveVariantCollection(
  variantId: string,
  parentCache?: TopicPageOwnerCache,
  knownParentId?: string,
): Promise<TopicPageOwner | null> {
  // Resolve ONE page_config folder → its owning collection (the node that
  // carries `ccm:page_config_ref`). Memoized by folder-id: sibling variants of
  // the same topic page share the folder, so the resolution runs only once per
  // folder across a whole Mode-C batch.
  //
  // Two `/metadata` reads, deliberately NOT `/parents`: that endpoint answers
  // 500 (AccessDeniedException) for anonymous callers on page-config folders,
  // so every walk returned an empty chain — no collection title, no topic-page
  // URL — while costing ~1.1 s each. `/metadata` works anonymously at ~0.19 s
  // (live-verified 2026-07-27 against the production repository).
  //
  // The cache holds the in-flight PROMISE, not the resolved value: variants are
  // enriched concurrently, so caching only the result let every sibling miss
  // the cache and fire its own resolution before the first one returned.
  const resolveParent = (pid: string): Promise<TopicPageOwner | null> => {
    const cached = parentCache?.get(pid);
    if (cached) return cached;
    const pending = (async (): Promise<TopicPageOwner | null> => {
      const ownerId = await primaryParentOf(pid);
      if (!ownerId) return null;
      const owner = await getNodeMetadata(ownerId, OWNER_PROPS);
      const props = owner?.properties ?? {};
      // Carrying `ccm:page_config_ref` at all is what makes this collection a
      // Themenseite owner. It is deliberately NOT compared against `pid`: a
      // collection may hold several page-config folders while its own ref names
      // only the ACTIVE one (5 of 25 sampled pages), and requiring a match
      // would drop those pages entirely. The owner's own ref is the right one
      // to carry forward — it points at the page that is actually published.
      if (!props['ccm:page_config_ref']?.length) return null;
      return {
        id: ownerId,
        name: props['cclom:title']?.[0] ?? props['cm:name']?.[0] ?? owner?.name ?? '',
        pageConfigRef: props['ccm:page_config_ref'][0] ?? '',
      };
    })();
    parentCache?.set(pid, pending);
    return pending;
  };

  // Determine which parent(s) to resolve. A page variant lives under exactly
  // one page_config folder, so its known primary parent
  // (virtual:primaryparent_nodeid, present on every page_variant search hit)
  // is authoritative — use it directly and skip the variant→parents round-
  // trip entirely. We only fetch the parents list when no parent is known.
  const pids: string[] = knownParentId ? [knownParentId] : [await primaryParentOf(variantId)];
  if (!pids[0]) return null;
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
  // Only the owner fields are read below, and this runs once per candidate on
  // the Mode-B hot path — no reason to pull the full `-all-` projection.
  const node = await getNodeMetadata(collectionId, OWNER_PROPS);
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

