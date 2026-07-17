/**
 * rest/static.ts – Static asset serving for the public prompt launcher.
 *
 * Serves a FIXED allow-list of files from `public/` (currently only the
 * launcher). Split like `rest/routes.ts`:
 *  - `resolveStaticRoute(method, url)` — pure path→asset mapping, offline-testable,
 *    returns `null` for a path we don't own so the caller falls through (to the
 *    MCP branch / 404).
 *  - `handleStaticRequest(req, res)` — thin HTTP adapter mounted by `http.ts`
 *    that reads the mapped file and writes it.
 *
 * Security: the request pathname is only ever looked up in a closed map; a served
 * file path is NEVER derived from the URL, so there is no directory-traversal
 * surface. GET-only — a non-GET on a static-only path yields 405.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { log } from '../logger.js';

export interface StaticAsset {
  /** Path under `public/` — a constant from the map, never from the request. */
  relPath: string;
  contentType: string;
}

export interface StaticResult {
  status: number;
  asset?: StaticAsset;
}

const HTML = 'text/html; charset=utf-8';
const MARKDOWN = 'text/markdown; charset=utf-8';
const TEXT = 'text/plain; charset=utf-8';

// Closed allow-list: request pathname → the file under public/ it serves.
// `/` is shared with the MCP endpoint (POST /), so this GET mapping is only
// reached after the MCP branch declines it (see http.ts ordering).
// robots.txt is served explicitly (permissive): AI fetch tools check it before
// touching the public GET /api/* surface, and a missing file leaves the
// decision to each fetcher's default policy.
const STATIC_ROUTES: Record<string, StaticAsset> = {
  '/': { relPath: 'launcher.html', contentType: HTML },
  '/launcher.html': { relPath: 'launcher.html', contentType: HTML },
  '/bookmarklet.md': { relPath: 'bookmarklet.md', contentType: MARKDOWN },
  '/robots.txt': { relPath: 'robots.txt', contentType: TEXT },
  // llms.txt: the emerging convention for a self-describing API surface — AI
  // fetchers read it to learn the endpoints without any prompt at all.
  '/llms.txt': { relPath: 'llms.txt', contentType: TEXT },
};

/**
 * Route a static request. Returns `null` when the path is not one we own (the
 * caller falls through), a 200 result carrying the asset descriptor for a GET on
 * a known path, or a 405 for any other method on a known path.
 */
export function resolveStaticRoute(
  method: string | undefined,
  url: string | undefined,
): StaticResult | null {
  if (!url) return null;
  const pathname = new URL(url, 'http://localhost').pathname;
  const asset = STATIC_ROUTES[pathname];
  if (!asset) return null;
  if (method !== 'GET') return { status: 405 };
  return { status: 200, asset };
}

// `public/` sits at the repo root, two levels up whether this runs compiled
// (`dist/rest/static.js`) or via tsx (`src/rest/static.ts`).
const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');

/** Minimal request/response surface the adapter needs (satisfied by node:http). */
interface StaticReq { method?: string; url?: string }
interface StaticRes {
  writeHead: (status: number, headers?: Record<string, string>) => void;
  end: (body?: string) => void;
}

/**
 * HTTP adapter for `http.ts`: dispatch via `resolveStaticRoute`, read and write
 * the mapped file, and report whether the request was handled (so the caller can
 * fall through when it wasn't). A missing/unreadable asset is a server-side
 * misconfiguration → logged and reported as a generic 500 (no detail leaks).
 */
export async function handleStaticRequest(req: StaticReq, res: StaticRes): Promise<boolean> {
  const result = resolveStaticRoute(req.method, req.url);
  if (!result) return false;
  if (result.status !== 200 || !result.asset) {
    res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': 'GET' });
    res.end(JSON.stringify({ error: 'Method not allowed. Use GET.' }));
    return true;
  }
  try {
    // relPath is a constant from STATIC_ROUTES, never from the URL → no traversal.
    const body = await readFile(join(publicDir, result.asset.relPath), 'utf8');
    // nosniff: the declared Content-Type is authoritative; browsers must not
    // second-guess it (defense-in-depth for the public static surface).
    res.writeHead(200, { 'Content-Type': result.asset.contentType, 'X-Content-Type-Options': 'nosniff' });
    res.end(body);
  } catch (err) {
    log.error('static asset read failed', {
      relPath: result.asset.relPath,
      error: err instanceof Error ? err.message : String(err),
    });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
  return true;
}
