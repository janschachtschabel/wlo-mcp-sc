/**
 * tools/topic-pages.ts – search_wlo_topic_pages:
 * Find Themenseiten (by collection, by topic, or as a full list), then hand the
 * raw variants to the presentation layer (merge + render). This file owns the
 * mode dispatch and upstream I/O; merge/sort/render live in topic-pages-present.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { WloNode } from '../wlo-api.js';
import {
  WLO_REPOSITORY_URL,
  WLO_TOPIC_POOL,
  buildTopicPageUrl,
  stripStoreRef,
} from '../wlo-api.js';
import type { TargetGroup, ThemePageInfo, TopicPageOwnerCache } from '../topic-page-api.js';
import {
  getCollectionThemePages,
  getTopicPageContent,
  resolveVariantCollection,
  searchPageVariants,
} from '../topic-page-api.js';
import { labelFromUri, resolveVocab } from '../vocabs.js';

// Mode B bound: each candidate costs one metadata fetch (plus one children
// fetch when it has a page config), so cap the merged portal+keyword set.
const MODE_B_CANDIDATE_MAX = 12;
import type { LabeledCriterion } from './shared.js';
import { mapPool, queryMetaContent, toolError } from './shared.js';
import { findTopicPagesByQuery, resolveTopicPageSwimlanes } from '../services/topic-page.js';
import type { PresentedThemePage } from './topic-pages-present.js';
import { mergeThemePages, renderThemePages } from './topic-pages-present.js';

/**
 * Mode C candidate pool. Variants of ONE Themenseite (teacher / learner /
 * general) merge into a single entry, so the pool must exceed maxResults — but
 * a page carries at most those three, which bounds it at `maxResults * 3`.
 * The former `max(50, maxResults * 5)` charged a 5-result request 50 variant
 * enrichments (~8 s measured, client latency report 2026-07-27); it survives
 * as the one-shot top-up for data that merges harder than the bound predicts.
 */
const MODE_C_POOL_FACTOR = 3;
const MODE_C_POOL_MIN = 10;
const modeCTopUpPool = (maxResults: number): number => Math.max(50, maxResults * 5);

/** Entries the merge step will produce from these variants. */
function entryCount(pages: ThemePageInfo[], merge: boolean): number {
  if (!merge) return pages.length;
  return new Set(pages.map(p => p.collectionId ?? p.variantId)).size;
}

/**
 * Mode C of search_wlo_topic_pages: list all Themenseiten via the page_variant
 * API and resolve each variant's owning collection to a readable title. A
 * per-batch owner cache dedupes resolution across sibling variants of the same
 * Themenseite, the variant's known primary parent skips a round-trip, and a
 * bounded pool caps concurrent upstream fetches.
 */
async function listThemePageVariants(
  tg: TargetGroup | undefined,
  educationalContext: string | undefined,
  maxResults: number,
  merge: boolean,
): Promise<ThemePageInfo[]> {
  const eduCtxUri = educationalContext
    ? resolveVocab(educationalContext, 'educationalContext') ?? educationalContext
    : undefined;
  const search = (maxItems: number) => searchPageVariants({
    isTemplate: false,
    targetGroup: tg,
    educationalContext: eduCtxUri,
  }, maxItems);

  const parentCache: TopicPageOwnerCache = new Map();
  const poolSize = Math.max(MODE_C_POOL_MIN, maxResults * MODE_C_POOL_FACTOR);
  const variants = await search(poolSize);
  const enriched = await enrichVariants(variants, parentCache);

  // A short response means upstream is exhausted, so a wider retry cannot add
  // anything — only top up when the pool was actually filled AND the merge
  // still left us short of what the caller asked for.
  if (entryCount(enriched, merge) >= maxResults || variants.length < poolSize) return enriched;

  const wider = await search(modeCTopUpPool(maxResults));
  const seen = new Set(enriched.map(r => r.variantId));
  const extra = wider.filter(v => !seen.has(v.ref?.id ?? ''));
  return enriched.concat(await enrichVariants(extra, parentCache));
}

