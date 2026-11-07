/**
 * services/content-count.ts – how many contents match each of many queries?
 * (BOERDi wishlist item 5, 2026-11-06).
 *
 * The basis of a gap analysis, so three rules:
 * - ONE search per query, no query variants and no reranking: the number is the
 *   repository's `pagination.total`, and the same query twice gives the same one.
 * - An UNRESOLVED filter is never dropped: counting without it would report a
 *   larger number as if it were the filtered one — exactly the wrong answer
 *   for "where are the gaps". The query is named in `missing` instead.
 * - No subtree scope (decision E5): the repository cannot narrow a search to a
 *   collection's subtree, and an approximation would be read as a real number.
 */

import { ngsearch } from '../wlo-api.js';
import { buildFilterCriteria } from '../filter-criteria.js';
import { formatNodes } from '../formatter.js';
import { mapPool } from '../concurrency.js';
import { failureCode, type FailureCode } from './failure-code.js';

/** Searches in flight per call. */
const COUNT_POOL = 4;

export interface CountFilters {
  educationalContext?: string;
  discipline?: string;
  userRole?: string;
  learningResourceType?: string;
}

export interface CountQuery { id: string; query: string; filters?: CountFilters }

export interface CountResult {
  id: string;
  total: number;
  top: Array<{ nodeId: string; title: string; url: string }>;
  /** Filters that resolved only by GUESS — counted, but worth a question. */
  fuzzyFilters?: Array<keyof CountFilters>;
}

export interface CountMissing { part: string; code: FailureCode | 'unresolved_filter'; message?: string }

const FIELD_OF: Record<string, keyof CountFilters> = {
  'ccm:educationalcontext': 'educationalContext',
  'ccm:taxonid': 'discipline',
  'ccm:educationalintendedenduserrole': 'userRole',
  'ccm:oeh_lrt_aggregated': 'learningResourceType',
};

const TOP_PROPS = ['cclom:title', 'cm:title', 'cm:name', 'ccm:wwwurl'];

type Outcome = { result: CountResult } | { missing: CountMissing };

async function countOne(q: CountQuery, top: number): Promise<Outcome> {
  const { criteria, labeled, unresolved } = buildFilterCriteria(q.filters ?? {});
  if (unresolved.length) {
    return { missing: {
      part: q.id,
      code: 'unresolved_filter',
      message: unresolved.map(u => `${u.field} „${u.value}"${u.suggestions?.length ? ` (meintest du: ${u.suggestions.join(', ')})` : ''}`).join('; '),
    } };
  }
  try {
    // maxItems ≥ 1 even for `top: 0` — the total is what is asked, and a zero
    // page is not a request every repository version answers the same way.
    const res = await ngsearch(
      [{ property: 'ngsearchword', values: [q.query] }, ...criteria], 'FILES', Math.max(1, top), 0, TOP_PROPS,
    );
    const fuzzy = labeled.filter(l => l.match === 'fuzzy').map(l => FIELD_OF[l.property]).filter(Boolean) as Array<keyof CountFilters>;
    return { result: {
      id: q.id,
      total: res.pagination.total,
      top: formatNodes(res.nodes).slice(0, top).map(n => ({ nodeId: n.nodeId, title: n.title, url: n.url })),
      ...(fuzzy.length ? { fuzzyFilters: fuzzy } : {}),
    } };
  } catch (err) {
    return { missing: { part: q.id, code: failureCode(err) } };
  }
}

/** Count every query; results and misses keep the order of the input. */
export async function countMatches(queries: CountQuery[], top: number): Promise<{ results: CountResult[]; missing: CountMissing[] }> {
  const outcomes = await mapPool(queries, COUNT_POOL, q => countOne(q, top));
  const results: CountResult[] = [];
  const missing: CountMissing[] = [];
  outcomes.forEach((o, i) => {
    if (!o) missing.push({ part: queries[i]!.id, code: 'upstream_error' });
    else if ('result' in o) results.push(o.result);
    else missing.push(o.missing);
  });
  return { results, missing };
}
