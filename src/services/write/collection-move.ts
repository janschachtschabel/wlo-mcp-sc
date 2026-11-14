/**
 * services/write/collection-move.ts – hang a collection under another parent
 * (chatbot team, S5, 2026-11-14).
 *
 * Measured on staging with throwaway collections (`npm run measure:moves`),
 * and each line is a rule here:
 *
 * - `POST /node/v1/nodes/-home-/{target}/children/_move?source={collection}`
 *   keeps the id, takes every sub-collection and every reference along, and
 *   keeps permissions set locally on the collection; what it INHERITS comes
 *   from the new parent from then on.
 * - The repository does not mind a namesake: a second collection of the same
 *   title under the target answers 200, and two stand side by side. `merge`
 *   in the tree tool maps a title onto ONE collection — so this is refused
 *   here, before any key.
 * - A target inside the moved sub-tree answers 500
 *   (`CyclicChildRelationshipException`) and changes nothing. Refused before
 *   any key too: a 500 is not something to make a person approve.
 * - The `-root-` placeholder does not work at this endpoint (404): a
 *   collection cannot be moved to the top level here.
 */

import { BASE_URL } from '../../wlo-config.js';
import { wloFetch, HEADERS } from '../../wlo-fetch.js';
import { getChildCollectionsResult, readNodeMetadata, readNodeParents } from '../../wlo-node.js';
import type { WloNode } from '../../wlo-types.js';
import { isCollectionNode } from '../../node-kind.js';
import { collectionTitleFromProperties } from '../../node-match.js';
import { sanitizeText } from '../../text-sanitize.js';
import { isRefusal } from '../../upstream-error.js';
import { log } from '../../logger.js';
import { listCollectionTree } from '../collection-tree-flat.js';
import { normTitle } from './collection-tree.js';
import { mayWrite } from './collection-proposals.js';
import { failureDetail } from './nodes.js';
import type { MutationOutcome } from './verify.js';

const TITLE_PROPS = ['cm:title', 'cclom:title', 'cm:name'];

export interface Place { nodeId: string; title: string; /** Titles from the top down to this collection, itself included. */ path: string[] }

/** The collection's own title as the repository holds it — for COMPARING. Display goes through `sanitizeText`, which caps. */
const rawTitle = (node: WloNode) => collectionTitleFromProperties(node.properties) || node.title || '';

export type MovePlan =
  | {
      ok: true;
      collection: Place;
      from: Place;
      to: Place;
      /** Sub-collections that go along; `subMore` when the count stopped at its bound. */
      subCount: number;
      subMore: boolean;
    }
  | { ok: false; code: 'not_found' | 'not_a_collection' | 'not_checked' | 'invalid_input' | 'no_change' | 'exists' | 'forbidden'; message: string; existingId?: string };

const titleOf = (node: WloNode, id: string) => sanitizeText(collectionTitleFromProperties(node.properties) || node.title || id);

/** A collection with the chain above it. `/parents` answers self-first. */
interface Placed { ok: true; place: Place; /** Self-first ids of the chain above. */ chain: string[]; raw: string; mayWrite: boolean | null; /** The nearest COLLECTION above, if any. */ parent?: Place }
async function place(id: string, what: string): Promise<Placed | { ok: false; plan: Extract<MovePlan, { ok: false }> }> {
  const meta = await readNodeMetadata(id, TITLE_PROPS);
  if (!meta.node) {
    return { ok: false, plan: isRefusal(meta.status)
      ? { ok: false, code: 'not_found', message: `${what} „${sanitizeText(id)}“ wurde nicht gefunden oder ist nicht lesbar.` }
      : { ok: false, code: 'not_checked', message: `${what} „${sanitizeText(id)}“ ließ sich gerade nicht lesen. Es wurde nichts geändert; bitte später erneut versuchen.` } };
  }
  if (!isCollectionNode(meta.node)) return { ok: false, plan: { ok: false, code: 'not_a_collection', message: `„${sanitizeText(id)}“ ist keine Sammlung.` } };
  const parents = await readNodeParents(id, TITLE_PROPS);
  if (!parents.ok) {
    // Refused is an answer, not "later" (the rule of every listing here).
    return { ok: false, plan: isRefusal(parents.status)
      ? { ok: false, code: 'not_found', message: `Der Pfad von „${sanitizeText(id)}“ ist mit dieser Anmeldung nicht lesbar. Es wurde nichts geändert.` }
      : { ok: false, code: 'not_checked', message: `Der Pfad von „${sanitizeText(id)}“ ließ sich gerade nicht lesen — ohne ihn `
        + 'lässt sich nicht prüfen, ob das Ziel im eigenen Teilbaum liegt. Es wurde nichts geändert.' } };
  }
  // Self-first; only collections count as path (above a top-level collection the chain may go on into folders).
  const chain = parents.nodes.filter(n => n.ref?.id);
  const ids = chain.map(n => n.ref!.id!);
  const collections = chain.filter(isCollectionNode);
  const path = [...collections].reverse().map(n => titleOf(n, n.ref!.id!));
  const above = chain[1] && isCollectionNode(chain[1]) ? chain[1] : undefined;
  return {
    ok: true, chain: ids, raw: rawTitle(meta.node), mayWrite: mayWrite(meta.node),
    place: { nodeId: id, title: titleOf(meta.node, id), path: path.length ? path : [titleOf(meta.node, id)] },
    ...(above ? { parent: { nodeId: above.ref!.id!, title: titleOf(above, above.ref!.id!), path: path.slice(0, -1) } } : {}),
  };
}

