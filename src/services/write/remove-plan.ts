/**
 * services/write/remove-plan.ts – many materials out of collections as ONE
 * plan (chatbot team, S6, 2026-11-14), and the removal half of a MOVE
 * (`filing-plan.ts`, `removeFrom`).
 *
 * Removing takes the REFERENCE out; the material itself stays, and stays in
 * every other collection. What the plan adds to `wlo_remove_from_collection`:
 *
 * - Both ends of every pair are read BEFORE the preview, as in the filing plan.
 * - A pair that is not in its collection is `absent` and sends nothing —
 *   decided for the preview from ONE listing per collection. The step looks
 *   again for every pair it is about to remove (the plan writes up to thirty
 *   minutes after its approval); a pair the preview found absent has no step.
 * - A RECORD filed directly in a collection is not removed (`is_original`):
 *   taking it out deletes the material itself (measured 2026-11-14).
 * - The repository removes by the REFERENCE's id; a DELETE with the original's
 *   id answers 200 and removes nothing (measured 2026-08-03, again 2026-11-14).
 *   `removalOf` is the one place a plan step turns "this material, this
 *   collection" into that request and into a state.
 */

import { getNodeMetadata } from '../../wlo-api.js';
import { mapPool } from '../../concurrency.js';
import { sanitizeText } from '../../text-sanitize.js';
import { nodeTitle } from '../../node-match.js';
import { log } from '../../logger.js';
import { failureCode } from '../failure-code.js';
import { readFilingTarget, type FilingTarget } from './create-filing.js';
import { findReference, listMembers, removeReference } from './collections.js';
import { isOutcomeOpen } from './timeouts.js';
import type { PairInput, PairRefusal } from './filing-plan.js';
import type { ItemState, PlanItem, Step } from './plan-runner.js';

export const REMOVE_MAX_PAIRS = 200;
const READ_POOL = 4;
/** References read per collection for the preview; a larger collection is decided by the step. */
const LIST_MAX = 500;

export interface RemoveItem extends PlanItem {
  /** The id the caller named — a reference's or an original's; the lookup takes either. */
  requestedId: string;
  collection: FilingTarget;
  materialTitle: string;
  /** A removal of THIS plan left for the repository (its answer may be missing). */
  sent?: boolean;
}

/** Either id of an entry → the entry's own id, or null when the listing is too long or unread. */
async function memberIds(collectionId: string): Promise<Map<string, string> | null> {
  const members = await listMembers(collectionId, { max: LIST_MAX });
  // Unread or too long: decided by the step.
  return typeof members === 'string' ? null : new Map(members.flatMap(m => [[m.materialId, m.referenceId], [m.referenceId, m.referenceId]]));
}

export type ResolvedRemovals =
  | { ok: true; items: RemoveItem[]; absent: Set<string>; unknown: Set<string> }
  | { ok: false; reasons: string[]; refused: PairRefusal[] };

