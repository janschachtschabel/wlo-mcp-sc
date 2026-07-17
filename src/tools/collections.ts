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
  getChildCollections,
  getCollectionContents,
  searchCollectionsByKeyword,
} from '../wlo-api.js';
import { rerankNodes } from '../reranker.js';
import type { FormattedNode } from '../formatter.js';
import { formatNodes, renderToJson, renderToText } from '../formatter.js';
import type { LabeledCriterion } from './shared.js';
import { buildFilterCriteria, formatUnresolvedHint, queryMetaContent, toolError } from './shared.js';
import { searchWithinCollection } from '../services/search.js';
import { registerWloTool } from '../apps/register.js';
import { nodeListSchema } from '../apps/outputSchemas.js';
import { nodeMatchesCriteria, nodeMatchesText } from '../node-match.js';
import { log } from '../logger.js';

/**
 * Fallback collection search by tree traversal, used when the direct
 * keyword-collection search finds nothing. From the given level-1 child
 * collections it keeps those that match `query`, expands into a capped level 2,
 * and — only if nothing matched yet — a scored, capped level 3. The caps (O6)
 * stop the fallback from turning into a 100+-parallel-call avalanche; direct
 * level-1 matches are always preserved.
 */
async function findCollectionsByTreeTraversal(level1: WloNode[], query: string): Promise<WloNode[]> {
  // Collections form a DAG (a sub-collection can hang under several parents),
  // so the same node can be reached more than once across levels — de-dup by
  // nodeId at insertion (audit Q-2) to keep rows and `total` honest.
  const seen = new Set<string>();
  const matches: WloNode[] = [];
  const addMatches = (nodes: WloNode[]) => {
    for (const n of nodes) {
      if (!nodeMatchesText(n, query)) continue;
      const id = n.ref?.id ?? '';
      if (id) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      matches.push(n);
    }
  };
  addMatches(level1);

  const LEVEL2_PARENT_CAP = 25;
  const level2Parents = level1.slice(0, LEVEL2_PARENT_CAP);
  if (level1.length > LEVEL2_PARENT_CAP) {
    log.warn('collection search: level2 expansion capped', { from: level1.length, to: LEVEL2_PARENT_CAP, query });
  }
  const level2Results = await Promise.allSettled(
    level2Parents.map(parent => getChildCollections(parent.ref?.id ?? '', 50))
  );
  const allLevel2Nodes: WloNode[] = [];
  for (const r of level2Results) {
    if (r.status === 'fulfilled') {
      allLevel2Nodes.push(...r.value);
      addMatches(r.value);
    }
  }

  if (matches.length === 0) {
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const scoreNode = (n: WloNode): number => {
      const text = [
        n.properties?.['cm:name']?.[0] ?? '',
        n.properties?.['cclom:title']?.[0] ?? '',
        n.properties?.['cclom:general_description']?.[0] ?? '',
      ].join(' ').toLowerCase();
      return queryWords.reduce((s, w) => s + (text.includes(w) ? 1 : 0), 0);
    };
    const anyScored = allLevel2Nodes.some(n => scoreNode(n) > 0);
    const LEVEL3_PARENT_CAP = 15;
    const level2Candidates = anyScored
      ? [...allLevel2Nodes].sort((a, b) => scoreNode(b) - scoreNode(a)).slice(0, LEVEL3_PARENT_CAP)
      : allLevel2Nodes.slice(0, LEVEL3_PARENT_CAP);

    const level3Results = await Promise.allSettled(
      level2Candidates.map(parent => getChildCollections(parent.ref?.id ?? '', 30))
    );
    for (const r of level3Results) {
      if (r.status === 'fulfilled') addMatches(r.value);
    }
  }

  return matches;
}

/**
 * BFS over a collection and its sub-collections, collecting file children
 * until `maxResults` rows are gathered. Result rows are de-duplicated by
 * nodeId and filtered by `excluded`; when a query is given, each page is
 * reranked before collection. `totalHits` is the SUM of each visited
 * collection's backend total — an aggregate upper bound, not a de-duplicated
 * grand total (an item referenced in two sub-collections is counted twice).
 * It answers "how much is under here" roughly.
 */
/**
 * Cap for the LOCAL skip window of the recursive path: the BFS must gather
 * skip+max rows before slicing, so an unbounded skipCount would let one call
 * force a crawl of the whole subtree (amplification on a public endpoint).
 */
const RECURSIVE_SKIP_MAX = 400;

