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
import { formatNodes, oneLine, registryHintFor, renderToJson, renderToText } from '../formatter.js';
import type { LabeledCriterion } from '../filter-criteria.js';
import { buildFilterCriteria, withDerivedResourceType, derivedResourceTypeNotice, filterByExactLicense, licenseFilterNotice, licensePagingNotice, pageSizeForLicense, formatUnresolvedHint } from '../filter-criteria.js';
import { queryMetaContent, toolError, wikiResolutionNotice } from './shared.js';
import { mapPool } from '../concurrency.js';
import { dedupeByUrl } from '../result-dedupe.js';
import { searchWithLicense } from '../services/license-search.js';
import { searchAll, searchFacets } from '../services/search.js';
import { inlineRestrictedPreviews } from '../services/preview-inline.js';
import { registerWloTool } from '../apps/register.js';
import { capText } from '../text-cap.js';
import { nodeListSchema, searchAllEnvelopeSchema } from '../apps/outputSchemas.js';

/** Same bound as `get_node_details`, so an inline text reads the same either way. */
const TEXT_CONTENT_CAP = 4000;

/**
 * @param searchResultsWidgetUri – when the W1 widget is built, its `ui://`
 *   resource URI; attached to `search_wlo_all` so an Apps-SDK host renders the
 *   combined results. Omitted (undefined) when widgets are not built.
 */
