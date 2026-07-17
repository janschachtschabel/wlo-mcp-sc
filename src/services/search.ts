/**
 * services/search.ts – Search business logic shared by MCP tools, the REST
 * layer, and widgets.
 *
 * `searchWithinCollection` runs a filtered full-text search scoped to a single
 * collection subtree (e.g. "all videos on cell division inside the Biology
 * collection"), reusing `buildFilterCriteria` for the label→URI vocab mapping.
 */

import type { SearchCriterion, WloNode } from '../wlo-api.js';
import { getCollectionContents, getNodeTextContent, ngsearch, searchCollectionsByKeyword } from '../wlo-api.js';
import { enhancedSearch, rerankNodes } from '../reranker.js';
import type { FormattedNode } from '../formatter.js';
import { formatNodes, resolveFacetCounts } from '../formatter.js';
import type { LabeledCriterion, UnresolvedFilter } from '../tools/shared.js';
import { buildFilterCriteria, mapPool } from '../tools/shared.js';
import type { WikiSummary } from '../wikipedia-api.js';
import { fetchWikipediaSummary } from '../wikipedia-api.js';
import { nodeMatchesCriteria, nodeMatchesText } from '../node-match.js';
import { log } from '../logger.js';
import { getCompendiumTexts } from './compendium.js';
import type { SwimlanePayload } from './topic-page.js';
import { resolveTopicPageSwimlanes } from './topic-page.js';
import { getTopicPageContent, searchTopicPageCollections } from '../topic-page-api.js';

export interface SearchWithinCollectionOptions {
  nodeId: string;
  query?: string;
  educationalContext?: string;
  discipline?: string;
  userRole?: string;
  publisher?: string;
  learningResourceType?: string;
  maxResults?: number;
  skipCount?: number;
}

export interface SearchWithinCollectionResult {
  nodeId: string;
  query: string;
  results: FormattedNode[];
  pagination: { total: number; from: number; count: number };
  labeled: LabeledCriterion[];
  unresolved: UnresolvedFilter[];
  /** The collection's true content count, as reported by the backend. */
  collectionTotal: number;
  /** True when the collection holds more items than the sampled window. */
  truncated: boolean;
}

/**
 * Sampling window: how many of the collection's direct children are examined —
 * the same "up to 100" bound the stats service uses, keeping this to a single
 * upstream call. `truncated` discloses when a collection exceeds it.
 */
const WITHIN_CHILDREN_MAX = 100;

export async function searchWithinCollection(
  opts: SearchWithinCollectionOptions,
): Promise<SearchWithinCollectionResult> {
  const { criteria: filters, labeled, unresolved } = buildFilterCriteria(opts);
  const query = (opts.query ?? '').trim();
  const maxResults = opts.maxResults ?? 10;
  const skipCount = opts.skipCount ?? 0;

  // The collection's own `/children` listing is the ONLY working scope: the
  // backend rejects `virtual:primaryparent_nodeid` as an ngsearch criterion
  // with 400 Bad Request (live-probed 2026-07-17 — `ngsearchword` and
  // `ccm:taxonid` are accepted, the primaryparent property is not), so the
  // previously attempted scoped search could never succeed. `/children` also
  // covers curated collections, which hold *references* to nodes whose primary
  // parent lives elsewhere and which a primaryparent search would miss anyway.
  //
  // Query and resolved vocab filters are therefore matched locally against the
  // node metadata the listing carries, and pagination runs over the filtered
  // set. The window is bounded to one upstream call; `truncated` says so.
  const children = await getCollectionContents(opts.nodeId, 'files', WITHIN_CHILDREN_MAX, 0);
  const filtered = children.nodes.filter(
    n => (!query || nodeMatchesText(n, query)) && nodeMatchesCriteria(n, filters),
  );
  const page = filtered.slice(skipCount, skipCount + maxResults);

  return {
    nodeId: opts.nodeId,
    query,
    results: formatNodes(page),
    pagination: { total: filtered.length, from: skipCount, count: page.length },
    labeled,
    unresolved,
    collectionTotal: children.pagination.total,
    truncated: children.pagination.total > children.nodes.length,
  };
}

// ── listCollectionContents: a collection's direct file children ──────────────

export interface CollectionContentsResult {
  nodeId: string;
  results: FormattedNode[];
  pagination: { total: number; from: number; count: number };
}

/**
 * List a collection's direct file contents via the `/children` endpoint. Unlike
 * `searchWithinCollection` — which tries the `virtual:primaryparent_nodeid`
 * scoped search first and only falls back to `/children` when that finds
 * nothing — this always enumerates the actual child files directly: the right
 * primitive for a plain listing (e.g. the launcher's `GET /api/collection`
 * without a query, or a skills collection).
 */
