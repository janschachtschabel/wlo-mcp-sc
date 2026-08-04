/**
 * wikipedia-api.ts – Minimal Wikipedia REST client for external-knowledge
 * enrichment (compendium/orientation next to WLO material).
 *
 * Isolated from the WLO/edu-sharing client on purpose: it targets a different
 * host, needs its own descriptive User-Agent (Wikimedia policy), and must never
 * send a repository credential to a public encyclopedia — which is why it calls
 * `fetch` directly instead of the credential-attaching `wloFetch`. The one thing
 * it does share is the upstream timeout constant. No API key required.
 *
 * Two endpoints:
 *   - REST summary: ``https://<lang>.wikipedia.org/api/rest_v1/page/summary/{title}``
 *     — the lead extract, thumbnail, and canonical page URL for an exact title.
 *   - opensearch:   ``https://<lang>.wikipedia.org/w/api.php?action=opensearch``
 *     — used only as a fallback to resolve a fuzzy/misspelled query to a real
 *       title when the direct summary misses.
 */

import { log } from './logger.js';
import { readJson } from './read-json.js';
import { pickRelevantTitle } from './wikipedia-relevance.js';
// The upstream TIMEOUT is shared with the WLO client (see wikiFetch below);
// nothing else is, and in particular no repository credential can reach here —
// this module calls `fetch` directly, never the credential-attaching wloFetch.
// Imported from the config leaf rather than the `wlo-api` barrel so a public
// encyclopedia lookup does not drag in the whole edu-sharing client.
import { WLO_FETCH_TIMEOUT_MS } from './wlo-config.js';

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
  /**
   * How the article was reached:
   *  - `exact`  — the title as asked, or a Wikipedia REDIRECT from it. Editorial,
   *    so it is trusted as-is.
   *  - `fuzzy`  — no article of that name; resolved through a search and checked
   *    for relevance (see `wikipedia-relevance.ts`). Still the best available
   *    answer, but the caller asked for something the encyclopedia does not have
   *    under that name.
   *
   * Consumers that ATTRIBUTE the text ("Quelle: Wikipedia-Artikel …") should
   * weigh the two differently: a fuzzy hit cites an article the user never named.
   */
  match: 'exact' | 'fuzzy';
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
  match: 'exact' | 'fuzzy',
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
  const data = await readJson<RestSummary>(res, 'wikipedia summary');
  if (!data?.extract || (data.type && data.type !== 'standard')) return null;
  return {
    title: data.title ?? title,
    extract: capSections(data.extract, sections),
    thumbnail: data.thumbnail?.source,
    url: data.content_urls?.desktop?.page ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    lang: data.lang ?? lang,
    match,
  };
}

/**
 * How many opensearch candidates to weigh. Measured 2026-08-02: for "Dreiecke"
 * the correct article ("Dreieck") was the FIFTH result while a mountain in the
 * Allgäu was the first, so the old `limit: 1` could not have found it under any
 * scoring rule. Ten is one request either way and still a short list to judge.
 */
const CANDIDATE_LIMIT = 10;

/** opensearch → real article titles for a fuzzy query, best-first, possibly empty. */
async function resolveTitleCandidates(query: string, lang: string): Promise<string[]> {
  const params = new URLSearchParams({
    action: 'opensearch',
    search: query,
    limit: String(CANDIDATE_LIMIT),
    namespace: '0',
    format: 'json',
  });
  const url = `https://${lang}.wikipedia.org/w/api.php?${params}`;
  let res: Response;
  try {
    res = await wikiFetch(url);
  } catch (err) {
    log.warn('wikipedia opensearch failed', { query, lang, error: String(err) });
    return [];
  }
  if (!res.ok) return [];
  // opensearch shape: [query, titles[], descriptions[], urls[]]
  const data = await readJson<[string, string[], string[], string[]]>(res, 'wikipedia opensearch');
  return Array.isArray(data) && Array.isArray(data[1]) ? data[1].filter(t => typeof t === 'string') : [];
}

/**
 * Resolve a query to a Wikipedia article summary. Tries the direct title
 * lookup first; on a miss, weighs the opensearch candidates and takes the one
 * the query is actually about. Returns null when no article matches — including
 * when candidates existed but none of them was on topic.
 *
 * Returning nothing is the deliberate outcome for an off-topic candidate. A
 * caller that turns this into teaching material appends "Quelle:
 * Wikipedia-Artikel „X"", so a plausible-but-wrong article does not merely look
 * odd — it publishes a false attribution. Measured before this guard existed:
 * "Stadt Berlin" answered with the Swiss federal city.
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

  // A direct hit is the title as asked OR a Wikipedia redirect from it, and a
  // redirect is an editorial statement that both names denote the same topic.
  // It is therefore trusted without a relevance check — checking it would only
  // reject correct answers ("Bruchrechnen" → "Bruchrechnung" share no prefix
  // any rule could relate without a stemmer).
  const direct = await fetchSummaryByTitle(query, safeLang, sections, 'exact');
  if (direct) return direct;

  const candidates = await resolveTitleCandidates(query, safeLang);
  const picked = pickRelevantTitle(query, candidates);
  if (!picked) {
    if (candidates.length) {
      log.info('wikipedia: no candidate was on topic', { query, lang: safeLang, candidates });
    }
    return null;
  }
  // The direct lookup for this exact name already failed above (404, or a
  // disambiguation page, which is not an article) — asking again would spend a
  // round trip to reach the same null.
  if (picked.toLowerCase() === query.toLowerCase()) return null;

  return fetchSummaryByTitle(picked, safeLang, sections, 'fuzzy');
}
