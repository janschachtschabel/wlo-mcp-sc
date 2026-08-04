/**
 * filter-criteria.ts – turning caller-supplied vocabulary LABELS into the URIs
 * the repository filters on, and reporting the ones that did not resolve.
 *
 * Lived in `tools/shared.ts` until 2026-08-04, because the MCP tools were the
 * first callers. The REST layer and two `services/` modules then imported it
 * from there, which pointed the dependency the wrong way: this is vocabulary
 * domain logic — it knows `resolveVocab` and the `ccm:*` property names, and
 * nothing about MCP. As a leaf module every layer may depend on it.
 */

import type { SearchCriterion } from './wlo-api.js';
import { resolveVocab, type VocabKey } from './vocabs.js';
import { suggestVocab } from './vocab-suggest.js';

/** A search criterion carrying the human label the URI was resolved from. */
export interface LabeledCriterion {
  property: string;
  values: string[];
  label?: string;
}

export interface UnresolvedFilter {
  field: string;
  value: string;
  suggestions?: string[];
}

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
