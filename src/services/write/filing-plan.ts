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

import { wrongKind } from '../../node-kind.js';
import { getNodeMetadata } from '../../wlo-api.js';
import { mapPool } from '../../concurrency.js';
import { sanitizeText } from '../../text-sanitize.js';
import { nodeTitle } from '../../node-match.js';
import { resolveWriteTarget } from './nodes.js';
import { fileRecord, isAlreadyFiled, readFilingTarget, type FilingTarget } from './create-filing.js';
import { removalOf } from './remove-plan.js';
import { proposeForCollection } from './collection-proposals.js';
import { failureCode } from '../failure-code.js';
import { isOutcomeOpen } from './timeouts.js';
import type { ItemState, PlanItem, Step } from './plan-runner.js';

/** Chatbot frame (2026-11-06). */
export const FILING_MAX_PAIRS = 200;
const READ_POOL = 4;

export interface PairInput {
  nodeId: string;
  collectionId: string;
  /** MOVE: after the filing landed, take the material out of this collection (S6, 2026-11-14). */
  removeFrom?: string;
}

export interface FilingItem extends PlanItem {
  /** The id the caller named. */
  requestedId: string;
  /** The id that is filed: the original when `requestedId` is a reference (`resolveWriteTarget`). */
  filedId: string;
  collection: FilingTarget;
  materialTitle: string;
  /** The collection the material leaves once it is in `collection`. */
  source?: FilingTarget;
  /** The removal from `source` left for the repository (its answer may be missing). */
  removalSent?: boolean;
  /**
   * The caller may not write the target: the material is PROPOSED for it
   * (S8, 2026-11-14) — it is not in the collection until an editor decides.
   */
  propose?: true;
  /** OUR proposal left for the repository (its answer may be missing). */
  proposalSent?: boolean;
  /** `isPublic: false` on the material: filed, it is still invisible to others (S9). */
  notPublic?: true;
  /** A move's filing is CONFIRMED: later calls do not file again, and no state of this step is "not filed". */
  filed?: 'added' | 'already';
  /** How often the removal came back open — the step ends it itself, as filed. */
  removalTries?: number;
}

/** After this many open removals a move is ended as what it is: filed, not removed. Below the runner's own bound. */
const REMOVAL_TRIES = 2;

/** One unusable id of a batch, as a program reads it — the codes of the single tool. */
export interface PairRefusal {
  nodeId?: string;
  collectionId?: string;
  code: 'not_found' | 'not_a_collection' | 'is_a_collection' | 'is_a_folder' | 'refused';
}