/** The sub-collections of `parentId` by normalised COLLECTION title → id; null when that could not be found out. */
async function siblingTitles(parentId: string): Promise<Map<string, string> | null> {
  const byTitle = new Map<string, string>();
  for (let skip = 0; skip < 2000; skip += 500) {
    const res = await getChildCollectionsResult(parentId, 500, skip, TITLE_PROPS);
    if (!res.reachable) return null;
    for (const node of res.nodes) {
      // The SAME chain as for the moved collection: `cm:title` first. A leftover
      // `cclom:title` beside it would otherwise hide a namesake.
      const t = normTitle(rawTitle(node));
      if (t && node.ref?.id && !byTitle.has(t)) byTitle.set(t, node.ref.id);
    }
    if (res.nodes.length < 500) return byTitle;
  }
  return null;
}

/** Read everything the preview has to say, and refuse what the repository would do badly. */
export async function planMove(nodeId: string, newParentId: string): Promise<MovePlan> {
  if (nodeId === newParentId) return { ok: false, code: 'invalid_input', message: 'Eine Sammlung kann nicht unter sich selbst gehängt werden.' };
  const [moved, target] = await Promise.all([place(nodeId, 'Die Sammlung'), place(newParentId, 'Die Ziel-Sammlung')]);
  if (!moved.ok) return moved.plan;
  if (!target.ok) return target.plan;
  // The target's chain holds the moved collection: the target lies in its sub-tree.
  if (target.chain.includes(nodeId)) {
    return { ok: false, code: 'invalid_input', message: `Das Ziel „${target.place.title}“ liegt im Teilbaum von „${moved.place.title}“ — `
      + 'eine Sammlung kann nicht in ihren eigenen Teilbaum gehängt werden.' };
  }
  if (moved.chain[1] === newParentId) return { ok: false, code: 'no_change', message: `„${moved.place.title}“ liegt bereits unter „${target.place.title}“ — es wurde nichts geändert.` };
  // Known from the records themselves: refused here, the person approves nothing that ends in a 403.
  for (const [p, what] of [[moved, 'der Sammlung'], [target, 'der Ziel-Sammlung']] as const) {
    if (p.mayWrite === false) {
      return { ok: false, code: 'forbidden', message: `An ${what} „${p.place.title}“ darf diese Anmeldung nicht schreiben — umhängen lässt sie sich so nicht. Es wurde nichts geändert.` };
    }
  }

  // A namesake under the target: the repository would put both side by side.
  const siblings = await siblingTitles(newParentId);
  if (!siblings) {
    return { ok: false, code: 'not_checked', message: `Die Untersammlungen von „${target.place.title}“ ließen sich nicht lesen — ohne diesen Blick `
      + 'kann dort schon eine gleichnamige Sammlung stehen. Es wurde nichts geändert.' };
  }
  const namesake = siblings.get(normTitle(moved.raw));
  if (namesake) {
    return { ok: false, code: 'exists', existingId: namesake, message: `Unter „${target.place.title}“ gibt es schon eine Sammlung mit dem Titel `
      + `„${moved.place.title}“ (${namesake}). Das Repository würde beide nebeneinander stellen — es wurde nichts geändert.` };
  }

  // What goes along. A count that could not be had is no reason to refuse: the sentence says so.
  let subCount = 0;
  let subMore: boolean;
  try {
    const below = await listCollectionTree({ rootId: nodeId, depth: 4, maxItems: 250, skipCount: 0, includeContentCounts: false });
    subCount = below.count;
    // The count stops at four levels: a node on the fourth may hold more.
    subMore = Boolean(below.more || below.walkCapped || below.incomplete || below.restricted || below.items.some(i => i.depth >= 4));
  } catch { subMore = true; }

  // No collection above: it lies on the top level (whatever folder the repository keeps it in).
  const here: Place = moved.parent ?? { nodeId: '', title: '', path: [] };
  return { ok: true, collection: moved.place, from: here, to: target.place, subCount, subMore };
}

/** Send the move and read the collection's new parent back. */
export async function moveCollection(nodeId: string, newParentId: string): Promise<MutationOutcome> {
  const res = await wloFetch(
    `${BASE_URL}/node/v1/nodes/-home-/${encodeURIComponent(newParentId)}/children/_move?source=${encodeURIComponent(nodeId)}`,
    { method: 'POST', headers: HEADERS },
  );
  if (!res.ok) return { status: 'failed', detail: await failureDetail(res), httpStatus: res.status };
  log.info('collection moved', { nodeId, newParentId });

  const parents = await readNodeParents(nodeId, TITLE_PROPS);
  if (!parents.ok) return { status: 'unverified', detail: 'Der neue Pfad der Sammlung ließ sich danach nicht lesen.' };
  return parents.nodes[1]?.ref?.id === newParentId
    ? { status: 'ok' }
    : { status: 'not_visible', detail: 'Die Sammlung steht danach nicht unter der neuen Elternsammlung.' };
}
