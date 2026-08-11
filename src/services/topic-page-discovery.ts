/**
 * services/topic-page-discovery.ts – the three ways a Themenseite is found.
 *
 * Split out of `tools/topic-pages.ts`: this owns the discovery orchestration —
 * which upstream calls each mode makes, how wide the candidate pool is, and how
 * variants are enriched to their owning collection — while the tool module owns
 * the schema, the dispatch of the caller's parameters and the rendering. The
 * bounds here are measured against live data and change when the repository's
 * data does; the tool contract changes for entirely different reasons.
 */

import type { WloNode } from '../wlo-api.js';
import { WLO_TOPIC_POOL, buildTopicPageUrl, stripStoreRef } from '../wlo-api.js';
import type { ThemePageInfo, VariantFilters } from '../topic-page-variant.js';
import { variantFields, variantMatchesFilters } from '../topic-page-variant.js';
import { orderVariants } from '../topic-page-config.js';
import {
  getCollectionThemePages,
  resolvePageFolder,
  resolveVariantCollection,
  searchPageVariants,
} from '../topic-page-api.js';
import { mapPool } from '../concurrency.js';
import { log } from '../logger.js';
import { findTopicPagesByQuery } from './topic-page.js';

// Mode B bound: each candidate costs one metadata fetch (plus one children
// fetch when it has a page config), so cap the merged portal+keyword set.
const MODE_B_CANDIDATE_MAX = 12;

/**
 * How many variants the listing fetches in its ONE search. The profiling
 * filters are applied locally now (see `variantMatchesFilters`), so the pool
 * has to be wide enough to survive that filtering — and it costs one request
 * regardless of size, unlike the per-page owner resolution it feeds.
 *
 * The whole catalogue fits comfortably below this: 121 page variants on
 * production, 99 on staging (measured 2026-08-07).
 */
const VARIANT_SEARCH_MAX = 300;

/** Group variants by their page-config folder — one folder IS one Themenseite. */
function groupByPage(variants: WloNode[]): Map<string, WloNode[]> {
  const pages = new Map<string, WloNode[]>();
  for (const v of variants) {
    // Fall back to the variant's own id so a hit without a resolvable parent
    // still forms a group of its own instead of collapsing them all into one.
    const folder = stripStoreRef(v.properties?.['virtual:primaryparent_nodeid']?.[0]) || v.ref?.id || '';
    if (!folder) continue;
    const group = pages.get(folder);
    if (group) group.push(v); else pages.set(folder, [v]);
  }
  return pages;
}

/**
 * Mode C of search_wlo_topic_pages: list Themenseiten via the page_variant API
 * and resolve each one's owning collection to a readable title.
 *
 * The order of work is what keeps this affordable. `virtual:primaryparent_nodeid`
 * comes back on every hit and IS the merge key, so the variants are grouped into
 * pages BEFORE any owner is resolved and only the pages the caller asked for are
 * walked. Resolving first and merging afterwards — the previous behaviour — paid
 * two metadata reads for every page that the merge was about to discard, and
 * needed a pool factor plus a one-shot top-up to guess how many that would be.
 *
 * `withinCollectionId` narrows the search to a collection subtree
 * (`virtual:parent_recursive`); everything downstream is identical.
 */
async function listThemePageVariants(
  filters: VariantFilters,
  maxResults: number,
  withinCollectionId?: string,
): Promise<ThemePageInfo[]> {
  const variants = await searchPageVariants(
    { isTemplate: false, withinCollectionId },
    VARIANT_SEARCH_MAX,
  );
  if (variants.length >= VARIANT_SEARCH_MAX) {
    // A cap nobody mentions reads as completeness. The catalogue fits below
    // this today (121 production / 99 staging, measured 2026-08-07); if this
    // ever fires, the listing is no longer showing everything there is.
    log.warn('page-variant search hit its cap — the listing may be incomplete', {
      maxItems: VARIANT_SEARCH_MAX,
      ...(withinCollectionId ? { withinCollectionId } : {}),
    });
  }
  const matching = variants.filter(v => variantMatchesFilters(v.properties ?? {}, filters));

  // Resolve in waves until enough DISTINCT Themenseiten are in hand. Grouping
  // can only key on the page-config folder — that is all a search hit carries —
  // while the merge downstream keys on the owning COLLECTION, and a collection
  // may hold several folders (measured live 2026-08-07: one production
  // collection holds three, so a request for 20 pages returned 19). Every wave
  // works from the search result already in memory, so closing that gap costs
  // no further search; the common case (one folder per collection) resolves in
  // a single wave.
  const groups = [...groupByPage(matching).values()];
  const out: ThemePageInfo[] = [];
  const pagesSeen = new Set<string>();
  let next = 0;
  while (next < groups.length && pagesSeen.size < maxResults) {
    const wave = groups.slice(next, next + (maxResults - pagesSeen.size));
    next += wave.length;
    for (const page of await mapPool(wave, WLO_TOPIC_POOL, enrichPage)) {
      if (!page?.length) continue;
      out.push(...page);
      // Same key the presentation layer merges on, so the counts agree.
      pagesSeen.add(page[0].collectionId ?? page[0].variantId);
    }
  }
  return out;
}

