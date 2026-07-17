/**
 * tools/shared.ts – Helpers shared by all WLO tool modules:
 * query metadata for downstream consumers, the label→URI filter builder,
 * topic-page title fallbacks, and a bounded-concurrency mapper.
 */

import type { SearchCriterion } from '../wlo-api.js';
import type { ThemePageInfo } from '../topic-page-api.js';
import { resolveVocab, type VocabKey } from '../vocabs.js';
import { suggestVocab } from '../vocab-suggest.js';
import { log } from '../logger.js';

// ── Topic-page display-title resolution ─────────────────────────────────────

const _UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True for technical, non-human-readable identifiers that must never be
 * shown as a Themenseite title — namely the auto-generated `cm:name` of a
 * page-variant node ("PAGE_VARIANT_<uuid>") and bare node UUIDs.
 */
export function isPlaceholderTitle(s: string | undefined | null): boolean {
  const t = (s ?? '').trim();
  if (!t) return true;
  if (/^page[_-]?variant/i.test(t)) return true;
  if (_UUID_RE.test(t)) return true;
  return false;
}

/**
 * Pick the best human-readable title for a Themenseite, in priority order:
 *   1. owning collection name (`cclom:title`/`cm:name` of the collection),
 *   2. the variant node's own `cm:title` ("Seiten-Variante 1"),
 *   3. the variant's `cm:name` — only if it is NOT a PAGE_VARIANT/UUID
 *      placeholder.
 * Falls back to a generic "Themenseite" so a raw UUID is never displayed.
 */
export function pickThemePageTitle(r: ThemePageInfo): string {
  const candidates = [r.collectionName, r.variantTitle, r.variantName];
  for (const c of candidates) {
    const t = (c ?? '').trim();
    if (t && !isPlaceholderTitle(t)) return t;
  }
  return 'Themenseite';
}

/**
 * Run an async mapper over `items` with a bounded number of concurrent
 * in-flight tasks (worker-pool). Keeps result order. Used to fan out the
 * per-variant enrichment in search_wlo_topic_pages Mode C WITHOUT firing
 * 100+ simultaneous upstream fetches (which risks connection exhaustion /
 * upstream throttling / the 30s Vercel limit) — a controlled pool is both
 * stable and, combined with caching, fast.
 *
 * **Fault tolerance (explicit contract):** if `fn` rejects for a single item,
 * that slot is set to `null` and the batch keeps going — one transient upstream
 * error must not discard every other successfully-resolved item. Callers
 * therefore receive `(R | null)[]` and must filter out the nulls. The failure
 * is logged so it is not silently lost.
 */
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        results[i] = null;
        log.warn('mapPool item failed', { index: i, error: err instanceof Error ? err.message : String(err) });
      }
    }
  };
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}

// ── Query metadata for downstream consumers (backend → frontend) ────────────

export interface LabeledCriterion {
  property: string;
  values: string[];
  label?: string;
}

export interface QueryMeta {
  toolName: string;
  queryType: string;
  searchTerm: string;
  criteria: LabeledCriterion[];
  pagination: { maxItems: number; skipCount: number; totalResults: number };
  repositoryUrl: string;
  searchUrl: string;
  /**
   * Vocab filters the caller supplied that could NOT be resolved to a URI and
   * were therefore silently dropped from the search. Surfaced so the caller can
   * self-correct (e.g. via lookup_wlo_vocabulary). Each may carry up to three
   * fuzzy `suggestions` ("Meintest du?"). Omitted when everything resolved.
   * Publisher is a free-text filter and never appears here.
   */
  unresolvedFilters?: { field: string; value: string; suggestions?: string[] }[];
  /**
   * Facet counts for the current query (opt-in via `includeFacets`), keyed by
   * filter name → labeled buckets, e.g. `{ learningResourceType: [{label, count, uri}] }`.
   * Each bucket carries its concept `uri` so the caller can filter by it exactly —
   * e.g. a university-subject `discipline` facet whose label matches a school
   * subject but whose URI differs. Lets the caller narrow without probe-searches.
   * Omitted when not requested.
   */
  facets?: Record<string, { label: string; count: number; uri: string }[]>;
}

const SEARCH_URL_FILTER_PROPS = new Set([
  'ccm:taxonid',
  'ccm:educationalcontext',
  'ccm:oeh_lrt_aggregated',
  'ccm:educationalintendedenduserrole',
  'ccm:oeh_publisher_combined',
]);

export function buildSearchUrl(repoUrl: string, searchTerm: string, criteria: LabeledCriterion[]): string {
  const filterObj: Record<string, string[]> = {};
  for (const c of criteria) {
    if (SEARCH_URL_FILTER_PROPS.has(c.property)) {
      filterObj[c.property] = c.values;
    }
  }
  const params = new URLSearchParams();
  if (searchTerm) params.set('q', searchTerm);
  if (Object.keys(filterObj).length) params.set('filters', JSON.stringify(filterObj));
  return `${repoUrl}/components/search?${params.toString()}`;
}

