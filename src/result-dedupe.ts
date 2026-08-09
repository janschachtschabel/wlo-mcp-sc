/**
 * result-dedupe.ts – The ONE rule for collapsing search hits that are the same
 * material seen more than once. Both search paths import it: `search_wlo_content`
 * (enhancedSearch/ngsearch directly) and `searchAll` (which feeds `search_wlo_all`,
 * `search` and the REST layer) — the rule must not be written twice.
 *
 * Why the URL and not `ccm:original`: measured on staging 2026-08-09, the query
 * "Optik" returned EIGHT separate `ccm:io` records whose `ccm:wwwurl` was all
 * `https://de.wikipedia.org/wiki/Optik`. None was a collection reference —
 * `originalId` was null and `ccm:original` pointed at each node ITSELF, so the
 * `ccm:original` rule (see wlo-collections-references) collapses nothing here.
 * Their `cm:name` carried edu-sharing's collision suffixes (`… - 2` … `- 6`):
 * repeated imports of one web page, not one record seen repeatedly.
 */

/** The minimum a node must expose to be deduplicated — `FormattedNode` satisfies it. */
interface UrlBearing {
  url: string;
}

/**
 * Drop every hit whose `url` was already seen, keeping the FIRST occurrence.
 *
 * First, not newest, and the difference was measured: among those eight records
 * the newest by `cm:created` was an untouched `1.0` copy, while the only one
 * carrying editorial work (`cm:versionLabel 1.2`) was the OLDEST. "Newest wins"
 * would therefore have discarded the edited record — and neither `cm:created`
 * nor `cm:versionLabel` is in the search projection, so ordering by them would
 * widen every search request. The incoming order is the ranking (backend
 * relevance, refined by the reranker), so the first hit is the copy the search
 * already judged best.
 *
 * Nodes with an empty `url` are never collapsed: `formatNode` leaves it empty
 * only when a node has neither `ccm:wwwurl` nor a content URL, and treating ''
 * as a key would merge unrelated records into one.
 */
export function dedupeByUrl<T extends UrlBearing>(nodes: T[]): T[] {
  const seen = new Set<string>();
  return nodes.filter((n) => {
    if (!n.url) return true;
    if (seen.has(n.url)) return false;
    seen.add(n.url);
    return true;
  });
}
