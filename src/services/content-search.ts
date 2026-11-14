/**
 * services/content-search.ts – the ONE search for individual materials.
 *
 * `search_wlo_content` and the content leg of `search_wlo_all` each carried
 * their own copy of this course — the licence seam, the exclusion of ids seen
 * before, the URL dedupe, the exact-licence pass, the cap, the full-text
 * enrichment (audit 2026-11-12, A-1). Two copies of one search answer the same
 * question differently one fix later.
 *
 * Two defects are closed where both callers now meet:
 *
 * **Paging ran dry (K-2).** The ranked search reads ONE fixed window per call
 * (`WLO_POOL_SIZE` hits per query variant) whatever is asked for. Paging the
 * documented way — the same call again with `excludeNodeIds` — therefore read
 * the same window every time and, once its hits were excluded, answered
 * "nothing found" over a catalogue of thousands; `maxResults: 50` returned
 * what one window held. A page that comes up short is now REFILLED from the
 * following windows, bounded by `REFILL_ROUNDS`; what the bound did not reach is
 * disclosed as `more.nextSkipCount` instead of reading as the end.
 *
 * **Full text had no bound (P-5).** `includeTextContent` cost one text read per
 * hit, up to fifty, and a read that failed left the same empty string as a
 * record without text. `enrichStoredText` reads for the first
 * `TEXT_ENRICH_MAX` hits — the bound the detail tools use — and names the rest
 * and the failures.
 */

import type { SearchCriterion, SearchResponse } from '../wlo-api.js';
import { ngsearch } from '../wlo-api.js';
import { ENHANCED_POOL_SIZE, enhancedSearch } from '../reranker.js';
import { formatNodes, type FormattedNode } from '../formatter.js';
import { filterByExactLicense, pageSizeForLicense } from '../filter-criteria.js';
import { dedupeByUrl } from '../result-dedupe.js';
import { mapPool } from '../concurrency.js';
import { capText } from '../text-cap.js';
import { searchWithLicense } from './license-search.js';
import { fileTextFor, isStoredText, readStoredText, storedTextAnswered } from './content-text.js';
import { storedFileOf } from './node-details.js';
import { TEXT_CONTENT_CAP, TEXT_ENRICH_MAX } from './node-details.js';

/**
 * How many FURTHER windows a short page may read. Each is a whole ranked search
 * (one request per query variant, per licence key), so this bounds the cost of
 * one call at four times an ordinary one — enough for a hundred seen ids, and
 * past it the answer says where to continue. In numbers: an ordinary search is
 * up to 6 requests at once, one with the OER bundle up to 4 × 6 + 1; a page
 * that stays short through every round costs four times that, one round after
 * the other (the gate's 24 hold one round).
 */
export const REFILL_ROUNDS = 3;

/** The most query variants `expandQuery` builds (full, title, keyword, no-stopword, topic, synonym). */
const RANKED_VARIANTS_MAX = 6;

export interface ContentSearchOptions {
  query: string;
  /** Resolved filter criteria (`buildFilterCriteria`). */
  filters: SearchCriterion[];
  license?: string;
  /** How many results the caller wants. */
  max: number;
  skipCount: number;
  /** Ids the caller has seen — never returned again. */
  excluded: ReadonlySet<string>;
  /**
   * What an EMPTY query means: `browse` lists by the filters alone (plain
   * search, no ranking); `ranked` sends it through the ranked search like any
   * other. The two callers differed here before they shared this function.
   */
  emptyQuery?: 'browse' | 'ranked';
}

export interface ContentSearchResult {
  results: FormattedNode[];
  /** The catalogue's count for the query — not the number returned. */
  total: number;
  /** Candidates before and after the exact-licence pass; equal when no licence was asked. */
  checked: number;
  kept: number;
  queryType: 'ngsearch_enhanced' | 'ngsearch';
  /** The criteria of the first window, for `_queryMeta`. */
  criteria: SearchCriterion[];
  /**
   * A query variant of a window read here did not answer: the list may lack
   * hits, and an empty one is no finding.
   */
  incomplete?: true;
  /**
   * Set when fewer than `max` came back ALTHOUGH the catalogue holds more: the
   * bounded refill ended first. Absent when the page is full, and when the
   * windows themselves said they were the last (`SearchResponse.exhausted`).
   */
  // (see `incomplete` below for a window whose variants did not all answer)
  more?: { nextSkipCount: number };
}

