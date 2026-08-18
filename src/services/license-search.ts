/**
 * services/license-search.ts – finding material under a licence, and saying how
 * much of it there is.
 *
 * A single licence narrows upstream: `ccm:commonlicense_key=CC_BY_SA` is a
 * criterion the repository accepts, and `buildFilterCriteria` puts it in the
 * caller's filters. A SET cannot be expressed at all — measured 2026-08-09, two
 * values answer 400 `DAOValidationException`, the criterion repeated twice
 * AND-s, and an "A OR B" string matches nothing.
 *
 * The first answer to that was to send no criterion for the bundle and let
 * `filterByExactLicense` sort the generic result page out locally. Measured the
 * same day, that answer was wrong, not merely weak: staging's `Mathematik` holds
 * **18 793** records with an OER licence — 41.9 % of everything that carries a
 * licence at all, counted server-side by facet — and the tool replied "kein
 * Treffer mit genau der Lizenz OER". The first fifty by relevance carried no
 * `ccm:commonlicense_key` whatsoever (50/50 absent through plain search; through
 * `enhancedSearch`, 23× CC BY-NC-SA and 2× CUSTOM). Relevance ranking and
 * licence are unrelated, so the top of one is no sample of the other.
 *
 * So the bundle asks once per key and merges. Five requests instead of one, and
 * only when the caller actually asked for the bundle — a single licence and no
 * licence both stay at one.
 *
 * The search itself arrives as a function. That is what lets the same rule serve
 * `enhancedSearch` (a query) and plain `ngsearch` (browsing by filters alone)
 * without this module knowing either, and it is what makes the fan-out testable
 * without a network. The exact COUNT is the one thing that does not come through
 * that seam: it is always a plain `ngsearch` aggregation over the caller's own
 * criteria, and running it through `enhancedSearch` — which fans out over query
 * variants and merges — would aggregate something nobody asked for.
 */

import type { SearchCriterion, SearchResponse } from '../wlo-api.js';
import { FACET_BUCKET_MAX, ngsearch } from '../wlo-api.js';
import { resolveLicenseSelection } from '../filter-criteria.js';
import { resolveVocab } from '../vocabs.js';
import { mapPool } from '../concurrency.js';

/** The property a licence key filters on. */
const LICENSE_PROPERTY = 'ccm:commonlicense_key';

/**
 * Every key at once: the fan-out is the point, and this order of parallelism is
 * what `enhancedSearch` already spends on its query variants.
 *
 * Deliberately not tied to the bundle's current size (four keys since
 * 2026-08-12, when `COPYRIGHT_FREE` was removed as not-an-open-licence). A limit
 * BELOW the bundle would silently serialise the last key, so the headroom is the
 * point of the constant, not the number.
 */
const FANOUT_LIMIT = 5;

/** Runs one search, given extra criteria to add to the caller's own. */
export type RunSearch = (
  extra: SearchCriterion[],
  size: number,
  skipCount: number,
) => Promise<SearchResponse>;

export interface LicenseSearchOptions {
  /** The caller's `license` input, unresolved — a label, a key, or the bundle. */
  license: string | undefined;
  /**
   * The criteria the caller is searching with. Only the exact count uses them;
   * the search itself already carries them inside `run`.
   */
  criteria: SearchCriterion[];
  size: number;
  skipCount: number;
  run: RunSearch;
}

/**
 * How many records carry EXACTLY one of the selected licences.
 *
 * The upstream criterion cannot answer this and neither can the result page:
 * `ccm:commonlicense_key` matches a licence FAMILY, so `pagination.total` counts
 * the family. Measured on staging 2026-08-09 — "Optik" + CC_BY reports 343 over
 * 42 actual CC BY records, and for the bundle the five family totals OVERLAP
 * (the CC_BY family contains CC_BY_SA: Mathematik 27 351 vs 3 848 + 9 554), so
 * adding them counted the same records twice and overstated by 98–164 %.
 *
 * The facet counts exact keys server-side over the whole result set — one extra
 * request, and only when a licence is filtered at all. Buckets are matched
 * through `resolveVocab`, the same resolution `filterByExactLicense` applies to
 * a node, so the count and the list it describes obey one rule: staging holds
 * `CC BY-SA` spelled with spaces as its own key, and a literal comparison would
 * count it as neither.
 *
 * Returns null when the aggregation gives no answer — the caller then keeps the
 * upstream number rather than turning a working search into a failed one.
 */
