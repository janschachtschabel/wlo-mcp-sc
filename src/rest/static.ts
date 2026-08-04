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
import { parseRequestUrl } from '../request-url.js';

export interface StaticAsset {
  /** Path under `public/` — a constant from the map, never from the request. */
  relPath: string;
  contentType: string;
  /**
   * Content-Security-Policy for this asset. HTML without one falls back to
   * `LAUNCHER_CSP`; the access-block pages set a stricter policy of their own.
   */
  csp?: string;
}

export interface StaticResult {
  status: number;
  asset?: StaticAsset;
}

const HTML = 'text/html; charset=utf-8';

/**
 * CSP for the launcher page. Looser than the REST layer's HTML policy in exactly
 * one respect — the launcher runs an inline script (it builds example URLs and
 * offers a live API test), so `script-src` must permit inline code. Everything
 * else is denied: the page references no external asset at all, and its one
 * fetch goes to `location.origin`, which `connect-src 'self'` covers. Framing is
 * refused so the page cannot be dressed up as somebody else's.
 */
const LAUNCHER_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const MARKDOWN = 'text/markdown; charset=utf-8';
const TEXT = 'text/plain; charset=utf-8';
const CSS = 'text/css; charset=utf-8';
const JS = 'text/javascript; charset=utf-8';

/**
 * Policy for the two access-block pages — stricter than the launcher's in the
 * one way that matters here: **no inline script or style at all**. Their code
 * lives in files, so nothing needs it, and a page where someone types their WLO
 * password is exactly where an injected inline script would undo the point of
 * encrypting in the browser. `form-action 'none'` closes the other door: if the
 * page's JS ever failed, a native submit would post the password in clear.
 */
const AUTH_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; " +
  "base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

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
  // Access-block pages. `/auth` mirrors `/` → launcher.html: the short path is
  // what people are told, the .html one is what the pages link to each other by.
  '/auth': { relPath: 'auth.html', contentType: HTML, csp: AUTH_CSP },
  '/auth.html': { relPath: 'auth.html', contentType: HTML, csp: AUTH_CSP },
  '/auth-revoke.html': { relPath: 'auth-revoke.html', contentType: HTML, csp: AUTH_CSP },
  // Also reachable at the path the design names and people guess, mirroring
  // `/auth`. That path is the POST endpoint too; `rest/auth-pages.ts` owns the
  // POST and hands a GET here. Every asset the page pulls is absolute, so it
  // renders identically under both URLs.
  '/auth/revoke': { relPath: 'auth-revoke.html', contentType: HTML, csp: AUTH_CSP },
  '/auth.css': { relPath: 'auth.css', contentType: CSS },
  '/auth.js': { relPath: 'auth.js', contentType: JS },
  '/auth-revoke.js': { relPath: 'auth-revoke.js', contentType: JS },
  '/access-block.js': { relPath: 'access-block.js', contentType: JS },
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
  // A target that will not parse owns no route — and a throw here would escape
  // the http handler entirely (see `request-url.ts`).
  const parsed = parseRequestUrl(url);
  if (!parsed) return null;
  const asset = STATIC_ROUTES[parsed.pathname];
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
    res.writeHead(200, {
      'Content-Type': result.asset.contentType,
      'X-Content-Type-Options': 'nosniff',
      ...(result.asset.csp
        ? { 'Content-Security-Policy': result.asset.csp }
        : result.asset.contentType.startsWith('text/html')
          ? { 'Content-Security-Policy': LAUNCHER_CSP }
          : {}),
    });
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
