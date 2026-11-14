/**
 * response-headers.ts – the two headers EVERY response of this server carries
 * (audit 2026-11-14, S4).
 *
 * A leaf module because both listeners need it — the public handler
 * (`http-app.ts`) and the internal port (`rest/internal-port.ts`) — and the
 * second must not import the first. Set with `setHeader` when a request is
 * accepted, so a later `writeHead` merges them in: an answer written by a route
 * nobody has added yet carries them without anyone remembering to.
 *
 * - `X-Content-Type-Options: nosniff` — the declared Content-Type is
 *   authoritative. Several routes set it themselves; the JSON answers of the
 *   dispatcher (400/401/404/413/500, MCP) did not.
 * - `Referrer-Policy: no-referrer` — the pages here hold an access block or an
 *   OAuth request in view, and the consent page ends in a redirect to a client's
 *   address; nothing this server serves needs its URL sent along.
 */

import type { ServerResponse } from 'node:http';

export function applyBaselineHeaders(res: Pick<ServerResponse, 'setHeader'>): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}
