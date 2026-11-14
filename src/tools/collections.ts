/**
 * tools/collections.ts – Collection tools:
 * search_wlo_collections (keyword + tree-traversal fallback) and
 * get_collection_contents (contents/sub-collections of a collection).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { WloNode } from '../wlo-api.js';
import {
  WLO_REPOSITORY_URL,
  WLO_ROOT_COLLECTION_ID,
  getChildCollectionsResult,
  getCollectionContents,
} from '../wlo-api.js';
import { incompleteNotice, searchCollectionsResult } from '../services/collection-search.js';
import { rerankNodes } from '../reranker.js';
import type { FormattedNode } from '../formatter.js';
import { formatNodes, oneLine, registryHintFor, renderToJson, renderToText } from '../formatter.js';
import { ensureRegistries, refreshRegistries } from '../services/skill-registry-cache.js';
import type { LabeledCriterion } from '../filter-criteria.js';
import { buildFilterCriteria, formatUnresolvedHint, licenseFilterNotice } from '../filter-criteria.js';
import { queryMetaContent, subjectRegistryText, toolError } from './shared.js';
import { searchWithinCollection } from '../services/search.js';
import {
  RECURSIVE_SKIP_MAX,
  RESTRICTED_NOTICE,
  collectRecursiveContents,
  findCollectionsByTreeTraversal,
  notReadable,
} from '../services/collection-traversal.js';
import { registerWloTool } from '../apps/register.js';
import { nodeListSchema, resolvedCollectionSchema } from '../apps/outputSchemas.js';
import { collectionDisciplineParam, collectionNameParam, withCollectionByName } from './collection-arg.js';
import { nodeMatchesCriteria } from '../node-match.js';


/** The node list of a tool that may be called with a collection TITLE instead of its id. */
const namedCollectionListSchema = nodeListSchema.extend({ resolvedCollection: resolvedCollectionSchema });

/** Said when the recursive walk met a sub-listing that did not answer. */
const WALK_INCOMPLETE_NOTE = 'Hinweis: Mindestens eine Unterliste dieser Sammlung ließ sich gerade nicht lesen — '
  + 'die Inhalte darunter fehlen hier. Das ist KEIN Befund „mehr gibt es nicht“; bitte später erneut versuchen.';