export async function listCollectionContents(
  nodeId: string,
  maxResults = 20,
  skipCount = 0,
): Promise<CollectionContentsResult> {
  const resp = await getCollectionContents(nodeId, 'files', maxResults, skipCount);
  return { nodeId, results: formatNodes(resp.nodes), pagination: resp.pagination };
}

// ── searchAll: combined content + collections + topic pages, one call ────────

/** A topic-page result may carry its resolved swimlane content when requested. */
export type TopicPageResult = FormattedNode & { topicPageContent?: SwimlanePayload };

export interface SearchAllOptions {
  query: string;
  educationalContext?: string;
  discipline?: string;
  userRole?: string;
  publisher?: string;
  learningResourceType?: string;
  maxContent?: number;
  maxCollections?: number;
  include?: ('content' | 'collections' | 'topicPages')[];
  excludeNodeIds?: string[];
  skipCount?: number;
  /** Enrichments (each opt-in, off by default; each adds bounded round-trips). */
  includeCompendium?: boolean;
  includeTextContent?: boolean;
  includeWikipedia?: boolean;
  includeTopicPageContent?: boolean;
  maxPerSwimlane?: number;
}

export interface SearchAllEnvelope {
  query: string;
  content:     { total: number; count: number; results: FormattedNode[] };
  collections: { total: number; count: number; results: FormattedNode[] };
  topicPages:  { total: number; count: number; results: TopicPageResult[] };
  wikipedia?:  WikiSummary;
}

const TEXT_CONTENT_CAP = 4000;

/** Fill each node's stored full text (bounded concurrency, capped). */
async function enrichTextContent(nodes: FormattedNode[]): Promise<void> {
  await mapPool(nodes, 10, async (n) => {
    const full = await getNodeTextContent(n.nodeId);
    n.textContent = full && full.length > TEXT_CONTENT_CAP
      ? full.slice(0, TEXT_CONTENT_CAP) + '\n[…gekürzt]'
      : (full ?? '');
    return null;
  });
}

/**
 * Gap-fill the FULL compendium text for collection/topic-page results that did
 * not carry it inline (the search projection can differ from full metadata).
 * One bulk `-all-` fetch for the missing ids only — nodes already carrying it
 * are left untouched (no redundant round-trip).
 */
async function enrichCompendium(nodes: FormattedNode[]): Promise<void> {
  const missing = nodes.filter(n => !n.compendiumText);
  if (!missing.length) return;
  const entries = await getCompendiumTexts(missing.map(n => n.nodeId));
  const byId = new Map(entries.map(e => [e.nodeId, e.compendiumText]));
  for (const n of missing) {
    const text = byId.get(n.nodeId);
    if (text) n.compendiumText = text;
  }
}

/** Attach resolved swimlane content to each topic page (bounded, capped). */
async function enrichTopicPageContent(pages: TopicPageResult[], maxPerSwimlane: number): Promise<void> {
  await mapPool(pages, 5, async (page) => {
    const struct = await getTopicPageContent({ collectionId: page.nodeId });
    if (struct) page.topicPageContent = await resolveTopicPageSwimlanes(struct, maxPerSwimlane);
    return null;
  });
}

/**
 * One-call combined search: individual content, collections, and topic pages
 * (collections with a page config), run in parallel, plus opt-in enrichments
 * (compendium / full text / Wikipedia / topic-page swimlanes). Returns the
 * structured envelope reused by the MCP tool, the REST layer, and widgets.
 *
 * `total` semantics per bucket differ ON PURPOSE: content.total is the true
 * backend hit count; collections/topicPages.total is the shown count (the
 * keyword collection search returns no reliable grand total).
 */
