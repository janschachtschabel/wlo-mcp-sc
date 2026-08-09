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
 * resolved config and the ``propertyFilter`` helpers that both the search and
 * node clients use. The node/response types live in ``wlo-types.ts`` and the
 * fetch wrapper with its credential boundary in ``wlo-fetch.ts``.
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
 * Resolved once from ``WLO_REPOSITORY_URL`` at module load. Logs a warning when
 * the configured value looks suspicious (e.g. ends in ``/components`` or
 * contains ``/edu-sharing`` twice) — those are typically the result of pasting a
 * deep link instead of the repository root.
 *
 * **The default is STAGING, and that changed on 2026-08-06.** It used to be the
 * production redaction instance, "so unconfigured deploys still work as before".
 * What that actually produced: a deployment whose `.env` simply lacked the line
 * — while `NODE_ENV`, the extraction service and the operator's own belief all
 * said staging — wrote a record into the LIVE catalogue, with nothing in the log
 * to say which repository was in use until someone read the render URL of the
 * thing that had been created.
 *
 * Whichever way this points, a forgotten variable lands somewhere. The two
 * outcomes are not symmetric: against staging a mistaken write is a test record,
 * against production it is somebody's live catalogue. So the dangerous target is
 * the one that has to be named out loud. `.env.example` ships the same value
 * (pinned by `tests/deploy-env-passthrough.test.ts`, because a second copy of a
 * default is how this went wrong in the first place).
 */
const _DEFAULT_REPOSITORY_URL = 'https://repository.staging.openeduhub.net/edu-sharing';
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

/** The WLO root ("Portale") collection nodeId. */
const _WLO_ROOT_ID = '5e40e372-735c-4b17-bbf7-e827a5702b57';

/**
 * Known root-collection nodeIds per repository host. The root collection id is
 * REPOSITORY-BOUND — node ids only carry over between instances cloned as
 * id-faithful mirrors. WLO prod and staging are such mirrors: both resolve the
 * same root id (live-verified 2026-07-17 via
 * ``GET /node/v1/nodes/-home-/<id>/metadata`` on both hosts). One entry per
 * host anyway, so a future divergence is a one-line change here.
 */
const KNOWN_ROOT_COLLECTION_IDS: Record<string, string> = {
  'redaktion.openeduhub.net': _WLO_ROOT_ID,
  'repository.staging.openeduhub.net': _WLO_ROOT_ID,
};

/**
 * Resolve the root collection id: explicit env value → per-host default for
 * the known WLO instances → WLO fallback. ``source: 'fallback'`` tells the
 * caller the repository host is unknown, so the WLO id is almost certainly
 * wrong there (an unrelated edu-sharing has different node ids) and a warning
 * is warranted. Pure for testability (like ``sanitizeRepositoryUrl``).
 */
export function resolveRootCollectionId(
  raw: string | undefined,
  repositoryUrl: string,
): { id: string; source: 'env' | 'known-host' | 'fallback' } {
  const explicit = (raw ?? '').trim();
  if (explicit) return { id: explicit, source: 'env' };
  let host = '';
  try { host = new URL(repositoryUrl).hostname; } catch { /* unparseable → fallback */ }
  const known = KNOWN_ROOT_COLLECTION_IDS[host];
  if (known) return { id: known, source: 'known-host' };
  return { id: _WLO_ROOT_ID, source: 'fallback' };
}

/**
 * Central/root collection nodeId of the configured repository — anchors
 * ``get_subject_portals``, tree browsing, and the portal leg of the combined
 * search. Repository-bound; see ``resolveRootCollectionId``.
 */
export const WLO_ROOT_COLLECTION_ID: string = (() => {
  const r = resolveRootCollectionId(process.env['WLO_ROOT_COLLECTION_ID'], WLO_REPOSITORY_URL);
  if (r.source === 'fallback') {
    log.warn(
      'WLO_ROOT_COLLECTION_ID not set and the repository host is not a known WLO instance — ' +
        'using the WLO root id, which will not exist on an unrelated repository. Set WLO_ROOT_COLLECTION_ID.',
      { repository: WLO_REPOSITORY_URL, fallback: r.id },
    );
  }
  return r.id;
})();

/**
 * Optional nodeId of the WLO collection that holds ALL skillsets (each a
 * sub-collection, each holding the skill records whose attached file is the
 * SKILL.md). When set, the skill search walks that subtree; unset, it searches
 * the whole repository for records of the `ai_prompt` content type. It also
 * makes `GET /api/collection` without a `nodeId` default to this collection.
 *
 * The subtree walk is not an optimisation but the only mechanism available:
 * `virtual:parent_recursive` is refused by `ngsearch` with 400
 * `DAOValidationException` (measured 2026-08-08 on both instances), so a
 * collection-scoped query cannot be expressed at all.
 */
export const WLO_SKILLS_COLLECTION_ID: string = (process.env['WLO_SKILLS_COLLECTION_ID'] ?? '').trim();

