/**
 * services/write/fulltext-plan.ts – many full texts under ONE approval (plan
 * 2026-11-08, W2), on the plan runner, with exactly the single-record rules of
 * W1 (`fulltext.ts`: the safeguard for records with a file, the refusal of
 * linked records, the raw body, the read-back). One place for those rules; this
 * module only plans many and bounds what the server holds.
 *
 * Bounds (user decision F2): at most 200 items and 3 000 000 UTF-8 bytes per
 * call — inside the 4 MiB body of `tools/call` — and every held text across all
 * plans together at most `FULLTEXT_HOLD_MAX` (64 MiB), refused as
 * `upstream_busy` BEFORE the key is spent. A text is dropped from memory the
 * moment its record is done — also when its step throws.
 */

import { mapPool } from '../../concurrency.js';
import { writeFailureCode } from '../failure-code.js';
import { planFulltext, writeFulltext, type FulltextInput, type FulltextPlan, type RefusalCode } from './fulltext.js';
import { livePlans, type ItemState, type PlanItem, type Step } from './plan-runner.js';

export const FULLTEXTS_MAX_ITEMS = 200;
export const FULLTEXTS_MAX_BYTES = 3_000_000;
export const FULLTEXT_HOLD_MAX = 64 * 1024 * 1024;
/**
 * `retryAfter` for a full memory. Held texts are freed only as other plans run
 * on (each call of a plan does ~40 s of work) or expire after 30 minutes, so the
 * ordinary 10 s of an upstream answer would only send the caller back too soon.
 */
export const FULLTEXT_BUSY_RETRY_S = 60;
export const FULLTEXTS_KIND = 'attach-fulltexts';
const PREVIEW_POOL = 8;

let holdMaxOverride: number | null = null;
/** Test seam: shrink the memory bound. `null` restores it. */
export function setFulltextHoldMaxForTest(bytes: number | null): void { holdMaxOverride = bytes; }

export interface FulltextItem extends PlanItem {
  plan: FulltextPlan;
  /** The text to send; emptied once the record is done, so a finished text is not held. */
  markdown: string;
}

export interface PreparedFulltexts {
  items: FulltextItem[];
  counts: { new: number; replaced: number; unchanged: number; refused: number };
  unchangedItems: Array<{ nodeId: string }>;
  refused: Array<{ nodeId: string; code: RefusalCode | 'duplicate'; reason: string }>;
}

export function totalBytes(inputs: FulltextInput[]): number {
  return inputs.reduce((n, i) => n + Buffer.byteLength(i.markdown, 'utf8'), 0);
}

/**
 * Plan every record with W1's rules. A record named twice — also through a
 * reference, and also when the first mention changes nothing — is refused the
 * second time: two answers about one record (unchanged AND replaced) cannot
 * both be true.
 */
export async function prepareFulltexts(inputs: FulltextInput[]): Promise<PreparedFulltexts> {
  const planned = await mapPool(inputs, PREVIEW_POOL, i => planFulltext(i));
  const out: PreparedFulltexts = { items: [], counts: { new: 0, replaced: 0, unchanged: 0, refused: 0 }, unchangedItems: [], refused: [] };
  const seen = new Set<string>();
  planned.forEach((p, idx) => {
    const input = inputs[idx]!;
    if (!p) {
      // The check itself failed (network) — nothing about the text is known.
      out.refused.push({ nodeId: input.nodeId, code: 'unreadable', reason: 'Der Datensatz ließ sich gerade nicht prüfen.' });
      return;
    }
    const target = p.ok ? p.plan.targetId : p.targetId;
    if (target !== undefined) {
      if (seen.has(target)) {
        out.refused.push({ nodeId: input.nodeId, code: 'duplicate', reason: `derselbe Datensatz wie ein früherer Eintrag (${target})` });
        return;
      }
      seen.add(target);
    }
    if (p.ok) out.items.push({ key: p.plan.targetId, plan: p.plan, markdown: input.markdown });
    else if (p.code === 'nothing_to_change') out.unchangedItems.push({ nodeId: input.nodeId });
    else out.refused.push({ nodeId: input.nodeId, code: p.code, reason: p.reason });
  });
  out.counts = {
    new: out.items.filter(i => !i.plan.replaces).length,
    replaced: out.items.filter(i => i.plan.replaces).length,
    unchanged: out.unchangedItems.length,
    refused: out.refused.length,
  };
  return out;
}

/** Bytes of text the server holds for unfinished records, across every live plan. */
export function heldFulltextBytes(): number {
  return livePlans<FulltextItem>(FULLTEXTS_KIND)
    .reduce((n, p) => n + p.items.reduce((m, i) => m + (i.markdown ? i.plan.bytes : 0), 0), 0);
}

/** Whether `bytes` more may be held now. */
export function hasFulltextRoom(bytes: number): boolean {
  return heldFulltextBytes() + bytes <= (holdMaxOverride ?? FULLTEXT_HOLD_MAX);
}

/**
 * One record: W1's write and read-back, then the text is let go. A throw is an
 * OPEN outcome — the POST may have gone out — and is never left `pending`: the
 * runner would send the same POST again on the next call.
 */
export const fulltextStep: Step<FulltextItem> = async (item): Promise<ItemState> => {
  try {
    const out = await writeFulltext(item.plan, item.markdown);
    if (out.status === 'stored') return { status: 'stored' };
    return { status: out.status, code: out.code, outcomeOpen: out.outcomeOpen };
  } catch (err) {
    return { status: 'failed', code: writeFailureCode(err), outcomeOpen: true };
  } finally {
    item.markdown = '';
  }
};
