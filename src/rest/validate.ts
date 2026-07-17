/**
 * rest/validate.ts – Input validation for the public REST layer.
 *
 * REST is a public trust boundary (unlike the MCP tools, whose zod schemas guard
 * their inputs), so every query parameter is bounded here before it reaches a
 * service: query length, nodeId length/count, integer ranges, boolean flags.
 * Pure and side-effect-free so it is unit-testable without a live server.
 */

const MAX_QUERY_LEN = 200;
const MAX_NODE_ID_LEN = 50;
const MAX_IDS = 25;
const MAX_FILTER_LEN = 100;

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

/** A non-empty free-text query, capped at MAX_QUERY_LEN. */
export function validateQuery(raw: string | null): Validated<string> {
  const q = (raw ?? '').trim();
  if (!q) return { ok: false, error: 'query parameter "q" is required' };
  if (q.length > MAX_QUERY_LEN) return { ok: false, error: `query must be at most ${MAX_QUERY_LEN} characters` };
  return { ok: true, value: q };
}

/** A single node id: non-empty, capped at MAX_NODE_ID_LEN. */
export function validateNodeId(raw: string): Validated<string> {
  const id = raw.trim();
  if (!id) return { ok: false, error: 'nodeId must not be empty' };
  if (id.length > MAX_NODE_ID_LEN) return { ok: false, error: `nodeId must be at most ${MAX_NODE_ID_LEN} characters` };
  return { ok: true, value: id };
}

/** A list of node ids: at least one, at most MAX_IDS, each individually valid. */
export function validateNodeIds(raws: string[]): Validated<string[]> {
  const ids = raws.map(s => s.trim()).filter(Boolean);
  if (!ids.length) return { ok: false, error: 'at least one nodeId is required' };
  if (ids.length > MAX_IDS) return { ok: false, error: `at most ${MAX_IDS} ids are allowed` };
  for (const id of ids) {
    const v = validateNodeId(id);
    if (!v.ok) return v;
  }
  return { ok: true, value: ids };
}

/**
 * A vocab filter value (educationalContext, discipline, …). The service resolves
 * the label→URI and gracefully reports what it can't map, so unknown *values* are
 * fine here — only absurdly long input is rejected. Returns `undefined` when the
 * param is absent.
 */
export function validateFilter(raw: string | null): Validated<string | undefined> {
  const v = (raw ?? '').trim();
  if (!v) return { ok: true, value: undefined };
  if (v.length > MAX_FILTER_LEN) return { ok: false, error: `filter value must be at most ${MAX_FILTER_LEN} characters` };
  return { ok: true, value: v };
}

/**
 * A Wikipedia language code: 2–3 lowercase ASCII letters (e.g. "de", "en",
 * "bar"). Defaults to "de" when absent. Rejecting garbage here keeps the
 * boundary contract honest instead of relying on wikipedia-api's safeLang
 * backstop to silently repair it.
 */
export function validateLang(raw: string | null): Validated<string> {
  const v = (raw ?? '').trim().toLowerCase();
  if (!v) return { ok: true, value: 'de' };
  if (!/^[a-z]{2,3}$/.test(v)) return { ok: false, error: 'lang must be a 2–3 letter language code (e.g. "de")' };
  return { ok: true, value: v };
}

/** Parse an integer query param and clamp it into [min, max]; `def` when absent/NaN. */
export function clampInt(raw: string | null, min: number, max: number, def: number): number {
  const n = parseInt(raw ?? '', 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

/** Truthy string flags: "1", "true", "yes", "on" (case-insensitive). */
export function parseBool(raw: string | null): boolean {
  return /^(1|true|yes|on)$/i.test((raw ?? '').trim());
}

/**
 * `FormattedNode` (+ `TopicPageResult`) output keys a caller may request via
 * `?fields=` on `/api/search` to trim the JSON — a token saving for generic LLM
 * clients that only need a few fields per hit. Kept in sync with `FormattedNode`
 * in `formatter.ts`; projection keeps only the requested keys that a given item
 * actually has (`src/rest/project.ts`).
 */
export const PROJECTABLE_FIELDS: ReadonlySet<string> = new Set([
  'nodeId', 'title', 'description', 'keywords', 'disciplines', 'educationalContexts',
  'userRoles', 'learningResourceTypes', 'url', 'downloadUrl', 'contentUrl', 'previewUrl',
  'previewIsIcon', 'mimeType', 'fileSize', 'license', 'publisher', 'nodeType',
  'topicPageUrl', 'textContent', 'compendiumText', 'topicPageContent',
]);

/**
 * Parse `fields=title,url` → the projected field list, or `undefined` when the
 * param is absent (no projection = full payload, back-compat). `nodeId` is always
 * included so projected results stay actionable (identity for a follow-up fetch).
 * Unknown field names are ignored; an error is returned only when NONE of the
 * requested names are valid, so the caller can self-correct.
 */
export function parseFields(raw: string | null): Validated<string[] | undefined> {
  const s = (raw ?? '').trim();
  if (!s) return { ok: true, value: undefined };
  const valid = s.split(',').map(f => f.trim()).filter(f => PROJECTABLE_FIELDS.has(f));
  if (!valid.length) {
    return { ok: false, error: `fields must be a comma-separated subset of: ${[...PROJECTABLE_FIELDS].join(', ')}` };
  }
  return { ok: true, value: [...new Set(['nodeId', ...valid])] };
}
