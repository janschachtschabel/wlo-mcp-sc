/**
 * read-body.ts – Read a request body into a string, bounded by a byte cap.
 *
 * Extracted from http.ts so it can be unit-tested (http.ts starts the server
 * on import and can't be imported from a test). Works on any async iterable of
 * byte chunks — the Node `IncomingMessage` is one.
 */

/**
 * Does this request DECLARE a JSON body?
 *
 * Not a formality, and not about parsing: it is what keeps a cross-origin form
 * out of an endpoint that checks a password. A `fetch` with
 * `Content-Type: application/json` is a non-simple request, so the browser sends
 * a preflight first — and the preflight fails on our credential surfaces, which
 * send no CORS header at all. A `<form enctype="text/plain">` needs no preflight
 * and its body can be crafted to parse as JSON, so an endpoint that parses
 * whatever arrives is reachable from any page in the world.
 *
 * Requiring the header is therefore the whole CSRF defence on those endpoints
 * (see `rest/auth-pages.ts` and `rest/oauth-consent.ts`). Parameters after the
 * type are allowed — `fetch` appends `; charset=utf-8` in some runtimes.
 *
 * Lives here because this is the module that reads request bodies, and the two
 * callers already depend on it.
 */
export function isJsonContentType(raw: string | string[] | undefined): boolean {
  const value = Array.isArray(raw) ? raw[0] ?? '' : raw ?? '';
  return (value.split(';')[0] ?? '').trim().toLowerCase() === 'application/json';
}

export interface BodyResult {
  /** True when the body exceeded `maxBytes` (its content is then discarded). */
  tooLarge: boolean;
  /** The decoded body, or '' when `tooLarge`. */
  text: string;
}

/**
 * How far past the cap an oversized body is still drained.
 *
 * Draining lets the HTTP layer answer a clean 413 instead of resetting the
 * connection — worth it for the ordinary case of a file a little too large. An
 * unbounded drain, however, lets a client stream for the whole request timeout
 * (audit 2026-11-05). Past this multiple the reader stops, which destroys the
 * request; the caller's 413 then goes nowhere, which is the right outcome for a
 * body nobody legitimate sends.
 */
export const DRAIN_FACTOR = 4;

/**
 * Buffer the body up to `maxBytes`. Once the cap is exceeded we stop buffering
 * (memory stays bounded) and keep draining up to `DRAIN_FACTOR × maxBytes`, so
 * an ordinary oversize still gets its clean 413.
 */
export async function readBodyWithLimit(
  req: AsyncIterable<Buffer | Uint8Array>,
  maxBytes: number,
): Promise<BodyResult> {
  const chunks: Buffer[] = [];
  let received = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    received += buf.length;
    if (received > maxBytes) {
      tooLarge = true;
      if (received > maxBytes * DRAIN_FACTOR) break; // stop draining an abusive stream
      continue; // keep draining, stop buffering
    }
    chunks.push(buf);
  }
  if (tooLarge) return { tooLarge: true, text: '' };
  return { tooLarge: false, text: Buffer.concat(chunks).toString('utf-8') };
}
