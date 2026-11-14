/**
 * rest/routes.ts – Public read-only REST router.
 *
 * Dispatches `/api/*` GET requests to the endpoint handlers in `handlers.ts`;
 * returns `null` for a path this layer does not own so the caller can fall
 * through to the MCP branch / 404. Split in two:
 *  - `routeRestRequest(method, url)` — the pure, fully-testable core (no
 *    `req`/`res`), unit-tested offline like `rate-limit.ts`/`read-body.ts`.
 *  - `handleRestRequest(req, res)` — the thin node:http adapter mounted by `http.ts`.
 */

import { isAccident } from '../accident.js';
import { log } from '../logger.js';
import { parseRequestUrl } from '../request-url.js';
import type { RestResult } from './result.js';
import { failureFields, type FailureCode } from '../services/failure-code.js';
import { isClientGone } from '../request-scope.js';
import {
  SKILL_PREFIX,
  handleSearch,
  handleCollection,
  handleCompendium,
  handleTopicPage,
  handleWikipedia,
  handleSkillsList,
  handleSkillRaw,
} from './handlers.js';

/** Prefix of the path-form search route (`/api/search/<term>`). */
const SEARCH_PREFIX = '/api/search/';

/**
 * CSP for `?format=html`. The rendered page is entirely self-contained — inline
 * style, no script, no image — so everything but inline CSS can be denied.
 */
const HTML_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const ROUTES: Record<string, (p: URLSearchParams) => Promise<RestResult>> = {
  '/api/search': handleSearch,
  '/api/collection': handleCollection,
  '/api/compendium': handleCompendium,
  '/api/topic-page': handleTopicPage,
  '/api/wikipedia': handleWikipedia,
  '/api/skills': handleSkillsList,
};

/**
 * Route a public REST request. Returns `null` when the path is not an `/api/*`
 * route this layer owns (the caller then falls through to the MCP branch / 404);
 * otherwise a `{status, json}` result. GET-only; other methods on a known path
 * yield 405. A thrown service error is logged and reported as a generic 500 (no
 * internal detail leaks to the client).
 */
export async function routeRestRequest(
  method: string | undefined,
  url: string | undefined,
): Promise<RestResult | null> {
  // Decide on the PARSED path, never on the raw request target. `http-app.ts`
  // dispatches to this layer on the same parse; matching the raw string here
  // made the two disagree for a request-target in absolute form
  // (`GET http://host/api/search`, which HTTP/1.1 permits) — this layer declined
  // a path the caller above had already accepted as ours. A target that will not
  // parse owns no route either, and saying so beats throwing: the rejection
  // escaped into the http handler, where nothing awaits it (see `request-url.ts`).
  const parsed = parseRequestUrl(url);
  if (!parsed) return null;
  const path = parsed.pathname;
  if (!path.startsWith('/api/')) return null;

  // Variable path: `/api/search/<term>` — the STRIPPING-PROOF search form.
  // AI fetch layers strip the query string from model-built URLs
  // (live-diagnosed 2026-07-17: every chat test hit our API as a bare
  // /api/search → 400), but the path survives. The term becomes `q`; optional
  // filters still ride the query string and degrade gracefully when stripped.
  // An explicit `q` query param wins (it is the older, documented contract).
  if (path.startsWith(SEARCH_PREFIX) && path.length > SEARCH_PREFIX.length) {
    if (method !== 'GET') return METHOD_NOT_ALLOWED;
    let term: string;
    try {
      term = decodeURIComponent(path.slice(SEARCH_PREFIX.length));
    } catch {
      return { status: 400, json: { error: 'Malformed search term (invalid percent-encoding)' } };
    }
    if (!parsed.searchParams.get('q')?.trim() && term.trim()) parsed.searchParams.set('q', term.trim());
    try {
      return await handleSearch(parsed.searchParams);
    } catch (err) {
      // The ROUTE, not the path: here the path ends in the search term.
      return failureResult(SEARCH_PREFIX, err);
    }
  }

  // Variable path: raw skill Markdown by id (`/api/skills/<id>`). Checked before
  // the exact-match table (which owns the `/api/skills` list route).
  if (path.startsWith(SKILL_PREFIX)) {
    if (method !== 'GET') return METHOD_NOT_ALLOWED;
    // Malformed percent-escapes (e.g. %ZZ) make decodeURIComponent throw a
    // URIError; decoding must happen inside a guard or the rejection escapes to
    // the http.ts call site and the socket hangs until requestTimeout.
    let id: string;
    try {
      id = decodeURIComponent(path.slice(SKILL_PREFIX.length));
    } catch {
      return { status: 400, json: { error: 'Malformed skill id (invalid percent-encoding)' } };
    }
    try {
      return await handleSkillRaw(id);
    } catch (err) {
      // The ROUTE here too: the path ends in an id the caller chose.
      return failureResult(SKILL_PREFIX, err);
    }
  }

  const handler = ROUTES[path];
  if (!handler) return null;
  if (method !== 'GET') return METHOD_NOT_ALLOWED;
  try {
    return await handler(parsed.searchParams);
  } catch (err) {
    return failureResult(path, err);
  }
}

