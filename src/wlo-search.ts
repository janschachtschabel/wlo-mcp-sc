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
 * The bucket limit sent with a facet aggregation.
 *
 * NOT the number of buckets that come back — measured 2026-08-17, the server
 * answers with up to FIVE times this (see `FACET_BUCKET_MAX`). It is the knob
 * that sizes the aggregation, and 20 is what the facet output of
 * `services/search.ts` is tuned to: raising it to 100 grows the corpus-wide
 * `ccm:taxonid` facet from 100 buckets to 376.
 */
export const FACET_LIMIT = 20;

/**
 * The most buckets a facet response can carry — a list this long may have been
 * cut, and a sum over a cut list looks authoritative while understating the
 * answer. Exported for callers that SUM buckets; they must test against this,
 * never against `FACET_LIMIT`.
 *
 * The factor of five is measured, not derived (2026-08-17, staging). Asking for
 * N buckets of `ccm:taxonid` answered with exactly 5N every time — 1→5, 2→10,
 * 10→50, 50→250 — until 80→376, which is every distinct value that property has.
 * It is presumably a per-shard limit merged across shards, so it is a property
 * of the deployment: an instance with FEWER shards returns fewer buckets, and
 * this bound would then be too high to catch a real truncation. Re-measure
 * before trusting it elsewhere.
 *
 * Using `FACET_LIMIT` here instead was live until 2026-08-17 and wrong in the
 * expensive direction: staging holds 23 distinct `ccm:commonlicense_key` values
 * corpus-wide, so every broad licence count was discarded as "possibly
 * truncated" and fell back to the family total.
 */
export const FACET_BUCKET_MAX = FACET_LIMIT * 5;

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

/**
 * GET /collection/v1/collections/-home-/search?query=...
 * The OTHER collection index — a separate backend from the mds query above, and
 * measured 2026-08-11 against staging, neither is a superset of the other:
 *
 *  - The mds query cannot return the collection `9e7ae956` ("Optik") for ANY
 *    search word. Terms occurring only in its own keywords ("Oberflächen-
 *    phänomene", "Die Lehre vom Licht") return zero hits there and find it here.
 *  - This endpoint matches resolved vocabulary labels (`ccm:taxonid_DISPLAYNAME`
 *    — "Deutsch" as a subject), which the mds query does not.
 *  - The mds query matches `ccm:oeh_collection_compendium_text`, which this one
 *    does not read at all (6 of 6 checked "Klimawandel" hits).
 *
 * Two properties of the response shape that callers must know:
 *
 *  1. It answers under `collections`, not `nodes`.
 *  2. **It ignores `propertyFilter`** and returns a fixed projection of 46
 *     properties which does NOT include `ccm:page_config_ref` — the property the
 *     Themenseiten split is derived from — nor `cclom:title`. So its nodes are
 *     not interchangeable with ours; `services/collection-search.ts` uses this
 *     as an ID source and re-reads what it contributes. No projection is sent
 *     here for the same reason: it would only lengthen the URL.
 *
 * Latency scales with the number of collections returned (~0.25 s each), so the
 * cap is the cost lever: 0.9–2.7 s at `maxItems=10` versus 1.3–9.7 s at 40.
 *
 * Degrades to `[]` like `searchCollectionsByKeyword`, and for the same reason —
 * it is one leg of a search that must still answer when the other one works.
 */
export async function searchCollectionsByName(query: string, maxItems = 10): Promise<WloNode[]> {
  const q = query.trim();
  if (!q) return [];
  const params = new URLSearchParams({
    query: q,
    maxItems: String(maxItems),
    skipCount: '0',
  });
  const url = `${BASE_URL}/collection/v1/collections/-home-/search?${params}`;
  const res = await wloFetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) { logUpstreamMiss('searchCollectionsByName', res); return []; }
  const data = await readJson<{ collections?: WloNode[] }>(res, 'searchCollectionsByName');
  return data?.collections ?? [];
}