/** Read both ends of every pair; refuse with one reason per unusable id. */
export async function resolvePairs(
  pairs: PairInput[],
): Promise<{ ok: true; items: FilingItem[] } | { ok: false; reasons: string[]; refused: PairRefusal[] }> {
  const nodeIds = [...new Set(pairs.map(p => p.nodeId.trim()))];
  // Targets and sources alike: both must be collections, and both are named in the preview.
  const collectionIds = [...new Set(pairs.flatMap(p => [p.collectionId.trim(), ...(p.removeFrom?.trim() ? [p.removeFrom.trim()] : [])]))];
  const [materials, collections] = await Promise.all([
    mapPool(nodeIds, READ_POOL, id => getNodeMetadata(id)),
    mapPool(collectionIds, READ_POOL, id => readFilingTarget(id)),
  ]);
  const reasons: string[] = [];
  const refused: PairRefusal[] = [];
  // "Public" is asked of what is FILED: for a reference that is its original
  // (the single tool reads it there too). One more read per reference named.
  const originals = new Map<string, boolean>();
  await mapPool(nodeIds.map((id, i) => ({ id, node: materials[i] })).filter(m => m.node && resolveWriteTarget(m.node, m.id).targetId !== m.id), READ_POOL, async (m) => {
    const original = await getNodeMetadata(resolveWriteTarget(m.node!, m.id).targetId);
    if (original) originals.set(m.id, original.isPublic === false);
    return null;
  });
  const material = new Map<string, { filedId: string; title: string; notPublic: boolean }>();
  nodeIds.forEach((id, i) => {
    const node = materials[i];
    if (!node) {
      reasons.push(`Das Material „${sanitizeText(id)}“ wurde nicht gefunden oder ist nicht lesbar.`);
      refused.push({ nodeId: id, code: 'not_found' });
      return;
    }
    // What is filed is a RECORD — the check `wlo_add_to_collection` applies. A
    // collection or folder id was sent on as a reference PUT (cross-package
    // review of the audit follow-up, phase 1).
    const wrong = wrongKind(node, 'content');
    if (wrong) {
      reasons.push(`„${sanitizeText(id)}“ ${wrong.reason}`);
      refused.push({ nodeId: id, code: wrong.code });
      return;
    }
    material.set(id, { filedId: resolveWriteTarget(node, id).targetId, title: sanitizeText(nodeTitle(node) || id), notPublic: originals.get(id) ?? node.isPublic === false });
  });
  const target = new Map<string, FilingTarget>();
  collectionIds.forEach((id, i) => {
    const t = collections[i];
    if (!t || !t.ok) {
      const notOne = t && t.reason === 'not_a_collection';
      reasons.push(notOne
        ? `„${sanitizeText(id)}“ ist keine Sammlung.`
        : `Die Sammlung „${sanitizeText(id)}“ wurde nicht gefunden oder ist nicht lesbar.`);
      refused.push({ collectionId: id, code: notOne ? 'not_a_collection' : 'not_found' });
      return;
    }
    target.set(id, { nodeId: t.target.nodeId, title: sanitizeText(t.target.title), ...(t.target.readOnly ? { readOnly: true as const } : {}) });
  });
  for (const p of pairs) {
    if (p.removeFrom?.trim() && p.removeFrom.trim() === p.collectionId.trim()) {
      reasons.push(`Bei „${sanitizeText(p.nodeId.trim())}“ sind Ziel und Quelle dieselbe Sammlung (${sanitizeText(p.collectionId.trim())}).`);
    }
    // A proposal is not a filing: the material would leave the source and be in no collection.
    if (p.removeFrom?.trim() && target.get(p.collectionId.trim())?.readOnly) {
      reasons.push(`„${sanitizeText(p.nodeId.trim())}“: an der Ziel-Sammlung ${sanitizeText(p.collectionId.trim())} darf diese Anmeldung nicht schreiben — `
        + 'dorthin ginge nur ein Vorschlag, und ein Vorschlag ist keine Aufnahme. Umsortieren (removeFrom) braucht Schreibrecht am Ziel.');
    }
  }
  if (reasons.length) return { ok: false, reasons, refused };

  const items: FilingItem[] = [];
  const seen = new Map<string, string>();
  for (const p of pairs) {
    const m = material.get(p.nodeId.trim())!;
    const collection = target.get(p.collectionId.trim())!;
    const source = p.removeFrom?.trim() ? target.get(p.removeFrom.trim())! : undefined;
    const key = `${m.filedId}>${collection.nodeId}`;
    const before = seen.get(key);
    if (before !== undefined) {
      // One filing, two different words about the source: which was meant is not ours to guess.
      if (before !== (source?.nodeId ?? '')) {
        return { ok: false, reasons: [`„${sanitizeText(p.nodeId.trim())}“ → ${collection.nodeId} ist zweimal genannt, mit verschiedener Quelle (removeFrom).`], refused: [] };
      }
      continue;
    }
    seen.set(key, source?.nodeId ?? '');
    items.push({
      key, requestedId: p.nodeId.trim(), filedId: m.filedId, collection, materialTitle: m.title, ...(source ? { source } : {}),
      ...(collection.readOnly ? { propose: true as const } : {}), ...(m.notPublic ? { notPublic: true as const } : {}),
    });
  }
  return { ok: true, items };
}

/** The preview line of one step — part of what the token authorises. */
export function filingLine(item: FilingItem): string {
  const via = item.requestedId !== item.filedId
    ? ` (Verknüpfung ${item.requestedId} — aufgenommen wird das Original ${item.filedId})`
    : ` (${item.filedId})`;
  return `„${item.materialTitle}“${via} → ${item.propose ? 'als VORSCHLAG an ' : ''}„${item.collection.title}“ (${item.collection.nodeId})`
    + (item.propose ? ' — dort darf diese Anmeldung nicht schreiben; aufgenommen ist es erst, wenn die Redaktion annimmt' : '')
    + (item.source ? `; danach heraus aus „${item.source.title}“ (${item.source.nodeId})` : '')
    + (item.notPublic ? ' — noch nicht öffentlich' : '');
}