/** Read both ends of every pair; refuse with one reason per unusable id. */
export async function resolveRemovals(pairs: PairInput[]): Promise<ResolvedRemovals> {
  const nodeIds = [...new Set(pairs.map(p => p.nodeId.trim()))];
  const collectionIds = [...new Set(pairs.map(p => p.collectionId.trim()))];
  const [materials, collections, members] = await Promise.all([
    mapPool(nodeIds, READ_POOL, id => getNodeMetadata(id)),
    mapPool(collectionIds, READ_POOL, id => readFilingTarget(id)),
    mapPool(collectionIds, READ_POOL, id => memberIds(id)),
  ]);
  const reasons: string[] = [];
  const refused: PairRefusal[] = [];
  const title = new Map<string, string>();
  nodeIds.forEach((id, i) => {
    const node = materials[i];
    if (!node) {
      reasons.push(`Das Material „${sanitizeText(id)}“ wurde nicht gefunden oder ist nicht lesbar.`);
      refused.push({ nodeId: id, code: 'not_found' });
      return;
    }
    title.set(id, sanitizeText(nodeTitle(node) || id));
  });
  const target = new Map<string, FilingTarget>();
  const inside = new Map<string, Map<string, string> | null>();
  collectionIds.forEach((id, i) => {
    const t = collections[i];
    if (!t || !t.ok) {
      const notOne = t && t.reason === 'not_a_collection';
      reasons.push(notOne ? `„${sanitizeText(id)}“ ist keine Sammlung.` : `Die Sammlung „${sanitizeText(id)}“ wurde nicht gefunden oder ist nicht lesbar.`);
      refused.push({ collectionId: id, code: notOne ? 'not_a_collection' : 'not_found' });
      return;
    }
    target.set(id, { nodeId: t.target.nodeId, title: sanitizeText(t.target.title) });
    inside.set(id, members[i] ?? null);
  });
  if (reasons.length) return { ok: false, reasons, refused };

  const items: RemoveItem[] = [];
  const absent = new Set<string>();
  const unknown = new Set<string>();
  const seen = new Set<string>();
  for (const p of pairs) {
    const nodeId = p.nodeId.trim();
    const collection = target.get(p.collectionId.trim())!;
    const members = inside.get(collection.nodeId);
    // ONE step per entry: a reference and its original named side by side would race for one DELETE.
    const key = `${members?.get(nodeId) ?? nodeId}>${collection.nodeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ key, requestedId: nodeId, collection, materialTitle: title.get(nodeId)! });
    if (!members) unknown.add(key);
    else if (!members.has(nodeId)) absent.add(key);
  }
  return { ok: true, items, absent, unknown };
}

/** The preview line of one step — part of what the token authorises. */
export function removalLine(item: RemoveItem, absent: boolean): string {
  return `„${item.materialTitle}“ (${item.requestedId}) aus „${item.collection.title}“ (${item.collection.nodeId})`
    + (absent ? ' — ist dort nicht enthalten, kein Schritt' : '');
}

/**
 * Take `nodeId` out of `collectionId` and say what is now true. `sent` tells
 * whether a removal of this plan already left: a reference that is gone then
 * is OUR removal, not "was never there". Never throws.
 */
export async function removalOf(
  nodeId: string, collectionId: string, sent: boolean, markSent: () => void,
): Promise<ItemState> {
  let left = sent;
  try {
    const found = await findReference(collectionId, nodeId);
    if (found.status === 'absent') return { status: sent ? 'removed' : 'absent' };
    // Not found out: removing blind is impossible here anyway (it needs the reference's id).
    if (found.status === 'unknown') return { status: 'pending', code: 'not_checked', outcomeOpen: sent };
    // The record itself, filed directly: its DELETE would delete the material (measured).
    if (found.direct) return { status: 'failed', code: 'is_original', outcomeOpen: false };
    markSent();
    left = true;
    const outcome = await removeReference(collectionId, found.referenceId);
    if (outcome.status === 'ok') return { status: 'removed' };
    if (outcome.status === 'failed') {
      const status = outcome.httpStatus ?? 0;
      // A refusal wrote nothing. Anything else is looked at again by the next call.
      if (status >= 400 && status < 500 && status !== 429) return { status: 'failed', code: failureCode(outcome.detail), outcomeOpen: false };
      return { status: 'pending', code: failureCode(outcome.detail) };
    }
    // Answered, and the reference is still there or could not be read.
    return { status: 'unverified', code: outcome.status, outcomeOpen: true };
  } catch (err) {
    if (isOutcomeOpen(err)) return { status: 'pending', code: 'timeout' };
    log.warn('removal step failed', { nodeId, collectionId, error: err instanceof Error ? err.message : String(err) });
    return { status: 'failed', code: failureCode(err), outcomeOpen: left };
  }
}

export const removeStep: Step<RemoveItem> = item =>
  removalOf(item.requestedId, item.collection.nodeId, Boolean(item.sent), () => { item.sent = true; });