export async function searchAll(opts: SearchAllOptions): Promise<SearchAllEnvelope> {
  const query = (opts.query ?? '').trim();
  const want = new Set(opts.include ?? ['content', 'collections', 'topicPages']);
  const excluded = new Set(opts.excludeNodeIds ?? []);
  const maxContent = opts.maxContent ?? 8;
  const maxColl = opts.maxCollections ?? 5;
  const skipCount = opts.skipCount ?? 0;
  const { criteria: filters } = buildFilterCriteria(opts);

  const needColl = want.has('collections') || want.has('topicPages');
  const EMPTY = { nodes: [] as WloNode[], pagination: { total: 0, from: 0, count: 0 } };

  // Content search, collection search, portal match, and the optional
  // Wikipedia lookup all run in one parallel block — wall time ≈ the slowest.
  const [contentResp, collNodes, portalNodes, wiki] = await Promise.all([
    want.has('content')
      ? enhancedSearch(query, 'FILES', filters, maxContent + excluded.size, skipCount)
      : Promise.resolve(EMPTY),
    needColl
      // Degrade like the wiki leg below: a thrown collections search (timeout,
      // DNS, reset) must not discard the content results already fetched.
      ? searchCollectionsByKeyword(query, (maxColl + excluded.size) * 2).catch((err) => {
          log.warn('searchAll: collections search failed, continuing without', {
            error: err instanceof Error ? err.message : String(err),
          });
          return [] as WloNode[];
        })
      : Promise.resolve([] as WloNode[]),
    // The keyword-collections endpoint cannot surface Themenseiten (fixed
    // reduced projection without ccm:page_config_ref; the subject portals are
    // absent from its hits — live-verified 2026-07-17), so the topicPages
    // bucket is fed by the root portals matched locally against the query.
    want.has('topicPages')
      ? searchTopicPageCollections(query).catch(() => [] as WloNode[])
      : Promise.resolve([] as WloNode[]),
    opts.includeWikipedia
      ? fetchWikipediaSummary(query, 'de').catch(() => null)
      : Promise.resolve(null),
  ]);

  const ok = (id: string) => !!id && !excluded.has(id);
  const contentFmt = formatNodes(contentResp.nodes).filter(n => ok(n.nodeId)).slice(0, maxContent);
  // Merge portals into the collection pool (portal copies first: on an id
  // collision they are the ones carrying the config ref → topicPageUrl), then
  // rerank by relevance; topic pages inherit the ranking.
  const seenColl = new Set<string>();
  const collMerged = [...portalNodes, ...collNodes].filter(n => {
    const id = n.ref?.id ?? '';
    if (!id || seenColl.has(id)) return false;
    seenColl.add(id);
    return true;
  });
  const collAll = formatNodes(rerankNodes(collMerged, query)).filter(n => ok(n.nodeId));
  const topicPagesFmt: TopicPageResult[] = want.has('topicPages')
    ? collAll.filter(n => n.topicPageUrl).slice(0, maxColl)
    : [];
  const collectionsFmt = want.has('collections') ? collAll.filter(n => !n.topicPageUrl).slice(0, maxColl) : [];

  // Opt-in enrichments run in parallel once the base results are known; each
  // touches a distinct field, so they cannot conflict on shared nodes.
  await Promise.all([
    opts.includeTextContent ? enrichTextContent(contentFmt) : Promise.resolve(),
    opts.includeCompendium ? enrichCompendium([...collectionsFmt, ...topicPagesFmt]) : Promise.resolve(),
    opts.includeTopicPageContent ? enrichTopicPageContent(topicPagesFmt, opts.maxPerSwimlane ?? 3) : Promise.resolve(),
  ]);

  const envelope: SearchAllEnvelope = {
    query,
    content:     { total: contentResp.pagination.total, count: contentFmt.length, results: contentFmt },
    collections: { total: collectionsFmt.length, count: collectionsFmt.length, results: collectionsFmt },
    topicPages:  { total: topicPagesFmt.length, count: topicPagesFmt.length, results: topicPagesFmt },
  };
  if (wiki) envelope.wikipedia = wiki;
  return envelope;
}

// ── Facet aggregation (shared by the MCP search tools and the REST layer) ─────

const FACET_PROPERTIES = ['ccm:oeh_lrt_aggregated', 'ccm:taxonid', 'ccm:educationalcontext'];

export interface FacetSearchOptions {
  query?: string;
  educationalContext?: string;
  discipline?: string;
  userRole?: string;
  publisher?: string;
  learningResourceType?: string;
}

/**
 * Facet counts (learningResourceType / discipline / educationalContext) for a
 * query, keyed by filter → `{label, count, uri}` buckets (one `ngsearch` with
 * maxItems=1 — aggregation only). Graceful: a facet failure yields `{}`, so a
 * facet lookup never fails the caller. Shared by `search_wlo_content`,
 * `search_wlo_all`, and `GET /api/search` so the logic lives in one place.
 */
export async function searchFacets(
  opts: FacetSearchOptions,
): Promise<Record<string, { label: string; count: number; uri: string }[]>> {
  const { criteria: filters } = buildFilterCriteria(opts);
  const query = (opts.query ?? '').trim();
  const criteria: SearchCriterion[] = query
    ? [{ property: 'ngsearchword', values: [query] }, ...filters]
    : (filters.length ? filters : [{ property: 'ngsearchword', values: ['*'] }]);
  const resp = await ngsearch(criteria, 'FILES', 1, 0, undefined, FACET_PROPERTIES).catch(() => null);
  return resp ? resolveFacetCounts(resp.facets) : {};
}
