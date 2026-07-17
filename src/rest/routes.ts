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

import { log } from '../logger.js';
import type { RestResult } from './result.js';
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
  if (!url || !url.startsWith('/api/')) return null;
  const parsed = new URL(url, 'http://localhost');
  const path = parsed.pathname;

  // Variable path: raw skill Markdown by id (`/api/skills/<id>`). Checked before
  // the exact-match table (which owns the `/api/skills` list route).
  if (path.startsWith(SKILL_PREFIX)) {
    if (method !== 'GET') return { status: 405, json: { error: 'Method not allowed. Use GET.' } };
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
      log.error('rest handler error', { path, error: err instanceof Error ? err.message : String(err) });
      return { status: 500, json: { error: 'Internal server error' } };
    }
  }

  const handler = ROUTES[path];
  if (!handler) return null;
  if (method !== 'GET') return { status: 405, json: { error: 'Method not allowed. Use GET.' } };
  try {
    return await handler(parsed.searchParams);
  } catch (err) {
    log.error('rest handler error', {
      path,
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: 500, json: { error: 'Internal server error' } };
  }
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
  if (result.raw != null) {
    res.writeHead(result.status, { 'Content-Type': result.contentType ?? 'text/plain; charset=utf-8' });
    res.end(result.raw);
  } else {
    res.writeHead(result.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result.json));
  }
  return true;
}
