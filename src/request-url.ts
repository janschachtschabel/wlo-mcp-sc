/**
 * request-url.ts – Parse an inbound HTTP request target, once.
 *
 * node:http and the WHATWG URL parser do not agree on what a request target is.
 * llhttp accepts `//[` (it reads as the authority form and is a legal
 * origin-form target); `new URL('//[', base)` throws. Three layers used to parse
 * the same `req.url` independently — the dispatcher, the REST router and the
 * static router — and only the first one guarded the parse. Its fallback handed
 * the RAW string to the other two, so the throw simply moved one layer down,
 * escaped the handler (node:http never awaits the promise its handler returns)
 * and left the client with no response at all until `requestTimeout` — from an
 * unauthenticated request on a path neither rate limiter covers.
 *
 * So the rule lives in one place and every caller gets the same total answer:
 * a target we cannot parse matches no route, because no route can be expressed
 * in a form we cannot read.
 */

/** The parsed target, or `null` when it is absent or will not parse. */
export function parseRequestUrl(url: string | undefined): URL | null {
  if (!url) return null;
  try {
    // The base only supplies the origin for an origin-form target (`/api/x`);
    // its host is never used, and an absolute-form target (which HTTP/1.1
    // permits) keeps its own.
    return new URL(url, 'http://localhost');
  } catch {
    return null;
  }
}
