/**
 * tools/topic-pages.ts – search_wlo_topic_pages:
 * Find Themenseiten (by collection, by topic, or as a full list), then hand the
 * raw variants to the presentation layer (merge + render). This file owns the
 * mode dispatch and upstream I/O; merge/sort/render live in topic-pages-present.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { WLO_REPOSITORY_URL } from '../wlo-api.js';
import type { TargetGroup } from '../topic-page-api.js';
import { getTopicPageContent } from '../topic-page-structure.js';
import { labelFromUri, resolveVocab } from '../vocabs.js';
import { registerWloTool } from '../apps/register.js';
import { nodeListSchema } from '../apps/outputSchemas.js';
import type { LabeledCriterion } from '../filter-criteria.js';
import { queryMetaContent, toolError } from './shared.js';
import { mapPool } from '../concurrency.js';
import { resolveTopicPageSwimlanes } from '../services/topic-page.js';
import { collectThemePages } from '../services/topic-page-discovery.js';
import type { PresentedThemePage } from './topic-pages-present.js';
import { mergeThemePages, renderThemePages, themePagesAsNodeList } from './topic-pages-present.js';

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

export function registerTopicPageSearchTool(server: McpServer, searchResultsWidgetUri?: string): void {
  registerWloTool(server, {
    name: 'search_wlo_topic_pages',
    title: 'WLO Themenseiten-Suche',
    widgetUri: searchResultsWidgetUri,
    description: `Search for Themenseiten (topic pages) on WirLernenOnline.
A Themenseite IS a Sammlung (collection) that additionally carries a curated page layout —
swimlanes, tailored to different target groups (Lehrkräfte, Lernende, Allgemein). Every
Themenseite is a collection, but only some collections have one, so this tool returns a
SUBSET of what search_wlo_collections returns. Use that one when any collection will do.

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
    inputSchema: {
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
    outputSchema: nodeListSchema,
    annotations: { readOnlyHint: true },
    handler: async (params) => {
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
          // A miss still satisfies the schema, so the widget shows its empty
          // state instead of the host failing on a missing structuredContent.
          return {
            content: [{ type: 'text' as const, text: hint }],
            structuredContent: { total: 0, count: 0, results: [] },
          };
        }

        const out = mergeThemePages(results, { merge, sort, maxResults: params.maxResults ?? 5 });

        // Optional swimlane content per page (JSON mode only): resolve each
        // Themenseite's structure via the shared resolver, bounded to ≤5 in
        // flight so a wide result set can't fan out into an upstream avalanche.
        if (params.includeContent && params.outputFormat === 'json') {
          await mapPool(out, 5, async (p: PresentedThemePage) => {
            // The variant id is already in hand from the merge — passing it lets
            // getTopicPageContent read variant and collection in parallel
            // instead of walking the page-config folder (measured 1238 → 774 ms).
            const { structure } = await getTopicPageContent({
              collectionId: p.collectionId,
              variantId: p.variants[0]?.variantId || undefined,
            });
            if (structure) p.content = await resolveTopicPageSwimlanes(structure, params.maxPerSwimlane ?? 3);
            return null;
          });
        }

        const tpMeta = buildTopicPagesMeta(params, queryType, out.length);
        return {
          ...renderThemePages(out, tpMeta, params.outputFormat),
          structuredContent: themePagesAsNodeList(out),
        };
      } catch (err) {
        return toolError('Fehler bei der Themenseiten-Suche', err);
      }
    },
  });
}