/**
 * Which skill tool surface is registered:
 *
 *   `two-tool` (default) — `search_skill` returns a catalogue, `get_skill`
 *       loads the one the model picked. The model sees what it is choosing
 *       between, and a wrong pick costs one extra call.
 *   `one-tool` — `get_skill_for_task` ranks and loads the top match itself.
 *       Fewer round-trips, but the choice is invisible to the caller.
 *
 * An unrecognised value keeps the default and warns: silently registering a
 * different tool surface than the operator asked for would show up as a missing
 * tool with nothing to explain it. Override via ``WLO_SKILL_TOOL_MODE``.
 */
export function resolveSkillToolMode(raw: string | undefined): 'two-tool' | 'one-tool' {
  const s = (raw ?? '').trim().toLowerCase();
  if (s === 'one-tool' || s === 'two-tool') return s;
  if (s) {
    log.warn('WLO_SKILL_TOOL_MODE is not a known value — using the default', {
      value: s, accepted: ['two-tool', 'one-tool'], fallback: 'two-tool',
    });
  }
  return 'two-tool';
}

export const WLO_SKILL_TOOL_MODE: 'two-tool' | 'one-tool' =
  resolveSkillToolMode(process.env['WLO_SKILL_TOOL_MODE']);

/**
 * How much `search` (the ChatGPT knowledge-convention tool) puts in its answer:
 *
 *   `lean` (default) — the convention's minimum: `{results:[{id,title,url}]}`,
 *       no widget. What the convention documents, and the only shape that has
 *       been seen to work in Deep Research.
 *   `rich` — the same payload PLUS the `search_wlo_all` buckets
 *       (content/collections/topicPages with full metadata) and the results
 *       widget, so a host that picks `search` over `search_wlo_all` no longer
 *       falls back to three fields and no interface.
 *
 * The default is `lean` on purpose. `search` takes a single `query` string by
 * convention (developers.openai.com/api/docs/mcp), so the buckets are the only
 * part of `search_wlo_all` that can be copied at all — and whether a connector
 * accepts sibling keys next to `results` is NOT measured. A third-party report
 * describes connectors dropping "any or all items" that do not match the
 * expected shape, which would make `search` return nothing in Deep Research
 * without any error to see. Turning `rich` on is therefore a deliberate act,
 * reversible by an env change rather than a deploy. Override via
 * ``WLO_SEARCH_OUTPUT_MODE``.
 */
export function resolveSearchOutputMode(raw: string | undefined): 'lean' | 'rich' {
  const s = (raw ?? '').trim().toLowerCase();
  if (s === 'lean' || s === 'rich') return s;
  if (s) {
    log.warn('WLO_SEARCH_OUTPUT_MODE is not a known value — using the default', {
      value: s, accepted: ['lean', 'rich'], fallback: 'lean',
    });
  }
  return 'lean';
}

export const WLO_SEARCH_OUTPUT_MODE: 'lean' | 'rich' =
  resolveSearchOutputMode(process.env['WLO_SEARCH_OUTPUT_MODE']);

/**
 * nodeId of the shared inbox new records land in when the server writes under
 * the SERVICE account (a personal login writes to `-userhome-` instead).
 *
 * Deliberately without a default. Node ids are repository-bound, so a hardcoded
 * one would write into whatever node happens to carry that id on the configured
 * instance — a different collection on staging than on production, or nothing
 * at all elsewhere. Unset means service-account creation is refused with a
 * message naming this variable, which is a better outcome than a record filed
 * somewhere nobody looks.
 */
export const WLO_INBOX_ID: string = (process.env['WLO_INBOX_ID'] ?? '').trim();

/**
 * Read an integer from a raw env value, refusing anything that is not a plain
 * run of digits at or above ``min``. ``name`` identifies the variable in the
 * warning, which is the point of the check: ``parseInt`` stops at the first
 * non-digit, so ``WLO_FETCH_TIMEOUT_MS=20s`` used to resolve to a 20 ms timeout
 * — a deployment where every upstream call fails, with nothing in the log
 * pointing at the cause. Same shape, same trap: ``MAX_BODY_BYTES=1MB`` becomes a
 * one-byte cap that answers every request with 413. A value we cannot fully
 * parse is refused, and saying so is more useful than half-accepting it.
 *
 * Unset and empty stay silent: not configuring an optional variable is normal.
 */
function resolveInt(raw: string | undefined, fallback: number, name: string, min: number): number {
  const s = (raw ?? '').trim();
  if (!s) return fallback;
  if (/^\d+$/.test(s)) {
    const v = parseInt(s, 10);
    if (v >= min) return v;
  }
  log.warn('env value is not an integer in the accepted range — using the default', {
    variable: name, value: s, fallback, minimum: min,
  });
  return fallback;
}

/** `resolveInt` with a floor of 1 — for a value where 0 would break the server. */
export function resolvePositiveInt(raw: string | undefined, fallback: number, name: string): number {
  return resolveInt(raw, fallback, name, 1);
}

