/**
 * tools/shared.ts – Helpers shared by all WLO tool modules: query metadata for
 * downstream consumers, topic-page title fallbacks, and the tool error shape.
 *
 * What is left here is genuinely about the MCP tool surface. Two things that
 * were not moved out on 2026-08-04, because `services/` and `rest/` imported
 * them from here and a lower layer must not depend on this one: the
 * bounded-concurrency mapper (`../concurrency.ts`) and the vocabulary
 * label→URI filter builder (`../filter-criteria.ts`).
 */

import { oneLine } from '../formatter.js';
import { sanitizeText } from '../text-sanitize.js';
import { log } from '../logger.js';
// The title rule moved to a leaf module (topic-page-api/-structure and the write
// service need it and must not import from tools/). Re-exported so the tools
// keep one import site.
export { isPlaceholderTitle } from '../topic-page-title.js';
export { pickThemePageTitle } from '../topic-page-variant.js';
import type { LabeledCriterion } from '../filter-criteria.js';

// ── Query metadata for downstream consumers (backend → frontend) ────────────

export interface QueryMeta {
  toolName: string;
  queryType: string;
  searchTerm: string;
  criteria: LabeledCriterion[];
  pagination: { maxItems: number; skipCount: number; totalResults: number };
  repositoryUrl: string;
  searchUrl: string;
  /**
   * Vocab filters the caller supplied that could NOT be resolved to a URI and
   * were therefore silently dropped from the search. Surfaced so the caller can
   * self-correct (e.g. via lookup_wlo_vocabulary). Each may carry up to three
   * fuzzy `suggestions` ("Meintest du?"). Omitted when everything resolved.
   * Publisher is a free-text filter and never appears here.
   */
  unresolvedFilters?: { field: string; value: string; suggestions?: string[] }[];
  /**
   * Facet counts for the current query (opt-in via `includeFacets`), keyed by
   * filter name → labeled buckets, e.g. `{ learningResourceType: [{label, count, uri}] }`.
   * Each bucket carries its concept `uri` so the caller can filter by it exactly —
   * e.g. a university-subject `discipline` facet whose label matches a school
   * subject but whose URI differs. Lets the caller narrow without probe-searches.
   * Omitted when not requested.
   */
  facets?: Record<string, { label: string; count: number; uri: string }[]>;
}

const SEARCH_URL_FILTER_PROPS = new Set([
  'ccm:taxonid',
  'ccm:educationalcontext',
  'ccm:oeh_lrt_aggregated',
  'ccm:educationalintendedenduserrole',
  'ccm:oeh_publisher_combined',
]);

export function buildSearchUrl(repoUrl: string, searchTerm: string, criteria: LabeledCriterion[]): string {
  const filterObj: Record<string, string[]> = {};
  for (const c of criteria) {
    if (SEARCH_URL_FILTER_PROPS.has(c.property)) {
      filterObj[c.property] = c.values;
    }
  }
  const params = new URLSearchParams();
  if (searchTerm) params.set('q', searchTerm);
  if (Object.keys(filterObj).length) params.set('filters', JSON.stringify(filterObj));
  return `${repoUrl}/components/search?${params.toString()}`;
}

export function queryMetaContent(meta: Omit<QueryMeta, 'searchUrl'>): { type: 'text'; text: string } {
  const searchUrl = buildSearchUrl(meta.repositoryUrl, meta.searchTerm, meta.criteria);
  return { type: 'text' as const, text: JSON.stringify({ _queryMeta: { ...meta, searchUrl } }) };
}

// ── Wikipedia resolution disclosure ─────────────────────────────────────────

/**
 * The one sentence that discloses a SUBSTITUTED Wikipedia article, shared by
 * every tool that renders an extract as prose (`get_wikipedia_summary` and
 * `search_wlo_all`).
 *
 * Shared rather than written twice: a caller turning the extract into teaching
 * material appends "Quelle: Wikipedia-Artikel „…"", so the disclosure is what
 * stops a false attribution. It was worded on one surface and forgotten on the
 * other — the more-used one — which is exactly the drift a single source
 * prevents. Returns '' for an exact hit, so callers can append unconditionally.
 */
export function wikiResolutionNotice(
  query: string,
  title: string,
  match: 'exact' | 'fuzzy' | undefined,
): string {
  if (match !== 'fuzzy') return '';
  return `_Kein Artikel „${oneLine(query)}"; per Suche aufgelöst zu „${oneLine(title)}"._`;
}

// ── A node that did not load ────────────────────────────────────────────────

/**
 * Why a node lookup produced nothing, in the words the caller gets to read.
 *
 * `readNodeMetadata` reports the status precisely so this distinction survives
 * into the answer: only a 404 licenses "not found". A refused read is a rights
 * question the caller can act on, an upstream failure is a fact about the
 * server, and both used to reach the user as "this material does not exist" —
 * the one thing we did not learn. Shared because `get_node_details` and the
 * knowledge-convention `fetch` answer the same question about the same read.
 *
 * @param status the HTTP status from `readNodeMetadata` (`0` = unparseable body).
 */
export function nodeLookupMiss(nodeId: string, status: number): string {
  const id = sanitizeText(nodeId);
  if (status === 404) return `Node ${id} nicht gefunden.`;
  if (status === 401 || status === 403) {
    return `Node ${id} ist nicht zugänglich (HTTP ${status}) — das Material ist nicht öffentlich. `
      + 'Das heißt NICHT, dass es nicht existiert.';
  }
  return `Node ${id} ist derzeit nicht abrufbar${status ? ` (HTTP ${status})` : ''} — `
    + 'der Abruf ist fehlgeschlagen, über den Knoten selbst sagt das nichts.';
}

// ── Uniform tool error handling ──────────────────────────────────────────────

/**
 * Build the standard error result for a failed tool call AND log it
 * server-side. Every tool's catch block was previously duplicating the
 * `err instanceof Error ? ...` extraction and returning it to the client
 * WITHOUT any server-side trace — so upstream failures were invisible in the
 * logs. This centralizes both: structured error log + the client-facing
 * `<context>: <detail>` message (behaviour-preserving for callers).
 */
export function toolError(
  context: string,
  err: unknown,
): { content: { type: 'text'; text: string }[]; isError: true } {
  const detail = err instanceof Error ? err.message : String(err);
  log.error('tool error', { context, error: detail });
  return { content: [{ type: 'text' as const, text: `${context}: ${detail}` }], isError: true };
}
