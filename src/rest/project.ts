/**
 * rest/project.ts – Optional field projection for the public `/api/search` JSON.
 *
 * A token-conscious generic client (an LLM reading the raw JSON) often needs only
 * a few fields per hit. `?fields=title,url,description` trims each result item to
 * the requested keys, cutting the response — and thus the tokens the model
 * ingests — without touching the MCP tools, widgets, or the service layer. The
 * field list is allow-list-validated in `validate.ts`; here we only pick. Pure.
 */

import type { SearchAllEnvelope } from '../services/search.js';

export interface ProjectedEnvelope {
  query: string;
  content: { total: number; count: number; results: Record<string, unknown>[] };
  collections: { total: number; count: number; results: Record<string, unknown>[] };
  topicPages: { total: number; count: number; results: Record<string, unknown>[] };
  wikipedia?: unknown;
}

/** Keep only the requested keys that this item actually carries. */
function pick(item: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) if (f in item) out[f] = item[f];
  return out;
}

/** Trim a list of result items to `fields` (shared by /api/search and /api/collection). */
export function projectItems(items: readonly unknown[], fields: readonly string[]): Record<string, unknown>[] {
  return items.map(it => pick(it as Record<string, unknown>, fields));
}

/**
 * Trim each bucket's result items to `fields`; envelope metadata (query, totals,
 * counts, wikipedia) is preserved unchanged.
 */
export function projectEnvelope(env: SearchAllEnvelope, fields: readonly string[]): ProjectedEnvelope {
  const bucket = (b: { total: number; count: number; results: readonly unknown[] }) => ({
    total: b.total,
    count: b.count,
    results: projectItems(b.results, fields),
  });
  return {
    query: env.query,
    content: bucket(env.content),
    collections: bucket(env.collections),
    topicPages: bucket(env.topicPages),
    ...(env.wikipedia !== undefined ? { wikipedia: env.wikipedia } : {}),
  };
}
