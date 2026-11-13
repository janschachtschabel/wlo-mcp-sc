/**
 * services/write/collection-tree.ts – a whole collection tree as ONE plan
 * (BOERDi wishlist item 6, decision E4 = B, 2026-11-06).
 *
 * Three parts, each a rule:
 *
 * - `flattenTree` turns the nested input into plan steps, top-down, keyed by
 *   their title PATH ("Optik/Linsen") — the mapping the chatbot asked for. Two
 *   siblings whose titles differ only in case or spacing are refused: `merge`
 *   would map both onto one collection, and the person approved two.
 * - `findExisting` is the preview's walk for `merge`: it lists the children of
 *   every collection that already exists along the tree, and only those — a
 *   branch that will be created has nothing below it yet.
 * - `treeStep` is one step of the run. Before it creates, it checks the
 *   parent's children when the step could already exist: under a collection
 *   that was there before, or after an earlier attempt whose answer never came
 *   (an abort hits the response, not the work — measured 2026-08-02). That
 *   check is what makes a re-presented key harmless.
 */

import { getChildCollectionsResult } from '../../wlo-node.js';
import { nodeTitle } from '../../node-match.js';
import { mapPool } from '../../concurrency.js';
import { log } from '../../logger.js';
import { createCollection } from './collections.js';
import { isOutcomeOpen } from './timeouts.js';
import { failureCode } from '../failure-code.js';
import type { ItemState, PlanItem, Step, StoredPlan } from './plan-runner.js';

/** Chatbot frame (2026-11-06): trees of 30–120 nodes, at most 250. */
export const TREE_MAX_NODES = 250;

/** Children listed per page, and pages read, before a listing counts as too large to check. */
const LIST_PAGE = 500;
const LIST_PAGES_MAX = 4;
const TITLE_PROPS = ['cclom:title', 'cm:title', 'cm:name'];

export interface TreeInput { title: string; description?: string; children?: TreeInput[] }

export interface TreeItem extends PlanItem {
  title: string;
  description?: string;
}

export type OnExisting = 'merge' | 'fail';

/** Case, edge and inner spacing do not make a different collection. */
export function normTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function flattenTree(tree: TreeInput[]): { ok: true; items: TreeItem[] } | { ok: false; reasons: string[] } {
  const items: TreeItem[] = [];
  const reasons: string[] = [];
  const keys = new Set<string>();
  // Breadth-first, so the plan's order IS the order of creation: a parent
  // always precedes its children.
  let level: Array<{ node: TreeInput; parent?: string }> = tree.map(node => ({ node }));
  while (level.length) {
    const next: typeof level = [];
    const siblings = new Map<string, Set<string>>();
    for (const { node, parent } of level) {
      const title = node.title.trim();
      if (!title) {
        reasons.push(`Ein Knoten ${parent ? `unter „${parent}“ ` : ''}hat keinen Titel.`);
        continue;
      }
      const seen = siblings.get(parent ?? '') ?? new Set<string>();
      siblings.set(parent ?? '', seen);
      if (seen.has(normTitle(title))) {
        reasons.push(`„${title}“ steht zweimal unter ${parent ? `„${parent}“` : 'der Elternsammlung'} — bei gleichem Titel `
          + 'wären es dieselbe Sammlung.');
        continue;
      }
      seen.add(normTitle(title));
      const key = parent ? `${parent}/${title}` : title;
      if (keys.has(key)) {
        reasons.push(`Der Pfad „${key}“ kommt zweimal vor (ein Titel enthält „/“).`);
        continue;
      }
      keys.add(key);
      const description = node.description?.trim();
      items.push({ key, title, ...(parent ? { after: parent } : {}), ...(description ? { description } : {}) });
      for (const child of node.children ?? []) next.push({ node: child, parent: key });
    }
    level = next;
  }
  if (items.length > TREE_MAX_NODES) reasons.push(`Der Baum hat ${items.length} Knoten, höchstens ${TREE_MAX_NODES} sind möglich.`);
  return reasons.length ? { ok: false, reasons } : { ok: true, items };
}

/**
 * The sub-collections of `parentId` by normalised title → nodeId, or null when
 * that could not be found out (unreadable, or more than the pages read — a
 * duplicate beyond the last page read is what `merge` exists to prevent).
 */
export async function listChildCollections(parentId: string): Promise<Map<string, string> | null> {
  const byTitle = new Map<string, string>();
  for (let page = 0; page < LIST_PAGES_MAX; page++) {
    const res = await getChildCollectionsResult(parentId, LIST_PAGE, page * LIST_PAGE, TITLE_PROPS);
    if (!res.reachable) return null;
    for (const node of res.nodes) {
      const t = normTitle(nodeTitle(node));
      const id = node.ref?.id;
      if (t && id && !byTitle.has(t)) byTitle.set(t, id);
    }
    if (res.nodes.length < LIST_PAGE) return byTitle;
  }
  return null;
}

