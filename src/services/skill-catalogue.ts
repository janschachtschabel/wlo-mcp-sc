/**
 * services/skill-catalogue.ts – what makes a record a skill, and how a skills
 * collection is enumerated.
 *
 * Split out of `skills.ts` when that file passed 300 lines. The seam is real:
 * this module follows how the REPOSITORY behaves — which field marks a skill,
 * what a collection listing costs, where a walk has to stop — while `skills.ts`
 * follows the skill contract (what a search returns, how it ranks, what
 * `get_skill` hands over). The same split `collection-traversal.ts` was
 * extracted for: a bounded traversal is an algorithm, not a tool's schema.
 */

import type { WloNode } from '../wlo-api.js';
import { DISPLAY_PROPS, getChildCollections, getCollectionContents } from '../wlo-api.js';
import { nodeMatchesCriteria } from '../node-match.js';
import { mapPool } from '../concurrency.js';
import { log } from '../logger.js';

/**
 * The `contentTypes` vocabulary entry that marks a record as a skill.
 *
 * Was `ai_prompt` until 2026-08-12, when the vocabulary gained its own
 * `ai_skill` entry ("KI-Skill") and WLO moved skill records onto it. Staging's
 * `mds_oeh` still lists only the nine older values, so the editorial dropdown
 * shows the field blank — the INDEX takes the new value regardless (measured
 * 2026-08-12: the 28 Lehrtoolkit records re-indexed under `ai_skill` within
 * ~45 s of the write, and dropped out of the `ai_prompt` result set).
 *
 * Full URI: the short form is not indexed (measured 2026-08-08, `ai_prompt`
 * alone matches 0 while the URI form is the value the facet reports for every
 * other content type).
 */
export const SKILL_CONTENT_TYPE_URI = 'http://w3id.org/openeduhub/vocabs/contentTypes/ai_skill';

/**
 * The vocabulary entry that marks a REGISTRY document — the Markdown catalogue
 * whose `:::` blocks name the skills approved for a collection.
 *
 * This used to be the same constant as above, on the reasoning that a registry
 * is marked exactly as a skill is. That held only while `ai_prompt` was the one
 * entry available. Now the vocabulary distinguishes the two, and a registry is
 * precisely what `ai_prompt` still means: a prompt document ABOUT skills, not a
 * skill. Staging agrees — re-measured 2026-08-12 as the service user, the only
 * `ai_prompt` records left are the two registry documents (`skill_registry.md`,
 * `skill_katalog.md`), against 31 under `ai_skill`. Anonymously the same query
 * answers 1 and 28, so quote the identity with the number: a reader who
 * re-measures without one sees different figures and concludes something moved.
 */
export const REGISTRY_CONTENT_TYPE_URI = 'http://w3id.org/openeduhub/vocabs/contentTypes/ai_prompt';

/**
 * Projection for skill reads: what the formatter needs, the type field we filter
 * on, and `ccm:original` — without which a skill reached through a collection
 * looks like an original, and its companion files are never found.
 */
export const SKILL_PROPS = [...DISPLAY_PROPS, 'ccm:oeh_extendedType', 'ccm:original'];
/**
 * How many levels BELOW the configured root the walk follows.
 *
 * The documented structure is root → skillsets → skill records (`docs/SKILLS.md`),
 * so level 1 is the last one that has to be read; level 2 is slack for a nested
 * skillset. A tree deeper than that is not a skills collection, and following it
 * is how a lookup turns into a crawl: pointed at a subject portal, the walk read
 * 30 collections and 717 records where the structure would have cost two.
 */
const SKILL_DEPTH_MAX = 2;

/** Collections one scoped walk may read — a curated skills tree is small. */
export const SKILL_VISIT_MAX = 30;
/** Page size for both listings a collection produces: its files and its sub-collections. */
const SKILL_PAGE_MAX = 50;
/** Candidates gathered before ranking. */
const SKILL_CATALOGUE_MAX = 200;
/**
 * Collections read concurrently. The walk used to be sequential, and a live run
 * over a subject portal (30 collections, two calls each) took **90 s** — past
 * any client's patience for one tool call. Per level the reads are independent,
 * so they belong in a pool.
 */
