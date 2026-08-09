/**
 * wlo-search.ts – edu-sharing search endpoints.
 *
 * `ngsearch` (full-text FILE search, with optional server-side facet
 * aggregation) and `searchCollectionsByKeyword` (the COLLECTIONS endpoint that
 * correctly returns `ccm:map` nodes). Both go through the shared `wloFetch` +
 * `propertyFilter` helpers in `wlo-config`.
 */

import { BASE_URL, DISPLAY_PROPS, appendPropertyFilter } from './wlo-config.js';
import { HEADERS, wloFetch, logUpstreamMiss } from './wlo-fetch.js';
import { readJson } from './read-json.js';
import type { SearchCriterion, SearchResponse, WloNode } from './wlo-types.js';

/**
 * POST /search/v1/queries/-home-/mds_oeh/ngsearch
 * Search for FILE nodes. Uses contentType=FILES (default).
 * NOTE: contentType=FOLDERS/COLLECTIONS returns 0 for anonymous users —
 *       use searchCollectionsByKeyword() for collection search instead.
 */
export type NgsearchContentType = 'FILES' | 'FILES_AND_FOLDERS';

/**
 * How many buckets a facet aggregation may return.
 *
 * Exported because a caller that SUMS buckets has to know it: a response holding
 * exactly this many is possibly truncated, and a sum over a truncated list looks
 * authoritative while understating the answer. Staging carries 16 distinct
 * `ccm:commonlicense_key` values over the whole index (measured 2026-08-09), so
 * 20 is complete there — but that is a property of one instance, not of the
 * format.
 */
export const FACET_LIMIT = 20;

export async function ngsearch(
  criteria: SearchCriterion[],
  contentType: NgsearchContentType = 'FILES',
  maxItems = 20,
  skipCount = 0,
  props: string[] | undefined = DISPLAY_PROPS,
  facets?: string[],
): Promise<SearchResponse> {
  const params = new URLSearchParams({
    contentType,
    maxItems: String(maxItems),
    skipCount: String(skipCount),
  });
  appendPropertyFilter(params, props);

  const url = `${BASE_URL}/search/v1/queries/-home-/mds_oeh/ngsearch?${params}`;
  const payload: Record<string, unknown> = {
    criteria: criteria.map(c => ({ property: c.property, values: c.values })),
  };
  // Opt-in facet aggregation — the edu-sharing ngsearch backend counts the
  // given properties over the result set server-side (verified live).
  if (facets && facets.length) {
    payload['facets'] = facets.map(p => ({ property: p }));
    payload['facetLimit'] = FACET_LIMIT;
    payload['facetMinCount'] = 1;
  }
  const body = JSON.stringify(payload);

  const res = await wloFetch(url, { method: 'POST', headers: HEADERS, body });
  if (!res.ok) throw new Error(`ngsearch failed: ${res.status} ${res.statusText}`);

  // Throws rather than degrading: search is the primary read of the call it
  // serves, and an empty result set would be read as "nothing matched".
  const data = await readJson<{
    nodes?: WloNode[];
    pagination?: SearchResponse['pagination'];
    facets?: SearchResponse['facets'];
  }>(res, 'ngsearch');
  if (!data) throw new Error('ngsearch: upstream response was not valid JSON');
  return {
    nodes: data.nodes ?? [],
    pagination: data.pagination ?? { total: 0, from: 0, count: 0 },
    facets: data.facets,
  };
}

/**
 * POST /search/v1/queries/-home-/mds_oeh/collections?contentType=COLLECTIONS
 * Full-text keyword search that returns real COLLECTION nodes (isDirectory=true).
 * Unlike ngsearch with filter=collections, this endpoint correctly returns ccm:map nodes.
 */
export async function searchCollectionsByKeyword(
  query: string,
  maxItems = 10,
  props: string[] | undefined = DISPLAY_PROPS,
): Promise<WloNode[]> {
  const params = new URLSearchParams({
    contentType: 'COLLECTIONS',
    maxItems: String(maxItems),
    skipCount: '0',
  });
  appendPropertyFilter(params, props);
  const url = `${BASE_URL}/search/v1/queries/-home-/mds_oeh/collections?${params}`;
  const body = JSON.stringify({ criteria: [{ property: 'ngsearchword', values: [query] }] });
  const res = await wloFetch(url, { method: 'POST', headers: HEADERS, body });
  if (!res.ok) { logUpstreamMiss('searchCollectionsByKeyword', res); return []; }
  const data = await readJson<{ nodes?: WloNode[] }>(res, 'searchCollectionsByKeyword');
  return data?.nodes ?? [];
}
