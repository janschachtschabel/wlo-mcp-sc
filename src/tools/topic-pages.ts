/**
 * tools/topic-pages.ts – search_wlo_topic_pages:
 * Find Themenseiten (by collection, by topic, or as a full list), then hand the
 * raw variants to the presentation layer (merge + render). This file owns the
 * mode dispatch and upstream I/O; merge/sort/render live in topic-pages-present.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { WLO_REPOSITORY_URL } from '../wlo-api.js';
import type { TargetGroup } from '../topic-page-variant.js';
import { getTopicPageContent } from '../topic-page-structure.js';
import { labelFromUri } from '../vocabs.js';
import { registerWloTool } from '../apps/register.js';
import { nodeListSchema } from '../apps/outputSchemas.js';
import type { LabeledCriterion } from '../filter-criteria.js';
import { buildFilterCriteria, formatUnresolvedHint } from '../filter-criteria.js';
import { queryMetaContent, toolError } from './shared.js';
import { cachedRegistriesFor } from '../services/skill-registry-cache.js';
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
  params: { query?: string; collectionId?: string; withinCollectionId?: string; targetGroup?: string; educationalContext?: string; maxResults?: number },
  queryType: string,
  total: number,
  eduUri: string | undefined,
): { type: 'text'; text: string } {
  const tpCriteria: LabeledCriterion[] = [];
  // Only what the DISPATCHED mode used. Three of the four modes ignore
  // parameters the caller may have passed alongside — the dispatch takes the
  // most specific one and drops the rest — and `criteria` is the machine-
  // readable statement of what was searched. Listing an `ngsearchword` that
  // never reached the repository makes a downstream consumer misreport the
  // query as a full-text search.
  const usedQuery = queryType === 'topic_pages_by_keyword' && !!params.query?.trim();
  if (usedQuery) tpCriteria.push({ property: 'ngsearchword', values: [params.query!] });
  if (queryType === 'topic_pages_by_collection' && params.collectionId) {
    tpCriteria.push({ property: 'collectionId', values: [params.collectionId] });
  }
  if (queryType === 'topic_pages_below_collection' && params.withinCollectionId) {
    tpCriteria.push({ property: 'virtual:parent_recursive', values: [params.withinCollectionId] });
  }
  if (params.targetGroup) {
    const tgLabel = labelFromUri(params.targetGroup, 'targetGroup');
    tpCriteria.push({ property: 'targetGroup', values: [params.targetGroup], label: tgLabel });
  }
  // The RESOLVED uri, handed in — not re-derived. A value the vocabulary could
  // not resolve is dropped from the search, so listing it here would state a
  // narrowing that never happened, which is the same defect the comment above
  // describes for `ngsearchword`.
  if (params.educationalContext && eduUri) {
    tpCriteria.push({ property: 'ccm:educationalcontext', values: [eduUri], label: params.educationalContext });
  }
  return queryMetaContent({
    toolName: 'search_wlo_topic_pages',
    queryType,
    searchTerm: usedQuery ? params.query! : '',
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
    description: `Finde Themenseiten auf WirLernenOnline (WLO) — für „gibt es eine Themenseite zu Optik", „welche Themenseiten gibt es für die Grundschule".
Eine Themenseite IST eine Sammlung, die zusätzlich ein kuratiertes Seiten-Layout trägt (Schwimmlinien, nach Zielgruppe: Lehrkräfte, Lernende, Allgemein). Jede Themenseite ist eine Sammlung, aber nur manche Sammlungen haben eine — dieses Werkzeug liefert also eine TEILMENGE von search_wlo_collections. Wenn irgendeine Sammlung genügt, nimm jenes; wenn es um Material geht, search_wlo_all.

Vier Modi: collectionId (hat DIESE Sammlung eine Themenseite?), withinCollectionId (alle Themenseiten UNTERHALB einer Sammlung, z. B. eines Fachportals), query (Thema — sucht Sammlungen und prüft, welche eine haben), oder nur Filter (Zielgruppe/Bildungsstufe).
Kein „discipline"-Parameter: über educationalContext und targetGroup eingrenzen. Varianten einer Themenseite werden zusammengefasst; die erste ist die, die die Seite anzeigt (\`isDefault\`). Reihenfolge deterministisch.`,
    inputSchema: {
      query: z.string().optional().default('').describe(
        'Thematic search query in German, e.g. "Physik" or "Farben". ' +
        'Searches collections and checks for linked Themenseiten. Leave empty to list all.'
      ),
      targetGroup: z.enum(['teacher', 'learner', 'general']).optional().describe(
        'Target audience: "teacher" (Lehrkräfte), "learner" (Lernende), "general" (Allgemein). ' +
        'Variants that declare NO target group are kept — the field is unset on ~90 % of WLO ' +
        'topic pages, so excluding them would hide most of the catalogue.'
      ),
      educationalContext: z.string().optional().describe(
        'Educational level: e.g. "Grundschule", "Sekundarstufe I", "Schule", or full URI. ' +
        'Variants that declare no educational context are kept, for the same reason as targetGroup.'
      ),
      collectionId: z.string().optional().describe(
        'Directly check a specific collection (nodeId) for its Themenseite. ' +
        'Bypasses the search – useful when you already have a collection from search_wlo_collections.'
      ),
      withinCollectionId: z.string().optional().describe(
        'List every Themenseite BELOW this collection (nodeId), including its ' +
        'sub-collections — e.g. all topic pages of the Physik portal. Unlike ' +
        'collectionId, which only checks that one collection. Takes precedence ' +
        'over query; collectionId wins over both.'
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
      // The label→URI mapping belongs here; everything below compares URIs. A
      // value that does not resolve is DROPPED, not passed on raw: raw text
      // never equals a URI, so it used to hide every variant that declares a
      // context and keep only those that declare none — a typo turned into a
      // silent, wrong narrowing. `buildFilterCriteria` is the one place that
      // rule lives (same property, same "did you mean" suggestions), so the
      // resolution is borrowed from it rather than repeated.
      const { criteria: eduCriteria, unresolved } = buildFilterCriteria({
        educationalContext: params.educationalContext,
      });
      const filters = {
        targetGroup: params.targetGroup as TargetGroup | undefined,
        educationalContext: eduCriteria[0]?.values[0],
      };
      const unresolvedHint = formatUnresolvedHint(unresolved);
      const unresolvedBlock = unresolvedHint
        ? [{ type: 'text' as const, text: unresolvedHint }]
        : [];
      // For a topic query, default = relevance (uses the collection reranking);
      // for pure listing (Mode C, no query) it stays alphabetical.
      const sort = params.sort ?? (params.query?.trim() ? 'relevance' : 'alpha');
      const merge = params.mergeVariants !== false;

      try {
        const { results, queryType } = await collectThemePages(params, filters);

        if (results.length === 0) {
          const hint = params.query
            ? `Keine Themenseiten für "${params.query}" gefunden. Die Sammlung hat möglicherweise keine konfigurierte Themenseite (ccm:page_config_ref fehlt).`
            : 'Keine Themenseiten gefunden.';
          // A miss still satisfies the schema, so the widget shows its empty
          // state instead of the host failing on a missing structuredContent.
          return {
            // An ignored filter matters MOST here: "keine Themenseiten" plus a
            // typo the caller cannot see is the pair that sends someone looking
            // for pages that exist.
            content: [{ type: 'text' as const, text: hint }, ...unresolvedBlock],
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
            //
            // Only when we KNOW it is the one the page renders. A collection can
            // own several page-config folders and the listing may have resolved
            // none of the active one's variants (measured live 2026-08-07), and
            // then `variants[0]` is an arbitrary superseded copy. Handing over no
            // variant costs one round-trip and takes the authoritative chain:
            // collection → ccm:page_config_ref → ccm:page_config.default.
            const rendered = p.variants.find(v => v.isDefault)?.variantId;
            const { structure } = await getTopicPageContent({
              collectionId: p.collectionId,
              variantId: rendered || undefined,
            });
            if (structure) p.content = await resolveTopicPageSwimlanes(structure, params.maxPerSwimlane ?? 3);
            return null;
          });
        }

        const tpMeta = buildTopicPagesMeta(params, queryType, out.length, filters.educationalContext);
        // Cache only, like the browse tools: this listing carries up to 20 pages
        // and paying a children listing for each on first contact is the crawl
        // the cache exists to prevent. What it does not know is queued.
        //
        // Attached to the page, not handed to the renderer, so the Markdown
        // listing, the JSON payload and `structuredContent` read one field.
        const registries = cachedRegistriesFor(out.map(p => p.collectionId));
        for (const page of out) {
          const registry = registries.get(page.collectionId);
          if (registry) page.skillRegistry = registry;
        }
        const rendered = renderThemePages(out, tpMeta, params.outputFormat);
        return {
          content: [...rendered.content, ...unresolvedBlock],
          structuredContent: themePagesAsNodeList(out),
        };
      } catch (err) {
        return toolError('Fehler bei der Themenseiten-Suche', err);
      }
    },
  });
}