export function queryMetaContent(meta: Omit<QueryMeta, 'searchUrl'>): { type: 'text'; text: string } {
  const searchUrl = buildSearchUrl(meta.repositoryUrl, meta.searchTerm, meta.criteria);
  return { type: 'text' as const, text: JSON.stringify({ _queryMeta: { ...meta, searchUrl } }) };
}

// ── Uniform tool error handling ──────────────────────────────────────────────

/**
 * Build the standard error result for a failed tool call AND log it
 * server-side. Every tool's catch block was previously duplicating the
 * `err instanceof Error ? ...` extraction and returning it to the client
 * WITHOUT any server-side trace — so upstream failures were invisible in the
 * logs. This centralizes both: structured error log + the client-facing
 * `<context>: <detail>` message (behaviour-preserving for callers).
 */
export function toolError(
  context: string,
  err: unknown,
): { content: { type: 'text'; text: string }[]; isError: true } {
  const detail = err instanceof Error ? err.message : String(err);
  log.error('tool error', { context, error: detail });
  return { content: [{ type: 'text' as const, text: `${context}: ${detail}` }], isError: true };
}

// ── Shared filter builder ────────────────────────────────────────────────────

export function buildFilterCriteria(params: {
  educationalContext?: string;
  discipline?: string;
  userRole?: string;
  publisher?: string;
  learningResourceType?: string;
}): {
  criteria: SearchCriterion[];
  labeled: LabeledCriterion[];
  unresolved: UnresolvedFilter[];
} {
  const criteria: SearchCriterion[] = [];
  const labeled: LabeledCriterion[] = [];
  // Vocab filters the caller gave that didn't resolve to a URI — they get
  // silently dropped from the search, so we report them (with fuzzy
  // "Meintest du?" suggestions) for self-correction.
  const unresolved: UnresolvedFilter[] = [];
  const reportUnresolved = (field: string, value: string, vocab: VocabKey) => {
    const suggestions = suggestVocab(value, vocab);
    unresolved.push(suggestions.length ? { field, value, suggestions } : { field, value });
  };

  if (params.educationalContext) {
    const uri = resolveVocab(params.educationalContext, 'educationalContext');
    if (uri) {
      criteria.push({ property: 'ccm:educationalcontext', values: [uri] });
      labeled.push({ property: 'ccm:educationalcontext', values: [uri], label: params.educationalContext });
    } else {
      reportUnresolved('educationalContext', params.educationalContext, 'educationalContext');
    }
  }
  if (params.discipline) {
    const uri = resolveVocab(params.discipline, 'discipline');
    if (uri) {
      criteria.push({ property: 'ccm:taxonid', values: [uri] });
      labeled.push({ property: 'ccm:taxonid', values: [uri], label: params.discipline });
    } else {
      reportUnresolved('discipline', params.discipline, 'discipline');
    }
  }
  if (params.userRole) {
    const uri = resolveVocab(params.userRole, 'userRole');
    if (uri) {
      criteria.push({ property: 'ccm:educationalintendedenduserrole', values: [uri] });
      labeled.push({ property: 'ccm:educationalintendedenduserrole', values: [uri], label: params.userRole });
    } else {
      reportUnresolved('userRole', params.userRole, 'userRole');
    }
  }
  if (params.publisher) {
    criteria.push({ property: 'ccm:oeh_publisher_combined', values: [params.publisher] });
    labeled.push({ property: 'ccm:oeh_publisher_combined', values: [params.publisher], label: params.publisher });
  }
  const lrt = resolveVocab(params.learningResourceType ?? '', 'lrt');
  if (lrt) {
    criteria.push({ property: 'ccm:oeh_lrt_aggregated', values: [lrt] });
    labeled.push({ property: 'ccm:oeh_lrt_aggregated', values: [lrt], label: params.learningResourceType });
  } else if (params.learningResourceType) {
    reportUnresolved('learningResourceType', params.learningResourceType, 'lrt');
  }

  return { criteria, labeled, unresolved };
}

export interface UnresolvedFilter {
  field: string;
  value: string;
  suggestions?: string[];
}

/**
 * Render a human-readable warning for vocab filters that did not resolve, so the
 * hint rides in the tool's visible content — not only in `_queryMeta`. Returns
 * '' when nothing is unresolved. Each line names the dropped filter and, when
 * available, up to three "Meintest du?" suggestions.
 */
export function formatUnresolvedHint(unresolved: UnresolvedFilter[]): string {
  if (!unresolved.length) return '';
  return unresolved
    .map(u => {
      const head = `⚠ Filter "${u.value}" für ${u.field} nicht erkannt und ignoriert.`;
      return u.suggestions?.length ? `${head} Meintest du: ${u.suggestions.join(', ')}?` : head;
    })
    .join('\n');
}
