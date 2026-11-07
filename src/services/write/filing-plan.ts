/**
 * services/write/filing-plan.ts – many materials into many collections as ONE
 * plan (BOERDi wishlist item 7, decision E4 = B, 2026-11-06).
 *
 * The step is the one `wlo_add_to_collection` takes (`fileRecord`, with its
 * read-back). What the plan adds:
 *
 * - Every pair is resolved BEFORE the preview: the material must be readable,
 *   the target must be a collection (`readFilingTarget`), and a reference id is
 *   replaced by its ORIGINAL — the filing PUT takes the original, and the
 *   preview says so, because the token binds to what is sent.
 * - Pairs that resolve to the same original and collection are ONE step; a
 *   reference and its original named side by side would otherwise file twice.
 * - A pair already in place is `already` and sends nothing. Checked in the
 *   step, not the preview: it costs a usage lookup per pair, and the step is
 *   where it decides whether a request goes out.
 */

import { getNodeMetadata } from '../../wlo-api.js';
import { mapPool } from '../../concurrency.js';
import { sanitizeText } from '../../text-sanitize.js';
import { nodeTitle } from '../../node-match.js';
import { resolveWriteTarget } from './nodes.js';
import { fileRecord, isAlreadyFiled, readFilingTarget, type FilingTarget } from './create-filing.js';
import type { PlanItem, Step } from './plan-runner.js';

/** Chatbot frame (2026-11-06). */
export const FILING_MAX_PAIRS = 200;
const READ_POOL = 4;

export interface PairInput { nodeId: string; collectionId: string }

export interface FilingItem extends PlanItem {
  /** The id the caller named. */
  requestedId: string;
  /** The id that is filed: the original when `requestedId` is a reference (`resolveWriteTarget`). */
  filedId: string;
  collection: FilingTarget;
  materialTitle: string;
}

/** Read both ends of every pair; refuse with one reason per unusable id. */
export async function resolvePairs(
  pairs: PairInput[],
): Promise<{ ok: true; items: FilingItem[] } | { ok: false; reasons: string[] }> {
  const nodeIds = [...new Set(pairs.map(p => p.nodeId.trim()))];
  const collectionIds = [...new Set(pairs.map(p => p.collectionId.trim()))];
  const [materials, collections] = await Promise.all([
    mapPool(nodeIds, READ_POOL, id => getNodeMetadata(id)),
    mapPool(collectionIds, READ_POOL, id => readFilingTarget(id)),
  ]);
  const reasons: string[] = [];
  const material = new Map<string, { filedId: string; title: string }>();
  nodeIds.forEach((id, i) => {
    const node = materials[i];
    if (!node) { reasons.push(`Das Material „${sanitizeText(id)}“ wurde nicht gefunden oder ist nicht lesbar.`); return; }
    material.set(id, { filedId: resolveWriteTarget(node, id).targetId, title: sanitizeText(nodeTitle(node) || id) });
  });
  const target = new Map<string, FilingTarget>();
  collectionIds.forEach((id, i) => {
    const t = collections[i];
    if (!t || !t.ok) {
      reasons.push(t && t.reason === 'not_a_collection'
        ? `„${sanitizeText(id)}“ ist keine Sammlung.`
        : `Die Sammlung „${sanitizeText(id)}“ wurde nicht gefunden oder ist nicht lesbar.`);
      return;
    }
    target.set(id, { nodeId: t.target.nodeId, title: sanitizeText(t.target.title) });
  });
  if (reasons.length) return { ok: false, reasons };

  const items: FilingItem[] = [];
  const seen = new Set<string>();
  for (const p of pairs) {
    const m = material.get(p.nodeId.trim())!;
    const collection = target.get(p.collectionId.trim())!;
    const key = `${m.filedId}>${collection.nodeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ key, requestedId: p.nodeId.trim(), filedId: m.filedId, collection, materialTitle: m.title });
  }
  return { ok: true, items };
}

/** The preview line of one step — part of what the token authorises. */
export function filingLine(item: FilingItem): string {
  const via = item.requestedId !== item.filedId
    ? ` (Verknüpfung ${item.requestedId} — aufgenommen wird das Original ${item.filedId})`
    : ` (${item.filedId})`;
  return `„${item.materialTitle}“${via} → „${item.collection.title}“ (${item.collection.nodeId})`;
}

export const filingStep: Step<FilingItem> = async (item) => {
  if (await isAlreadyFiled(item.filedId, item.collection.nodeId) === true) return { status: 'already' };
  const outcome = await fileRecord(item.filedId, item.collection);
  // An abort hits the answer, not the work: the step stays OPEN, and the next
  // call's `isAlreadyFiled` above finds out whether it landed — instead of a
  // pair left "unverified" for good, or sent a second time.
  if (outcome.code === 'timeout') return { status: 'pending', code: 'timeout' };
  return { status: outcome.status, ...(outcome.code ? { code: outcome.code } : {}) };
};
