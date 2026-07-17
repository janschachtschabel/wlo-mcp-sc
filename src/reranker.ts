/**
 * reranker.ts – Client-side relevance scoring + multi-query RRF reranking
 * Ported from wlo-search-app/src/searchStrategy.ts + api.ts.
 * Query expansion (variants, synonyms, stopwords) lives in query-expand.ts.
 */

import type { WloNode, SearchResponse, SearchCriterion, NgsearchContentType } from './wlo-api.js';
import { ngsearch } from './wlo-api.js';
import type { QueryVariant } from './query-expand.js';
import { DE_STOPWORDS, expandQuery } from './query-expand.js';
import { nodeTitle } from './node-match.js';

// Candidate pool PER search variant for ranking — NOT the number of results
// delivered (that is maxResults). Smaller pool = faster/smaller fetches at
// minimally lower recall. Default 25 (reduced from 40), overridable via the
// ``WLO_POOL_SIZE`` env var.
const POOL_SIZE: number = (() => {
  const v = parseInt(process.env['WLO_POOL_SIZE'] ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 25;
})();

// Final-score blend: text/metadata quality dominates, cross-variant RRF
// consensus nudges the order, and appearing in several variants earns a small
// bonus capped below either weight — so consensus can break ties but never
// outvote actual relevance.
const QUALITY_WEIGHT = 0.8;
const RRF_WEIGHT = 0.1;
const APPEARANCE_BONUS_MAX = 0.1;

// ── Relevance Scoring ────────────────────────────────────────────────────────

function termInText(term: string, text: string): boolean {
  return text.includes(term);
}

function computeRelevanceScore(node: WloNode, query: string): number {
  let score = 0;
  const props = node.properties ?? {};
  const queryLower = query.toLowerCase();
  // Drop stopwords: a stopword ("die", "und", …) must not act as a relevance
  // signal (a title merely containing "die" is not a match). Phrase-level checks
  // below still use the full `queryLower`, so exact-phrase matches are unaffected.
  const queryTerms = queryLower.split(/\s+/).filter(t => t.length >= 2 && !DE_STOPWORDS.has(t));

  // Shared title chain (node-match.ts) so a node titled only at cm:title /
  // node-level scores against its real title, not an empty string.
  const title = nodeTitle(node).toLowerCase();
  const desc  = (props['cclom:general_description']?.[0] ?? '').toLowerCase();
  const keywords = (props['cclom:general_keyword'] ?? []).map((k: string) => k.toLowerCase());
  const allKw = keywords.join(' ');

  // Title relevance
  if (title.includes(queryLower)) {
    score += 30;
    if (title === queryLower) score += 20;
    else if (title.startsWith(queryLower)) score += 10;
  } else {
    for (const term of queryTerms) {
      if (termInText(term, title)) score += 8;
    }
    if (queryTerms.length > 1 && queryTerms.every(t => termInText(t, title))) score += 12;
  }

  // Keyword relevance
  let kwHits = 0;
  for (const term of queryTerms) {
    if (keywords.includes(term)) { score += 10; kwHits++; }
    else if (termInText(term, allKw)) score += 5;
  }
  if (queryTerms.length > 1 && kwHits === queryTerms.length) score += 10;

  // Description relevance
  if (desc.includes(queryLower)) score += 8;
  else { for (const term of queryTerms) { if (termInText(term, desc)) score += 3; } }

  // Penalty: not in title or keywords
  const inTitle = queryTerms.some(t => termInText(t, title));
  const inKw    = queryTerms.some(t => termInText(t, allKw));
  if (!inTitle && !inKw) score -= 20;

  // Metadata quality
  if (node.preview?.url && !node.preview.isIcon) score += 3;
  if (props['ccm:educationalcontext']?.length) score += 2;
  if (props['ccm:taxonid']?.length) score += 2;
  if (props['ccm:oeh_lrt_aggregated']?.length) score += 1;
  const license = props['ccm:commonlicense_key']?.[0] ?? '';
  if (['CC_0', 'CC_BY', 'CC_BY_SA', 'PDM'].includes(license)) score += 3;
  if (desc.length > 100) score += 2;
  else if (desc.length > 30) score += 1;
  if (props['ccm:oeh_publisher_combined']?.[0]) score += 1;
  if (props['ccm:wwwurl']?.[0] ?? node.content?.url) score += 1;

  return Math.max(score, 0);
}

// ── Merge + RRF ranking ──────────────────────────────────────────────────────

const RRF_K = 60;

interface ScoredNode {
  node: WloNode;
  nodeId: string;
  rrfScore: number;
  qualityScore: number;
  finalScore: number;
  appearances: number;
}

function getNodeId(node: WloNode): string {
  return node.ref?.id ?? node.properties?.['sys:node-uuid']?.[0] ?? '';
}

function isDeletedNode(node: WloNode): boolean {
  // Full title chain (incl. cm:title + node.title): a page variant titled only
  // at cm:title must not be misclassified as a deleted placeholder.
  const title = nodeTitle(node);
  const desc  = node.properties?.['cclom:general_description']?.[0] ?? '';
  if (title.includes('Element wurde gelöscht') || title.includes('Element was removed')) return true;
  if (desc.includes('Element wurde gelöscht') || desc.includes('Element was removed')) return true;
  if (!title.trim()) return true;
  return false;
}

function mergeAndRank(
  results: { variant: QueryVariant; response: SearchResponse }[],
  query: string,
): ScoredNode[] {
  const nodeMap = new Map<string, ScoredNode>();

  for (const { variant, response } of results) {
    for (let rank = 0; rank < response.nodes.length; rank++) {
      const node = response.nodes[rank];
      const nodeId = getNodeId(node);
      if (!nodeId) continue;
      const rrfContribution = variant.weight / (RRF_K + rank + 1);
      if (nodeMap.has(nodeId)) {
        const ex = nodeMap.get(nodeId)!;
        ex.rrfScore += rrfContribution;
        ex.appearances += 1;
      } else {
        nodeMap.set(nodeId, { node, nodeId, rrfScore: rrfContribution, qualityScore: 0, finalScore: 0, appearances: 1 });
      }
    }
  }

  const entries = Array.from(nodeMap.values());
  for (const e of entries) e.qualityScore = computeRelevanceScore(e.node, query);

  const maxRrf     = Math.max(...entries.map(e => e.rrfScore), 0.001);
  const maxQuality = Math.max(...entries.map(e => e.qualityScore), 1);
  for (const e of entries) {
    const normRrf     = e.rrfScore / maxRrf;
    const normQuality = e.qualityScore / maxQuality;
    const bonus       = Math.min(e.appearances / results.length, 1) * APPEARANCE_BONUS_MAX;
    e.finalScore = normQuality * QUALITY_WEIGHT + normRrf * RRF_WEIGHT + bonus;
  }

  // Deterministic tie-breaker: when scores are equal, sort by nodeId
  // (lexicographically). Otherwise the order depends on the JS engine's
  // sort stability + insertion order from the parallel `Promise.allSettled`
  // — which can flip between calls and gives the impression of "random"
  // results.
  entries.sort((a, b) => {
    if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
    return a.nodeId.localeCompare(b.nodeId);
  });

  // Same stopword-filtered term list as computeRelevanceScore: the floor must
  // be calibrated on the terms that can actually score, or a stopword-heavy
  // query over-filters and silently flips to the RRF-only fallback below.
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length >= 2 && !DE_STOPWORDS.has(t));
  const minScore   = Math.max(5, queryTerms.length * 3);
  const passing = entries.filter(e => e.qualityScore >= minScore);
  // Graceful degradation: if the text-overlap quality floor would discard
  // EVERY hit (e.g. the backend matched via full-text/PDF body or keywords
  // not echoed in cclom:title/general_keyword), fall back to the RRF-ranked
  // pool instead of returning nothing. `entries` is already sorted by
  // finalScore, so the best candidates stay on top.
  return passing.length > 0 ? passing : entries;
}

