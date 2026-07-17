/**
 * wlo-config.ts – WLO / edu-sharing environment config + fetch foundation.
 *
 * The server points at a single edu-sharing instance per process. Pick it via
 * the ``WLO_REPOSITORY_URL`` env variable (e.g.
 * ``https://redaktion.openeduhub.net/edu-sharing`` or
 * ``https://repository.staging.openeduhub.net/edu-sharing``). The endpoint paths
 * (``/rest/search/v1/...``, ``/rest/node/v1/...``, ``/components/render/<id>``,
 * ``/components/topic-pages?...``) are identical across instances, so the only
 * difference between prod and staging is the base URL. This module owns the
 * resolved config, the shared node/response types, the timeout-enforcing
 * ``wloFetch`` wrapper, and the ``propertyFilter`` helpers that both the search
 * and node clients use.
 */

import { log } from './logger.js';

/**
 * Sanitize a repository URL input. Forgives common user-typo cases:
 *
 *   - leading/trailing whitespace
 *   - one or more trailing slashes
 *   - a trailing ``/rest`` segment that users sometimes paste from the
 *     REST docs (the MCP server appends ``/rest`` itself, so a double
 *     ``/rest/rest`` would 404)
 *   - missing protocol → defaults to ``https://``
 *
 * Returns the empty string for empty/whitespace-only input so the
 * caller can decide whether to apply a default.
 */
export function sanitizeRepositoryUrl(raw: string): string {
  let s = (raw ?? '').trim();
  if (!s) return '';
  // Strip one or more trailing slashes.
  s = s.replace(/\/+$/, '');
  // Common paste mistake: trailing /rest segment (which we add ourselves).
  // ``\/rest$`` after slash-stripping covers both ``…/rest`` and ``…/rest/``.
  s = s.replace(/\/rest$/i, '');
  // Bare hostname → prepend https:// so the URL is parseable by fetch().
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  // Auto-append /edu-sharing when only the bare host was given
  // (e.g. "https://repository.staging.openeduhub.net").
  if (!/\/edu-sharing(\/|$)/i.test(s)) s += '/edu-sharing';
  return s;
}

/**
 * Frontend base URL (e.g. ``https://redaktion.openeduhub.net/edu-sharing``).
 * Resolved once from ``WLO_REPOSITORY_URL`` at module load; defaults to
 * the WLO production redaction instance so unconfigured deploys still
 * work as before. Logs a warning when the configured value looks
 * suspicious (e.g. ends in ``/components`` or contains ``/edu-sharing``
 * twice) — those are typically the result of pasting a deep link
 * instead of the repository root.
 */
const _DEFAULT_REPOSITORY_URL = 'https://redaktion.openeduhub.net/edu-sharing';
export const WLO_REPOSITORY_URL: string = (() => {
  const raw = process.env['WLO_REPOSITORY_URL'] ?? '';
  const cleaned = sanitizeRepositoryUrl(raw);
  const resolved = cleaned || _DEFAULT_REPOSITORY_URL;

  // Soft validation — warn but don't crash. We log to stderr so stdio
  // transport users still see the warning even if stdout is reserved
  // for MCP framing.
  const suspicious: string[] = [];
  if (/\/components($|\/)/i.test(resolved)) {
    suspicious.push('URL ends in "/components" — looks like a deep page link, not the repository root');
  }
  // Lookahead (?=...) instead of capture-group so adjacent matches
  // ("/edu-sharing/edu-sharing") are counted separately.
  if ((resolved.match(/\/edu-sharing(?=\/|$)/gi)?.length ?? 0) > 1) {
    suspicious.push('URL contains "/edu-sharing" more than once');
  }
  if (suspicious.length > 0) {
    log.warn('WLO_REPOSITORY_URL looks suspicious', {
      issues: suspicious,
      resolved,
      expected: 'https://<host>/edu-sharing (no trailing /rest, no /components)',
    });
  }
  return resolved;
})();

/** REST API base — ``<repository-url>/rest``. */
export const BASE_URL: string = `${WLO_REPOSITORY_URL}/rest`;

/**
 * Central/root collection nodeId of the configured repository.
 *
 * Default is the WLO root (``5e40e372-...``) which is the same node ID
 * on the staging mirror today. Override per deployment via
 * ``WLO_ROOT_COLLECTION_ID`` if a future staging/development repo uses
 * a different root.
 */
export const WLO_ROOT_COLLECTION_ID: string = (() => {
  const raw = (process.env['WLO_ROOT_COLLECTION_ID'] ?? '').trim();
  return raw || '5e40e372-735c-4b17-bbf7-e827a5702b57';
})();

/**
 * Optional nodeId of the WLO collection that holds the launcher "skills"
 * (uploaded Markdown instruction files, delivered via each node's anonymous
 * `downloadUrl`). When set, `GET /api/collection` with no `nodeId` defaults to
 * it. Empty (unset) → callers must pass an explicit `nodeId`.
 */
export const WLO_SKILLS_COLLECTION_ID: string = (process.env['WLO_SKILLS_COLLECTION_ID'] ?? '').trim();

/**
 * Per-request upstream timeout in milliseconds. Without it a hung
 * edu-sharing socket would block the MCP tool call indefinitely (stdio /
 * self-hosted) or until the serverless platform kills it. Override via
 * ``WLO_FETCH_TIMEOUT_MS``; default 10s.
 */
