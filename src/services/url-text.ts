/**
 * services/url-text.ts – The text behind an ARBITRARY URL.
 *
 * The sibling of `content-text.ts`, and the difference is the whole point: there
 * the URL comes from a record's curated `ccm:wwwurl`, here it comes from
 * whoever is talking to the model. The target is chosen by the caller, so the
 * guard runs BEFORE anything is fetched — a check that answers correctly after
 * the extraction service has already made the request has guarded nothing.
 *
 * Order matters: cheapest and most certain first (scheme, literal host), then
 * the one that costs a resolver round trip. Each refusal has its own reason, so
 * "we would not fetch that" never looks like "the page had no text".
 */

import { WLO_TEXT_EXTRACTION_URL } from '../wlo-config.js';
import type { ExtractionMethod } from '../text-extraction-api.js';
import { extractTextFromUrl } from '../text-extraction-api.js';
import { isPrivateHost, resolvesToPrivateAddress } from '../url-safety.js';
import { capText } from '../text-cap.js';
import { log } from '../logger.js';
import { MIN_USEFUL_CHARS } from './content-text.js';

/**
 * Why there is no text:
 *   - `not_http`           — not a URL, or not an http(s) one
 *   - `private_host`       — the host is, or resolves into, a private network
 *   - `dns_failed`         — the host could not be resolved, so it could not be
 *                            judged. Refused rather than waved through: the
 *                            fetching service may resolve what we could not.
 *   - `service_disabled`   — no extraction service is configured. An operator
 *                            fault, deliberately NOT folded into
 *                            `extraction_failed`: that would report a missing
 *                            setting as a fact about the page.
 *   - `extraction_failed`  — the service could not read the page, or returned
 *                            too little to be content. A normal outcome: it
 *                            renders with Playwright and has known gaps
 *                            (protected pages, bot detection, media files).
 */
export type UrlTextMiss =
  | 'not_http'
  | 'private_host'
  | 'dns_failed'
  | 'service_disabled'
  | 'extraction_failed';

export interface UrlText {
  url: string;
  text: string;
  /** Length BEFORE truncation, so the caller can see what it is missing. */
  charCount: number;
  truncated: boolean;
  /** Only when there is no text. */
  reason?: UrlTextMiss;
}

/** Injection points for tests — neither DNS nor the network belongs in a unit test. */
export interface UrlTextDeps {
  extract?: (url: string, method: ExtractionMethod) => Promise<string | null>;
  lookup?: (hostname: string) => Promise<{ address: string }[]>;
}

export async function getUrlText(
  url: string,
  method: ExtractionMethod,
  maxChars: number,
  deps: UrlTextDeps = {},
): Promise<UrlText> {
  // Reported and requested URL, kept identical from here on — see below.
  let reported = url;
  const miss = (reason: UrlTextMiss): UrlText =>
    ({ url: reported, text: '', charCount: 0, truncated: false, reason });

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return miss('not_http');
  }
  // From here the NORMALISED form is used for both the request and the answer,
  // and it is set BEFORE the scheme check so a refusal is reported cleanly too.
  // Measured 2026-08-03: a tool argument declared `z.string().url()` may contain
  // a literal newline — zod accepts it — and WHATWG parsing strips it. Echoing
  // the raw input would name a URL that was never requested, and a line break
  // in a provenance line ("Quelle: …") forges a second, false one.
  reported = target.href;

  if (target.protocol !== 'http:' && target.protocol !== 'https:') return miss('not_http');

  // Only ever the host, never the URL: a caller-supplied URL can carry a token
  // in its query string, and a refusal must not be the thing that logs it.
  if (isPrivateHost(target.hostname)) {
    log.warn('url text refused a private-network host', { host: target.hostname });
    return miss('private_host');
  }
  // Before the resolver round trip: if there is no service to ask, resolving the
  // host answers a question nobody will act on.
  if (!WLO_TEXT_EXTRACTION_URL) return miss('service_disabled');

  const resolved = await resolvesToPrivateAddress(target.hostname, deps.lookup);
  if (resolved !== 'public') {
    log.warn('url text refused a host by resolution', { host: target.hostname, resolved });
    return miss(resolved === 'private' ? 'private_host' : 'dns_failed');
  }

  const extract = deps.extract ?? extractTextFromUrl;
  const extracted = await extract(reported, method);
  if (!extracted || extracted.trim().length < MIN_USEFUL_CHARS) return miss('extraction_failed');

  return { url: reported, ...capText(extracted, maxChars) };
}