async function exactLicenseTotal(
  criteria: SearchCriterion[],
  keys: string[],
): Promise<number | null> {
  const resp = await ngsearch(criteria, 'FILES', 1, 0, undefined, [LICENSE_PROPERTY])
    .catch(() => null);
  const buckets = resp?.facets?.find(f => f.property === LICENSE_PROPERTY)?.values;
  if (!buckets?.length) return null;
  // A full bucket list may have been cut, and a sum over a truncated list
  // understates the corpus while looking exact. We cannot tell "that is every
  // distinct licence there is" from "there were more", so the honest answer is
  // the fallback.
  //
  // The threshold is `FACET_BUCKET_MAX`, NOT the limit we asked for: measured
  // 2026-08-17, the server answers with up to five times the requested limit, and
  // staging holds 23 distinct keys against a request for 20. Testing against
  // `FACET_LIMIT` therefore discarded a complete, correct count on every broad
  // licence search and fell back to the family total this module exists to avoid.
  if (buckets.length >= FACET_BUCKET_MAX) return null;
  const allowed = new Set(keys);
  return buckets.reduce((sum, b) => {
    const key = resolveVocab(b.value, 'license');
    return key && allowed.has(key) ? sum + (b.count ?? 0) : sum;
  }, 0);
}

/**
 * Search under a licence selection.
 *
 * No licence — and an unresolvable one, which the caller reports as unresolved
 * rather than silently narrowing anything — goes straight through: one call, no
 * extra criteria, and no count, because the upstream total is already right.
 *
 * Known limit: `skipCount` is passed to every key, so paging over the bundle
 * pages each family separately and the merged pages are not a partition. The
 * alternative — one global ordering across five result sets — is not something
 * the repository can give us, so the limit is DISCLOSED rather than hidden:
 * `licensePagingNotice` says it on every page after the first.
 */
export async function searchWithLicense(opts: LicenseSearchOptions): Promise<SearchResponse> {
  const { license, criteria, size, skipCount, run } = opts;
  const keys = resolveLicenseSelection(license);
  if (!keys) return run([], size, skipCount);

  const withExactTotal = (resp: SearchResponse, exact: number | null): SearchResponse =>
    exact === null ? resp : { ...resp, pagination: { ...resp.pagination, total: exact } };

  if (keys.length === 1) {
    const [resp, exact] = await Promise.all([
      run([], size, skipCount),
      exactLicenseTotal(criteria, keys),
    ]);
    return withExactTotal(resp, exact);
  }

  const [answers, exact] = await Promise.all([
    mapPool(keys, FANOUT_LIMIT, async key =>
      run([{ property: LICENSE_PROPERTY, values: [key] }], size, skipCount),
    ),
    exactLicenseTotal(criteria, keys),
  ]);

  // `mapPool` answers null for a key whose request threw. Losing one licence's
  // hits is bad; losing the other four because of it would be worse.
  const lists = answers.filter((a): a is SearchResponse => a !== null);
  // Losing ALL of them is a different event, though, and it must not be reported
  // as a result: an empty answer here is indistinguishable from "there is no
  // freely reusable material on this topic". Every other search path throws when
  // the repository is unreachable, and so does this one.
  if (!lists.length) {
    throw new Error(
      `Lizenz-Suche fehlgeschlagen: keine der ${keys.length} Anfragen an das Repository wurde beantwortet.`,
    );
  }

  const nodes: SearchResponse['nodes'] = [];
  const seen = new Set<string>();
  // Round-robin, not concatenation. There is no ranking ACROSS the five result
  // sets, and appending them hands the whole result cap to whichever key comes
  // first: measured live, `Mathematik` + OER then returned six hits, all CC 0 —
  // the rarest of the five at 191 records — while the 11 563 CC BY-SA ones never
  // reached the page. Taking each key's best hit before any key's second is the
  // only fair merge available.
  const longest = Math.max(0, ...lists.map(a => a.nodes?.length ?? 0));
  for (let rank = 0; rank < longest; rank++) {
    for (const list of lists) {
      const node = list.nodes?.[rank];
      if (!node) continue;
      // The keys match FAMILIES, so one record can answer to more than one of
      // them — and a duplicate would spend a result slot on itself.
      const id = node.ref?.id ?? '';
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      nodes.push(node);
    }
  }

  // The summed families are the fallback, not the answer — see exactLicenseTotal.
  const summed = lists.reduce((sum, a) => sum + (a.pagination?.total ?? 0), 0);
  return {
    nodes,
    pagination: { total: exact ?? summed, from: skipCount, count: nodes.length },
  };
}