const SKILL_POOL = 10;

/**
 * Breadth-first walk of a skills root: its own file children plus those of its
 * skillset sub-collections, filtered to actual skills.
 *
 * `collectRecursiveContents` is deliberately not reused — it stops once it has
 * gathered its row target, which with a filter applied afterwards would return
 * an arbitrary window that may hold no skills at all, and its fixed projection
 * carries no `ccm:oeh_extendedType` to filter on.
 */
export async function collectSkillNodes(rootId: string, includeSubcollections: boolean): Promise<WloNode[]> {
  const visited = new Set<string>([rootId]);
  const found: WloNode[] = [];
  let candidates = 0;
  let level = [rootId];
  let depth = 0;
  let skipped = 0;   // sub-collections the visit cap refused
  let failed = 0;    // collections whose read threw
  let read = 0;      // collections successfully read

  while (level.length && depth <= SKILL_DEPTH_MAX && found.length < SKILL_CATALOGUE_MAX) {
    // A collection's files and its sub-collections are two independent reads,
    // and the collections of one level are independent of each other. Restricted
    // to one collection, the sub-collection listing is not requested at all —
    // "the skills of THIS topic" is one call, and it should cost one.
    const results = await mapPool(level, SKILL_POOL, async (id) => Promise.all([
      getCollectionContents(id, 'files', SKILL_PAGE_MAX, 0, SKILL_PROPS),
      includeSubcollections
        ? getChildCollections(id, SKILL_PAGE_MAX, 0, ['sys:node-uuid'])
        : Promise.resolve([] as WloNode[]),
    ]));

    const next: string[] = [];
    for (const result of results) {
      if (!result) { failed += 1; continue; }   // mapPool nulls a failed collection
      read += 1;
      const [listing, subs] = result;
      candidates += listing.nodes.length;
      for (const n of listing.nodes) {
        if (nodeMatchesCriteria(n, [{ property: 'ccm:oeh_extendedType', values: [SKILL_CONTENT_TYPE_URI] }])) {
          found.push(n);
        }
      }
      for (const sub of subs) {
        const subId = sub.ref?.id ?? sub.properties?.['sys:node-uuid']?.[0];
        if (!subId || visited.has(subId)) continue;
        // Claimed at scheduling time, so the cap bounds what is READ rather than
        // what was queued — two parents sharing a child enqueue it once.
        if (visited.size >= SKILL_VISIT_MAX) { skipped += 1; continue; }
        visited.add(subId);
        next.push(subId);
      }
    }
    level = next;
    depth += 1;
  }

  // Nothing readable at all is a statement about the SERVER, and returning []
  // would turn it into a statement about the catalogue ("no skills here"). Same
  // reasoning as `getCollectionContents`, which throws rather than degrading.
  if (read === 0 && failed > 0) {
    throw new Error(`Die Sammlung ${rootId} ist derzeit nicht abrufbar.`);
  }

  // Any bound biting means the listing is incomplete, and silence would present
  // it as the whole catalogue. `skipped` matters on its own: the visit cap can
  // refuse every child of the LAST level read, which leaves no next level and
  // therefore no other trace.
  if (level.length || skipped > 0 || failed > 0) {
    log.warn('skills: the subtree could not be read completely — listing may be incomplete', {
      rootId, collectionsRead: read, notVisited: skipped + level.length, unreadable: failed,
      depthReached: depth, depthMax: SKILL_DEPTH_MAX, visitMax: SKILL_VISIT_MAX,
    });
  }

  // An empty answer over a non-empty subtree is almost always missing metadata
  // rather than an empty collection — say so, or the operator sees "no skills"
  // and has nothing to look at.
  if (!found.length && candidates > 0) {
    log.warn('skills: the collection subtree holds content, but none of it is marked as a skill', {
      rootId, candidates, expected: SKILL_CONTENT_TYPE_URI,
    });
  }
  return found;
}
