/**
 * node-match.ts – Local (client-side) node matching for the paths where the
 * backend search cannot be used: the collection tree-traversal fallback
 * (tools/collections.ts) and the /children fallback for reference collections
 * (services/search.ts). Leaf module (type-only imports) so both layers share
 * one matcher instead of drifting copies.
 */

import { DE_STOPWORDS } from './query-expand.js';
import type { SearchCriterion, WloNode } from './wlo-types.js';

/** Above this length a term may match anywhere in a word (see {@link termMatches}). */
const SHORT_TERM_MAX = 3;

/**
 * The words of a query that can carry a signal.
 *
 * A stopword carries none, and it is not merely useless — it is actively
 * harmful, because German stopwords sit inside ordinary words ("Stu-die-n",
 * "Me-die-n"). Measured live 2026-08-03 over a 60-node pool: `"Bruchrechnung"`
 * matched 0 nodes, and `"die Bruchrechnung"` matched 43 — one article turned a
 * correct rejection into a 72% pass rate. Single characters are dropped for the
 * same reason.
 */
export function queryTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(t => t.length >= 2 && !DE_STOPWORDS.has(t));
}

/**
 * Does `term` occur in `text` as a signal rather than by accident?
 *
 * A plain substring test is right for German: "Rechnung" belongs inside
 * "Bruchrechnung" and "Mittelalter" inside "mittelalterlichen". For a SHORT
 * term the same test is mostly accident — measured live 2026-08-03, the query
 * "IT" put "s-it-ting", "Maur-it-ius", "Pol-it-ik" and "C-it-izenship" in the
 * top five results.
 *
 * What separates the two is WHERE the match sits: a compound or an inflection
 * carries the term at a word START, while the accidental ones bury it mid-word.
 * So a short term must match at a word boundary — which still keeps "EU" in
 * "Europäische" and "Bio" in "Biologie" — and a longer one keeps the substring
 * behaviour German needs. Only the START is checked: requiring a boundary at
 * the end too would reject exactly those compounds.
 *
 * `text` is expected lowercase, as is `term`.
 */
export function termMatches(term: string, text: string): boolean {
  if (!term) return false;
  if (term.length > SHORT_TERM_MAX) return text.includes(term);
  for (let from = 0; ; from += 1) {
    const at = text.indexOf(term, from);
    if (at === -1) return false;
    if (at === 0 || !/[\p{L}\p{N}]/u.test(text[at - 1]!)) return true;
    from = at;
  }
}

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

/**
 * Match a node against a keyword query: any signal-carrying query word hits its
 * name/title/description.
 *
 * A query of nothing but stopwords yields no terms, and then this matches
 * NOTHING rather than everything — the caller asked whether this node is about
 * the query, and "die und der" says nothing to be about. Passing every node
 * would be the answer that looks like a result and is not.
 */
export function nodeMatchesText(node: WloNode, q: string): boolean {
  const words = queryTerms(q);
  if (words.length === 0) return false;
  const haystack = [
    node.properties?.['cm:name']?.[0] ?? node.name ?? '',
    node.properties?.['cclom:title']?.[0] ?? node.title ?? '',
    node.properties?.['cm:title']?.[0] ?? '',
    node.properties?.['cclom:general_description']?.[0] ?? '',
  ].join(' ').toLowerCase();
  return words.some(w => termMatches(w, haystack));
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
