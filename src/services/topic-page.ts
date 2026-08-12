/**
 * services/topic-page.ts – Topic-page swimlane resolution.
 *
 * Turns a parsed `TopicPageStructure` into RENDER-READY swimlanes: each
 * swimlane's dynamic WIDGET nodes (ccm:map with ccm:widget_config = saved
 * query / node list / single node) are EXECUTED into real content cards.
 * Extracted from the get_topic_page_content tool so search_wlo_all and
 * search_wlo_topic_pages can reuse the exact same resolution.
 */
/* eslint @typescript-eslint/no-explicit-any: "off" -- this module traverses the
 * page builder's unvalidated `ccm:widget_config` JSON; every access below is
 * guarded at runtime (typeof / Array.isArray), which is the actual contract. */

import type { SearchCriterion, WloNode } from '../wlo-api.js';
import { WLO_TOPIC_POOL, buildTopicPageUrl, getNodesMetadata, ngsearch, stripStoreRef } from '../wlo-api.js';
import { searchCollections } from './collection-search.js';
import type { ThemePageInfo, VariantFilters } from '../topic-page-variant.js';
import { getCollectionThemePages, searchTopicPageCollections } from '../topic-page-api.js';
import type { TopicPageStructure } from '../topic-page-structure.js';
import type { FormattedNode } from '../formatter.js';
import { formatNodes } from '../formatter.js';
import { rerankNodes } from '../reranker.js';
import { log } from '../logger.js';
import { mapPool } from '../concurrency.js';

/**
 * Resolve a topic QUERY to the Themenseiten of the best-matching collections —
 * the shared core of search_wlo_topic_pages Mode B, reused by
 * get_topic_page_content's one-step topic path.
 *
 * The keyword-collections endpoint returns a reduced projection WITHOUT
 * ccm:page_config_ref and never surfaces the subject portals (live-verified
 * 2026-07-17), so match the portals locally AND metadata-check every keyword
 * hit via getCollectionThemePages. Results keep the reranked (relevance) order.
 */
