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
 * credentials.
 */

import { WLO_TEXT_EXTRACTION_URL, WLO_TEXT_TIMEOUT_MS, wloFetch } from './wlo-config.js';
import { log } from './logger.js';

/** Extraction methods the service accepts; `browser` renders JS-heavy pages. */
export type ExtractionMethod = 'simple' | 'browser';

/**
 * Fetch the text behind a public URL. Returns null when the service is disabled
 * (empty base URL), the URL is not http(s), or the call fails — the caller then
 * degrades to whatever the repository has.
 *
 * @param baseUrl override for tests; defaults to the configured service.
 */
export async function extractTextFromUrl(
  url: string,
  method: ExtractionMethod = 'browser',
  baseUrl: string = WLO_TEXT_EXTRACTION_URL,
): Promise<string | null> {
  if (!baseUrl) return null;
  if (!/^https?:\/\//i.test(url)) return null;

  try {
    const res = await wloFetch(`${baseUrl}/from-url`, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
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
    const data = await res.json() as { text?: string };
    return data.text ?? null;
  } catch (err) {
    // A failing external service must never fail the tool call — the caller
    // reports `extraction_failed` and the user still gets the metadata.
    log.warn('text extraction failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