/** Resolve each page variant to its owning collection (shared owner cache). */
async function enrichVariants(
  variants: WloNode[],
  parentCache: TopicPageOwnerCache,
): Promise<ThemePageInfo[]> {
  const enriched = await mapPool(variants, WLO_TOPIC_POOL, async (v) => {
    const vProps = v.properties ?? {};
    const variantId = v.ref?.id ?? '';
    if (!variantId) return null;
    const knownParentId = stripStoreRef(vProps['virtual:primaryparent_nodeid']?.[0]) || undefined;
    // The parent walk already yields the owner's page_config_ref — re-fetching
    // the owner's metadata just to read it back was one dead upstream call per
    // variant, i.e. half of Mode C's latency (client report 2026-07-27).
    const owner = await resolveVariantCollection(variantId, parentCache, knownParentId);
    const topicPageUrl = owner ? buildTopicPageUrl(owner.id, owner.pageConfigRef) ?? '' : '';

    return {
      variantId,
      variantName: vProps['cm:name']?.[0] || v.name || '',
      variantTitle: vProps['cclom:title']?.[0] || vProps['cm:title']?.[0] || '',
      targetGroup: vProps['ccm:page_variant_profiling_target_group']?.[0] || '',
      educationalContexts: vProps['ccm:educationalcontext'] ?? [],
      isTemplate: false,
      topicPageUrl,
      collectionId: owner?.id,
      collectionName: owner?.name,
    } satisfies ThemePageInfo;
  });
  return enriched.filter((r): r is NonNullable<typeof r> => r !== null);
}

/**
 * Dispatch the three search modes and return the raw variants plus the
 * queryType tag for the metadata block:
 *   A. collectionId → direct check of one collection's Themenseite.
 *   B. query        → search collections, then read their page configs.
 *   C. filters only → list all Themenseiten via the page_variant API.
 */
async function collectThemePages(
  params: { collectionId?: string; query?: string; educationalContext?: string; maxResults?: number },
  tg: TargetGroup | undefined,
  merge: boolean,
): Promise<{ results: ThemePageInfo[]; queryType: string }> {
  const results: ThemePageInfo[] = [];

  // ── Mode A: Direct collection check ──────────────────────────────────
  if (params.collectionId) {
    const pages = await getCollectionThemePages(params.collectionId, tg);
    results.push(...pages);
    return { results, queryType: 'topic_pages_by_collection' };
  }
  // ── Mode B: Topic-based search (collection → page_config_ref) ────────
  // The resolution core is shared with get_topic_page_content's one-step topic
  // path (services/topic-page.findTopicPagesByQuery).
  if (params.query?.trim()) {
    const pages = await findTopicPagesByQuery(params.query, tg, MODE_B_CANDIDATE_MAX);
    results.push(...pages);
    return { results: results.slice(0, (params.maxResults ?? 5) * 3), queryType: 'topic_pages_by_keyword' };
  }
  // ── Mode C: List all Themenseiten (page_variant API) ─────────────────
  results.push(...await listThemePageVariants(tg, params.educationalContext, params.maxResults ?? 5, merge));
  return { results, queryType: 'page_variant' };
}

/**
 * Build the machine-readable `_queryMeta` block for the topic-page search,
 * translating the caller's filters into labeled criteria.
 */
function buildTopicPagesMeta(
  params: { query?: string; collectionId?: string; targetGroup?: string; educationalContext?: string; maxResults?: number },
  queryType: string,
  total: number,
): { type: 'text'; text: string } {
  const tpCriteria: LabeledCriterion[] = [];
  if (params.query?.trim()) tpCriteria.push({ property: 'ngsearchword', values: [params.query] });
  if (params.collectionId) tpCriteria.push({ property: 'collectionId', values: [params.collectionId] });
  if (params.targetGroup) {
    const tgLabel = labelFromUri(params.targetGroup, 'targetGroup');
    tpCriteria.push({ property: 'targetGroup', values: [params.targetGroup], label: tgLabel });
  }
  if (params.educationalContext) {
    const eduUri = resolveVocab(params.educationalContext, 'educationalContext') ?? params.educationalContext;
    tpCriteria.push({ property: 'ccm:educationalcontext', values: [eduUri], label: params.educationalContext });
  }
  return queryMetaContent({
    toolName: 'search_wlo_topic_pages',
    queryType,
    searchTerm: params.query ?? '',
    criteria: tpCriteria,
    pagination: { maxItems: params.maxResults ?? 5, skipCount: 0, totalResults: total },
    repositoryUrl: WLO_REPOSITORY_URL,
  });
}