export async function findTopicPagesByQuery(
  query: string,
  filters: VariantFilters = {},
  maxCandidates = 12,
): Promise<ThemePageInfo[]> {
  const q = query.trim();
  if (!q) return [];
  const [portals, keywordHits] = await Promise.all([
    searchTopicPageCollections(q).catch(() => [] as WloNode[]),
    // Degrade like the portal leg: the keyword hits are the SUPPLEMENT here
    // (their projection has no config ref at all), so a thrown keyword search
    // — timeout, reset — must not discard the portals, which are the only leg
    // that can surface a Themenseite. Same guard as searchAll's.
    searchCollections(q, 10).catch((err) => {
      log.warn('findTopicPagesByQuery: keyword collection search failed, continuing without', {
        error: err instanceof Error ? err.message : String(err),
      });
      return [] as WloNode[];
    }),
  ]);
  // Portal copies first: on an id collision they carry the config ref. Dedup,
  // rerank by relevance, cap the per-candidate metadata fan-out.
  const seen = new Set<string>();
  const merged = [...portals, ...keywordHits].filter(c => {
    const id = c.ref?.id;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const candidateIds = rerankNodes(merged, q)
    .flatMap(c => (c.ref?.id ? [c.ref.id] : []))
    .slice(0, maxCandidates);
  // Each candidate costs a metadata read plus, when it owns a page config, a
  // children read. At a hard-coded width of 4 those 12 candidates took three to
  // four sequential waves (~1.8 s measured against production, ~0.8 s in one
  // wave) — the dominant cost of both callers. Share WLO_TOPIC_POOL with the
  // Mode-C fan-out instead of adding a second knob: it is the same kind of
  // work, bounded by the same upstream.
  const pages = await mapPool(candidateIds, WLO_TOPIC_POOL, (cId) => getCollectionThemePages(cId, filters));
  const results: ThemePageInfo[] = [];
  for (const p of pages) if (p) results.push(...p);
  return results;
}

/** One swimlane with its resolved content cards. */
export interface ResolvedSwimlane {
  heading: string;
  type: string;
  items: FormattedNode[];
  hasMore: boolean;
}

/** Render-ready swimlane payload for a single topic-page variant. */
export interface SwimlanePayload {
  variantId: string;
  collectionId: string | null;
  variantTitle: string;
  /** The owning collection's title — the page's real heading (when resolvable). */
  collectionTitle?: string;
  /** The collection's description — the page intro text (when present). */
  description?: string;
  topicPageUrl: string | null;
  swimlaneCount: number;
  /** Total swimlanes on the page (may exceed swimlaneCount when capped). */
  swimlanesTotal: number;
  swimlanes: ResolvedSwimlane[];
  /** Only on an empty payload: why there is nothing to render (TopicPageMiss). */
  reason?: string;
}

/** Cap on resolved swimlanes per call. */
const MAX_LANES = 12;

/**
 * Cap on widgets read per swimlane. The lane cap alone does not bound the
 * upstream calls: one metadata request goes out per widget node, and a lane's
 * grid is parsed unbounded (topic-page-structure.ts). Only the FIRST
 * content-bearing widget of a lane is ever used, so a handful is all the
 * resolution can spend — together with MAX_LANES this is what makes the call
 * count bounded.
 */
const MAX_WIDGETS_PER_LANE = 4;

/**
 * Resolve the content of ONE widget config — three forms that occur in WLO:
 *  (a) content-teaser      → propertyFilters (saved query) → ngsearch
 *  (b) wlo-collection-chips → sortedNodeIds (fixed collection list)
 *  (c) wlo-media-rendering  → selectedNodeId (single node)
 * Other widgets (text/AI-text/navigation/members/iframe) carry no content → null.
 */
async function resolveWidget(
  cfg: any,
  cap: number,
): Promise<{ items: FormattedNode[]; hasMore: boolean } | null> {
  const pf = cfg?.propertyFilters;
  if (pf && typeof pf === 'object') {
    const criteria: SearchCriterion[] = Object.entries(pf)
      .map(([property, values]) => ({
        property,
        values: (Array.isArray(values) ? values : []).filter((v): v is string => typeof v === 'string' && v !== ''),
      }))
      .filter(c => c.values.length > 0);
    if (criteria.length) {
      try {
        const r = await ngsearch(criteria, 'FILES', cap);
        const nodes = (r.nodes ?? []).slice(0, cap);
        return { items: formatNodes(nodes), hasMore: (r.pagination?.total ?? nodes.length) > nodes.length };
      } catch (err) {
        // Deliberate degradation: a failed widget query leaves only THIS
        // swimlane empty, not the whole Themenseite. Log it so it doesn't go
        // unnoticed.
        log.warn('swimlane widget query failed', { error: err instanceof Error ? err.message : String(err) });
        return null;
      }
    }
  }
  const sorted: string[] = Array.isArray(cfg?.sortedNodeIds)
    ? cfg.sortedNodeIds.map((x: any) => stripStoreRef(String(x))).filter((x: string) => !!x)
    : [];
  if (sorted.length) {
    const take = sorted.slice(0, cap);
    const nodes = await getNodesMetadata(take);
    return { items: formatNodes(nodes), hasMore: sorted.length > take.length };
  }
  const sel = cfg?.selectedNodeId ? stripStoreRef(String(cfg.selectedNodeId)) : '';
  if (sel) {
    const nodes = await getNodesMetadata([sel]);
    return { items: formatNodes(nodes), hasMore: false };
  }
  return null;
}

/**
 * Execute a topic page's swimlane widgets into real content cards.
 *
 * @param struct           parsed page-variant structure (from getTopicPageContent)
 * @param maxPerSwimlane   max content cards resolved per swimlane (≤0 → default 3)
 */
export async function resolveTopicPageSwimlanes(
  struct: TopicPageStructure,
  maxPerSwimlane: number,
): Promise<SwimlanePayload> {
  const cap = maxPerSwimlane && maxPerSwimlane > 0 ? maxPerSwimlane : 3;
  // Both caps applied once, here, so the id collection below and the per-lane
  // loop further down see the same bounded item list.
  const lanes = struct.swimlanes
    .slice(0, MAX_LANES)
    .map(sl => ({ ...sl, items: sl.items.slice(0, MAX_WIDGETS_PER_LANE) }));

  // 1. Resolve all widget nodes ONCE (in parallel) → read widget_config.
  const widgetIds = [...new Set(
    lanes.flatMap(sl => sl.items.map(it => stripStoreRef(it.nodeId)).filter(x => !!x)),
  )];
  // Only `ccm:widget_config` is read off these nodes (below), so the fan-out
  // asks for that one property instead of the default ~59-property projection.
  const widgetNodes = await getNodesMetadata(widgetIds, 8, ['ccm:widget_config']);
  const cfgById = new Map<string, any>();
  for (const wn of widgetNodes) {
    const raw = wn.properties?.['ccm:widget_config']?.[0];
    if (!raw) continue;
    try {
      const cfg = JSON.parse(raw);
      if (cfg && typeof cfg === 'object') cfgById.set(stripStoreRef(wn.ref?.id), cfg);
    } catch { /* widget without valid config */ }
  }

  // 2. Per swimlane, resolve the FIRST content-bearing widget. Bounded pool
  // (not Promise.all): a page can carry ~12 lanes and each resolution may
  // ngsearch — unbounded, the page×lane product multiplies with the caller's
  // own page pool into dozens of concurrent upstream searches (audit #10).
  const swimlanes = (await mapPool(lanes, 4, async sl => {
    const laneWidgetIds = sl.items.map(it => stripStoreRef(it.nodeId)).filter(x => !!x);
    let resolved: { items: FormattedNode[]; hasMore: boolean } | null = null;
    for (const id of laneWidgetIds) {
      const cfg = cfgById.get(id);
      if (!cfg) continue;
      resolved = await resolveWidget(cfg, cap);
      if (resolved && resolved.items.length) break;
    }
    return { heading: sl.heading, type: sl.type, items: resolved?.items ?? [], hasMore: resolved?.hasMore ?? false };
  })).filter((s): s is NonNullable<typeof s> => s !== null);

  // The pageConfigRef value doesn't matter to buildTopicPageUrl (only a truthy
  // check) → collectionId as a placeholder builds /components/topic-pages?collectionId=…
  const topicPageUrl = struct.collectionId
    ? buildTopicPageUrl(struct.collectionId, struct.collectionId)
    : null;

  return {
    variantId: struct.variantId,
    collectionId: struct.collectionId ?? null,
    variantTitle: struct.variantTitle,
    ...(struct.collectionTitle ? { collectionTitle: struct.collectionTitle } : {}),
    ...(struct.description ? { description: struct.description } : {}),
    topicPageUrl,
    swimlaneCount: swimlanes.length,
    swimlanesTotal: struct.swimlanes.length,   // capped if > MAX_LANES
    swimlanes,
  };
}
