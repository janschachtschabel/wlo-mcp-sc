/**
 * collection-search.ts – "which collections match this word?", asked of BOTH
 * repository backends.
 *
 * The repository answers that question through two unrelated indexes, and
 * measured 2026-08-11 against staging, neither is a superset of the other (the
 * evidence is in `docs/plans/2026-08-11-collection-name-search-and-vocab-sync.md`
 * and, per endpoint, on the two functions in `wlo-search.ts`). The short form:
 *
 *  - `searchCollectionsByKeywordResult` (mds) reads the compendium text and **cannot
 *    return the collection `9e7ae956` ("Optik") for any search word at all**.
 *  - `searchCollectionsByNameResult` (REST) finds that record every time and matches
 *    resolved vocabulary labels, but reads no compendium text.
 *
 * This module is the one place that merges them, and it is one place on purpose:
 * three call sites reach a collection search (`services/search.ts`,
 * `services/topic-page.ts`, `tools/collections.ts`), and a rule re-derived per
 * call site is the shape that has already drifted twice in this codebase. The
 * direction is enforced by `tests/shared-rule-discipline.test.ts`, not by this
 * sentence.
 */

import { DISPLAY_PROPS } from '../wlo-config.js';
import { getNodesMetadata } from '../wlo-node.js';
import { searchCollectionsByKeywordResult, searchCollectionsByNameResult } from '../wlo-search.js';
import type { WloNode } from '../wlo-types.js';
import { log } from '../logger.js';

/** Bounded fan-out for the re-read below — the same pool size the node client uses. */
const TOPUP_CONCURRENCY = 8;

/**
 * How many results the name leg is asked for, independently of the caller's cap.
 *
 * It is the cost lever: that endpoint's latency scales with the number of
 * collections it returns. Measured 2026-08-11 against staging, "Mathematik"
 * costs 889 ms at 3, 1275 ms at 5 and 2565 ms at 10 — and at the caller's usual
 * cap of 10 it tripled the whole collections leg (984 ms → 3396 ms), because
 * 7–10 of its 10 hits were new and every one of them had to be re-read.
 *
 * The leg is a REPAIR, not a second full search. What justifies it is a record
 * the mds index cannot return at any rank, and such a record ranks high in a
 * name-oriented list; positions 6–10 of a second ranking are merely different
 * from the first ranking, not better. 5 rather than 3 because the collection
 * this exists to recover ("Optik") sits at position 3 of its own ranking, which
 * leaves 3 no margin at all.
 */
const NAME_LEG_MAX = 5;

const idOf = (n: WloNode): string => n.ref?.id ?? '';

/**
 * Both collection backends, in parallel, merged into one capped list.
 *
 * **Why the name leg's own nodes are thrown away.** That endpoint ignores
 * `propertyFilter` and answers with a fixed projection that omits
 * `ccm:page_config_ref` — the property `searchAll` derives its Themenseiten
 * split from — so adopting its nodes verbatim would file a topic page as an
 * ordinary collection. It is used as an ID source instead, and the ids it
 * contributes are re-read with the caller's projection. That read costs nothing
 * in the common case: it only fires for ids the mds leg did not already have,
 * which was 0 for most search words measured.
 *
 * Order is round-robin, not concatenation — the same rule and the same reason as
 * the licence bundle in `license-search.ts`: appending hands the whole result cap
 * to whichever list comes first. `searchAll` reranks the merged pool afterwards
 * and overrides this order; the other two call sites do not, which is why the
 * fair merge lives here.
 *
 * Each leg degrades on its own, so one backend being down costs its
 * contribution and not the whole answer — and is REPORTED (`unreachable`).
 *
 * @param maxItems upper bound on the RESULT, asked of each leg separately. It is
 *   also the cost lever for the name leg, whose latency scales with the number
 *   of collections it returns (~0.25 s each).
 */
/** Which of the two indexes did not answer. Neither is a superset of the other, so one missing leg can hide hits. */
export type CollectionSearchLeg = 'keyword' | 'name';

/**
 * The merged search, saying which leg did NOT answer (audit 2026-11-12, K-3).
 * One leg down still returns what the other found — but the caller can say
 * that the list may be incomplete, and both down is "not reachable", never
 * "no collections".
 */
export async function searchCollectionsResult(
  query: string,
  maxItems = 10,
  props: string[] | undefined = DISPLAY_PROPS,
): Promise<{ nodes: WloNode[]; unreachable: CollectionSearchLeg[] }> {
  const q = query.trim();
  if (!q) return { nodes: [], unreachable: [] };

  const nameCap = Math.min(maxItems, NAME_LEG_MAX);
  // A leg that THROWS (timeout, DNS, reset — before a response exists) is the
  // same non-answer as one that answered non-OK; neither takes the other down.
  const down = (leg: CollectionSearchLeg) => (err: unknown) => {
    log.warn('collection search leg failed, continuing without it', { leg, error: err instanceof Error ? err.message : String(err) });
    return { nodes: [] as WloNode[], reachable: false };
  };
  const [keyword, name] = await Promise.all([
    searchCollectionsByKeywordResult(q, maxItems, props).catch(down('keyword')),
    searchCollectionsByNameResult(q, nameCap).catch(down('name')),
  ]);
  const keywordHits = keyword.nodes;
  const nameHits = name.nodes;
  const unreachable: CollectionSearchLeg[] = [...(keyword.reachable ? [] : ['keyword' as const]), ...(name.reachable ? [] : ['name' as const])];

  const known = new Set(keywordHits.map(idOf).filter(Boolean));
  const newIds = nameHits.map(idOf).filter(id => id && !known.has(id)).slice(0, nameCap);
  // Nodes the re-read cannot deliver are dropped rather than substituted by the
  // endpoint's own: a half-projected node in the pool is exactly what this
  // re-read exists to prevent.
  const adopted = newIds.length ? await getNodesMetadata(newIds, TOPUP_CONCURRENCY, props) : [];
  // An id the name leg FOUND and the re-read lost. That may be a record that is
  // gone — or a read that did not answer, and then the leg's one contribution
  // (records the other index never returns) is missing from a list that looks
  // complete. The bulk read cannot tell the two apart, so it is said.
  if (adopted.length < newIds.length && !unreachable.includes('name')) unreachable.push('name');

  const merged: WloNode[] = [];
  const seen = new Set<string>();
  const longest = Math.max(keywordHits.length, adopted.length);
  for (let rank = 0; rank < longest && merged.length < maxItems; rank++) {
    for (const list of [keywordHits, adopted]) {
      const node = list[rank];
      if (!node || merged.length >= maxItems) continue;
      const id = idOf(node);
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      merged.push(node);
    }
  }
  return { nodes: merged, unreachable };
}

/**
 * The sentence for a list whose source did not answer — one wording for every
 * renderer. With hits: the list may lack some. Without: an empty list from a
 * search that did not (fully) answer is NOT a finding, whichever part was down.
 */
export function incompleteNotice(what: 'Sammlungen' | 'Themenseiten', empty: boolean): string {
  return empty
    ? `Die Suche nach ${what} hat nicht (vollständig) geantwortet — 0 Treffer sind hier KEIN Befund „keine ${what}“. Bitte später erneut versuchen.`
    : `Die Suche nach ${what} war nur teilweise erreichbar — die Liste kann unvollständig sein.`;
}