export const WLO_FETCH_TIMEOUT_MS: number = (() => {
  const v = parseInt(process.env['WLO_FETCH_TIMEOUT_MS'] ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 10_000;
})();

export interface SearchCriterion {
  property: string;
  values: string[];
}

export interface WloNode {
  ref?: { id: string; repo: string };
  name?: string;
  title?: string;
  isDirectory?: boolean;
  /** edu-sharing object type — `ccm:io` (file) or `ccm:map` (collection). */
  type?: string;
  /** MIME type, e.g. `application/pdf` (only on `ccm:io` nodes). */
  mimetype?: string;
  /** Coarse mediatype label, e.g. `file-pdf`, `file-video`. */
  mediatype?: string;
  /** File size in bytes (only on file nodes with binary content). The live
   *  API serialises this as a STRING — consumers must coerce (formatter). */
  size?: number | string;
  /** Direct binary download URL — works without auth; null if no binary content. */
  downloadUrl?: string | null;
  properties?: Record<string, string[]>;
  preview?: {
    url?: string;
    /** `true` = generic mediatype icon, `false` = real generated thumbnail */
    isIcon?: boolean;
    isGenerated?: boolean;
  };
  /**
   * In-repo viewer URL (PDF/video preview component). Null when the node
   * has no binary attachment (e.g. external link nodes via `ccm:wwwurl`).
   */
  content?: { url?: string; originalUrl?: string; hash?: string; version?: string };
  collection?: { description?: string; title?: string; childCollectionsCount?: number };
}

export interface SearchResponse {
  nodes: WloNode[];
  pagination: { total: number; from: number; count: number };
  /**
   * Facet aggregation buckets, only present when `ngsearch` was called with
   * `facets`. Values are property URIs with their document counts (no
   * server-side labels — resolve via `resolveFacetCounts`).
   */
  facets?: { property: string; values: { value: string; count: number }[] }[];
}

export const HEADERS = {
  'Accept': 'application/json',
  'Content-Type': 'application/json',
};

/**
 * ``fetch`` wrapper that enforces the upstream timeout. Every call to the
 * edu-sharing API goes through here so no request can hang forever. A
 * caller-supplied ``signal`` is respected as-is; otherwise a
 * ``WLO_FETCH_TIMEOUT_MS`` abort signal is attached.
 */
export function wloFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const signal = init.signal ?? AbortSignal.timeout(WLO_FETCH_TIMEOUT_MS);
  return fetch(url, { ...init, signal });
}

/**
 * Log a non-OK upstream response before a caller degrades gracefully (returns
 * `[]`/`null`). Without this an outage is invisible — indistinguishable from a
 * legitimately empty result — so on-call can't tell "broken" from "empty".
 */
export function logUpstreamMiss(context: string, res: Response): void {
  log.warn('upstream returned non-OK', { context, status: res.status });
}

// ── Property filter (O2: request only fields that are actually used) ──────────
//
// edu-sharing accepts ``propertyFilter`` ONLY as a REPEATED query param
// (``&propertyFilter=a&propertyFilter=b``). A comma-separated list yields 0
// properties (verified against staging 2026-06). ``_DISPLAYNAME`` companion
// fields MUST be listed explicitly — but then come back correctly.
//
// DISPLAY_PROPS = the set actually consumed by formatter.ts + reranker.ts
// (instead of ``-all-`` with ~59 properties/node → ~24 → much smaller payloads
// across 6 query variants × up to 40 hits).
export const DISPLAY_PROPS: string[] = [
  // Title + description + ranking
  'cclom:title', 'cm:title', 'cm:name',
  'cclom:general_description', 'cclom:general_keyword',
  // Vocabulary fields (+ server-side labels)
  'ccm:taxonid', 'ccm:taxonid_DISPLAYNAME',
  'ccm:educationalcontext', 'ccm:educationalcontext_DISPLAYNAME',
  'ccm:educationalintendedenduserrole', 'ccm:educationalintendedenduserrole_DISPLAYNAME',
  'ccm:oeh_lrt_aggregated', 'ccm:oeh_lrt_aggregated_DISPLAYNAME',
  'ccm:oeh_lrt', 'ccm:oeh_lrt_DISPLAYNAME',
  // Links / license / source
  'ccm:wwwurl', 'ccm:commonlicense_key',
  'ccm:oeh_publisher_combined',
  'ccm:replicationsource', 'ccm:replicationsource_DISPLAYNAME', // source (e.g. Klexikon)
  'ccm:author_freetext',
  // Collection editorial text (collections/portals only) — bundled so
  // collection search/browse carry it inline for orientation without a second
  // get_compendium_text call; renderToText caps the text output at 500 chars.
  'ccm:oeh_collection_compendium_text',
  // Structure / IDs
  'ccm:page_config_ref',
  'sys:node-uuid', 'virtual:primaryparent_nodeid',
];

/**
 * Appends the ``propertyFilter`` to the query params. ``props`` undefined OR
 * empty ⇒ ``-all-`` (full set, e.g. for get_node_details). Otherwise ONE
 * repeated ``propertyFilter`` param per field (that is the only format
 * edu-sharing accepts for field selection).
 */
export function appendPropertyFilter(params: URLSearchParams, props?: string[]): void {
  if (props && props.length > 0) {
    for (const p of props) params.append('propertyFilter', p);
  } else {
    params.append('propertyFilter', '-all-');
  }
}