/** Propose instead of filing. The proposer's only read-back is the repository refusing the same proposal as a duplicate. */
async function propose(item: FilingItem): Promise<ItemState> {
  try {
    const before = Boolean(item.proposalSent);
    item.proposalSent = true;
    const outcome = await proposeForCollection(item.collection.nodeId, item.filedId);
    switch (outcome.status) {
      case 'proposed': return { status: 'proposed' };
      // A duplicate after OUR request left is our proposal; else it was there before (open, or decided).
      // (If our first request did NOT land and a proposal existed before, this says `proposed` over
      // somebody else's — the repository gives a proposer no way to tell the two apart.)
      case 'already_proposed': return before ? { status: 'proposed' } : { status: 'already', code: 'already_proposed' };
      case 'unverified': return { status: 'unverified', outcomeOpen: true };
      default: {
        const s = outcome.httpStatus;
        if (s >= 400 && s < 500 && s !== 429) return { status: 'failed', code: failureCode(outcome.detail), outcomeOpen: false };
        return { status: 'pending', code: failureCode(outcome.detail) };
      }
    }
  } catch (err) {
    if (isOutcomeOpen(err)) return { status: 'pending', code: 'timeout' };
    return { status: 'failed', code: failureCode(err), outcomeOpen: true };
  }
}

async function file(item: FilingItem): Promise<ItemState> {
  if (item.propose) return propose(item);
  if (await isAlreadyFiled(item.filedId, item.collection.nodeId) === true) return { status: 'already' };
  const outcome = await fileRecord(item.filedId, item.collection);
  // An abort hits the answer, not the work: the step stays OPEN, and the next
  // call's `isAlreadyFiled` above finds out whether it landed — instead of a
  // pair left "unverified" for good, or sent a second time.
  if (outcome.code === 'timeout') return { status: 'pending', code: 'timeout' };
  return { status: outcome.status, ...(outcome.code ? { code: outcome.code } : {}) };
}

/**
 * A MOVE is two writes, and their order is the safety property: FIRST the
 * material is in the target (filed and read back), THEN it leaves the source.
 * A removal that fails leaves it in both — said (`not_removed`), never lost.
 * A filing that is not confirmed removes nothing.
 */
export const filingStep: Step<FilingItem> = async (item) => {
  if (!item.source) return file(item);
  // Filed once, filed for good: a later call must not file again. Right after a
  // removal the usage lookup answers 500 for seconds (measured), so "is it
  // there?" comes back unknown — and a second PUT answers 409.
  if (!item.filed) {
    const filed = await file(item);
    if (filed.status !== 'added' && filed.status !== 'already') {
      return filed.status === 'pending' ? filed : { ...filed, code: filed.code ?? 'not_removed' };
    }
    item.filed = filed.status;
  }
  const filed = item.filed;
  const removed = await removalOf(item.filedId, item.source.nodeId, Boolean(item.removalSent), () => { item.removalSent = true; });
  switch (removed.status) {
    case 'removed': return { status: 'moved' };
    // It was not in the source: filed all the same, and nothing to take out.
    case 'absent': return { status: filed, code: 'not_in_source' };
    case 'pending': {
      // The source could not be read, or the removal's answer is missing. Tried
      // again by the next call — but ended HERE, as filed: left to the runner it
      // would end as "failed", over a material that is in the target.
      item.removalTries = (item.removalTries ?? 0) + 1;
      if (item.removalTries <= REMOVAL_TRIES) return removed;
      return { status: filed, code: 'not_removed', ...(item.removalSent ? { outcomeOpen: true } : {}) };
    }
    // In BOTH collections now — the filing stands.
    default: return { status: filed, code: removed.code === 'is_original' ? 'source_is_original' : 'not_removed', ...(removed.outcomeOpen ? { outcomeOpen: true } : {}) };
  }
};
