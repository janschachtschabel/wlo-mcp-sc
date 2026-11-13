/**
 * tools/curation-plan.ts – the ONE course of a planned, multi-call write.
 *
 * `wlo_add_to_collections`, `wlo_create_collection_tree`, `wlo_update_contents`
 * and `wlo_attach_fulltexts` all run on `services/write/plan-runner.ts`, and
 * each carried this course as its own forty lines: find the plan the key
 * already started, else prepare; preview without a key; look again for a plan a
 * parallel call started; ask for capacity; redeem the key; start; run. The last
 * correction to it — the second look, without which two confirmations at once
 * wrote every record twice — had to be made four times (audit 2026-11-12, A-4).
 *
 * The ORDER is the safety property, so it lives here once:
 *
 *   1. a key that names a stored plan continues it — nothing is read again;
 *   2. otherwise the tool prepares (reads, validates, builds the change set);
 *   3. without a key that is the preview;
 *   4. with one: look for the plan AGAIN (another call may have started it
 *      while this one was reading), and only then
 *   5. capacity and the tool's own last refusal, BEFORE the key is redeemed —
 *      refused there, the key stays valid;
 *   6. redeem, start, run with what is left of the call's budget.
 *
 * What differs per tool is what it reads and how it words the answer.
 */

import type { ChangeSet } from '../services/write/change-set.js';
import {
  PLAN_BUDGET_MS, findPlan, hasPlanCapacity, runPlan, startPlan,
  type ItemState, type PlanItem, type PlanReport, type Step, type StoredPlan,
} from '../services/write/plan-runner.js';
import type { WloToolResult } from '../apps/register.js';
import { confirmOrExplain, isPreviewCall, timeoutOrError } from './curation-shared.js';
import { planErrorReply } from './curation-plan-reply.js';

/** What a tool hands over once its reads are done. */
export interface PlanDraft<I extends PlanItem> {
  /** Everything the key authorises — the token is bound to its fingerprint. */
  cs: ChangeSet;
  items: I[];
  /** Steps that need no work (a collection that exists already). */
  initial?: Map<string, ItemState>;
  /** The answer of a call without a key. */
  preview: () => WloToolResult;
}

export interface PlannedCall<I extends PlanItem> {
  kind: string;
  params: Record<string, unknown>;
  /** What the plan is bound to — a key presented with other arguments is not this plan. See `canonicalArgs`. */
  args: string;
  step: (plan: StoredPlan<I>) => Step<I>;
  answer: (plan: StoredPlan<I>, report: PlanReport) => WloToolResult;
  /**
   * Read, validate, build the change set — run only when the key names no
   * stored plan. `token` is `''` for a preview. A `reply` ends the call (a
   * refusal, or "nothing to do").
   */
  prepare: (token: string) => Promise<{ reply: WloToolResult } | { draft: PlanDraft<I> }>;
  /** The tool's own refusal just before the key is redeemed; refused here, the key stays valid. */
  beforeRedeem?: (draft: PlanDraft<I>) => WloToolResult | null;
  /** For an unexpected error: "Fehler beim …". */
  context: string;
  /** For an abort: the question it leaves open, e.g. "Ob schon Sammlungen angelegt wurden". */
  whatIsOpen: string;
}

export async function runPlannedCall<I extends PlanItem>(call: PlannedCall<I>): Promise<WloToolResult> {
  // What is LEFT of this call's budget after the reads (rule 3 of plan
  // 2026-11-08): a confirmation that read 200 records must not add a full 40 s.
  const started = Date.now();
  const remaining = (): number => Math.max(0, PLAN_BUDGET_MS - (Date.now() - started));
  const { kind, params, args } = call;
  const proceed = async (plan: StoredPlan<I>): Promise<WloToolResult> =>
    call.answer(plan, await runPlan(plan, call.step(plan), remaining()));

  const continuation = String(params['continuationToken'] ?? '');
  const token = String(params['confirmToken'] ?? '');
  const key = continuation || token;
  if (key) {
    const found = findPlan<I>(kind, key, args);
    if (found && !found.ok) return planErrorReply(found.code);
    if (found) return proceed(found.plan);
    if (continuation) return planErrorReply('plan_expired');
  }

  try {
    const prepared = await call.prepare(token);
    if ('reply' in prepared) return prepared.reply;
    const { draft } = prepared;
    if (!token) return draft.preview();

    // A second call with the same key may have started the plan while this one
    // was reading. Without this look it reaches the spent key, answers
    // `confirm_unknown` and asks for a new preview — whose confirmation would
    // run the plan a second time (overall review W1–W4, 2026-11-08). The plan is
    // there already, so neither capacity nor the tool's own bound is asked.
    const running = findPlan<I>(kind, token, args);
    if (running && !running.ok) return planErrorReply(running.code);
    if (running) return await proceed(running.plan);

    // Checked BEFORE the key is redeemed: refused here, it stays valid.
    if (!hasPlanCapacity()) return planErrorReply('too_many_plans');
    const ownRefusal = call.beforeRedeem?.(draft);
    if (ownRefusal) return ownRefusal;
    const refusal = confirmOrExplain(token, draft.cs);
    if (refusal) return refusal;

    const planId = startPlan(kind, args, draft.items, draft.initial ?? new Map(), token);
    const plan = findPlan<I>(kind, planId, args);
    if (!plan?.ok) return planErrorReply('plan_expired');
    return await proceed(plan.plan);
  } catch (err) {
    return timeoutOrError(call.context, err, call.whatIsOpen, { preview: isPreviewCall(params) });
  }
}

/**
 * The arguments a plan is bound to, as ONE spelling: object keys sorted at
 * every level. Two of the four tools compared the raw `JSON.stringify` of their
 * items. That was not the defect the audit took it for — measured 2026-11-13:
 * the input schema already hands the handler every DECLARED key in schema
 * order, whatever order the client wrote them in, so a reordered continuation
 * found its plan. But that made the identity of a plan a side effect of the
 * validation library; this makes it a property of the arguments.
 */
export function canonicalArgs(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v);
}