/** Every route here is GET-only; a 405 has to say which method the path does take. */
const METHOD_NOT_ALLOWED: RestResult = { status: 405, json: { error: 'Method not allowed. Use GET.' }, allow: 'GET' };

/**
 * What a caller reads per failure code — fixed English sentences, never the
 * repository's own text or ours: a thrown message names functions and can quote
 * an upstream body.
 */
const FAILURE: Record<FailureCode, { status: number; error: string }> = {
  not_found: { status: 404, error: 'Not found.' },
  forbidden: { status: 403, error: 'The repository refused this read: not readable without a login.' },
  upstream_busy: { status: 503, error: 'The repository is busy. Try again shortly.' },
  timeout: { status: 504, error: 'The repository did not answer in time.' },
  upstream_error: { status: 502, error: 'The repository could not be read.' },
};

/**
 * A thrown handler error as a response.
 *
 * Classified, where it was a generic 500 for everything: "not there", "not
 * public" and "busy for ten seconds" all read as a defect of this server, and a
 * client could neither stop retrying a 404 nor wait out a 503. The code is
 * `failureCode`'s — the one the MCP tools answer with — and the body is the REST
 * shape the 429s already use, `{error, code, retryAfter?}`.
 *
 * Which errors are OURS is `isAccident`'s answer — the one rule `toolError`
 * goes by, so the two surfaces cannot disagree about the same throw. An
 * accident stays a 500 without a code or a detail; the log has both. A plain
 * `Error` counts as the repository's: that is what every read path here throws
 * when a listing did not answer or a body was not JSON, and telling those
 * apart from a rare invariant of ours by their WORDING (tried, review
 * 2026-11-14) made every new outage sentence a silent 500.
 */
function failureResult(route: string, err: unknown): RestResult {
  // A hang-up is not a failure (`toolError` holds the same line): nobody reads
  // this answer, and an error line per closed tab buries the ones an operator
  // must read. 499 so that it does not count among the server errors either.
  if (isClientGone(err)) {
    log.info('rest request abandoned — its client is gone', { path: route });
    return { status: 499, json: { error: 'Client closed request' } };
  }
  const detail = { path: route, error: err instanceof Error ? err.message : String(err) };
  if (isAccident(err)) {
    log.error('rest handler error', detail);
    return { status: 500, json: { error: 'Internal server error' } };
  }
  const { code, retryAfter } = failureFields(err);
  // A refusal is the ordinary reply for an id that does not exist or is not
  // public — on an open endpoint, an error line for each buried the outages.
  if (code === 'not_found' || code === 'forbidden') log.warn('rest handler error', detail);
  else log.error('rest handler error', detail);
  const { status, error } = FAILURE[code];
  return {
    status,
    json: { error, code, ...(retryAfter ? { retryAfter } : {}) },
    ...(retryAfter ? { retryAfter } : {}),
  };
}

/** Minimal request/response surface the adapter needs (satisfied by node:http). */
interface RestReq { method?: string; url?: string }
interface RestRes {
  writeHead: (status: number, headers?: Record<string, string>) => void;
  end: (body?: string) => void;
}

/**
 * HTTP adapter for `http.ts`: dispatch via `routeRestRequest`, write the JSON
 * response, and report whether the request was handled (so the caller can fall
 * through to the MCP branch / 404 when it wasn't).
 */
export async function handleRestRequest(req: RestReq, res: RestRes): Promise<boolean> {
  const result = await routeRestRequest(req.method, req.url);
  if (!result) return false;
  // nosniff on the whole public surface: the declared Content-Type is
  // authoritative (matches rest/static.ts) — a browser must never sniff e.g.
  // HTML out of a served markdown body. no-store keeps AI-fetch/proxy
  // intermediaries from replaying a stale search for a different term.
  if (result.raw != null) {
    const contentType = result.contentType ?? 'text/plain; charset=utf-8';
    res.writeHead(result.status, {
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      // Only on the one response a browser renders (`?format=html`). The page
      // embeds repository-supplied titles and descriptions, which `search-page.ts`
      // escapes; this is the second control. It can be this strict because the
      // page carries no script, no image and no external asset of its own.
      ...(contentType.startsWith('text/html') ? { 'Content-Security-Policy': HTML_CSP } : {}),
    });
    res.end(result.raw);
  } else {
    res.writeHead(result.status, {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      ...(result.retryAfter ? { 'Retry-After': String(result.retryAfter) } : {}),
      ...(result.allow ? { Allow: result.allow } : {}),
    });
    res.end(JSON.stringify(result.json));
  }
  return true;
}
