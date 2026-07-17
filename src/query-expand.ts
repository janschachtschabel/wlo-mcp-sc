/**
 * query-expand.ts – Query expansion for the enhanced search: turns one user
 * query into a small, weight-capped set of backend query variants (full text,
 * title, keywords, stopword-free, synonyms). Extracted from reranker.ts so the
 * most-edited data (synonym table, stopwords) lives apart from the scoring/
 * merge algorithm that consumes the variants.
 */

import type { SearchCriterion } from './wlo-config.js';

// O4: Upper bound for parallel query variants (= parallel ngsearch calls).
// Variants are sorted by weight and trimmed to the best MAX_VARIANTS, so a
// synonym-/term-rich query does not trigger double-digit numbers of backend
// calls. ``full:`` (weight 1.0) therefore always stays included.
const MAX_VARIANTS = 5;

/** Shared with the reranker's scoring: stopwords must not act as relevance signals either. */
export const DE_STOPWORDS = new Set([
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'einem', 'einen', 'eines',
  'und', 'oder', 'aber', 'als', 'auch', 'auf', 'aus', 'bei', 'bis', 'für', 'mit', 'nach',
  'von', 'vor', 'wie', 'über', 'unter', 'durch', 'gegen', 'ohne', 'zwischen',
  'ich', 'du', 'er', 'sie', 'wir', 'ihr', 'uns', 'sich',
  'ist', 'sind', 'war', 'hat', 'wird', 'kann', 'soll', 'zum', 'zur', 'vom',
  'nicht', 'noch', 'nur', 'sehr', 'schon', 'dann', 'wenn', 'dass', 'weil',
  'im', 'am', 'an', 'in', 'zu', 'so', 'es', 'ob',
]);

const SYNONYM_MAP: Record<string, string[]> = {
  'ki':                     ['künstliche intelligenz', 'artificial intelligence'],
  'künstliche intelligenz': ['ki'],
  'oer':                    ['open educational resources', 'freie bildungsmaterialien'],
  'mathe':                  ['mathematik'],
  'mathematik':             ['mathe'],
  'bio':                    ['biologie'],
  'biologie':               ['bio'],
  'physik':                 ['physics'],
  'chemie':                 ['chemistry'],
  'geo':                    ['geographie', 'erdkunde'],
  'geographie':             ['erdkunde', 'geo'],
  'erdkunde':               ['geographie', 'geo'],
  'info':                   ['informatik'],
  'informatik':             ['info', 'computer science'],
  'grundschule':            ['primarstufe'],
  'primarstufe':            ['grundschule'],
  'klima':                  ['klimawandel', 'klimaschutz'],
  'klimawandel':            ['klima', 'klimaschutz', 'climate change'],
  'nachhaltigkeit':         ['nachhaltige entwicklung', 'bne', 'sustainability'],
  'bne':                    ['bildung für nachhaltige entwicklung', 'nachhaltigkeit'],
};

export interface QueryVariant {
  label: string;
  weight: number;
  criteria: SearchCriterion[];
}

export function expandQuery(query: string): QueryVariant[] {
  const trimmed = query.trim();
  if (!trimmed) return [{ label: 'all', weight: 1, criteria: [{ property: 'ngsearchword', values: ['*'] }] }];

  const terms = trimmed.split(/\s+/).filter(t => t.length >= 2);
  const significantTerms = terms.filter(t => t.length >= 3);
  const contentTerms = terms.filter(t => !DE_STOPWORDS.has(t.toLowerCase()));
  const variants: QueryVariant[] = [];

  variants.push({ label: `full:"${trimmed}"`, weight: 1.0, criteria: [{ property: 'ngsearchword', values: [trimmed] }] });
  variants.push({ label: `title:"${trimmed}"`, weight: 0.95, criteria: [{ property: 'cclom:title', values: [trimmed] }] });

  if (significantTerms.length > 0) {
    variants.push({ label: `kw:${significantTerms.join(',')}`, weight: 0.9, criteria: [{ property: 'cclom:general_keyword', values: significantTerms }] });
  }

  if (contentTerms.length > 0 && contentTerms.length < terms.length) {
    variants.push({ label: `nostop:"${contentTerms.join(' ')}"`, weight: 0.85, criteria: [{ property: 'ngsearchword', values: [contentTerms.join(' ')] }] });
  }

  const queryLower = trimmed.toLowerCase();
  const synonymQueries = new Set<string>();
  for (const [term, synonyms] of Object.entries(SYNONYM_MAP)) {
    // Match on word boundaries (umlaut-aware) so a key like "klima" does NOT
    // fire inside "klimawandel", and the replace can't corrupt a substring
    // (the old `.replace(term, syn)` turned "geographie" → "geographiegrafie").
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![\\wäöüß])${esc}(?![\\wäöüß])`, 'i');
    if (re.test(queryLower)) {
      for (const syn of synonyms) {
        const expanded = queryLower.replace(re, syn);
        if (expanded !== queryLower) synonymQueries.add(expanded);
      }
    }
  }
  for (const synQuery of synonymQueries) {
    variants.push({ label: `syn:"${synQuery}"`, weight: 0.6, criteria: [{ property: 'ngsearchword', values: [synQuery] }] });
  }

  // O4: The former single-term variants (term:"X", weight 0.5) have been
  // removed — they produced 1 ngsearch call PER term for minimal added value,
  // since the keyword variant (kw:) already covers the individual terms via
  // cclom:general_keyword. Instead: sort by weight and cap at the best
  // MAX_VARIANTS.
  variants.sort((a, b) => b.weight - a.weight);
  return variants.slice(0, MAX_VARIANTS);
}