/**
 * `resolveInt` with a floor of 0 — for the rate limits, where `0` is documented
 * and meaningful ("disable the limiter, a WAF sits in front"). Using the
 * positive parser for those would quietly turn "off" back into the default,
 * which is the opposite of what the operator asked for.
 */
export function resolveNonNegativeInt(raw: string | undefined, fallback: number, name: string): number {
  return resolveInt(raw, fallback, name, 0);
}

/**
 * Default per-request upstream timeout, in milliseconds.
 *
 * Measured on staging 2026-08-02, per call, not per pipeline:
 *
 *   creating a `ccm:io`   4.2 – 8.0 s   (18 samples — by far the slowest)
 *   writing metadata      0.5 – 0.9 s
 *   reading a node        0.3 – 0.4 s
 *   search (ngsearch)     0.5 – 2.4 s   (production: max 1.1 s)
 *
 * The previous 10 s left 28 % headroom over the slowest of those, and that was
 * not enough: a create timed out in real use while the repository had already
 * made the record, so the tool reported a failure about a record that exists.
 * 20 s is ~2.8× the measured worst case and still bounds a hung socket to
 * something a caller can wait out.
 */
export const DEFAULT_FETCH_TIMEOUT_MS = 20_000;

/**
 * Per-request upstream timeout in milliseconds. Without it a hung
 * edu-sharing socket would block the MCP tool call indefinitely. Override via
 * ``WLO_FETCH_TIMEOUT_MS``.
 */
export const WLO_FETCH_TIMEOUT_MS: number =
  resolvePositiveInt(process.env['WLO_FETCH_TIMEOUT_MS'], DEFAULT_FETCH_TIMEOUT_MS, 'WLO_FETCH_TIMEOUT_MS');

/**
 * Base URL of the text-extraction service used to read the full text of a
 * material that is only LINKED (`ccm:wwwurl`) and whose text the repository has
 * not stored. Each edu-sharing instance normally runs its own, so the address is
 * configuration, not code — and there is deliberately NO default.
 *
 * A default used to point at the staging service, which meant any deploy that
 * had not set the variable shipped the URLs of its material to a host in a
 * different environment. Unset therefore disables the external path entirely,
 * with a warning naming the variable; the repository's own `/textContent` then
 * remains the only source. Trailing slashes are stripped so callers can append
 * a path safely.
 *
 * A value that cannot serve as a base for `${url}/from-url` — no scheme, not
 * http(s), or carrying a query/fragment — disables the service and warns too: a
 * typo must not redirect material URLs to a host the operator never chose.
 */
export function resolveExtractionUrl(raw: string | undefined): string {
  const s = (raw ?? '').trim();
  if (s === '') {
    log.warn('text-extraction service disabled: WLO_TEXT_EXTRACTION_URL is not set', {
      variable: 'WLO_TEXT_EXTRACTION_URL',
      effect: 'full text comes from the repository /textContent only',
    });
    return '';
  }
  const candidate = s.replace(/\/+$/, '');

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    log.warn('text-extraction service disabled: WLO_TEXT_EXTRACTION_URL is not a URL', { value: candidate });
    return '';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    log.warn('text-extraction service disabled: expected an http(s) URL', { protocol: parsed.protocol });
    return '';
  }
  if (parsed.search || parsed.hash) {
    log.warn('text-extraction service disabled: base URL must carry no query or fragment', { value: candidate });
    return '';
  }
  return candidate;
}

export const WLO_TEXT_EXTRACTION_URL: string = resolveExtractionUrl(process.env['WLO_TEXT_EXTRACTION_URL']);

/**
 * Timeout for full-text reads, both from the repository and from the extraction
 * service. Deliberately larger than ``DEFAULT_FETCH_TIMEOUT_MS``: `/textContent`
 * was measured at a median of 4.6 s and a maximum of 9.2 s (2026-07-28), and the
 * extraction service renders pages, which is slow for the same reason. The gap
 * between the two is the point — full text is the one call allowed to take
 * longer than everything else.
 */
export const DEFAULT_TEXT_TIMEOUT_MS = 25_000;

/** Override via ``WLO_TEXT_TIMEOUT_MS``. */
export const WLO_TEXT_TIMEOUT_MS: number =
  resolvePositiveInt(process.env['WLO_TEXT_TIMEOUT_MS'], DEFAULT_TEXT_TIMEOUT_MS, 'WLO_TEXT_TIMEOUT_MS');

/**
 * Concurrent upstream fetches while resolving Themenseiten-Varianten to their
 * owning collections (search_wlo_topic_pages Mode C). This listing is the
 * server's most fan-out-heavy path, so its wall-clock scales inversely with
 * this number — while the number itself bounds the load a single tool call may
 * put on edu-sharing. Raise it on a well-provisioned repository and watch the
 * upstream error rate. Override via ``WLO_TOPIC_POOL``; default 10.
 */
export const WLO_TOPIC_POOL: number =
  resolvePositiveInt(process.env['WLO_TOPIC_POOL'], 10, 'WLO_TOPIC_POOL');

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
