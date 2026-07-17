/**
 * read-body.ts – Read a request body into a string, bounded by a byte cap.
 *
 * Extracted from http.ts so it can be unit-tested (http.ts starts the server
 * on import and can't be imported from a test). Works on any async iterable of
 * byte chunks — the Node `IncomingMessage` is one.
 */

export interface BodyResult {
  /** True when the body exceeded `maxBytes` (its content is then discarded). */
  tooLarge: boolean;
  /** The decoded body, or '' when `tooLarge`. */
  text: string;
}

/**
 * Buffer the body up to `maxBytes`. Once the cap is exceeded we stop buffering
 * (memory stays bounded) but keep draining the stream to its end — reading the
 * body fully lets the HTTP layer send a clean 413 instead of resetting the
 * connection, which happens if the response finishes with the body unread.
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
      continue; // keep draining, stop buffering
    }
    if (!tooLarge) chunks.push(buf);
  }
  if (tooLarge) return { tooLarge: true, text: '' };
  return { tooLarge: false, text: Buffer.concat(chunks).toString('utf-8') };
}
