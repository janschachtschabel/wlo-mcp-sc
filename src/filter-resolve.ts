/**
 * filter-resolve.ts – every filter label of a plan, resolved in one pass.
 *
 * The question `resolve_wlo_filters` answers (BOERDi wishlist item 3,
 * 2026-11-06): "what does each of these labels mean to WLO, and how sure is
 * that?". Pure — no I/O — and built ON `resolveVocabMatch` and
 * `resolveLicenseSelection`, never beside them: a search, a write and this tool
 * must read one label the same way, or a plan resolved here filters differently
 * there.
 */

import { labelFromUri, resolveVocabMatch, type VocabKey, type VocabMatchKind } from './vocabs.js';
import { resolveLicenseSelection } from './filter-criteria.js';
import { suggestVocab } from './vocab-suggest.js';

/** The vocabularies a plan names, in the order the result lists them. */
export const RESOLVABLE_VOCABS = [
  'discipline', 'educationalContext', 'lrt', 'license', 'userRole', 'targetGroup',
] as const satisfies readonly VocabKey[];
export type ResolvableVocab = (typeof RESOLVABLE_VOCABS)[number];

export interface ResolvedValue {
  input: string;
  status: VocabMatchKind;
  /** The value WLO stores: a URI, or a bare key for licences. */
  uri: string;
  label: string;
  /** Only for a bundle ("OER"): the licence keys it stands for. */
  keys?: string[];
  /** Only for `fuzzy`: what the caller may have meant — a guess is never final. */
  suggestions?: string[];
}

export interface UnresolvedValue {
  vocabulary: ResolvableVocab;
  input: string;
  suggestions: string[];
}

export interface FilterResolution {
  results: Partial<Record<ResolvableVocab, ResolvedValue[]>>;
  unresolved: UnresolvedValue[];
}

/** Resolve every value of every given vocabulary. Order of inputs is kept. */
export function resolveFilters(filters: Partial<Record<ResolvableVocab, string[]>>): FilterResolution {
  const results: FilterResolution['results'] = {};
  const unresolved: UnresolvedValue[] = [];
  for (const vocab of RESOLVABLE_VOCABS) {
    for (const raw of filters[vocab] ?? []) {
      const input = raw.trim();
      if (!input) continue;
      const hit = resolveOne(input, vocab);
      if (hit) (results[vocab] ??= []).push(hit);
      else unresolved.push({ vocabulary: vocab, input, suggestions: suggestVocab(input, vocab) });
    }
  }
  return { results, unresolved };
}

function resolveOne(input: string, vocab: ResolvableVocab): ResolvedValue | null {
  if (vocab === 'license') {
    // The bundle is a SET the search tools accept as one word; it has no single
    // key, so it is named with the keys it expands to.
    const keys = resolveLicenseSelection(input);
    if (keys && keys.length > 1) {
      return { input, status: 'alias', uri: 'OER', label: 'OER (frei nachnutzbar)', keys };
    }
  }
  const hit = resolveVocabMatch(input, vocab);
  if (!hit) return null;
  return {
    input,
    status: hit.match,
    uri: hit.value,
    label: labelFromUri(hit.value, vocab),
    ...(hit.match === 'fuzzy' ? { suggestions: suggestVocab(input, vocab) } : {}),
  };
}
