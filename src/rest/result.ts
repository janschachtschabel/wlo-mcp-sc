/**
 * rest/result.ts – The REST layer's result shape + the shared 400 helper.
 *
 * Extracted so the router (`routes.ts`) and the endpoint handlers (`handlers.ts`)
 * can share them without a circular import.
 */

export interface RestResult {
  status: number;
  /** JSON body (default). Mutually exclusive with `raw`. */
  json?: unknown;
  /** Raw text body (e.g. a skill's Markdown) written as-is with `contentType`. */
  raw?: string;
  contentType?: string;
  /** Seconds, for a 503/429 that will pass: written as the `Retry-After` header. The JSON carries the same number. */
  retryAfter?: number;
}

export const badRequest = (error: string): RestResult => ({ status: 400, json: { error } });
