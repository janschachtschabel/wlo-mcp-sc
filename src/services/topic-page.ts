/**
 * services/topic-page.ts – Topic-page swimlane resolution.
 *
 * Turns a parsed `TopicPageStructure` into RENDER-READY swimlanes: each
 * swimlane's dynamic WIDGET nodes (ccm:map with ccm:widget_config = saved
 * query / node list / single node) are EXECUTED into real content cards.
 * Extracted from the get_topic_page_content tool so search_wlo_all and
 * search_wlo_topic_pages can reuse the exact same resolution.
 */

import type { SearchCriterion } from '../wlo-api.js';
import { buildTopicPageUrl, getNodesMetadata, ngsearch, stripStoreRef } from '../wlo-api.js';
import type { TopicPageStructure } from '../topic-page-api.js';
import type { FormattedNode } from '../formatter.js';
import { formatNodes } from '../formatter.js';
import { log } from '../logger.js';
import { mapPool } from '../tools/shared.js';

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
  topicPageUrl: string | null;
  swimlaneCount: number;
  /** Total swimlanes on the page (may exceed swimlaneCount when capped). */
  swimlanesTotal: number;
  swimlanes: ResolvedSwimlane[];
}

/** Cap on resolved swimlanes per call → bounded upstream call count. */
const MAX_LANES = 12;

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
  const lanes = struct.swimlanes.slice(0, MAX_LANES);

  // 1. Resolve all widget nodes ONCE (in parallel) → read widget_config.
  const widgetIds = [...new Set(
    lanes.flatMap(sl => sl.items.map(it => stripStoreRef(it.nodeId)).filter(x => !!x)),
  )];
  const widgetNodes = await getNodesMetadata(widgetIds);
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
    topicPageUrl,
    swimlaneCount: swimlanes.length,
    swimlanesTotal: struct.swimlanes.length,   // capped if > MAX_LANES
    swimlanes,
  };
}
