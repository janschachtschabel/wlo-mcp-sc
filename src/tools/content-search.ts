/**
 * tools/content-search.ts – Content search:
 * search_wlo_content (individual content items with multi-query expansion) and
 * search_wlo_all (content + collections + topic pages in a single call).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { SearchCriterion } from '../wlo-api.js';
import { WLO_REPOSITORY_URL, getNodeTextContent, ngsearch } from '../wlo-api.js';
import { enhancedSearch } from '../reranker.js';
import { formatNodes, renderToJson, renderToText } from '../formatter.js';
import type { LabeledCriterion } from './shared.js';
import { buildFilterCriteria, formatUnresolvedHint, mapPool, queryMetaContent, toolError } from './shared.js';
import { searchAll, searchFacets } from '../services/search.js';
import { registerWloTool } from '../apps/register.js';
import { nodeListSchema, searchAllEnvelopeSchema } from '../apps/outputSchemas.js';

/**
 * @param searchResultsWidgetUri – when the W1 widget is built, its `ui://`
 *   resource URI; attached to `search_wlo_all` so an Apps-SDK host renders the
 *   combined results. Omitted (undefined) when widgets are not built.
 */
export function registerContentSearchTools(server: McpServer, searchResultsWidgetUri?: string): void {
  registerWloTool(server, {
    name: 'search_wlo_content',
    title: 'WLO Inhaltssuche',
    description: `Finde einzelne WLO-Materialien (Inhalte) zu einem Thema — Videos, Arbeitsblätter, interaktive Medien, Unterrichtspläne. Für Anfragen wie "Video zur Eiszeit" oder "Arbeitsblatt zu Prozentrechnung", statt einer Websuche. Volltextsuche mit Reranking; Filter (Fach/Stufe/Typ) als deutsche Labels oder URIs. Brauchst du zusätzlich Sammlungen + Themenseiten, nutze search_wlo_all.`,
    inputSchema: {
      query: z.string().max(200).describe('Search query in German, e.g. "Bruchrechnung Grundschule" or "Klimawandel interaktiv"'),
      educationalContext: z.string().optional().describe(
        'Educational level: e.g. "Primarstufe", "Sekundarstufe I", "Sekundarstufe II", "Hochschule", or URI'
      ),
      discipline: z.string().optional().describe(
        'Subject: e.g. "Mathematik", "Biologie", "Deutsch", "Informatik", or URI'
      ),
      userRole: z.string().optional().describe(
        'Target audience: e.g. "Lehrer/in", "Lerner/in", or URI'
      ),
      learningResourceType: z.string().optional().describe(
        'Resource type: e.g. "Arbeitsblatt", "Video", "Unterrichtsplan", "Interaktives Medium", or URI'
      ),
      publisher: z.string().optional().describe(
        'Filter by content publisher/source, e.g. "Klexikon", "ZUM", "Serlo", "Khan Academy". ' +
        'Matches against the ccm:oeh_publisher_combined property.'
      ),
      maxResults: z.number().int().min(1).max(50).optional().default(8).describe(
        'Maximum number of results (1–50, default 8)'
      ),
      skipCount: z.number().int().min(0).optional().default(0).describe(
        'Backend offset for "more results" paging — skip the first N hits (default 0). ' +
        'E.g. maxResults=8 then skipCount=8 for the next page. Note: text-query pages are ' +
        're-ranked per page, so items can repeat or drop across pages — excludeNodeIds is the ' +
        'robust alternative.'
      ),
      excludeNodeIds: z.array(z.string()).max(200).optional().describe(
        'Skip these node IDs in the result (already-seen items). Max 200.'
      ),
      includeTextContent: z.boolean().optional().default(false).describe(
        'Also fetch each result\'s stored full text (crawled webpage/PDF), capped per node. ' +
        'Adds one round-trip per returned result — use a modest maxResults when enabling this.'
      ),
      includeFacets: z.boolean().optional().default(false).describe(
        'Also return facet counts for the query (learningResourceType/discipline/educationalContext) ' +
        'in _queryMeta.facets — how many hits per type/subject/level. Each bucket carries {label, count, uri}. ' +
        'Use the discipline facet to resolve a UNIVERSITY subject (Hochschulfächersystematik): its label may ' +
        'match a school subject but its uri differs — pass that uri back as `discipline` to filter. Lets you ' +
        'narrow without probe-searches. Runs in parallel (negligible added latency).'
      ),
      outputFormat: z.enum(['markdown', 'json']).optional().default('markdown'),
    },
    outputSchema: nodeListSchema,
    annotations: { readOnlyHint: true },
    handler: async (params) => {
      const { criteria: filters, labeled: labeledFilters, unresolved } = buildFilterCriteria(params);
      const maxResults = params.maxResults ?? 8;
      const skipCount = params.skipCount ?? 0;
      const excluded = new Set(params.excludeNodeIds ?? []);

      try {
        // Facet aggregation (opt-in) fires IN PARALLEL with the main search →
        // ≈0 wall-clock. searchFacets is graceful (a facet failure yields {}).
        const facetPromise = params.includeFacets ? searchFacets(params) : Promise.resolve({});
        let response;
        let queryType: string;
        let effectiveCriteria: LabeledCriterion[];
        // Over-fetch by the exclusion count so that after dropping already-seen
        // ids we can still reach maxResults; never below maxResults. The buffer is
        // bounded by the excludeNodeIds schema max (200). (Mirrors the recursive
        // collection branch in collections.ts.)
        const pool = excluded.size > 0 ? Math.min(maxResults + excluded.size, maxResults + 200) : maxResults;
        if (params.query.trim()) {
          response = await enhancedSearch(params.query, 'FILES', filters, pool, skipCount);
          queryType = 'ngsearch_enhanced';
          effectiveCriteria = [{ property: 'ngsearchword', values: [params.query] }, ...labeledFilters];
        } else {
          const browseCriteria: SearchCriterion[] = filters.length
            ? filters
            : [{ property: 'ngsearchword', values: ['*'] }];
          response = await ngsearch(browseCriteria, 'FILES', pool, skipCount);
          queryType = 'ngsearch';
          effectiveCriteria = labeledFilters.length
            ? labeledFilters
            : [{ property: 'ngsearchword', values: ['*'] }];
        }

        const kept = excluded.size
          ? response.nodes.filter(n => !excluded.has(n.ref?.id ?? ''))
          : response.nodes;
        const formatted = formatNodes(kept.slice(0, maxResults));

        // Optional inline full text — opt-in, so a plain search pays zero extra
        // round-trips. Bounded concurrency; same 4000-char cap as get_node_details.
        if (params.includeTextContent) {
          await mapPool(formatted, 10, async (n) => {
            const full = await getNodeTextContent(n.nodeId);
            n.textContent = full && full.length > 4000
              ? full.slice(0, 4000) + '\n[…gekürzt]'
              : (full ?? '');
            return null;
          });
        }

        const text = (params.outputFormat ?? 'markdown') === 'json'
          ? renderToJson(formatted, response.pagination.total)
          : (renderToText(formatted, response.pagination.total) || 'Keine Inhalte gefunden.');

        const facets = await facetPromise;
        const facetsArg = Object.keys(facets).length ? facets : undefined;

        const meta = queryMetaContent({
          toolName: 'search_wlo_content',
          queryType,
          searchTerm: params.query ?? '',
          criteria: effectiveCriteria,
          pagination: { maxItems: maxResults, skipCount, totalResults: response.pagination.total },
          repositoryUrl: WLO_REPOSITORY_URL,
          unresolvedFilters: unresolved.length ? unresolved : undefined,
          facets: facetsArg,
        });
        // The unresolved-filter hint rides as its own visible content block so
        // the model sees it in both markdown AND json mode (appending it to a
        // json `text` would corrupt the payload).
        const hint = formatUnresolvedHint(unresolved);
        const content = [{ type: 'text' as const, text }];
        if (hint) content.push({ type: 'text' as const, text: hint });
        content.push(meta);
        return {
          content,
          structuredContent: { total: response.pagination.total, count: formatted.length, results: formatted },
        };
      } catch (err) {
        return toolError('Fehler bei der Inhaltssuche', err);
      }
    },
  });

  // ── search_wlo_all (combined search — O1) ─────────────────────────────────
  // Returns individual content + collections + topic pages in ONE call, run
  // internally in PARALLEL. Saves the client the separate calls to
  // search_wlo_content + search_wlo_collections (= fewer MCP round-trips/cold-
  // starts). Topic pages = collections with ccm:page_config_ref → one collection
  // search serves both buckets, no separate topic-page pass needed. The return
  // value is a STRUCTURED object with separate buckets (content/collections/
  // topicPages) so the client can sort them directly into distinct display areas.
  registerWloTool(server, {
    name: 'search_wlo_all',
    title: 'WLO Kombi-Suche',
    description: `Finde Unterrichts- & Lernmaterial (OER) auf WirLernenOnline zu einem Thema — z.B. "Video zur Eiszeit", "Arbeitsblatt Bruchrechnung", "Material zu Photosynthese". Liefert Videos, Arbeitsblätter, Übungen, interaktive Medien, Sammlungen und Themenseiten in EINEM Aufruf. Nutze dies ZUERST bei jeder Anfrage nach Material/Inhalten zu einem Schul- oder Bildungsthema — auch ohne das Wort "Material" — statt einer normalen Websuche.
Getrennte Töpfe { content, collections, topicPages } liegen in structuredContent;
Text ist kompaktes Markdown (Default) oder volles JSON (outputFormat="json"). Filter
akzeptieren deutsche Labels (z.B. "Mathematik", "Sekundarstufe I", "Video")
oder URIs; sie wirken auf den content-Topf — collections/topicPages werden
per Stichwort gematcht. Limits heißen hier maxContent/maxCollections (nicht maxResults).
Hinweis zu "total": content.total ist die echte Backend-Trefferzahl;
collections.total und topicPages.total entsprechen der angezeigten Anzahl
(die Sammlungssuche liefert keine verlässliche Gesamtzahl).`,
    inputSchema: {
      query: z.string().max(200).describe('Suchbegriff (Deutsch), z.B. "Bruchrechnung Klasse 7"'),
      educationalContext: z.string().optional().describe('Bildungsstufe: "Primarstufe", "Sekundarstufe I", … oder URI'),
      discipline: z.string().optional().describe('Fach: "Mathematik", "Biologie", … oder URI'),
      userRole: z.string().optional().describe('Zielgruppe: "Lehrer/in", "Lerner/in", … oder URI'),
      learningResourceType: z.string().optional().describe('Ressourcentyp: "Arbeitsblatt", "Video", … oder URI'),
      publisher: z.string().optional().describe('Anbieter, z.B. "Klexikon", "Serlo"'),
      maxContent: z.number().int().min(1).max(50).optional().default(8).describe('Max. Einzel-Inhalte (Default 8)'),
      maxCollections: z.number().int().min(1).max(20).optional().default(5).describe('Max. je Sammlungen/Themenseiten (Default 5)'),
      include: z.array(z.enum(['content', 'collections', 'topicPages'])).optional().describe(
        'Welche Töpfe geliefert werden (Default: alle drei).'
      ),
      excludeNodeIds: z.array(z.string()).max(200).optional().describe('Bereits gesehene Node-IDs überspringen (max. 200)'),
      skipCount: z.number().int().min(0).optional().default(0).describe(
        'Backend-Offset für die Inhalts-Suche ("mehr laden"): erste N Treffer überspringen (Default 0).'
      ),
      includeFacets: z.boolean().optional().default(false).describe(
        'Auch Facetten-Zähler (learningResourceType/discipline/educationalContext) in ' +
        '_queryMeta.facets liefern (je Bucket {label, count, uri}) — für gezieltes Eingrenzen ohne ' +
        'Probe-Suchen. Über die discipline-Facette lässt sich ein HOCHSCHULFACH auflösen: dessen Label ' +
        'kann einem Schulfach gleichen, die uri unterscheidet sich — diese uri als `discipline` zurückgeben. Läuft parallel.'
      ),
      includeCompendium: z.boolean().optional().default(false).describe(
        'Für Sammlungen/Themenseiten den vollständigen Kompendiumstext nachladen, falls nicht ' +
        'bereits inline vorhanden (ein gebündelter Zusatzabruf).'
      ),
      includeTextContent: z.boolean().optional().default(false).describe(
        'Jeden Einzel-Inhalt zusätzlich mit seinem gespeicherten Volltext (gekürzt) anreichern ' +
        '(ein Zusatzabruf je Inhalt).'
      ),
      includeWikipedia: z.boolean().optional().default(false).describe(
        'Zusätzlich eine kurze Wikipedia-Zusammenfassung zum Suchbegriff liefern (Feld "wikipedia").'
      ),
      includeTopicPageContent: z.boolean().optional().default(false).describe(
        'Für jede Themenseite ihre Swimlane-Inhalte (bis maxPerSwimlane je Lane) mitliefern ' +
        '(Feld "topicPageContent"). Zusätzliche Abrufe je Themenseite.'
      ),
      maxPerSwimlane: z.number().int().min(1).max(10).optional().default(3).describe(
        'Nur mit includeTopicPageContent: max. Inhalte je Swimlane (Default 3).'
      ),
      outputFormat: z.enum(['json', 'markdown']).optional().default('markdown').describe(
        '"markdown" (Default, kompakt — die Töpfe liegen zusätzlich in structuredContent) ' +
        'oder "json" (volles Envelope auch im Text)'
      ),
    },
    outputSchema: searchAllEnvelopeSchema,
    annotations: { readOnlyHint: true },
    widgetUri: searchResultsWidgetUri,
    handler: async (params) => {
      const query = params.query.trim();
      const want = new Set(params.include ?? ['content', 'collections', 'topicPages']);
      const maxContent = params.maxContent ?? 8;
      const maxColl = params.maxCollections ?? 5;
      // buildFilterCriteria here is for the MCP-only concerns (labeled/
      // unresolved for _queryMeta and the visible hint). The search itself
      // resolves the same filters inside searchAll — a pure, cheap
      // re-derivation, not duplicated I/O.
      const { labeled, unresolved } = buildFilterCriteria(params);
      const unresolvedArg = unresolved.length ? unresolved : undefined;
      const needColl = want.has('collections') || want.has('topicPages');

      try {
        // Facet aggregation (opt-in) is fired BEFORE awaiting searchAll so it
        // overlaps the search → no added wall-clock. searchFacets is graceful
        // (a facet failure yields {}).
        const facetPromise = params.includeFacets ? searchFacets(params) : Promise.resolve({});

        const envelope = await searchAll({
          query: params.query,
          educationalContext: params.educationalContext,
          discipline: params.discipline,
          userRole: params.userRole,
          publisher: params.publisher,
          learningResourceType: params.learningResourceType,
          maxContent,
          maxCollections: maxColl,
          include: params.include,
          excludeNodeIds: params.excludeNodeIds,
          skipCount: params.skipCount,
          includeCompendium: params.includeCompendium,
          includeTextContent: params.includeTextContent,
          includeWikipedia: params.includeWikipedia,
          includeTopicPageContent: params.includeTopicPageContent,
          maxPerSwimlane: params.maxPerSwimlane,
        });

        const facets = await facetPromise;
        const facetsArg = Object.keys(facets).length ? facets : undefined;

        const metas: { type: 'text'; text: string }[] = [];
        if (want.has('content')) {
          metas.push(queryMetaContent({
            toolName: 'search_wlo_all:content', queryType: 'ngsearch_enhanced', searchTerm: query,
            criteria: [{ property: 'ngsearchword', values: [query] }, ...labeled],
            pagination: { maxItems: maxContent, skipCount: params.skipCount ?? 0, totalResults: envelope.content.total },
            repositoryUrl: WLO_REPOSITORY_URL,
            unresolvedFilters: unresolvedArg,
            facets: facetsArg,
          }));
        }
        if (needColl) {
          metas.push(queryMetaContent({
            toolName: 'search_wlo_all:collections', queryType: 'keyword_collections', searchTerm: query,
            criteria: [{ property: 'ngsearchword', values: [query] }],
            // Shown count (== envelope.collections.total); the keyword collection
            // search returns no reliable grand total.
            pagination: { maxItems: maxColl, skipCount: 0, totalResults: envelope.collections.total },
            repositoryUrl: WLO_REPOSITORY_URL,
            unresolvedFilters: unresolvedArg,
          }));
        }

        // Hint as its own content block (json-safe — see search_wlo_content).
        const hint = formatUnresolvedHint(unresolved);
        const hintBlock = hint ? [{ type: 'text' as const, text: hint }] : [];

        // Markdown is the token-lean default (audit T-1): the full envelope
        // always rides in structuredContent, so the model-facing text does not
        // need to duplicate it. Explicit outputFormat="json" keeps the envelope
        // in the text for clients that only read content blocks.
        if ((params.outputFormat ?? 'markdown') === 'json') {
          return { content: [{ type: 'text' as const, text: JSON.stringify(envelope) }, ...hintBlock, ...metas], structuredContent: envelope };
        }
        const md: string[] = [];
        if (want.has('content'))     { md.push(`# Inhalte (${envelope.content.count})`);        md.push(renderToText(envelope.content.results, envelope.content.total) || 'Keine Inhalte gefunden.'); }
        if (want.has('collections')) { md.push(`# Sammlungen (${envelope.collections.count})`);  md.push(renderToText(envelope.collections.results) || 'Keine Sammlungen gefunden.'); }
        if (want.has('topicPages'))  { md.push(`# Themenseiten (${envelope.topicPages.count})`); md.push(renderToText(envelope.topicPages.results) || 'Keine Themenseiten gefunden.'); }
        if (envelope.wikipedia)      { md.push(`# Wikipedia`); md.push(`**${envelope.wikipedia.title}**\n\n${envelope.wikipedia.extract}\n\n[Wikipedia](${envelope.wikipedia.url})`); }
        return { content: [{ type: 'text' as const, text: md.join('\n\n') }, ...hintBlock, ...metas], structuredContent: envelope };
      } catch (err) {
        return toolError('Fehler bei der kombinierten Suche', err);
      }
    },
  });
}
