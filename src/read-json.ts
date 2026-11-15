/**
 * read-json.ts – parse an upstream response body, or report that it wasn't JSON.
 *
 * `res.ok` says the server answered; it does not say the body is JSON. A
 * reverse proxy's maintenance page, a captive portal and an empty body all
 * arrive as HTTP 200 with something `res.json()` throws on. Before this helper
 * every client function did `await res.json() as T` unguarded, so a parse
 * failure escaped past functions that document themselves as degrading to
 * `[]`/`null` — the failure mode was decided by the body's shape rather than by
 * the caller's contract.
 *
 * A pure leaf on purpose: the edu-sharing client, the Wikipedia client and the
 * text-extraction client all need it, and the Wikipedia client must not have to
 * import the module that carries the repository credential to get it.
 */

import { log } from './logger.js';

/**
 * Parse `res` as JSON. Returns `null` — never throws — when the body is not
 * valid JSON, logging which upstream call it was so an outage is visible.
 *
 * Callers whose contract is to degrade use `?? fallback`; callers whose
 * contract is to throw check for `null` and throw a named error, so the message
 * says which call broke instead of `Unexpected token <`.
 */
export async function readJson<T>(res: Response, context: string): Promise<T | null> {
  try {
    return await res.json() as T;
  } catch (err) {
    log.warn('upstream response was not valid JSON', {
      context,
      status: res.status,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