// ── Public: Enhanced search ──────────────────────────────────────────────────

export async function enhancedSearch(
  query: string,
  contentType: NgsearchContentType,
  additionalCriteria: SearchCriterion[],
  maxResults: number,
  skipCount = 0,
): Promise<SearchResponse> {
  const variants = expandQuery(query);

  const settled = await Promise.allSettled(
    variants.map(async variant => {
      const criteria = [...variant.criteria, ...additionalCriteria];
      // skipCount is the backend offset applied per variant before the pool is
      // merged/reranked — enables "more results" paging. Default 0 = first page.
      const response = await ngsearch(criteria, contentType, POOL_SIZE, skipCount);
      return { variant, response };
    })
  );

  const successful = settled
    .filter((r): r is PromiseFulfilledResult<{ variant: QueryVariant; response: SearchResponse }> => r.status === 'fulfilled')
    .map(r => r.value);

  if (successful.length === 0) return { nodes: [], pagination: { total: 0, from: 0, count: 0 } };

  const ranked   = mergeAndRank(successful, query);
  const filtered = ranked.filter(r => !isDeletedNode(r.node));
  const topNodes = filtered.slice(0, maxResults).map(r => r.node);
  // Report the TRUE backend hit count of the primary full-query variant
  // (label "full:…") as the total. Previously this was clamped to
  // filtered.length (≤ the merged POOL_SIZE window), badly under-reporting
  // "found N" for broad queries. `count` stays the number returned this page.
  const fullVariant = successful.find(r => r.variant.label.startsWith('full:'));
  const apiTotal = fullVariant
    ? fullVariant.response.pagination.total
    : Math.max(...successful.map(r => r.response.pagination.total), 0);

  return {
    nodes: topNodes,
    pagination: { total: apiTotal, from: skipCount, count: topNodes.length },
  };
}

/** Simple reranking for already-fetched nodes (used for collection contents). */
export function rerankNodes(nodes: WloNode[], query: string): WloNode[] {
  if (!query.trim() || nodes.length === 0) return nodes;
  return nodes
    .filter(n => !isDeletedNode(n))
    .map(n => ({ node: n, score: computeRelevanceScore(n, query), id: getNodeId(n) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.id.localeCompare(b.id);
    })
    .map(s => s.node);
}

/** Deterministic alphabetical sort by title (with nodeId tie-breaker). */
export function sortByTitle(nodes: WloNode[]): WloNode[] {
  return [...nodes].sort((a, b) => {
    const ta = nodeTitle(a).toLowerCase();
    const tb = nodeTitle(b).toLowerCase();
    if (ta !== tb) return ta.localeCompare(tb, 'de');
    return getNodeId(a).localeCompare(getNodeId(b));
  });
}
