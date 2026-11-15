/**
 * text-extraction-api.ts – Client for the openeduhub text-extraction service.
 *
 * One endpoint is used: `POST /from-url`, which fetches a public material URL
 * and returns its text (Markdown). The service offers NO file upload, and it
 * cannot consume an edu-sharing download URL — that returns 424 Failed
 * Dependency (live-verified 2026-07-28). It is therefore only useful for
 * externally LINKED material (`ccm:wwwurl`); everything the repository hosts is
 * read through edu-sharing's own `/textContent` instead.
 *
 * Only public material URLs are sent here — never node ids, user input or
 * the repository's credentials. Behind the B-API proxy the service's own key
 * goes along as `X-API-KEY` (`WLO_TEXT_EXTRACTION_API_KEY`).
 */

import { WLO_TEXT_EXTRACTION_API_KEY, WLO_TEXT_EXTRACTION_URL, WLO_TEXT_TIMEOUT_MS } from './wlo-config.js';
import { isPrivateHost } from './url-safety.js';
import { wloFetch } from './wlo-fetch.js';
import { readJson } from './read-json.js';
import { log } from './logger.js';

/**
 * The key to send to `baseUrl`: the configured one, and only for the configured
 * service address — a caller that names another base URL gets none.
 */
export function extractionKeyFor(
  baseUrl: string,
  configured: { url: string; key: string } = { url: WLO_TEXT_EXTRACTION_URL, key: WLO_TEXT_EXTRACTION_API_KEY },
): string {
  return configured.key && baseUrl === configured.url ? configured.key : '';
}

/** Extraction methods the service accepts; `browser` renders JS-heavy pages. */
export type ExtractionMethod = 'simple' | 'browser';

/**
 * Fetch the text behind a public URL. Returns null when the service is disabled
 * (empty base URL), the URL is not http(s), its host is private (see
 * `isPrivateHost`), or the call fails — the caller then degrades to whatever
 * the repository has.
 *
 * @param baseUrl override for tests; defaults to the configured service.
 * @param apiKey the B-API key, when the service sits behind that proxy.
 */
export async function extractTextFromUrl(
  url: string,
  method: ExtractionMethod = 'browser',
  baseUrl: string = WLO_TEXT_EXTRACTION_URL,
  apiKey: string = extractionKeyFor(baseUrl),
): Promise<string | null> {
  if (!baseUrl) return null;
  if (!/^https?:\/\//i.test(url)) return null;

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  if (isPrivateHost(target.hostname)) {
    log.warn('text extraction refused a private-network URL', { host: target.hostname });
    return null;
  }

  try {
    const res = await wloFetch(`${baseUrl}/from-url`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json', 'Content-Type': 'application/json',
        // The B-API takes its key in this header — not as `Authorization: Bearer`.
        ...(apiKey ? { 'X-API-KEY': apiKey } : {}),
      },
      // With a key, no redirect is followed: `fetch` would carry the header on
      // to whatever host the answer names.
      ...(apiKey ? { redirect: 'error' as const } : {}),
      body: JSON.stringify({
        url,
        method,
        browser_location: null,
        lang: 'auto',
        output_format: 'markdown',
        preference: 'none',
      }),
      signal: AbortSignal.timeout(WLO_TEXT_TIMEOUT_MS),
    });
    if (!res.ok) {
      log.warn('text extraction returned non-OK', { status: res.status });
      return null;
    }
    const data = await readJson<{ text?: string }>(res, 'extractTextFromUrl');
    return data?.text ?? null;
  } catch (err) {
    // A failing external service must never fail the tool call — the caller
    // reports `extraction_failed` and the user still gets the metadata.
    log.warn('text extraction failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