export function registerContentSearchTools(server: McpServer, searchResultsWidgetUri?: string): void {
  registerWloTool(server, {
    name: 'search_wlo_content',
    title: 'WLO Inhaltssuche',
    widgetUri: searchResultsWidgetUri,
    description: `NUR einzelne WLO-Materialien — Video, Arbeitsblatt, interaktives Medium, Unterrichtsplan — ohne Sammlungen und ohne Themenseiten. Für Anfragen, bei denen genau ein Materialtyp gefragt ist und alles andere stören würde, z.B. "ausschließlich Videos zur Zellteilung". Volltextsuche mit Reranking; Filter (Fach/Stufe/Typ) als deutsche Labels oder URIs.
IM ZWEIFEL search_wlo_all NEHMEN: das liefert Materialien UND Sammlungen UND Themenseiten in einem Aufruf und ist der Standard-Einstieg. Dieses Werkzeug ist die bewusste Verengung darauf.`,
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
        'Resource type: e.g. "Arbeitsblatt", "Video", "Unterrichtsplan", "Interaktives Medium", or URI. ' +
        'If omitted and the query names an unambiguous medium (Video, Arbeitsblatt, Übung, Bild, Simulation, Podcast), ' +
        'that type is derived automatically and disclosed in the answer.'
      ),
      publisher: z.string().optional().describe(
        'Filter by content publisher/source, e.g. "Klexikon", "ZUM", "Serlo", "Khan Academy". ' +
        'Matches against the ccm:oeh_publisher_combined property.'
      ),
      license: z.string().optional().describe(
        'Licence: "CC BY 4.0", "CC BY-SA 4.0", "gemeinfrei", the repository key ("CC_BY"), ' +
        'or "OER" for every freely reusable licence at once (CC0, public domain, CC BY, CC BY-SA — NC and ND excluded). ' +
        'Matching is EXACT: "CC BY 4.0" never returns NC or ND material. lookup_wlo_vocabulary("license") lists the values.'
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
    handler: async (rawParams) => {
      // "Arbeitsblatt KI" asks for two things: KI as the subject and worksheets
      // as the type. `query-expand.ts` strips the medium so it stops emptying
      // the result set; this is where the constraint it carried comes back —
      // as a real filter, and therefore visible in _queryMeta.
      const params = withDerivedResourceType(rawParams);
      // Set exactly when the filter came from the QUERY, not the caller — the
      // gate for both halves of the disclosure (notice + envelope field).
      const derivedType = !rawParams.learningResourceType ? params.learningResourceType : undefined;
      const { criteria: filters, labeled: labeledFilters, unresolved } = buildFilterCriteria(params);
      const maxResults = params.maxResults ?? 8;
      const skipCount = params.skipCount ?? 0;
      const excluded = new Set(params.excludeNodeIds ?? []);

      try {
        // Facet aggregation (opt-in) fires IN PARALLEL with the main search →
        // ≈0 wall-clock. The `.catch` is not redundant with searchFacets being
        // graceful: when the main search below throws, this promise is never
        // awaited, and an unhandled rejection takes down the whole process. The
        // guarantee has to be here, where the floating promise is created.
        const facetPromise = params.includeFacets
          ? searchFacets(params).catch(() => ({}))
          : Promise.resolve({});
        let response;
        let queryType: string;
        let effectiveCriteria: LabeledCriterion[];
        // Over-fetch by the exclusion count so that after dropping already-seen
        // ids we can still reach maxResults; never below maxResults. The `+200`
        // clamp is redundant TODAY — the excludeNodeIds schema already caps the
        // array at 200 — and kept as a second, local bound so raising that cap
        // cannot silently widen the upstream page. (Mirrors the recursive
        // collection branch in collections.ts.)
        const excludePool = excluded.size > 0 ? Math.min(maxResults + excluded.size, maxResults + 200) : maxResults;
        const pool = pageSizeForLicense(excludePool, params.license);
        if (params.query.trim()) {
          // Through the licence seam, which fans out over the OER bundle's keys.
          // Everything else — a single licence, no licence — passes straight to
          // the same call as before (see services/license-search.ts).
          response = await searchWithLicense({
            license: params.license,
            criteria: [{ property: 'ngsearchword', values: [params.query] }, ...filters],
            size: pool,
            skipCount,
            run: (extra, size, skip) => enhancedSearch(params.query, 'FILES', [...filters, ...extra], size, skip),
          });
          queryType = 'ngsearch_enhanced';
          effectiveCriteria = [{ property: 'ngsearchword', values: [params.query] }, ...labeledFilters];
        } else {
          const browseCriteria: SearchCriterion[] = filters.length
            ? filters
            : [{ property: 'ngsearchword', values: ['*'] }];
          response = await searchWithLicense({
            license: params.license,
            criteria: browseCriteria,
            size: pool,
            skipCount,
            run: (extra, size, skip) => ngsearch([...browseCriteria, ...extra], 'FILES', size, skip),
          });
          queryType = 'ngsearch';
          effectiveCriteria = labeledFilters.length
            ? labeledFilters
            : [{ property: 'ngsearchword', values: ['*'] }];
        }

        const kept = excluded.size
          ? response.nodes.filter(n => !excluded.has(n.ref?.id ?? ''))
          : response.nodes;
        // Dedupe BEFORE the cap, so maxResults distinct materials come back
        // rather than one material plus its re-imports (see result-dedupe.ts).
        // The licence pass is here for the same reason and must run before the
        // cap too — the upstream key matches a licence FAMILY, see
        // filterByExactLicense.
        const candidates = dedupeByUrl(formatNodes(kept));
        const licensed = filterByExactLicense(candidates, params.license);
        const licenceNotice = [
          licenseFilterNotice(candidates.length, licensed.length, params.license),
          licensePagingNotice(params.license, skipCount),
        ].filter(Boolean).join('\n');
        const formatted = licensed.slice(0, maxResults);

        // Optional inline full text — opt-in, so a plain search pays zero extra
        // round-trips. Bounded concurrency; same cap and cutting rule as get_node_details.
        if (params.includeTextContent) {
          await mapPool(formatted, 10, async (n) => {
            const full = await getNodeTextContent(n.nodeId);
            n.textContent = full ? capText(full, TEXT_CONTENT_CAP).text : '';
            return null;
          });
        }

        const isJson = (params.outputFormat ?? 'markdown') === 'json';
        // In markdown the notice goes INTO block 0: a measured real client
        // hands the model only the first content block (2026-08-19), and a
        // narrowing nobody asked for must not be invisible exactly there. A
        // JSON block 0 cannot take prose, so there it rides as its own block
        // below — the same split the licence notice could not have.
        const derivedNotice = derivedResourceTypeNotice(derivedType, formatted.length);
        let text = isJson
          ? renderToJson(formatted, response.pagination.total)
          : (renderToText(formatted, response.pagination.total) || 'Keine Inhalte gefunden.');
        if (!isJson && derivedNotice) text += `\n\n${derivedNotice}`;

        const facets = await facetPromise;
        const facetsArg = Object.keys(facets).length ? facets : undefined;
        // Restricted hits only (public ones never fetch): the picture the
        // browser cannot get travels in the widget-only _meta channel.
        const inlinedPreviews = await inlineRestrictedPreviews(formatted);

        const meta = queryMetaContent({
          toolName: 'search_wlo_content',
          queryType,
          searchTerm: params.query,
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
        // Rides as its own block for the same reason as `hint`: appending it to
        // a json `text` would corrupt the payload.
        if (licenceNotice) content.push({ type: 'text' as const, text: licenceNotice });
        if (isJson && derivedNotice) content.push({ type: 'text' as const, text: derivedNotice });
        content.push(meta);
        return {
          content,
          structuredContent: {
            total: response.pagination.total,
            count: formatted.length,
            results: formatted,
            ...(derivedType ? { derivedResourceType: derivedType } : {}),
          },
          // Widget-only: hosts hand result _meta to the widget, never the
          // model — the base64 must not spend the chat's context.
          ...(Object.keys(inlinedPreviews).length ? { _meta: { 'wlo/previewData': inlinedPreviews } } : {}),
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
    description: `DER EINSTIEG für alles, was Lehrkräfte für den Unterricht suchen — auf WirLernenOnline (WLO/edu-sharing). Nimm dies ZUERST und statt einer Websuche, bei jeder Anfrage dieser Art:
„ein Video zu Bruchrechnung", „Medien zum Klimawandel", „ein Arbeitsblatt zur Zellteilung", „Material für Klasse 7", „Übungen zu Photosynthese", „was gibt es zu Optik", „eine Unterrichtsstunde zur Eiszeit", „ein Erklärvideo", „ein Bild/eine Grafik/eine Simulation zu …".
Auch OHNE die Wörter „Material" oder „Bildungsinhalt" — ein Thema aus Schule, Ausbildung oder Hochschule genügt.
EIN Aufruf liefert Videos, Arbeitsblätter, Übungen, interaktive Medien, Sammlungen UND Themenseiten.
Filter: Fach, Stufe, Medientyp („nur Videos"), Anbieter, Lizenz. Will jemand NUR Einzelmaterialien eines Typs („Arbeitsblätter zu Bruchrechnung"), ist search_wlo_content die Verengung ohne Sammlungen/Themenseiten. "search" nimmt nur einen Suchbegriff (Belegstellen).
Filter nehmen deutsche Labels oder URIs. Nur content.total ist eine echte Trefferzahl.`,
    inputSchema: {
      query: z.string().max(200).describe('Suchbegriff (Deutsch), z.B. "Bruchrechnung Klasse 7"'),
      educationalContext: z.string().optional().describe('Bildungsstufe: "Primarstufe", "Sekundarstufe I", … oder URI'),
      discipline: z.string().optional().describe('Fach: "Mathematik", "Biologie", … oder URI'),
      userRole: z.string().optional().describe('Zielgruppe: "Lehrer/in", "Lerner/in", … oder URI'),
      learningResourceType: z.string().optional().describe(
        'Ressourcentyp: "Arbeitsblatt", "Video", … oder URI. Ohne Angabe wird ein eindeutiges Medienwort '
        + 'aus der query abgeleitet (Video, Arbeitsblatt, Übung, Bild, Simulation, Podcast) und in der Antwort offengelegt.'),
      publisher: z.string().optional().describe('Anbieter, z.B. "Klexikon", "Serlo"'),
      license: z.string().optional().describe('Lizenz: "CC BY 4.0", "gemeinfrei", … oder "OER" für alle frei nachnutzbaren (CC0/gemeinfrei/CC BY/CC BY-SA)'),
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
        'Für Sammlungen/Themenseiten den vollständigen Kompendiumstext nachladen (Feld ' +
        'compendiumText, ein gebündelter Zusatzabruf). Ohne diese Option tragen Treffer nur das ' +
        'Signal hasCompendium; gezielte Absätze liefert get_compendium_text mit query.'
      ),
      includeTextContent: z.boolean().optional().default(false).describe(
        'Jeden Einzel-Inhalt zusätzlich mit seinem gespeicherten Volltext (gekürzt) anreichern ' +
        '(ein Zusatzabruf je Inhalt).'
      ),
      includeSkillRegistry: z.boolean().optional().default(false).describe(
        'Die freigegebenen Skills je Sammlung JETZT frisch abrufen, statt eine gemerkte Antwort zu nehmen (die bis zu 10 Minuten alt sein kann). Kostet 2 Abrufe je Sammlung, rund 1,0–1,4 Sekunden. NICHT nötig, damit der Katalog überhaupt kommt — der ist ohnehin in der Antwort. Nur nötig, wenn gerade eine Registry angelegt oder geändert wurde.'
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
    handler: async (rawParams) => {
      // Same derivation as search_wlo_content: the medium named in the query
      // becomes a real filter (see withDerivedResourceType). FIRST thing in the
      // handler, so the search and its _queryMeta disclosure see one params.
      const params = withDerivedResourceType(rawParams);
      const query = params.query.trim();
      const want = new Set(params.include ?? ['content', 'collections', 'topicPages']);
      // Only the content leg applies the filter (searchCollections takes the
      // bare query), so the disclosure follows licenseFilter's gate: content
      // leg ran, and the type came from the query rather than the caller.
      const derivedType = want.has('content') && !rawParams.learningResourceType
        ? params.learningResourceType
        : undefined;
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
        // overlaps the search → no added wall-clock. `.catch` for the same
        // reason as in search_wlo_content: a throw from searchAll leaves this
        // promise unawaited, and an unhandled rejection ends the process.
        const facetPromise = params.includeFacets
          ? searchFacets(params).catch(() => ({}))
          : Promise.resolve({});

        const envelope = await searchAll({
          query: params.query,
          educationalContext: params.educationalContext,
          discipline: params.discipline,
          userRole: params.userRole,
          publisher: params.publisher,
          learningResourceType: params.learningResourceType,
          license: params.license,
          maxContent,
          maxCollections: maxColl,
          include: params.include,
          excludeNodeIds: params.excludeNodeIds,
          skipCount: params.skipCount,
          includeCompendium: params.includeCompendium,
          includeSkillRegistry: params.includeSkillRegistry,
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

        // The licence pass runs inside `searchAll`, so the counts come back with
        // the envelope. Same disclosure the other two search paths give: silence
        // after a filter reads as "there is nothing", which is a different claim.
        // Both notices describe the CONTENT leg — the only one `license` touches
        // — so a call that asked for collections alone gets neither. `envelope
        // .content.licenseFilter` already says exactly that (set only when a
        // licence was given AND the content leg ran), so it is the single gate
        // here and on the REST page; re-deriving it from `include` would be a
        // second copy of one rule, and copies drift apart.
        const lf = envelope.content.licenseFilter;
        const licenceNotice = !lf ? '' : [
          licenseFilterNotice(lf.checked, lf.kept, params.license),
          licensePagingNotice(params.license, params.skipCount ?? 0),
        ].filter(Boolean).join('\n');
        const licenceBlock = licenceNotice ? [{ type: 'text' as const, text: licenceNotice }] : [];

        // The derived-type disclosure, same two-channel shape as the licence
        // one: a sentence for the reader, a field beside `licenseFilter` for
        // machines. Spread rather than mutated — the service's envelope type
        // does not carry the field, and enriching BEFORE the json branch keeps
        // the text envelope and structuredContent from disagreeing.
        const derivedNotice = derivedResourceTypeNotice(derivedType, envelope.content.count);
        const enriched = derivedType
          ? { ...envelope, content: { ...envelope.content, derivedResourceType: derivedType } }
          : envelope;
        const derivedBlock = derivedNotice ? [{ type: 'text' as const, text: derivedNotice }] : [];
        // Materials only: a collection tile renders no thumbnail (block glyph,
        // early return in tile.ts), so the service would discard those anyway.
        // Public hits cost nothing here.
        const inlinedPreviews = await inlineRestrictedPreviews(envelope.content.results);
        const previewMeta = Object.keys(inlinedPreviews).length
          ? { _meta: { 'wlo/previewData': inlinedPreviews } }
          : {};

        // Markdown is the token-lean default (audit T-1): the full envelope
        // always rides in structuredContent, so the model-facing text does not
        // need to duplicate it. Explicit outputFormat="json" keeps the envelope
        // in the text for clients that only read content blocks.
        if ((params.outputFormat ?? 'markdown') === 'json') {
          return { content: [{ type: 'text' as const, text: JSON.stringify(enriched) }, ...hintBlock, ...licenceBlock, ...derivedBlock, ...metas], structuredContent: enriched, ...previewMeta };
        }
        const md: string[] = [];
        // One ANSWER out of three rendered lists, so the registry pointer is
        // suppressed per list and appended once below. Topic pages are `ccm:map`
        // and format as collections, so a per-list hint fired twice.
        const noHint = { registryHint: false };
        if (want.has('content'))     { md.push(`# Inhalte (${envelope.content.count})`);        md.push(renderToText(envelope.content.results, envelope.content.total, noHint) || 'Keine Inhalte gefunden.');
          // Into block 0, right under the list it explains — the trailing
          // blocks never reach at least one measured client (2026-08-19).
          if (derivedNotice) md.push(derivedNotice); }
        if (want.has('collections')) { md.push(`# Sammlungen (${envelope.collections.count})`);  md.push(renderToText(envelope.collections.results, undefined, noHint) || 'Keine Sammlungen gefunden.'); }
        if (want.has('topicPages'))  { md.push(`# Themenseiten (${envelope.topicPages.count})`); md.push(renderToText(envelope.topicPages.results, undefined, noHint) || 'Keine Themenseiten gefunden.'); }
        if (envelope.wikipedia) {
          // Quoted, not inlined: the extract is world-editable text landing
          // between our own `# Inhalte` / `# Sammlungen` headings, and a line
          // inside it starting with `#` would otherwise read as one of those
          // sections. `oneLine` is the wrong tool here (prose may wrap); a
          // blockquote keeps the paragraphs and denies the line start.
          const quoted = envelope.wikipedia.extract.split('\n').map(l => `> ${l}`).join('\n');
          // The same disclosure get_wikipedia_summary gives, from the same
          // source. This tool is the documented default entry point, so a
          // silent substitution here reaches MORE callers, not fewer.
          const notice = wikiResolutionNotice(query, envelope.wikipedia.title, envelope.wikipedia.match);
          md.push(`# Wikipedia`);
          md.push(`**${oneLine(envelope.wikipedia.title)}**${notice ? `\n\n${notice}` : ''}\n\n${quoted}\n\n[Wikipedia](${envelope.wikipedia.url})`);
        }
        // Gated on the envelope's own flags, not on the parameter: the
        // background cache can answer without this call asking, and a
        // collection with NO registry carries no field — so the results alone
        // cannot tell "not checked" from "checked, none there". Per bucket
        // since 2026-08-19: the hint may only cover nodes whose question is
        // actually open, and gating both buckets on ONE flag printed "nicht
        // geprüft" beside a catalogue the same answer had just rendered.
        const registryUnchecked = [
          ...(envelope.collections.registryChecked ? [] : envelope.collections.results),
          ...(envelope.topicPages.registryChecked ? [] : envelope.topicPages.results),
        ];
        if (registryUnchecked.length) {
          md.push(...registryHintFor(registryUnchecked).map(oneLine));
        }
        // `enriched`, not `envelope`: the derived-type field must reach
        // structuredContent in BOTH formats (the notice already sits in md).
        return { content: [{ type: 'text' as const, text: md.join('\n\n') }, ...hintBlock, ...licenceBlock, ...metas], structuredContent: enriched, ...previewMeta };
      } catch (err) {
        return toolError('Fehler bei der kombinierten Suche', err);
      }
    },
  });
}
