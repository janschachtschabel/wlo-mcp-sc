/**
 * node-match.ts – Local (client-side) node matching for the paths where the
 * backend search cannot be used: the collection tree-traversal fallback
 * (tools/collections.ts) and the /children fallback for reference collections
 * (services/search.ts). Leaf module (type-only imports) so both layers share
 * one matcher instead of drifting copies.
 */

import type { SearchCriterion, WloNode } from './wlo-config.js';

/**
 * Canonical human-readable title fallback chain, shared by every consumer
 * (formatter, reranker scoring/sorting/deleted-check, breadcrumbs). cm:title
 * before cm:name: on page-variant nodes cm:name is a technical placeholder
 * ("PAGE_VARIANT_<uuid>") while the readable title lives in cm:title.
 */
export function nodeTitle(node: WloNode): string {
  const p = node.properties ?? {};
  return p['cclom:title']?.[0] || p['cm:title']?.[0] || p['cm:name']?.[0] || node.name || node.title || '';
}

/** Match a node against a keyword query: any query word hits its name/title/description. */
export function nodeMatchesText(node: WloNode, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = [
    node.properties?.['cm:name']?.[0] ?? node.name ?? '',
    node.properties?.['cclom:title']?.[0] ?? node.title ?? '',
    node.properties?.['cm:title']?.[0] ?? '',
    node.properties?.['cclom:general_description']?.[0] ?? '',
  ].join(' ').toLowerCase();
  return words.some(w => haystack.includes(w));
}

/**
 * True when the node satisfies EVERY criterion: for each, the node's property
 * values (e.g. `ccm:taxonid` URIs) intersect the wanted values. Used to apply
 * already-resolved vocab filters locally when results were fetched via
 * /children instead of ngsearch.
 */
export function nodeMatchesCriteria(node: WloNode, criteria: SearchCriterion[]): boolean {
  return criteria.every(c => {
    const have = node.properties?.[c.property] ?? [];
    return c.values.some(v => have.includes(v));
  });
}
