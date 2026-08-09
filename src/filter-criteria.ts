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
  license?: string;
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
  if (params.license) {
    // The only vocabulary here that does NOT resolve to a URI: edu-sharing
    // stores and filters licences as bare keys (`CC_BY`, `PDM`). Measured on
    // staging 2026-08-09 — `ccm:commonlicense_key` narrows an ngsearch
    // ("Optik" 756 -> 343 for CC_BY), while `virtual:license` and `ccm:license`
    // answer 400 DAOValidationException. `resolveVocab` accepts the label and
    // the key alike, so both spellings work.
    const keys = resolveLicenseSelection(params.license);
    if (!keys) {
      reportUnresolved('license', params.license, 'license');
    } else if (keys.length === 1) {
      criteria.push({ property: 'ccm:commonlicense_key', values: keys });
      labeled.push({ property: 'ccm:commonlicense_key', values: keys, label: params.license });
    } else {
      // A SET of licences (the OER bundle) cannot be expressed upstream, and
      // this was measured rather than assumed — the OR that works on
      // `ccm:oeh_extendedType` does not transfer: two values at
      // `ccm:commonlicense_key` answer 400 DAOValidationException, the criterion
      // repeated twice AND-s (343 + 110 → 110), and an "A OR B" string matches 0.
      // So the bundle sends NO criterion and is applied locally by
      // `filterByExactLicense`. Narrowing upstream on `CC_BY` would cover the two
      // CC members but silently lose every public-domain record — missing a
      // category the caller asked for is worse than a wider page.
      labeled.push({ property: 'ccm:commonlicense_key', values: keys, label: params.license });
    }
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
 * Keep only the hits whose licence is EXACTLY the requested one.
 *
 * The upstream criterion narrows but does not isolate: measured on staging
 * 2026-08-09, `ccm:commonlicense_key=CC_BY` returns 343 hits for "Optik"
 * including CC BY-ND, CC BY-NC-SA and CC BY-NC-ND — the key matches the CC-BY
 * family, and quoting the value changes nothing. Sub-keys behave the same way
 * one level down (`CC_BY_NC` covers `CC_BY_NC_SA`). So the one licence nobody
 * can isolate upstream is plain CC BY, which is precisely the one people filter
 * for when they intend to remix, and the extra hits are MORE restrictive than
 * what they asked for. That is the harmful direction, so the exact match is
 * enforced here.
 *
 * Runs before the result cap, like `dedupeByUrl`: a copy of the wrong licence
 * must not occupy a slot. The page is not widened to compensate, so a
 * family-heavy page returns fewer results than asked for — while the reported
 * total counts the records with exactly this licence, aggregated server-side by
 * `exactLicenseTotal` (services/license-search.ts), NOT the family the criterion
 * matched. Nodes are compared on the resolved KEY, because the formatted node
 * carries the display label ("CC BY-SA 4.0"), not the key — the same resolution
 * the count applies to its facet buckets, so both agree on what counts.
 *
 * A caller-supplied licence that did not resolve never reaches this function —
 * `buildFilterCriteria` reports it as unresolved and no filtering happens at all.
 *
 * A RECORD whose own licence does not resolve is dropped, and that is the rule
 * rather than a side effect of the comparison (operator's decision 2026-08-09):
 * what is not declared cannot be declared free. It decides a lot of material —
 * 105 969 of staging's 403 431 records carry no `ccm:commonlicense_key` at all
 * (26.3 %; production 88 200 of 318 696, 27.7 %). Staging is named first because
 * it is where `WLO_REPOSITORY_URL` points by default.
 */
/**
 * The one licence BUNDLE beside the individual licences: material that may
 * actually be reused.
 *
 * Membership follows the 5R / Open-Definition reading (reuse, revise, remix,
 * redistribute, retain): public-domain-equivalent plus the two share-alike-or-
 * freer Creative Commons licences. **NC and ND are deliberately out** — ND
 * forbids revision and NC restricts reuse, so including them would answer "may
 * I adapt this?" with material nobody may adapt, which is the same failure the
 * family over-match caused. `CUSTOM`, `NONE` and `SCHULFUNK` are out because
 * they say nothing verifiable about reuse.
 */
const OER_LICENSES = ['CC_0', 'PDM', 'COPYRIGHT_FREE', 'CC_BY', 'CC_BY_SA'] as const;

/** Words a caller may use for the bundle instead of a single licence. */
const OER_ALIASES = ['oer', 'oer-lizenz', 'oer-lizenzen', 'freie lizenz', 'freie lizenzen', 'offene lizenz', 'offene lizenzen'];

/**
 * Turn one `license` input into the set of repository keys it selects: the OER
 * bundle, a single licence, or nothing when it does not resolve. One place, so
 * the upstream criterion and the local exactness pass can never disagree about
 * what the caller asked for.
 */
export function resolveLicenseSelection(input: string | undefined): string[] | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;
  if (OER_ALIASES.includes(raw.toLowerCase())) return [...OER_LICENSES];
  const key = resolveVocab(raw, 'license');
  return key ? [key] : null;
}

/**
 * How large an upstream page to request when a licence filter is set.
 *
 * `filterByExactLicense` throws away the family members the repository could
 * not exclude, so without headroom it starves: measured live 2026-08-09,
 * "Optik" + CC BY 4.0 has 343 backend hits and the first page of ten held not
 * one exact CC BY record — the answer was "0 Treffer" for a filter with 343
 * hits behind it. Unlike duplicate copies, this over-match is SYSTEMATIC (the
 * key is a family prefix), which is what justifies paying for it here and
 * nowhere else. 50 is the repository page this project already uses as its
 * upper bound elsewhere; a family-heavy query can still come back short, and
 * `total` keeps reporting the real backend count either way.
 */
export const LICENSE_PAGE = 50;

/** The upstream page size for a request, widened only when a licence is filtered. */
export function pageSizeForLicense(base: number, license: string | undefined): number {
  return license ? Math.max(base, LICENSE_PAGE) : base;
}

export function filterByExactLicense<T extends { license: string }>(
  nodes: T[],
  requested: string | undefined,
): T[] {
  const wanted = resolveLicenseSelection(requested);
  if (!wanted) return nodes;
  const allowed = new Set(wanted);
  return nodes.filter(n => {
    const key = resolveVocab(n.license, 'license');
    return key !== null && allowed.has(key);
  });
}

/**
 * Say so when the local licence pass threw away candidates — silence here reads
 * as "there is nothing", which is false.
 *
 * The repository cannot isolate a licence (the key matches a family) and cannot
 * OR a set, so exactness happens locally over a bounded window. Measured live
 * 2026-08-09: `Optik` + CC BY-NC 4.0 matched 172 records in the NC family and
 * returned none of them, because the checked candidates held only its NC-SA and
 * NC-ND relatives. A bare "0 Treffer" would send the caller looking for material
 * that is there.
 *
 * Returns '' when nothing was dropped.
 *
 * FIVE paths accept `license` and every one of them discloses — three MCP tools
 * (`search_wlo_content`, `search_wlo_all` and `search_wlo_within_collection`)
 * plus `/api/search` and `/api/collection`. The two REST endpoints report the
 * counts as `licenseFilter {checked, kept}`; `/api/search?format=html` renders
 * this sentence from them, and so does the search-results widget's empty state
 * in its own two languages. Keep that count honest when adding a path: it was
 * "THREE" while two REST paths silently dropped the disclosure, and the number
 * is the thing a maintainer checks against.
 *
 * Their totals mean different things: a corpus count from the facet for the two
 * searches, a count within the examined window for the collection. The sentence
 * therefore says only what holds on all of them ("counts records with exactly
 * this licence") and leaves the window disclosure to the collection tool's own
 * sample hint. Saying "server-side" here was false on the collection path.
 */
export function licenseFilterNotice(
  before: number,
  after: number,
  license: string | undefined,
): string {
  if (!license || after >= before) return '';
  const head = after === 0
    ? `ⓘ Kein Treffer mit genau der Lizenz "${license}" unter den ${before} geprüften Kandidaten.`
    : `ⓘ ${before - after} von ${before} geprüften Treffern hatten nicht genau die Lizenz "${license}" und wurden entfernt.`;
  return `${head} Die Gesamtzahl zählt nur Datensätze mit genau dieser Lizenz; das Repository kann Lizenzen ohnehin nur als FAMILIE filtern (CC_BY erfasst auch NC/ND), die Feinauswahl passiert deshalb hier.`;
}

/**
 * Say that a page of BUNDLE results does not continue the previous one.
 *
 * The bundle cannot be expressed as one upstream query, so it asks once per
 * licence key and hands the same `skipCount` to each (`services/license-search.ts`).
 * Page two is therefore "the second page of every licence", not "the next eight
 * results": material repeats and material is skipped. There is no fix at this
 * layer — one ordering across five result sets is not something the repository
 * can produce — so the honest move is to say so and name the alternative the
 * schemas already carry.
 *
 * Silent on the first page (nothing is being continued) and for a single
 * licence, which pages normally because it is one upstream query.
 */
export function licensePagingNotice(license: string | undefined, skipCount: number): string {
  const keys = resolveLicenseSelection(license);
  if (!keys || keys.length <= 1 || skipCount <= 0) return '';
  return `ⓘ "${license}" fasst ${keys.length} Lizenzen zusammen, die einzeln durchsucht werden — diese Seite ist deshalb keine Fortsetzung der vorherigen, sondern die nächste Seite jeder einzelnen Lizenz. Zum verlässlichen Weiterblättern die bereits gesehenen IDs über excludeNodeIds mitgeben.`;
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
