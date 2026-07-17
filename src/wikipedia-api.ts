/**
 * wikipedia-api.ts – Minimal Wikipedia REST client for external-knowledge
 * enrichment (compendium/orientation next to WLO material).
 *
 * Isolated from the WLO/edu-sharing client on purpose: it targets a different
 * host, needs its own descriptive User-Agent (Wikimedia policy), and must never
 * pull WLO config into a public encyclopedia lookup. No API key required.
 *
 * Two endpoints:
 *   - REST summary: ``https://<lang>.wikipedia.org/api/rest_v1/page/summary/{title}``
 *     — the lead extract, thumbnail, and canonical page URL for an exact title.
 *   - opensearch:   ``https://<lang>.wikipedia.org/w/api.php?action=opensearch``
 *     — used only as a fallback to resolve a fuzzy/misspelled query to a real
 *       title when the direct summary misses.
 */

import { log } from './logger.js';
import { WLO_FETCH_TIMEOUT_MS } from './wlo-api.js';

/**
 * Descriptive User-Agent — Wikimedia's REST API policy requires one that
 * identifies the client and a contact/product URL, else requests may be
 * throttled or blocked.
 */
const WIKI_USER_AGENT =
  'WLO-MCP-Server/1.0 (https://wirlernenonline.de; Model Context Protocol server)';

export interface WikiSummary {
  title: string;
  extract: string;
  thumbnail?: string;
  url: string;
  lang: string;
}

/** Raw REST summary shape (only the fields we consume). */
interface RestSummary {
  type?: string;
  title?: string;
  extract?: string;
  thumbnail?: { source?: string };
  content_urls?: { desktop?: { page?: string } };
  lang?: string;
}

/**
 * ``fetch`` for Wikipedia: attaches the required User-Agent and the shared
 * upstream timeout (``WLO_FETCH_TIMEOUT_MS``) so a hung socket can't block a
 * tool call. Reuses the WLO timeout constant rather than parsing its own env.
 */
function wikiFetch(url: string): Promise<Response> {
  return fetch(url, {
    headers: { 'User-Agent': WIKI_USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(WLO_FETCH_TIMEOUT_MS),
  });
}

/** Keep at most ``sections`` leading paragraphs of the extract (bounds size). */
function capSections(extract: string, sections: number): string {
  const paras = extract.split(/\n\n+/);
  return paras.slice(0, Math.max(1, sections)).join('\n\n').trim();
}

/**
 * Fetch the REST summary for an EXACT title. Returns null on 404, on a
 * non-article (e.g. ``disambiguation``), or when there is no extract.
 */
async function fetchSummaryByTitle(
  title: string,
  lang: string,
  sections: number,
): Promise<WikiSummary | null> {
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  let res: Response;
  try {
    res = await wikiFetch(url);
  } catch (err) {
    log.warn('wikipedia summary fetch failed', { title, lang, error: String(err) });
    return null;
  }
  if (!res.ok) return null;
  const data = (await res.json()) as RestSummary;
  if (!data.extract || (data.type && data.type !== 'standard')) return null;
  return {
    title: data.title ?? title,
    extract: capSections(data.extract, sections),
    thumbnail: data.thumbnail?.source,
    url: data.content_urls?.desktop?.page ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    lang: data.lang ?? lang,
  };
}

/** opensearch → the best-matching real title for a fuzzy query, or null. */
async function resolveTitle(query: string, lang: string): Promise<string | null> {
  const params = new URLSearchParams({
    action: 'opensearch',
    search: query,
    limit: '1',
    namespace: '0',
    format: 'json',
  });
  const url = `https://${lang}.wikipedia.org/w/api.php?${params}`;
  let res: Response;
  try {
    res = await wikiFetch(url);
  } catch (err) {
    log.warn('wikipedia opensearch failed', { query, lang, error: String(err) });
    return null;
  }
  if (!res.ok) return null;
  // opensearch shape: [query, titles[], descriptions[], urls[]]
  const data = (await res.json()) as [string, string[], string[], string[]];
  return Array.isArray(data) && Array.isArray(data[1]) && data[1].length ? data[1][0] : null;
}

/**
 * Resolve a query to a Wikipedia article summary. Tries the direct title
 * lookup first; on a miss, resolves a real title via opensearch and retries.
 * Returns null when no article matches.
 *
 * @param sections 1..3 leading paragraphs of the lead extract to keep (default 1).
 */
export async function fetchWikipediaSummary(
  query: string,
  lang = 'de',
  sections: 1 | 2 | 3 = 1,
): Promise<WikiSummary | null> {
  // `lang` is interpolated into the request HOST (`https://<lang>.wikipedia.org`),
  // not a path/query, so it can't be percent-encoded. Reject anything that isn't
  // a plain ISO-639 code to prevent host manipulation by an untrusted caller
  // (this function is reused by the REST layer and search bundling).
  const safeLang = /^[a-z]{2,3}$/.test(lang) ? lang : 'de';

  const direct = await fetchSummaryByTitle(query, safeLang, sections);
  if (direct) return direct;

  const title = await resolveTitle(query, safeLang);
  if (title && title.toLowerCase() !== query.toLowerCase()) {
    return fetchSummaryByTitle(title, safeLang, sections);
  }
  return null;
}