export function registerCollectionTools(server: McpServer, searchResultsWidgetUri?: string): void {
  registerWloTool(server, {
    name: 'search_wlo_collections',
    widgetUri: searchResultsWidgetUri,
    title: 'WLO Sammlungssuche',
    description: `Finde WLO-Sammlungen zu einem Thema — kuratierte Bündel von Materialien nach Thema/Fach/Stufe. Für Anfragen wie "Themenseite Algebra", "Sammlung Klimawandel", "Portal Mathematik". Für einzelne Materialien (Videos/Arbeitsblätter) nutze stattdessen search_wlo_content oder search_wlo_all.
Sammlung und Themenseite sind NICHT dasselbe: eine Themenseite ist eine Sammlung, die zusätzlich ein kuratiertes Seiten-Layout mit Schwimmlinien trägt. Jede Themenseite ist eine Sammlung, aber nur manche Sammlungen haben eine. Dieses Werkzeug findet ALLE Sammlungen; geht es ausschließlich um Themenseiten, ist search_wlo_topic_pages das richtige.
Mit der nodeId weiter zu get_collection_contents (die Inhalte), get_topic_page_content (die Schwimmlinien) oder get_skill_registry (die für diese Sammlung freigegebenen Skills).
Filter (discipline, educationalContext) nehmen deutsche Labels oder URIs und wirken auf die Metadaten der Sammlung — ohne passenden Fach-/Stufen-Eintrag fällt sie heraus.`,
    inputSchema: {
      query: z.string().optional().default('').describe('Search query in German, e.g. "Klimawandel" or "Algebra". Leave empty to browse top-level collections.'),
      parentNodeId: z.string().optional().describe(
        'NodeId of a parent collection to search within (e.g. Mathematik nodeId to find "Algebra" inside it). ' +
        'Leave empty to search from the WLO root. Returned by a previous search_wlo_collections call.'
      ),
      educationalContext: z.string().optional().describe(
        'Educational level (Bildungsstufe): e.g. "Primarstufe", "Sekundarstufe I", "Hochschule", or URI'
      ),
      discipline: z.string().optional().describe(
        'Subject (Fach/Schulfach): e.g. "Mathematik", "Biologie", "Informatik", or URI'
      ),
      maxResults: z.number().int().min(1).max(50).optional().default(5).describe(
        'Maximum number of results (1–50, default 5)'
      ),
      excludeNodeIds: z.array(z.string()).max(200).optional().describe(
        'Skip these node IDs in the result (already-seen items, e.g. for paginated drill-downs). Max 200.'
      ),
      includeSkillRegistry: z.boolean().optional().default(false).describe(
        'Die freigegebenen Skills je Sammlung JETZT frisch abrufen, statt eine '
        + 'gemerkte Antwort zu nehmen (die bis zu 10 Minuten alt sein kann). '
        + 'Kostet 2 Abrufe je Sammlung, rund 1,0–1,4 Sekunden. NICHT nötig, damit der '
        + 'Katalog überhaupt kommt — der ist ohnehin in der Antwort. Nur nötig, wenn '
        + 'gerade eine Registry angelegt oder geändert wurde.'
      ),
      outputFormat: z.enum(['markdown', 'json']).optional().default('markdown').describe(
        '"markdown" (default, human-readable) or "json" (structured)'
      ),
    },
    outputSchema: nodeListSchema,
    annotations: { readOnlyHint: true },
    handler: async (params) => {
      const maxResults = params.maxResults ?? 5;
      const excluded = new Set(params.excludeNodeIds ?? []);

      // The backend collections query rejects extra vocab criteria (400,
      // live-verified 2026-07-17), so the resolved filters are applied LOCALLY:
      // both the keyword projection and the children listing carry
      // ccm:taxonid / ccm:educationalcontext. (userRole is not offered — that
      // property is absent from the keyword projection, so it could never match.)
      const { criteria: collCriteria, labeled: collLabeledCriteria, unresolved } = buildFilterCriteria(params);
      const unresolvedHint = formatUnresolvedHint(unresolved);
      // The contract half of the hint (feedback 2026-11-07): a client reading only
      // `structuredContent` otherwise never learns that a filter did not apply.
      const unresolvedField = unresolved.length ? { unresolvedFilters: unresolved } : {};

      const keepNode = (n: WloNode) =>
        !(excluded.size && excluded.has(n.ref?.id ?? '')) && nodeMatchesCriteria(n, collCriteria);

      const renderOut = async (nodes: WloNode[], qType: string, emptyMsg = 'Keine Sammlungen gefunden.', incomplete = false, restricted = false) => {
        const kept = nodes.filter(keepNode);
        // Shown-set semantics: after local exclusion + criteria filtering the
        // pre-filter backend count would overstate the result.
        const total = kept.length;
        // Uniform reranking (as for content): by relevance when a query is
        // present; rerankNodes is a no-op for an empty query (browse) and
        // otherwise only removes deleted nodes — it cannot lose anything relevant.
        const ranked = rerankNodes(kept, params.query ?? '');
        const formatted = formatNodes(ranked.slice(0, maxResults));
        // Opt-in and after the cap, so the cost is bounded by what is shown:
        // 2 upstream calls per collection, ~1.0–1.4 s (measured 2026-08-10).
        // Through the cache (K-15): the fresh answer replaces the entry, and only
        // ids that really ANSWERED count as checked.
        const forced = params.includeSkillRegistry ? await refreshRegistries(formatted) : { answered: new Set<string>(), failed: new Set<string>() };
        // After the cap and after any live pass: free either way, and a cold
        // collection is queued so the next call for it costs nothing. NOT for a
        // collection whose forced lookup just failed: the caller asked for the
        // state NOW, and the remembered one attached in its place would read as it.
        const remembered = await ensureRegistries(formatted.filter(n => !forced.failed.has(n.nodeId)));
        const unchecked = formatted.filter(n => n.nodeType === 'collection' && !n.skillRegistry
          && !forced.answered.has(n.nodeId) && !remembered.has(n.nodeId));
        const text = (params.outputFormat ?? 'markdown') === 'json'
          ? renderToJson(formatted, total, { incomplete, restricted })
          // The pointer covers exactly the collections whose lookup did NOT
          // answer. Suppressing it whenever the lookup was REQUESTED reported a
          // failed lookup as "checked, none there" (audit 2026-11-12, K-15).
          : [renderToText(formatted, total, { registryHint: false }) || (incomplete ? '' : emptyMsg),
            ...registryHintFor(unchecked).map(oneLine),
            ...(incomplete ? [incompleteNotice('Sammlungen', formatted.length === 0)] : []),
            ...(restricted ? [RESTRICTED_NOTICE] : [])].filter(Boolean).join('\n\n');
        const baseCriteria: LabeledCriterion[] = params.query?.trim()
          ? [{ property: 'ngsearchword', values: [params.query] }]
          : [];
        const meta = queryMetaContent({
          toolName: 'search_wlo_collections',
          queryType: qType,
          searchTerm: params.query ?? '',
          criteria: [...baseCriteria, ...collLabeledCriteria],
          pagination: { maxItems: maxResults, skipCount: 0, totalResults: total },
          repositoryUrl: WLO_REPOSITORY_URL,
          unresolvedFilters: unresolved.length ? unresolved : undefined,
        });
        const content = [{ type: 'text' as const, text }];
        if (unresolvedHint) content.push({ type: 'text' as const, text: unresolvedHint });
        // Before `_queryMeta`, which stays the LAST block everywhere.
        if ((params.outputFormat ?? 'markdown') === 'json' && incomplete) {
          content.push({ type: 'text' as const, text: incompleteNotice('Sammlungen', formatted.length === 0) });
        }
        if ((params.outputFormat ?? 'markdown') === 'json' && restricted) content.push({ type: 'text' as const, text: RESTRICTED_NOTICE });
        content.push(meta);
        return { content, structuredContent: {
          total, count: formatted.length, results: formatted,
          ...(incomplete ? { incomplete: true as const } : {}), ...(restricted ? { restricted: true as const } : {}), ...unresolvedField,
        } };
      };

      // A collection index did not answer (set in the direct-search branch).
      let searchIncomplete = false;
      try {
        const query: string = params.query.trim();
        const startId: string = params.parentNodeId ?? WLO_ROOT_COLLECTION_ID;

        if (query && !params.parentNodeId) {
          // Over-fetch by the exclusion count so excluded ids cannot shrink the
          // page below maxResults (audit Q-3; mirrors the content-search H1 fix).
          // The `+200` clamp is redundant while the schema caps excludeNodeIds
          // at 200, and kept as a second bound if that cap ever moves.
          const upstreamMax = Math.min(maxResults + excluded.size, maxResults + 200);
          const direct = await searchCollectionsResult(query, upstreamMax);
          // One index down may hide hits — neither is a superset of the other (K-3).
          // Carried through the fall-back below too: the tree traversal reads the
          // node store and matches by title, which is less than either index.
          searchIncomplete = direct.unreachable.length > 0;
          const keptDirect = direct.nodes.filter(keepNode);
          // When every direct hit was excluded or filtered out, fall through to
          // the tree traversal instead of returning an empty page (audit Q-3).
          if (keptDirect.length > 0) {
            return await renderOut(keptDirect, 'keyword_collections', undefined, searchIncomplete);
          }
        }

        const level1 = await getChildCollectionsResult(startId, 100);
        // An unread listing must not become "nothing found": both answers below
        // are statements about the catalogue ("no collections", "try a broader
        // term") that the caller will act on, and neither is true when the
        // repository simply did not answer.
        if (level1.refused) throw new Error(notReadable(startId, level1.refused));
        if (!level1.reachable) {
          throw new Error(`Die Sammlungsliste zu ${startId} ist derzeit nicht erreichbar.`);
        }

        if (!query) {
          return await renderOut(level1.nodes, 'collection_children');
        }

        const traversal = await findCollectionsByTreeTraversal(level1.nodes, query);
        const matches = traversal.matches;
        // Sub-lists that did not answer: the traversal's "nothing" is then not a finding either.
        searchIncomplete ||= traversal.unread > 0;
        // Sub-lists the repository refused: no outage, and no "nothing there" either.
        const restricted = traversal.refused > 0;

        if (matches.length === 0) {
          // "Keine Sammlungen gefunden" is a statement about the catalogue; with a
          // search index that did not answer it is not ours to make (K-3).
          const text = searchIncomplete
            ? [incompleteNotice('Sammlungen', true), ...(restricted ? [RESTRICTED_NOTICE] : [])].join('\n\n')
            : restricted ? `In den lesbaren Teilen wurde keine Sammlung für "${query}" gefunden.\n\n${RESTRICTED_NOTICE}`
            : `Keine Sammlungen gefunden für "${query}". Versuche einen übergeordneten Begriff (z.B. "Mathematik" statt "Bruchrechnung") oder frag nach verfügbaren Sammlungen ohne Suchbegriff.`;
          // JSON mode keeps a parseable first block (an empty list) and carries the
          // sentence as its own block — prose alone broke every client that parses block 0.
          const content = (params.outputFormat ?? 'markdown') === 'json'
            ? [{ type: 'text' as const, text: renderToJson([], 0, { incomplete: searchIncomplete, restricted }) }, { type: 'text' as const, text }]
            : [{ type: 'text' as const, text }];
          if (unresolvedHint) content.push({ type: 'text' as const, text: unresolvedHint });
          return { content, structuredContent: {
            total: 0, count: 0, results: [],
            ...(searchIncomplete ? { incomplete: true as const } : {}), ...(restricted ? { restricted: true as const } : {}), ...unresolvedField,
          } };
        }

        return await renderOut(matches, 'collection_tree_traversal', undefined, searchIncomplete, restricted);
      } catch (err) {
        return toolError('Fehler bei der Sammlungssuche', err);
      }
    },
  });

  registerWloTool(server, {
    name: 'get_collection_contents',
    title: 'WLO Sammlungsinhalte',
    widgetUri: searchResultsWidgetUri,
    description: `Liste die Inhalte einer WLO-Sammlung/Themenseite auf (per nodeId) — die Materialien und Unter-Sammlungen, die darin gebündelt sind. Der Widget-Knopf „Inhalte anzeigen" führt hierher. Nutze dies, wenn du eine Sammlung/Themenseite hast (nodeId aus search_wlo_collections, aus dem Themenbaum oder aus einer früheren Antwort) und zeigen willst, was konkret drinsteckt.
contentFilter="files" (Default) = Lernmaterialien, "folders" = Unter-Sammlungen (Unter-Themenseiten), "both" = alles. includeSubcollections=true durchläuft den gesamten Unterbaum rekursiv.
Statt der nodeId kann der Titel der Sammlung als \`collection\` angegeben werden, bei mehreren gleichnamigen mit \`discipline\` (Fach); bei Mehrdeutigkeit kommen Kandidaten statt eines Ergebnisses.`,
    inputSchema: {
      skillContext: z.string().max(120).optional().describe(
        'Arbeitszusammenhang, zu dem die für diese Sammlung freigegebenen Skills gezeigt werden '
        + 'sollen (Kontextname aus dem Registry-Dokument, z. B. „Redaktionsumgebung"). Liefert '
        + 'zusätzlich die Anleitung der Redaktion dazu und spart den Aufruf von get_skill_registry. '
        + 'Kostet 2 Abrufe, rund 1,0–1,4 Sekunden. Passt der Name nicht, kommt trotzdem der '
        + 'vollständige Katalog samt Liste der vorhandenen Kontexte — nie ein Fehler.'
      ),
      nodeId: z.string().optional().describe('Collection node ID from search_wlo_collections results. Give nodeId OR `collection` (its title) — one of the two is required.'),
      collection: collectionNameParam,
      discipline: collectionDisciplineParam('discipline'),
      query: z.string().optional().describe(
        'Optional search/filter query to rerank results within the collection'
      ),
      contentFilter: z.enum(['files', 'folders', 'both']).optional().default('files').describe(
        '"files" = Lernmaterialien (default), "folders" = Sub-Sammlungen, "both" = alles'
      ),
      includeSubcollections: z.boolean().optional().default(false).describe(
        'Wenn true: Sub-Sammlungen rekursiv durchsuchen und alle Inhalte sammeln (nur für contentFilter="files"). ' +
        'Pagination erfolgt hier lokal; skipCount ist auf 400 begrenzt.'
      ),
      maxResults: z.number().int().min(1).max(100).optional().default(20).describe(
        'Maximum number of items to return (1–100, default 20)'
      ),
      skipCount: z.number().int().min(0).optional().default(0).describe(
        'Number of items to skip for pagination (default 0)'
      ),
      excludeNodeIds: z.array(z.string()).max(200).optional().describe(
        'Skip these node IDs in the result. Max 200.'
      ),
      outputFormat: z.enum(['markdown', 'json']).optional().default('markdown'),
    },
    outputSchema: namedCollectionListSchema,
    annotations: { readOnlyHint: true },
    handler: withCollectionByName({
      idParam: 'nodeId', disciplineParam: 'discipline', missing: 'Bitte nodeId oder collection angeben.',
    }, async (params) => {
      const filter = (params.contentFilter ?? 'files') as 'files' | 'folders' | 'both';
      const maxResults = params.maxResults ?? 20;
      const skipCount = params.skipCount ?? 0;
      // Explicit element type: the seam hands the handler untyped args, so an
      // inferred Set<unknown> would not satisfy collectRecursiveContents.
      const excluded = new Set<string>(params.excludeNodeIds ?? []);

      try {
        let allNodes: FormattedNode[] = [];
        let totalHits = 0;
        let effectiveSkip = skipCount;
        let walkIncomplete = false;
        let walkRestricted = false;

        if (params.includeSubcollections && filter === 'files') {
          // The BFS has no upstream offset, so paginate locally: collect
          // skip+max rows and slice. The skip window is capped so a huge
          // skipCount cannot force a crawl of the entire subtree.
          effectiveSkip = Math.min(skipCount, RECURSIVE_SKIP_MAX);
          const recursive = await collectRecursiveContents(params.nodeId, maxResults + effectiveSkip, excluded, params.query);
          allNodes = recursive.nodes.slice(effectiveSkip);
          totalHits = recursive.totalHits;
          walkIncomplete = recursive.incomplete === true;
          walkRestricted = recursive.restricted === true;
        } else {
          // Cap the upstream page size: excluded.size is bounded (schema max 200)
          // but we still don't want a caller to force an oversized upstream query.
          const upstreamMax = Math.min(maxResults + excluded.size, maxResults + 200);
          const response = await getCollectionContents(params.nodeId, filter, upstreamMax, skipCount);
          totalHits = response.pagination.total;
          let nodes = response.nodes;
          if (excluded.size) nodes = nodes.filter(n => !excluded.has(n.ref?.id ?? ''));
          if (params.query?.trim() && filter !== 'folders') {
            nodes = rerankNodes(nodes, params.query);
          }
          allNodes = formatNodes(nodes.slice(0, maxResults));
        }
        await ensureRegistries(allNodes);
        // The listing above answers for the CHILDREN; this answers for the
        // collection the caller named, which never appears among them — and
        // with `contentFilter="files"` the children are materials, so the
        // enrichment had nothing to attach to at all.
        const subjectRegistry = await subjectRegistryText(params.nodeId, params.skillContext);

        const text = (params.outputFormat ?? 'markdown') === 'json'
          ? renderToJson(allNodes, totalHits, { incomplete: walkIncomplete, restricted: walkRestricted })
          // "Sammlung ist leer" is a statement about the collection — not over a walk that could not read all of it.
          : (renderToText(allNodes, totalHits) || (walkIncomplete || walkRestricted ? '' : 'Sammlung ist leer oder nodeId nicht gefunden.'));
        const meta = queryMetaContent({
          toolName: 'get_collection_contents',
          queryType: params.includeSubcollections ? 'collection_children_recursive' : 'collection_children',
          searchTerm: params.query ?? '',
          criteria: [{ property: 'nodeId', values: [params.nodeId] },
                     { property: 'contentFilter', values: [filter] }],
          pagination: { maxItems: maxResults, skipCount: effectiveSkip, totalResults: totalHits },
          repositoryUrl: WLO_REPOSITORY_URL,
        });
        // Its own content block, never appended to `text`: in json mode `text`
        // IS the payload, and German prose glued to it makes JSON.parse throw
        // (the same rule the sibling tools follow for their hints).
        const content = [{ type: 'text' as const, text }].filter(c => c.text);
        if (walkIncomplete) content.push({ type: 'text' as const, text: WALK_INCOMPLETE_NOTE });
        // Markdown: IN block 0 — a client that hands its model the first block
        // only would otherwise read "0 Treffer" with nothing beside it. JSON:
        // its own block, block 0 being the payload.
        if (walkRestricted) {
          if ((params.outputFormat ?? 'markdown') === 'json' || !content[0]) content.push({ type: 'text' as const, text: RESTRICTED_NOTICE });
          else content[0].text += `\n\n${RESTRICTED_NOTICE}`;
        }
        if (subjectRegistry) content.push({ type: 'text' as const, text: subjectRegistry });
        content.push(meta);
        return {
          content,
          structuredContent: {
            total: totalHits, count: allNodes.length, results: allNodes,
            ...(walkIncomplete ? { incomplete: true as const } : {}), ...(walkRestricted ? { restricted: true as const } : {}),
          },
        };
      } catch (err) {
        return toolError('Fehler beim Abruf der Sammlungsinhalte', err);
      }
    }),
  });

  registerWloTool(server, {
    name: 'search_wlo_within_collection',
    title: 'WLO Suche in Sammlung',
    widgetUri: searchResultsWidgetUri,
    description: `Durchsuche/filtere die Inhalte INNERHALB einer bestimmten WLO-Sammlung — z.B. "welche Videos zu Zellteilung gibt es in dieser Sammlung?". Nutze dies, wenn du bereits eine Sammlung (nodeId) hast und sie per Volltext und Filtern (Fach/Stufe/Typ) eingrenzen willst.
Für eine ungebundene Suche über ganz WLO nutze search_wlo_content; um Inhalte ungefiltert zu listen get_collection_contents.
NOTE: Das Matching läuft über die direkten Inhalte der Sammlung (eine begrenzte Stichprobe von bis zu 100 Items, lokal geprüft — das Backend bietet keine sammlungsweite Suche). Die Ausgabe weist darauf hin, wenn die Sammlung größer ist.
Statt der nodeId geht der Titel der Sammlung als \`collection\` (gleichnamige: \`collectionDiscipline\` — \`discipline\` filtert die Inhalte); mehrdeutig → Kandidaten statt Ergebnis.
Welche Skills für diese Sammlung freigegeben sind, steht bereits in der Antwort. get_skill_registry mit derselben nodeId liefert zusätzlich Beschreibungen, Keywords und die Verwendungshinweise der Redaktion.`,
    inputSchema: {
      skillContext: z.string().max(120).optional().describe(
        'Arbeitszusammenhang, zu dem die für diese Sammlung freigegebenen Skills gezeigt werden '
        + 'sollen (Kontextname aus dem Registry-Dokument, z. B. „Redaktionsumgebung"). Liefert '
        + 'zusätzlich die Anleitung der Redaktion dazu und spart den Aufruf von get_skill_registry. '
        + 'Kostet 2 Abrufe, rund 1,0–1,4 Sekunden. Passt der Name nicht, kommt trotzdem der '
        + 'vollständige Katalog samt Liste der vorhandenen Kontexte — nie ein Fehler.'
      ),
      nodeId: z.string().optional().describe('The collection nodeId to search within (from search_wlo_collections). Give nodeId OR `collection` (its title) — one of the two is required.'),
      collection: collectionNameParam,
      collectionDiscipline: collectionDisciplineParam('collectionDiscipline'),
      query: z.string().optional().default('').describe('Full-text query, e.g. "Zellteilung". Empty = all contents (filtered).'),
      educationalContext: z.string().optional().describe('Bildungsstufe: "Primarstufe", "Sekundarstufe I", … or URI'),
      discipline: z.string().optional().describe('Fach: "Mathematik", "Biologie", … or URI'),
      userRole: z.string().optional().describe('Zielgruppe: "Lehrer/in", "Lerner/in", … or URI'),
      learningResourceType: z.string().optional().describe('Ressourcentyp: "Arbeitsblatt", "Video", … or URI'),
      publisher: z.string().optional().describe('Anbieter, z.B. "Klexikon", "Serlo"'),
      license: z.string().optional().describe('Lizenz: "CC BY 4.0", "gemeinfrei", … oder "OER" für alle frei nachnutzbaren (CC0/PDM/CC BY/CC BY-SA)'),
      maxResults: z.number().int().min(1).max(50).optional().default(10).describe('Maximum results (1–50, default 10)'),
      skipCount: z.number().int().min(0).optional().default(0).describe('Backend offset for "more results" paging (default 0)'),
      excludeNodeIds: z.array(z.string()).max(200).optional().describe(
        'Skip these node IDs in the result (already-seen items) — also matches the original a reference points at. Max 200.'
      ),
      outputFormat: z.enum(['markdown', 'json']).optional().default('markdown'),
    },
    outputSchema: namedCollectionListSchema,
    annotations: { readOnlyHint: true },
    handler: withCollectionByName({
      idParam: 'nodeId', disciplineParam: 'collectionDiscipline', missing: 'Bitte nodeId oder collection angeben.',
    }, async (params) => {
      try {
        const res = await searchWithinCollection({
          excludeNodeIds: params.excludeNodeIds,
          nodeId: params.nodeId,
          query: params.query,
          educationalContext: params.educationalContext,
          discipline: params.discipline,
          userRole: params.userRole,
          publisher: params.publisher,
          learningResourceType: params.learningResourceType,
          license: params.license,
          maxResults: params.maxResults,
          skipCount: params.skipCount,
        });

        const text = (params.outputFormat ?? 'markdown') === 'json'
          ? renderToJson(res.results, res.pagination.total)
          : (renderToText(res.results, res.pagination.total) || 'Keine Inhalte in dieser Sammlung gefunden.');
        // Never let a sampled answer look exhaustive.
        const sampleHint = res.truncated
          ? `\n_Hinweis: Durchsucht wurden die ersten 100 von ${res.collectionTotal} Inhalten dieser Sammlung._`
          : '';

        // The licence pass can empty this result on its own, and then the sub-
        // collection hint below would send the caller one level down while the
        // material sits right here under a licence they did not ask for.
        const licenceNotice = licenseFilterNotice(res.licenseChecked, res.pagination.total, params.license);

        // A bare "0 Treffer" is indistinguishable from "this collection does
        // not exist" and from "there is nothing on the topic" (audit
        // 2026-07-30). The usual cause on a portal-level collection is that the
        // material sits one level DOWN: matching runs over the direct contents,
        // and those are sub-collections. Measured on the Mathematik portal: 15
        // direct entries, none matching "Bruch", 11 sub-collections below — so
        // the trigger is "no MATCHES", not "no contents at all".
        let emptyHint = '';
        if (res.results.length === 0) {
          const folders = await getCollectionContents(params.nodeId, 'folders', 1, 0)
            .catch(() => null);
          const subs = folders?.pagination.total ?? 0;
          if (subs > 0) {
            emptyHint = res.collectionTotal > 0
              ? `\n\n_Keiner der ${res.collectionTotal} direkten Inhalte dieser Sammlung passt zur Suche. Sie hat ${subs} Unter-Sammlung(en) — liste sie mit get_collection_contents (contentFilter="folders") auf und suche dann gezielt in einer davon._`
              : `\n\n_Diese Sammlung enthält keine eigenen Materialien, sondern ${subs} Unter-Sammlung(en). Liste sie mit get_collection_contents (contentFilter="folders") auf und suche dann in einer davon._`;
          }
        }

        const meta = queryMetaContent({
          toolName: 'search_wlo_within_collection',
          // The scope is the collection's own contents listing, matched locally
          // — the backend has no collection-scoped search (400 on primaryparent).
          queryType: 'collection_children_filtered',
          searchTerm: res.query,
          criteria: [
            { property: 'nodeId', values: [params.nodeId] },
            ...(res.query ? [{ property: 'ngsearchword', values: [res.query] }] : []),
            ...res.labeled,
          ],
          pagination: { maxItems: params.maxResults ?? 10, skipCount: params.skipCount ?? 0, totalResults: res.pagination.total },
          repositoryUrl: WLO_REPOSITORY_URL,
          unresolvedFilters: res.unresolved.length ? res.unresolved : undefined,
        });

        // Each hint rides as its OWN content block rather than being appended to
        // `text`: in json mode `text` is the payload, and a German sentence glued
        // to it makes JSON.parse throw for every client that reads it (the same
        // rule search_wlo_content follows for the unresolved-filter hint).
        const hint = formatUnresolvedHint(res.unresolved);
        // Which skills this collection has approved — the collection is the
        // subject of the call and never appears in its own result list.
        const subjectRegistry = await subjectRegistryText(params.nodeId, params.skillContext);
        const content = [{ type: 'text' as const, text }];
        // The registry goes LAST. `licenceNotice` and `emptyHint` say why this
        // result may be empty or short — the reader has to see those next to the
        // result, not below a catalogue that can run to a hundred lines.
        for (const extra of [sampleHint, licenceNotice, emptyHint, hint, subjectRegistry]) {
          if (extra.trim()) content.push({ type: 'text' as const, text: extra.trim() });
        }
        content.push(meta);
        return {
          content,
          structuredContent: { total: res.pagination.total, count: res.results.length, results: res.results,
            ...(res.unresolved.length ? { unresolvedFilters: res.unresolved } : {}) },
        };
      } catch (err) {
        return toolError('Fehler bei der Suche in der Sammlung', err);
      }
    }),
  });
}
