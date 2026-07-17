/**
 * wlo-search.ts – edu-sharing search endpoints.
 *
 * `ngsearch` (full-text FILE search, with optional server-side facet
 * aggregation) and `searchCollectionsByKeyword` (the COLLECTIONS endpoint that
 * correctly returns `ccm:map` nodes). Both go through the shared `wloFetch` +
 * `propertyFilter` helpers in `wlo-config`.
 */

import {
  BASE_URL, DISPLAY_PROPS, HEADERS, appendPropertyFilter, wloFetch, logUpstreamMiss,
  type SearchCriterion, type SearchResponse, type WloNode,
} from './wlo-config.js';

/**
 * POST /search/v1/queries/-home-/mds_oeh/ngsearch
 * Search for FILE nodes. Uses contentType=FILES (default).
 * NOTE: contentType=FOLDERS/COLLECTIONS returns 0 for anonymous users —
 *       use searchCollectionsByKeyword() for collection search instead.
 */
export type NgsearchContentType = 'FILES' | 'FILES_AND_FOLDERS';

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
    payload['facetLimit'] = 20;
    payload['facetMinCount'] = 1;
  }
  const body = JSON.stringify(payload);

  const res = await wloFetch(url, { method: 'POST', headers: HEADERS, body });
  if (!res.ok) throw new Error(`ngsearch failed: ${res.status} ${res.statusText}`);

  const data = await res.json() as {
    nodes?: WloNode[];
    pagination?: SearchResponse['pagination'];
    facets?: SearchResponse['facets'];
  };
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
  const data = await res.json() as { nodes?: WloNode[] };
  return data.nodes ?? [];
}