export function registerTopicPageSearchTool(server: McpServer): void {
  server.tool(
    'search_wlo_topic_pages',
    `Search for Themenseiten (topic pages) on WirLernenOnline.
Themenseiten are curated page layouts with swimlanes, tailored to different target groups
(Lehrkräfte, Lernende, Allgemein). They are linked to Sammlungen (collections).

Three search modes:
1. By collectionId: Direct check whether a specific collection has a Themenseite.
2. By topic (query): Searches collections first, then checks which ones have a Themenseite.
3. By filters only (no query): Lists Themenseiten, optionally filtered by target group or educational context.

Output:
- Each result is titled by its OWNING COLLECTION; if that can't be resolved, the page
  variant's own title (cm:title) is used, never a cryptic "PAGE_VARIANT_xxx" id.
- Multiple variants of the same Themenseite (different target groups) are merged into one entry.
- Target groups are returned as readable labels ("Lehrkräfte"), not slugs.

Filters: this tool has NO "discipline" (Fach) parameter — narrow by
educationalContext and targetGroup here, or use search_wlo_collections /
search_wlo_content for subject filtering. Unknown parameters are ignored.
Passing educationalContext also makes this call markedly faster, because it
narrows the candidate set upstream.

Order: deterministic. With a query, results default to relevance order (reranked);
without a query they are sorted alphabetically by collection name with nodeId as tie-breaker.`,
    {
      query: z.string().optional().default('').describe(
        'Thematic search query in German, e.g. "Physik" or "Farben". ' +
        'Searches collections and checks for linked Themenseiten. Leave empty to list all.'
      ),
      targetGroup: z.enum(['teacher', 'learner', 'general']).optional().describe(
        'Target audience: "teacher" (Lehrkräfte), "learner" (Lernende), "general" (Allgemein)'
      ),
      educationalContext: z.string().optional().describe(
        'Educational level: e.g. "Grundschule", "Sekundarstufe I", "Schule", or full URI'
      ),
      collectionId: z.string().optional().describe(
        'Directly check a specific collection (nodeId) for its Themenseite. ' +
        'Bypasses the search – useful when you already have a collection from search_wlo_collections.'
      ),
      mergeVariants: z.boolean().optional().default(true).describe(
        'When true (default), multiple variants of the same Themenseite (different target groups) ' +
        'are merged into a single entry with all variant URLs listed.'
      ),
      sort: z.enum(['relevance', 'alpha']).optional().describe(
        'Default: "relevance" when a query is given (keeps the reranked search order), ' +
        '"alpha" otherwise. NOTE: "alpha" sorts the fetched candidate set, not the ' +
        'whole catalogue — it is a deterministic order, not a global A-Z index.'
      ),
      maxResults: z.number().int().min(1).max(20).optional().default(5),
      includeContent: z.boolean().optional().default(false).describe(
        'JSON only: resolve and attach each Themenseite\'s swimlane content ' +
        '(heading + up to maxPerSwimlane real cards per lane) as a "content" field, ' +
        'so you get the page structure in the same call. Adds bounded extra fetches per page.'
      ),
      maxPerSwimlane: z.number().int().min(1).max(10).optional().default(3).describe(
        'Only with includeContent: max real content cards resolved per swimlane (default 3).'
      ),
      outputFormat: z.enum(['markdown', 'json']).optional().default('markdown').describe(
        '"markdown" (default) or "json" (structured)'
      ),
    },
    { readOnlyHint: true },
    async (params) => {
      const tg = params.targetGroup as TargetGroup | undefined;
      // For a topic query, default = relevance (uses the collection reranking);
      // for pure listing (Mode C, no query) it stays alphabetical.
      const sort = params.sort ?? (params.query?.trim() ? 'relevance' : 'alpha');
      const merge = params.mergeVariants !== false;

      try {
        const { results, queryType } = await collectThemePages(params, tg, merge);

        if (results.length === 0) {
          const hint = params.query
            ? `Keine Themenseiten für "${params.query}" gefunden. Die Sammlung hat möglicherweise keine konfigurierte Themenseite (ccm:page_config_ref fehlt).`
            : 'Keine Themenseiten gefunden.';
          return { content: [{ type: 'text' as const, text: hint }] };
        }

        const out = mergeThemePages(results, { merge, sort, maxResults: params.maxResults ?? 5 });

        // Optional swimlane content per page (JSON mode only): resolve each
        // Themenseite's structure via the shared resolver, bounded to ≤5 in
        // flight so a wide result set can't fan out into an upstream avalanche.
        if (params.includeContent && params.outputFormat === 'json') {
          await mapPool(out, 5, async (p: PresentedThemePage) => {
            const { structure } = await getTopicPageContent({ collectionId: p.collectionId });
            if (structure) p.content = await resolveTopicPageSwimlanes(structure, params.maxPerSwimlane ?? 3);
            return null;
          });
        }

        const tpMeta = buildTopicPagesMeta(params, queryType, out.length);
        return renderThemePages(out, tpMeta, params.outputFormat);
      } catch (err) {
        return toolError('Fehler bei der Themenseiten-Suche', err);
      }
    },
  );
}