/**
 * Which plan steps already exist? Walks only below collections that exist.
 * `unreadable` names the collection whose listing failed — the preview refuses
 * then, because "anlegen" over a branch nobody could look into may be a duplicate.
 */
export async function findExisting(
  rootId: string,
  items: TreeItem[],
): Promise<{ ok: true; existing: Map<string, string> } | { ok: false; unreadable: string }> {
  const existing = new Map<string, string>();
  const parentIdOf = (item: TreeItem) => (item.after ? existing.get(item.after) : rootId);
  const pending = new Set(items.map(i => i.key));
  for (;;) {
    // The items whose parent's existence is now decided and exists.
    const ready = items.filter(i => pending.has(i.key) && (!i.after || !pending.has(i.after)));
    if (!ready.length) return { ok: true, existing };
    for (const i of ready) pending.delete(i.key);
    const parents = [...new Set(ready.map(parentIdOf).filter((id): id is string => Boolean(id)))];
    const listings = new Map<string, Map<string, string> | null>();
    await mapPool(parents, 4, async id => { listings.set(id, await listChildCollections(id)); return null; });
    for (const item of ready) {
      const parentId = parentIdOf(item);
      if (!parentId) continue; // below a collection that will be created
      const listing = listings.get(parentId);
      if (!listing) return { ok: false, unreadable: parentId };
      const found = listing.get(normTitle(item.title));
      if (found) existing.set(item.key, found);
    }
  }
}

/**
 * One step of a run. `listing` is per RUN: siblings share their parent's
 * listing, and a later run lists afresh, which is what finds a collection whose
 * creation timed out last time.
 *
 * Creates under the SAME parent run one at a time (`lane`). Measured on staging
 * 2026-11-06: siblings created at once fail with HTTP 500
 * "ConcurrencyFailureException: Acl…" in 17 of 24 cases — and every one of them
 * exists afterwards. Under DIFFERENT parents, 12 of 12 parallel creates
 * succeeded, so the pool still works across branches.
 */
export function treeStep(rootId: string, plan: StoredPlan<TreeItem>, onExisting: OnExisting): Step<TreeItem> {
  const listings = new Map<string, Promise<Map<string, string> | null>>();
  const listing = (id: string) => {
    let p = listings.get(id);
    if (!p) { p = listChildCollections(id); listings.set(id, p); }
    return p;
  };
  const lanes = new Map<string, Promise<unknown>>();
  const lane = <T>(parentId: string, fn: () => Promise<T>): Promise<T> => {
    const run = (lanes.get(parentId) ?? Promise.resolve()).then(fn, fn);
    lanes.set(parentId, run.catch(() => undefined));
    return run;
  };
  return async (item, before) => {
    const parentId = item.after ? before?.nodeId : rootId;
    if (!parentId) return { status: 'failed', code: 'parent_failed' };
    const own = plan.state.get(item.key);
    // A collection this plan just created has only what this plan put there;
    // nothing below it can exist unless a step of ours was attempted before.
    const mayExist = !item.after || before?.status !== 'created' || Boolean(own?.code);
    try {
      if (mayExist) {
        const children = await listing(parentId);
        if (!children) return { status: 'pending', code: 'not_checked' };
        const found = children.get(normTitle(item.title));
        if (found) {
          // Our own earlier, unanswered attempt is not a conflict.
          if (onExisting === 'fail' && !own?.code) return { status: 'failed', nodeId: found, code: 'exists' };
          return { status: 'existing', nodeId: found };
        }
      }
      const result = await lane(parentId, () => createCollection(parentId, {
        title: item.title, ...(item.description ? { description: item.description } : {}),
      }));
      if (result.status === 'failed') {
        log.warn('collection tree step failed', { path: item.key, detail: result.detail });
        // A refused create is not proof that nothing exists: the lock above
        // covers OUR creates, not someone else's under the same parent, and that
        // collision answers 500 while creating. So look before saying "failed".
        const listing = await listChildCollections(parentId);
        // A listing that did not answer is no proof either way — and "failed"
        // over a collection that exists is how a second one gets created. The
        // step stays open; the next call looks again (bounded by `MAX_OPEN_TRIES`).
        if (!listing) return { status: 'pending', code: 'not_checked' };
        const landed = listing.get(normTitle(item.title));
        if (landed) return { status: 'unverified', nodeId: landed, code: 'upstream_error' };
        return { status: 'failed', code: failureCode(result.detail) };
      }
      return result.check.status === 'ok'
        ? { status: 'created', nodeId: result.nodeId }
        : { status: 'unverified', nodeId: result.nodeId, code: result.check.status };
    } catch (err) {
      // Open, not failed: the next call looks before it creates again.
      if (isOutcomeOpen(err)) return { status: 'pending', code: 'timeout' } satisfies ItemState;
      log.warn('collection tree step failed', { path: item.key, error: err instanceof Error ? err.message : String(err) });
      return { status: 'failed', code: failureCode(err) };
    }
  };
}
