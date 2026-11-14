/**
 * services/write/delete-empty-plan.ts – delete many collections, but only
 * EMPTY ones (chatbot team, S7, 2026-11-14).
 *
 * `wlo_delete_collection` takes a collection with everything below it. For
 * "the tree was wrong, take it back" that is too coarse once a tree was merged
 * into an existing one. This plan deletes a collection only when it holds
 * nothing: no sub-collection, no reference, no original.
 *
 * - "Empty" is READ, from the two listings — never taken from
 *   `childCollectionsCount` / `childReferencesCount`, which lag by seconds and
 *   count the sub-tree at the root (chatbot team, B2).
 * - A collection whose only contents are sub-collections that are ALSO named
 *   and empty is deletable: a wrong tree is taken back in one call. The plan
 *   puts children before their parents, and the deletes run one at a time, so a
 *   parent is looked at after its children are gone.
 * - The look is repeated right before each delete: the plan writes up to
 *   thirty minutes after its approval, and a collection that gained a member
 *   meanwhile stays (`not_empty`).
 * - Everything else comes back as `not_empty` — an answer, not a failure.
 */

import { wrongKind, type KindMismatch } from '../../node-kind.js';
import { getChildCollectionsResult, getCollectionContents, readNodeMetadata } from '../../wlo-api.js';
import { mapPool } from '../../concurrency.js';
import { sanitizeText } from '../../text-sanitize.js';
import { collectionTitleFromProperties } from '../../node-match.js';
import { isRefusal } from '../../upstream-error.js';
import { failureCode } from '../failure-code.js';
import { log } from '../../logger.js';
import { deleteCollection } from './collections.js';
import { isOutcomeOpen } from './timeouts.js';
import type { ItemState, PlanItem, Step } from './plan-runner.js';

export const DELETE_EMPTY_MAX = 200;
const READ_POOL = 4;
const TITLE_PROPS = ['cm:title', 'cclom:title', 'cm:name'];
/** Sub-collections read per collection. One that holds more is not a candidate for "empty once its children are gone". */
const CHILD_SCAN = 100;

export interface DeleteItem extends PlanItem {
  nodeId: string;
  title: string;
  /** A delete of THIS plan left for the repository (its answer may be missing). */
  sent?: boolean;
}

export interface DeleteRefusal { nodeId: string; code: 'not_found' | KindMismatch['code'] }

/** What one collection holds right now. `null` = could not be found out. */
export interface Holding { files: number; folders: string[]; moreFolders: boolean }

export async function readHolding(id: string): Promise<Holding | null> {
  try {
    const [files, folders] = await Promise.all([
      getCollectionContents(id, 'files', 1, 0, TITLE_PROPS),
      getChildCollectionsResult(id, CHILD_SCAN + 1, 0, TITLE_PROPS),
    ]);
    // Refused or unanswered alike: nothing was learned, and "empty" must be known.
    if (!folders.reachable) return null;
    const ids = folders.nodes.map(n => n.ref?.id ?? '').filter(Boolean);
    return { files: Math.max(files.pagination.total, files.nodes.length), folders: ids.slice(0, CHILD_SCAN), moreFolders: ids.length > CHILD_SCAN };
  } catch {
    return null;
  }
}

export type Resolved =
  | { ok: true; items: DeleteItem[]; notEmpty: Map<string, string>; unknown: Set<string>; /** Deletable only once named children are gone. */ viaChildren: Set<string> }
  | { ok: false; reasons: string[]; refused: DeleteRefusal[] };

/**
 * Read every collection and what it holds. `items` come back children-first;
 * `notEmpty` maps the keys that will NOT be deleted to the reason shown in the
 * preview; `unknown` holds those whose contents could not be read (decided by
 * the step's own look).
 */