async function collectRecursiveContents(
  rootId: string,
  maxResults: number,
  excluded: Set<string>,
  query: string | undefined,
): Promise<{ nodes: FormattedNode[]; totalHits: number }> {
  const collectionQueue = [rootId];
  const visited = new Set<string>();
  const seenNodes = new Set<string>(); // de-dup result rows across sub-collections
  const nodes: FormattedNode[] = [];
  let totalHits = 0;

  while (collectionQueue.length > 0 && nodes.length < maxResults) {
    const cid = collectionQueue.shift()!;
    if (visited.has(cid)) continue;
    visited.add(cid);

    const filesResp = await getCollectionContents(cid, 'files', 50);
    totalHits += filesResp.pagination.total;
    let fileNodes = filesResp.nodes;
    if (excluded.size) fileNodes = fileNodes.filter(n => !excluded.has(n.ref?.id ?? ''));
    // Drop a node already emitted from an earlier sub-collection.
    fileNodes = fileNodes.filter(n => {
      const id = n.ref?.id;
      if (!id) return true;          // no id → cannot de-dup, keep
      if (seenNodes.has(id)) return false;
      seenNodes.add(id);
      return true;
    });
    if (query?.trim()) fileNodes = rerankNodes(fileNodes, query);
    nodes.push(...formatNodes(fileNodes));

    // Fetch sub-collections and queue them
    const subs = await getChildCollections(cid);
    for (const sub of subs) {
      const subId = sub.ref?.id ?? sub.properties?.['sys:node-uuid']?.[0];
      if (subId && !visited.has(subId)) collectionQueue.push(subId);
    }
  }
  return { nodes: nodes.slice(0, maxResults), totalHits };
}

