/**
 * services/url-matches.ts – which records carry this source address?
 *
 * Two callers ask, with different consequences. The create path
 * (`write/duplicates.ts`) BLOCKS on a hit, so it accepts only the exact
 * spelling. `find_content_by_url` (BOERDi wishlist item 2, 2026-11-06) only
 * reports, so it also looks for the cleaned spelling and says which kind of hit
 * each one is — `exact` the chatbot treats as a duplicate, `normalized` it asks
 * about.
 *
 * Measured on staging 2026-11-06 (four real records): a `ccm:wwwurl` criterion
 * is case-insensitive and brings NEIGHBOURS along (a longer address sharing the
 * prefix, e.g. `…-teil-2`), but a spelling with a trailing slash or a
 * `?utm_source=` finds the stored clean address NOT at all. So the cleaned
 * spellings are asked for explicitly, and every hit is compared — a neighbour is
 * never a match.
 *
 * The hits are ORIGINALS (measured 2026-11-06: 0 collection references among the
 * exact hits for 50 real addresses, checked on `ccm:original`), which is why the
 * "this address already has a record — file that one" branch of
 * `wlo_create_content` files the hit's id without resolving it first.
 */

import { nodeTitle } from '../node-match.js';
import { ngsearch } from '../wlo-search.js';

export interface UrlRecord {
  nodeId: string;
  title: string;
  /** The address as the repository stores it. */
  url: string;
}

/**
 * How many hits one spelling may bring back: copies of the address and its
 * neighbours both arrive here, and the comparison downstream tells them apart.
 *
 * Twenty is enough because the stored address ranks FIRST (measured 2026-11-06:
 * 40 of 40 real records at position 0 of the search for their own address, none
 * with more than 20 hits). A bare host is where neighbours pile up
 * (`leifiphysik.de` 673, `planet-schule.de` 873) — re-measure the rank before
 * lowering this or relying on it for such an address.
 */
const URL_SCAN_LIMIT = 20;

/** Every record the repository returns for ONE spelling of an address. */
export async function recordsForUrl(spelling: string): Promise<UrlRecord[]> {
  const { nodes } = await ngsearch(
    [{ property: 'ccm:wwwurl', values: [spelling] }],
    'FILES',
    URL_SCAN_LIMIT,
    0,
    ['ccm:wwwurl', 'cclom:title', 'cm:title', 'cm:name'],
  );
  return nodes.flatMap(node => {
    const url = node.properties?.['ccm:wwwurl']?.[0];
    if (!url) return [];
    return [{
      nodeId: node.ref?.id ?? '',
      title: nodeTitle(node),
      url,
    }];
  });
}

/** Query parameters that track a click and never select a page. */
const TRACKING_PARAM = /^(utm_.*|fbclid|gclid)$/i;

/**
 * The cleaned form of a source address: scheme and host lower-case (`URL` does
 * that), no fragment, no tracking parameters, no trailing slash on the path.
 * `null` for anything that is not an http(s) URL. The PATH keeps its case — on
 * most sites, Wikipedia first, it selects a different page.
 */
export function normalizeSourceUrl(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}${url.search}`;
}

export interface UrlMatch extends UrlRecord {
  match: 'exact' | 'normalized';
}

/**
 * Every record whose address is this one — exactly as given, or after cleaning.
 * Asks for up to three spellings (as given, cleaned, cleaned with a trailing
 * slash), because a decorated spelling does not find the clean one.
 *
 * @throws when a search fails: "could not look" must not read as "no record".
 */
export async function findUrlMatches(input: string, normalized: string): Promise<UrlMatch[]> {
  const given = input.trim();
  const url = new URL(normalized);
  const withSlash = `${url.origin}${url.pathname}/${url.search}`;
  const spellings = [...new Set([given, normalized, withSlash])];
  const found = (await Promise.all(spellings.map(recordsForUrl))).flat();

  const exact = given.toLowerCase();
  const clean = normalized.toLowerCase();
  const byId = new Map<string, UrlMatch>();
  for (const r of found) {
    if (byId.has(r.nodeId)) continue;
    const stored = r.url.trim().toLowerCase();
    if (stored === exact) byId.set(r.nodeId, { ...r, match: 'exact' });
    else if (normalizeSourceUrl(r.url)?.toLowerCase() === clean) byId.set(r.nodeId, { ...r, match: 'normalized' });
  }
  return [...byId.values()];
}