export async function searchContent(opts: ContentSearchOptions): Promise<ContentSearchResult> {
  const { query, filters, license, max, excluded } = opts;
  const ranked = Boolean(query.trim()) || opts.emptyQuery === 'ranked';
  const browseCriteria: SearchCriterion[] = filters.length ? filters : [{ property: 'ngsearchword', values: ['*'] }];
  const criteria: SearchCriterion[] = ranked ? [{ property: 'ngsearchword', values: [query || '*'] }, ...filters] : browseCriteria;

  // Over-fetch by the exclusion count so that after dropping already-seen ids
  // the page can still fill; never below `max`. The `+200` is a local second
  // bound beside the schema's cap on `excludeNodeIds`.
  const wanted = excluded.size > 0 ? Math.min(max + excluded.size, max + 200) : max;
  // The ranked search reads its own fixed pool per variant and ignores `size`
  // upstream — `size` only decides how much of the merged, ranked window it
  // hands back. So the WHOLE window is asked for (it costs nothing): cutting it
  // to the page size first meant that a page left short by dedupe or the
  // licence pass jumped to the next backend window and never looked at ranks
  // 9…125 of the one in hand, which rank higher (review of this package).
  const size = ranked
    ? Math.max(pageSizeForLicense(wanted, license), ENHANCED_POOL_SIZE * RANKED_VARIANTS_MAX)
    : pageSizeForLicense(wanted, license);
  // How far ONE window advances the backend offset.
  const step = ranked ? ENHANCED_POOL_SIZE : size;

  const readWindow = (skip: number, withTotal: boolean): Promise<SearchResponse> => searchWithLicense({
    license, criteria, size, skipCount: skip, withTotal,
    run: ranked
      ? (extra, n, s) => enhancedSearch(query, 'FILES', [...filters, ...extra], n, s)
      // The plain search has no notion of a last window; a short one is it.
      : async (extra, n, s) => {
          const response = await ngsearch([...browseCriteria, ...extra], 'FILES', n, s);
          return { ...response, exhausted: response.nodes.length < n };
        },
  });

  const seen = new Set<string>();
  let candidates: FormattedNode[] = [];
  let licensed: FormattedNode[];
  let total = 0;
  let skip = opts.skipCount;
  let reachedEnd: boolean;
  let partial = false;
  for (let round = 0; ; round++) {
    // The exact total (one facet request for a licence) is asked ONCE.
    const response = await readWindow(skip, round === 0);
    if (round === 0) total = response.pagination.total;
    partial ||= response.incomplete === true;
    const fresh = response.nodes.filter(n => {
      const id = n.ref?.id ?? '';
      // A node without an id cannot be excluded or recognised again; it is kept, as before.
      if (!id) return true;
      if (excluded.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    // Dedupe BEFORE the cap, so `max` distinct materials come back rather than
    // one material plus its re-imports (result-dedupe.ts); the licence pass for
    // the same reason — the upstream key matches a licence FAMILY.
    candidates = dedupeByUrl([...candidates, ...formatNodes(fresh)]);
    licensed = filterByExactLicense(candidates, license);
    skip += step;
    // The end is read off the WINDOW, never off `total`: that number counts one
    // query variant (resp. the exact licence) while the paging runs over all
    // variants (resp. the licence family). Measured on the two cases it broke:
    // a framing query whose full variant matches nothing while its topic
    // variant holds 480, and a single licence whose family is 343 for 42 exact.
    reachedEnd = windowWasLast(response);
    if (licensed.length >= max || reachedEnd || round >= REFILL_ROUNDS) break;
  }

  const results = licensed.slice(0, max);
  return {
    results, total, checked: candidates.length, kept: licensed.length,
    queryType: ranked ? 'ngsearch_enhanced' : 'ngsearch',
    criteria,
    ...(results.length < max && !reachedEnd ? { more: { nextSkipCount: skip } } : {}),
    ...(partial ? { incomplete: true as const } : {}),
  };
}

/**
 * Whether a ranked window was the LAST one: every variant came back short of
 * its pool — or the window is simply empty. The second half is not redundant:
 * the ranked search does not claim the end when one variant FAILED (a failure
 * tells nothing), so an empty window with one failed variant would read as
 * "there is more" for good. ONE rule for the single and the many search — the
 * many search had only the first half and answered `count: 0, more: true`
 * (chatbot team, 2026-11-15).
 */
export function windowWasLast(response: { exhausted?: boolean; nodes: unknown[] }): boolean {
  return response.exhausted === true || response.nodes.length === 0;
}

/** What `enrichStoredText` could not attach, and why. Both lists are empty in the ordinary case. */
export interface StoredTextReport {
  /** Not read at all: past `TEXT_ENRICH_MAX`. */
  skipped: string[];
  /** Read, and the read failed. NOT the same as a record without text (that is `textContent: ''`). */
  unreadable: string[];
}

/**
 * Attach each node's stored full text, capped, for the first `TEXT_ENRICH_MAX`
 * nodes. A node whose text was not read or could not be read keeps
 * `textContent` UNSET and is named in the report — an empty string is reserved
 * for "the repository answered, and there is none".
 */
export async function enrichStoredText(nodes: FormattedNode[]): Promise<StoredTextReport> {
  const unreadable: string[] = [];
  await mapPool(nodes.slice(0, TEXT_ENRICH_MAX), 10, async (n) => {
    const read = await readStoredText(n.nodeId);
    // A 200 whose body names no text FIELD at all is no answer either — not
    // "this record has none". `{"text":null}` IS that answer: what the
    // repository says for a file it extracts nothing from (measured 2026-11-13;
    // it was reported as unreadable, i.e. "try again", for a state that stays).
    if (!storedTextAnswered(read)) { unreadable.push(n.nodeId); return null; }
    // Blank or binary debris is no text: the ONE rule of every path that shows
    // stored text — and so is the way out for a file that IS text.
    const text = isStoredText(read.text) ? read.text : (await fileTextFor(n.nodeId, storedFileOf(n)))?.text ?? null;
    n.textContent = text ? capText(text, TEXT_CONTENT_CAP).text : '';
    return null;
  });
  return { skipped: nodes.slice(TEXT_ENRICH_MAX).map(n => n.nodeId), unreadable: unreadable.sort() };
}

/**
 * The same sentences from the fields an envelope carries — for the renderers
 * of `searchAll` (the tool's markdown, the HTML page). An envelope field the
 * renderer drops is not a disclosure.
 */
export function contentBucketNotices(bucket: {
  count: number; total: number; more?: { nextSkipCount: number }; incomplete?: true;
  textContentSkipped?: string[]; textContentUnreadable?: string[];
}): string[] {
  return contentSearchNotices(bucket.more, bucket.count, bucket.total,
    { skipped: bucket.textContentSkipped ?? [], unreadable: bucket.textContentUnreadable ?? [] }, bucket.incomplete);
}

/**
 * A content search whose query variants did not all answer. The wording carries
 * the phrase clients recognise an outage by („hat nicht (vollständig)
 * geantwortet“, pinned in `tests/refused-is-not-unreachable.test.ts`).
 */
export function contentIncompleteNotice(empty: boolean): string {
  return empty
    ? 'Hinweis: Die Inhaltssuche hat nicht (vollständig) geantwortet — „keine Treffer“ ist hier kein Befund. Ein erneuter Aufruf kann sie vervollständigen.'
    : 'Hinweis: Die Inhaltssuche hat nicht (vollständig) geantwortet — die Liste kann Treffer auslassen. Ein erneuter Aufruf kann sie vervollständigen.';
}

/** The German sentences for a `more`, an incomplete search and a text report — one wording for both tools. */
export function contentSearchNotices(
  more: ContentSearchResult['more'], shown: number, total: number, text?: StoredTextReport, incomplete?: boolean,
): string[] {
  const lines: string[] = [];
  if (incomplete) lines.push(contentIncompleteNotice(shown === 0));
  if (more) {
    lines.push(shown === 0
      ? `Auf dieser Seite keine weiteren Treffer — das ist nicht das Ende des Katalogs. Weiter mit skipCount=${more.nextSkipCount}; schon gesehene IDs dabei weiter über excludeNodeIds mitgeben.`
      : `Nur ${shown} neue Treffer auf dieser Seite, der Katalog hält mehr. Weitere mit skipCount=${more.nextSkipCount}; schon gesehene IDs dabei weiter über excludeNodeIds mitgeben.`);
  }
  if (text?.skipped.length) lines.push(`Volltext nur für die ersten ${TEXT_ENRICH_MAX} Treffer; ohne: ${text.skipped.join(', ')} (einzeln: get_wlo_content_text).`);
  if (text?.unreadable.length) lines.push(`Volltext nicht abrufbar (Abruf fehlgeschlagen, nicht „kein Text“): ${text.unreadable.join(', ')}.`);
  return lines;
}
