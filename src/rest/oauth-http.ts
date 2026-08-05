/**
 * rest/oauth-http.ts – the request/response shapes the OAuth surface shares.
 *
 * Extracted when `oauth-pages.ts` grew a second responsibility (the login flow
 * moved to `oauth-consent.ts`, and `/oauth/token` follows). Nothing here decides
 * anything; it exists so both modules answer with the SAME headers. A second
 * `send` would be one `nosniff` away from drifting.
 */

import type { CodeStore } from '../auth/oauth-codes.js';
import type { DistinctValueLimiter, RateLimiter } from '../rate-limit.js';
import { readBodyWithLimit } from '../read-body.js';

export interface OAuthEndpointDeps {
  /** Client key for the limiters (already resolved through TRUST_PROXY). */
  ip: string;
  /** Cap on a buffered request body (MAX_BODY_BYTES). */
  maxBodyBytes: number;
  /** Requests per address — the public-surface limiter. */
  rateLimiter: RateLimiter;
  /** Distinct logins per address — the guessing guard, shared with `/auth/issue`. */
  authAbuseLimiter: DistinctValueLimiter;
  /** Where an issued authorization code waits for `/oauth/token`. */
  codeStore: CodeStore;
  /** This deployment's public origin, or null when it could not be established. */
  issuer: string | null;
}

/**
 * Async-iterable because most of these endpoints read a body; the discovery
 * paths do not. Same shape as `AuthEndpointDeps`' request, so both modules can
 * be driven by the same kind of stub.
 */
export interface OAuthReq extends AsyncIterable<Buffer | Uint8Array> {
  method?: string;
  url?: string;
  /** Only `accept` is read, to tell the consent PAGE from the page's own fetch. */
  headers?: Record<string, string | string[] | undefined>;
}

export interface OAuthRes {
  writeHead: (status: number, headers?: Record<string, string>) => void;
  end: (body?: string) => void;
  /** node:http sets this; the mocks in the tests do not, which reads as false. */
  headersSent?: boolean;
}

export const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
};

/** Answer with JSON. Returns `true` — the value every handler here reports. */
export function send(
  res: OAuthRes,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): true {
  res.writeHead(status, { ...JSON_HEADERS, ...headers });
  res.end(JSON.stringify(body));
  return true;
}

/**
 * A JSON object from the request body.
 *
 * `'too-large'` is kept distinct from `null` because the two callers answer it
 * differently — registration owes RFC 7591 a 413, consent does not — and
 * collapsing them into one value is how that 413 silently became a 400 during a
 * refactor.
 */
export async function readJsonBody(
  req: OAuthReq,
  maxBodyBytes: number,
): Promise<Record<string, unknown> | 'too-large' | null> {
  const { tooLarge, text } = await readBodyWithLimit(req, maxBodyBytes);
  if (tooLarge) return 'too-large';
  if (!text) return null;
  try {
    const data: unknown = JSON.parse(text);
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
    return data as Record<string, unknown>;
  } catch {
    return null;
  }
}