/**
 * Resolve ONE Themenseite: walk its page-config folder up to the owning
 * collection once, then describe every variant of that page with the result.
 *
 * The group is a single page_config folder by construction, so the owner walk
 * runs once for all of its variants — the memo that used to do that job across
 * a flat variant list is no longer needed.
 */
async function enrichPage(group: WloNode[]): Promise<ThemePageInfo[]> {
  const first = group[0];
  const seedId = first?.ref?.id ?? '';
  if (!seedId) return [];
  const folderId = stripStoreRef(first.properties?.['virtual:primaryparent_nodeid']?.[0]);

  // One folder read yields BOTH the owner walk and the variant order. Without a
  // known folder — the property is absent from the hit — fall back to the walk
  // that starts at the variant; there is then no config to order by either.
  // The walk already carries the owner's page_config_ref out, so no further
  // fetch is needed for the URL (Mode-C latency, client report 2026-07-27).
  const { owner, config } = folderId
    ? await resolvePageFolder(folderId)
    : { owner: await resolveVariantCollection(seedId), config: { order: [], defaultId: '' } };
  const topicPageUrl = owner ? buildTopicPageUrl(owner.id, owner.pageConfigRef) ?? '' : '';

  const ordered = group.length > 1 ? orderVariants(group, config) : group;
  // A collection can hold several page-config folders while its own
  // `ccm:page_config_ref` names the ACTIVE one. A variant in a superseded
  // folder is listed — dropping it would lose pages whose only folder is one —
  // but it is not what the page renders, so it is not marked as such.
  const isActiveFolder = !!owner && stripStoreRef(owner.pageConfigRef) === folderId;

  return ordered.flatMap((v, index) => {
    // The variant's OWN fields come from the one shared projection, so a mode
    // cannot describe a variant differently from how the other mode does — the
    // difference would be a property of how the caller asked, not of the page.
    const fields = variantFields(v);
    if (!fields.variantId) return [];
    return [{
      ...fields,
      topicPageUrl,
      collectionId: owner?.id,
      collectionName: owner?.name,
      isDefault: index === 0 && isActiveFolder,
    } satisfies ThemePageInfo];
  });
}

/**
 * Dispatch the four search modes and return the raw variants plus the
 * queryType tag for the metadata block:
 *   A. collectionId        → direct check of one collection's Themenseite.
 *   D. withinCollectionId  → every Themenseite in a collection SUBTREE.
 *   B. query               → search collections, then read their page configs.
 *   C. filters only        → list all Themenseiten via the page_variant API.
 *
 * The order is the dispatch order: the most specific instruction the caller
 * gave wins, and a caller who passes both an exact and a subtree id gets the
 * exact check.
 */
export async function collectThemePages(
  params: { collectionId?: string; withinCollectionId?: string; query?: string; maxResults?: number },
  filters: VariantFilters,
): Promise<{ results: ThemePageInfo[]; queryType: string }> {
  const maxResults = params.maxResults ?? 5;

  // ── Mode A: Direct collection check ──────────────────────────────────
  if (params.collectionId) {
    return {
      results: await getCollectionThemePages(params.collectionId, filters),
      queryType: 'topic_pages_by_collection',
    };
  }
  // ── Mode D: Everything below one collection (virtual:parent_recursive) ─
  if (params.withinCollectionId) {
    return {
      results: await listThemePageVariants(filters, maxResults, params.withinCollectionId),
      queryType: 'topic_pages_below_collection',
    };
  }
  // ── Mode B: Topic-based search (collection → page_config_ref) ────────
  // The resolution core is shared with get_topic_page_content's one-step topic
  // path (services/topic-page.findTopicPagesByQuery).
  if (params.query?.trim()) {
    const pages = await findTopicPagesByQuery(params.query, filters, MODE_B_CANDIDATE_MAX);
    return { results: pages.slice(0, maxResults * 3), queryType: 'topic_pages_by_keyword' };
  }
  // ── Mode C: List all Themenseiten (page_variant API) ─────────────────
  return {
    results: await listThemePageVariants(filters, maxResults),
    queryType: 'page_variant',
  };
}
