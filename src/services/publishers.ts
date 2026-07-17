/**
 * services/publishers.ts – lookup_wlo_publishers business logic.
 *
 * Returns the publishers/sources present in WLO (the `ccm:oeh_publisher_combined`
 * property) with per-publisher hit counts, via an ngsearch facet aggregation.
 * Optionally scoped by a free-text query and/or discipline/educationalContext
 * filters, so callers can ask "who publishes biology material?" and not only the
 * global list. Facet values for this property are plain publisher names (not
 * vocab URIs — verified against the live API), so the label is the value itself.
 */

import type { SearchCriterion } from '../wlo-api.js';
import { ngsearch } from '../wlo-api.js';
import { buildFilterCriteria } from '../tools/shared.js';

const PUBLISHER_FACET = 'ccm:oeh_publisher_combined';

export interface PublisherCount {
  label: string;
  count: number;
}

export interface LookupPublishersOptions {
  query?: string;
  discipline?: string;
  educationalContext?: string;
  maxResults?: number;
}

export async function lookupPublishers(
  opts: LookupPublishersOptions = {},
): Promise<PublisherCount[]> {
  const query = (opts.query ?? '').trim();
  const maxResults = opts.maxResults ?? 20;
  const { criteria: filters } = buildFilterCriteria({
    discipline: opts.discipline,
    educationalContext: opts.educationalContext,
  });

  const criteria: SearchCriterion[] = query
    ? [{ property: 'ngsearchword', values: [query] }, ...filters]
    : (filters.length ? filters : [{ property: 'ngsearchword', values: ['*'] }]);

  // maxItems=1: we only want the facet aggregation, not the hit list.
  const resp = await ngsearch(criteria, 'FILES', 1, 0, undefined, [PUBLISHER_FACET]);

  const group = (resp.facets ?? []).find(g => g.property === PUBLISHER_FACET);
  const counts: PublisherCount[] = (group?.values ?? [])
    .filter(v => v.value && v.value.trim())
    .map(v => ({ label: v.value, count: v.count }));

  // Deterministic ordering: most content first, label as the tie-breaker.
  counts.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return counts.slice(0, maxResults);
}