export async function resolveDeletions(ids: string[]): Promise<Resolved> {
  const unique = [...new Set(ids.map(id => id.trim()))];
  const read = await mapPool(unique, READ_POOL, async id => ({ meta: await readNodeMetadata(id, TITLE_PROPS), holding: await readHolding(id) }));
  const reasons: string[] = [];
  const refused: DeleteRefusal[] = [];
  const title = new Map<string, string>();
  const holding = new Map<string, Holding | null>();
  unique.forEach((id, i) => {
    const node = read[i]?.meta.node;
    if (!node) {
      reasons.push(`Die Sammlung „${sanitizeText(id)}“ wurde nicht gefunden oder ist nicht lesbar.`);
      refused.push({ nodeId: id, code: 'not_found' });
      return;
    }
    const wrong = wrongKind(node, 'collection');
    if (wrong) {
      reasons.push(`„${sanitizeText(id)}“ ${wrong.reason}`);
      refused.push({ nodeId: id, code: wrong.code });
      return;
    }
    title.set(id, sanitizeText(collectionTitleFromProperties(node.properties) || node.title || id));
    holding.set(id, read[i]?.holding ?? null);
  });
  if (reasons.length) return { ok: false, reasons, refused };

  const named = new Set(unique);
  const notEmpty = new Map<string, string>();
  const unknown = new Set<string>();
  const deletable = new Map<string, boolean>();
  const viaChildren = new Set<string>();
  // Children first: a collection is decided after every sub-collection it names.
  const order: string[] = [];
  const visit = (id: string, trail: Set<string>): boolean => {
    const known = deletable.get(id);
    if (known !== undefined) return known;
    const h = holding.get(id);
    let ok = true;
    if (!h) {
      unknown.add(id);
    } else if (h.files > 0) {
      ok = false;
      notEmpty.set(id, `enthält ${h.files} ${h.files === 1 ? 'Inhalt' : 'Inhalte'}`);
    } else if (h.moreFolders) {
      ok = false;
      notEmpty.set(id, `enthält mehr als ${CHILD_SCAN} Untersammlungen`);
    } else {
      const outside = h.folders.filter(f => !named.has(f));
      if (outside.length) {
        ok = false;
        notEmpty.set(id, `enthält ${outside.length} ${outside.length === 1 ? 'Untersammlung, die' : 'Untersammlungen, die'} nicht genannt ${outside.length === 1 ? 'ist' : 'sind'}`);
      } else {
        // A cycle cannot be emptied from inside; the trail ends the walk.
        const staying = h.folders.filter(f => trail.has(f) || !visit(f, new Set([...trail, id])));
        if (!staying.length && h.folders.length) viaChildren.add(id);
        if (staying.length) {
          ok = false;
          notEmpty.set(id, `enthält ${staying.length} ${staying.length === 1 ? 'Untersammlung, die' : 'Untersammlungen, die'} selbst nicht leer ${staying.length === 1 ? 'ist' : 'sind'}`);
        }
      }
    }
    deletable.set(id, ok);
    order.push(id);
    return ok;
  };
  for (const id of unique) visit(id, new Set());
  return { ok: true, items: order.map(id => ({ key: id, nodeId: id, title: title.get(id)! })), notEmpty, unknown, viaChildren };
}

/** The preview line of one collection — part of what the token authorises. */
export function deleteLine(item: DeleteItem, notEmpty: string | undefined, unknown: boolean, viaChildren = false): string {
  const what = notEmpty ? `bleibt — ${notEmpty}`
    : unknown ? 'wird gelöscht, WENN sie beim Löschen leer ist (ihr Inhalt ließ sich gerade nicht lesen)'
      // Not empty YET: it holds named sub-collections, and goes only when they are gone.
      : viaChildren ? 'wird gelöscht, sobald ihre mitgenannten Untersammlungen gelöscht sind (sonst hält sie nichts)'
        : 'leer, wird gelöscht';
  return `„${item.title}“ (${item.nodeId}): ${what}`;
}

/**
 * One at a time, in plan order (`lane`): a parent's look must come after its
 * children's deletes, and a wave of the runner starts four steps together.
 */
export function deleteEmptyStep(plan?: { state: ReadonlyMap<string, ItemState> }): Step<DeleteItem> {
  let lane: Promise<unknown> = Promise.resolve();
  const inLane = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = lane.then(fn, fn);
    lane = run.catch(() => undefined);
    return run;
  };
  return item => inLane(async (): Promise<ItemState> => {
    try {
      const now = await readNodeMetadata(item.nodeId, TITLE_PROPS);
      if (!now.node) {
        // Gone: ours, if a delete of this plan left; else somebody else's.
        if (now.status === 404) return item.sent ? { status: 'deleted' } : { status: 'failed', code: 'not_found', outcomeOpen: false };
        if (isRefusal(now.status)) return { status: 'failed', code: 'forbidden', outcomeOpen: Boolean(item.sent) };
        return { status: 'pending', code: 'not_checked' };
      }
      // Right before the write: empty is what the listings say NOW.
      const h = await readHolding(item.nodeId);
      if (!h) return { status: 'pending', code: 'not_checked', outcomeOpen: Boolean(item.sent) };
      // A named child whose own delete is still open: decided when the child is —
      // "not empty" now would keep this collection for good.
      if (h.files === 0 && h.folders.some(f => plan?.state.get(f)?.status === 'pending')) {
        return { status: 'pending', code: 'child_pending', outcomeOpen: false };
      }
      if (h.files > 0 || h.folders.length > 0) return { status: 'not_empty' };

      item.sent = true;
      const outcome = await deleteCollection(item.nodeId);
      if (outcome.status === 'ok') return { status: 'deleted' };
      if (outcome.status === 'failed') {
        log.warn('batch delete step failed', { nodeId: item.nodeId, detail: outcome.detail });
        const status = outcome.httpStatus ?? 0;
        // A refusal deleted nothing. Anything else is looked at again: gone then is OUR delete.
        if (status >= 400 && status < 500 && status !== 429) return { status: 'failed', code: failureCode(outcome.detail), outcomeOpen: false };
        return { status: 'pending', code: failureCode(outcome.detail) };
      }
      return { status: 'unverified', outcomeOpen: true };
    } catch (err) {
      if (isOutcomeOpen(err)) return { status: 'pending', code: 'timeout' };
      log.warn('batch delete step failed', { nodeId: item.nodeId, error: err instanceof Error ? err.message : String(err) });
      return { status: 'failed', code: failureCode(err), ...(item.sent ? { outcomeOpen: true } : {}) };
    }
  });
}