export function registerCollectionTools(server: McpServer): void {
  registerWloTool(server, {
    name: 'search_wlo_collections',
    title: 'WLO Sammlungssuche',
    description: `Finde WLO-Sammlungen und Themenseiten zu einem Thema — kuratierte thematische Seiten, die Materialien in Schwimmlinien (Karussells) nach Thema/Fach/Stufe bündeln. Für Anfragen wie "Themenseite Algebra", "Sammlung Klimawandel", "Portal Mathematik". Für einzelne Materialien (Videos/Arbeitsblätter) nutze stattdessen search_wlo_content oder search_wlo_all.
In WLO ist eine "Sammlung" dasselbe wie eine "Themenseite".
Use the returned nodeId with get_topic_page_content (Schwimmlinien) or get_collection_contents to retrieve the actual content items.
Filters (discipline, educationalContext) accept German labels (e.g. "Mathematik", "Grundschule")
or full URIs and are applied against each collection's own metadata — collections that do not
carry a matching subject/level tag are excluded.`,
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

      const keepNode = (n: WloNode) =>
        !(excluded.size && excluded.has(n.ref?.id ?? '')) && nodeMatchesCriteria(n, collCriteria);

      const renderOut = (nodes: WloNode[], qType: string, emptyMsg = 'Keine Sammlungen gefunden.') => {
        const kept = nodes.filter(keepNode);
        // Shown-set semantics: after local exclusion + criteria filtering the
        // pre-filter backend count would overstate the result.
        const total = kept.length;
        // Uniform reranking (as for content): by relevance when a query is
        // present; rerankNodes is a no-op for an empty query (browse) and
        // otherwise only removes deleted nodes — it cannot lose anything relevant.
        const ranked = rerankNodes(kept, params.query ?? '');
        const formatted = formatNodes(ranked.slice(0, maxResults));
        const text = (params.outputFormat ?? 'markdown') === 'json'
          ? renderToJson(formatted, total)
          : (renderToText(formatted, total) || emptyMsg);
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
        content.push(meta);
        return { content, structuredContent: { total, count: formatted.length, results: formatted } };
      };

      try {
        const query: string = params.query.trim();
        const startId: string = params.parentNodeId ?? WLO_ROOT_COLLECTION_ID;

        if (query && !params.parentNodeId) {
          // Over-fetch by the exclusion count so excluded ids cannot shrink the
          // page below maxResults (audit Q-3; mirrors the content-search H1 fix).
          const upstreamMax = Math.min(maxResults + excluded.size, maxResults + 200);
          const directHits = await searchCollectionsByKeyword(query, upstreamMax);
          const keptDirect = directHits.filter(keepNode);
          // When every direct hit was excluded or filtered out, fall through to
          // the tree traversal instead of returning an empty page (audit Q-3).
          if (keptDirect.length > 0) {
            return renderOut(keptDirect, 'keyword_collections');
          }
        }

        const level1 = await getChildCollections(startId, 100);

        if (!query) {
          return renderOut(level1, 'collection_children');
        }

        const matches = await findCollectionsByTreeTraversal(level1, query);

        if (matches.length === 0) {
          const text = `Keine Sammlungen gefunden für "${query}". Versuche einen übergeordneten Begriff (z.B. "Mathematik" statt "Bruchrechnung") oder frag nach verfügbaren Sammlungen ohne Suchbegriff.`;
          const content = [{ type: 'text' as const, text }];
          if (unresolvedHint) content.push({ type: 'text' as const, text: unresolvedHint });
          return { content, structuredContent: { total: 0, count: 0, results: [] } };
        }

        return renderOut(matches, 'collection_tree_traversal');
      } catch (err) {
        return toolError('Fehler bei der Sammlungssuche', err);
      }
    },
  });

  server.tool(
    'get_collection_contents',
    `Liste die Inhalte einer WLO-Sammlung/Themenseite auf (per nodeId) — die Materialien und Unter-Sammlungen, die darin gebündelt sind. Nutze dies, wenn du eine Sammlung/Themenseite hast (nodeId aus search_wlo_collections) und zeigen willst, was konkret drinsteckt.
contentFilter="files" (Default) = Lernmaterialien, "folders" = Unter-Sammlungen (Unter-Themenseiten), "both" = alles. includeSubcollections=true durchläuft den gesamten Unterbaum rekursiv.`,
    {
      nodeId: z.string().describe('Collection node ID from search_wlo_collections results'),
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
    { readOnlyHint: true },
    async (params) => {
      const filter = (params.contentFilter ?? 'files') as 'files' | 'folders' | 'both';
      const maxResults = params.maxResults ?? 20;
      const skipCount = params.skipCount ?? 0;
      const excluded = new Set(params.excludeNodeIds ?? []);

      try {
        let allNodes: FormattedNode[] = [];
        let totalHits = 0;
        let effectiveSkip = skipCount;

        if (params.includeSubcollections && filter === 'files') {
          // The BFS has no upstream offset, so paginate locally: collect
          // skip+max rows and slice. The skip window is capped so a huge
          // skipCount cannot force a crawl of the entire subtree.
          effectiveSkip = Math.min(skipCount, RECURSIVE_SKIP_MAX);
          const recursive = await collectRecursiveContents(params.nodeId, maxResults + effectiveSkip, excluded, params.query);
          allNodes = recursive.nodes.slice(effectiveSkip);
          totalHits = recursive.totalHits;
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

        const text = (params.outputFormat ?? 'markdown') === 'json'
          ? renderToJson(allNodes, totalHits)
          : (renderToText(allNodes, totalHits) || 'Sammlung ist leer oder nodeId nicht gefunden.');
        const meta = queryMetaContent({
          toolName: 'get_collection_contents',
          queryType: params.includeSubcollections ? 'collection_children_recursive' : 'collection_children',
          searchTerm: params.query ?? '',
          criteria: [{ property: 'nodeId', values: [params.nodeId] },
                     { property: 'contentFilter', values: [filter] }],
          pagination: { maxItems: maxResults, skipCount: effectiveSkip, totalResults: totalHits },
          repositoryUrl: WLO_REPOSITORY_URL,
        });
        return { content: [{ type: 'text' as const, text }, meta] };
      } catch (err) {
        return toolError('Fehler beim Abruf der Sammlungsinhalte', err);
      }
    },
  );

  server.tool(
    'search_wlo_within_collection',
    `Durchsuche/filtere die Inhalte INNERHALB einer bestimmten WLO-Sammlung — z.B. "welche Videos zu Zellteilung gibt es in dieser Sammlung?". Nutze dies, wenn du bereits eine Sammlung (nodeId) hast und sie per Volltext und Filtern (Fach/Stufe/Typ) eingrenzen willst.
Für eine ungebundene Suche über ganz WLO nutze search_wlo_content; um Inhalte ungefiltert zu listen get_collection_contents.
NOTE: Das Matching läuft über die direkten Inhalte der Sammlung (eine begrenzte Stichprobe von bis zu 100 Items, lokal geprüft — das Backend bietet keine sammlungsweite Suche). Die Ausgabe weist darauf hin, wenn die Sammlung größer ist.`,
    {
      nodeId: z.string().describe('The collection nodeId to search within (from search_wlo_collections).'),
      query: z.string().optional().default('').describe('Full-text query, e.g. "Zellteilung". Empty = all contents (filtered).'),
      educationalContext: z.string().optional().describe('Bildungsstufe: "Primarstufe", "Sekundarstufe I", … or URI'),
      discipline: z.string().optional().describe('Fach: "Mathematik", "Biologie", … or URI'),
      userRole: z.string().optional().describe('Zielgruppe: "Lehrer/in", "Lerner/in", … or URI'),
      learningResourceType: z.string().optional().describe('Ressourcentyp: "Arbeitsblatt", "Video", … or URI'),
      publisher: z.string().optional().describe('Anbieter, z.B. "Klexikon", "Serlo"'),
      maxResults: z.number().int().min(1).max(50).optional().default(10).describe('Maximum results (1–50, default 10)'),
      skipCount: z.number().int().min(0).optional().default(0).describe('Backend offset for "more results" paging (default 0)'),
      outputFormat: z.enum(['markdown', 'json']).optional().default('markdown'),
    },
    { readOnlyHint: true },
    async (params) => {
      try {
        const res = await searchWithinCollection({
          nodeId: params.nodeId,
          query: params.query,
          educationalContext: params.educationalContext,
          discipline: params.discipline,
          userRole: params.userRole,
          publisher: params.publisher,
          learningResourceType: params.learningResourceType,
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

        const hint = formatUnresolvedHint(res.unresolved);
        const content = [{ type: 'text' as const, text: text + sampleHint }];
        if (hint) content.push({ type: 'text' as const, text: hint });
        content.push(meta);
        return { content };
      } catch (err) {
        return toolError('Fehler bei der Suche in der Sammlung', err);
      }
    },
  );
}
