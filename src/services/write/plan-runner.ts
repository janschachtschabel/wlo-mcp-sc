/**
 * services/write/plan-runner.ts – one approval for a whole plan, executed in
 * time-budgeted calls (BOERDi wishlist items 6 and 7, decision E4 = B,
 * 2026-11-06).
 *
 * The chatbot never confirms on its own: the person's approval releases exactly
 * one stored call. A tree of 40 collections does not fit that call's 60 s, so
 * the SERVER holds the approved plan and runs it in budgeted slices:
 *
 * - The plan is bound to the identity that confirmed it and to a 30-minute
 *   deadline from that confirmation, which never extends itself.
 * - Every item carries its own state. A key presented again by the SAME
 *   identity therefore continues what is open, or replays the result — it
 *   cannot create anything twice. That is a deliberate exception to the
 *   single-use rule of `confirm.ts`, accepted on 2026-11-06: without it a lost
 *   answer (client timeout) would cost the whole plan. The key does nothing the
 *   approved plan did not name.
 * - In memory, like the confirmation keys: one server instance. After a restart
 *   a plan is `plan_expired`, and the way back is the same call with `merge` and
 *   a new preview — which the PERSON confirms again.
 */

import { randomBytes, createHash } from 'node:crypto';

import { mapPool } from '../../concurrency.js';
import { currentIdentity } from './confirm.js';

/** From the confirmation; never extended. */
export const PLAN_TTL_MS = 30 * 60 * 1000;
/** Work per call — below the chatbot's 60 s client limit (their request: stay at ~40 s). */
export const PLAN_BUDGET_MS = 40_000;
/**
 * Items in flight per wave. Parallel only ACROSS parents: measured 2026-11-06,
 * siblings created at once under one parent fail with 500 while landing
 * (`collection-tree.ts` serialises them); 4 under different parents: 12 of 12.
 */
export const PLAN_POOL = 4;
/** Plans held at once — a bound on memory; complete plans go first (`sweep`). */
const MAX_PLANS = 200;
/**
 * UNFINISHED plans one identity may hold, so one signed-in caller cannot evict
 * everyone else's running plan and memory stays bounded per caller (a tree may
 * carry ~500 000 characters of descriptions). Room comes from the identity's
 * own COMPLETE plans only: evicting an unfinished one ended a running filing
 * with `plan_expired` halfway (chatbot feedback 2026-11-07). A sixth unfinished
 * plan is refused (`hasPlanCapacity`) before its confirmation key is spent.
 */
export const PLANS_PER_IDENTITY = 5;

let budgetOverride: number | null = null;
/** Test seam: shrink the budget to exercise continuation. `null` restores it. */
export function setPlanBudgetForTest(ms: number | null): void { budgetOverride = ms; }

export type ItemStatus = 'pending' | 'created' | 'existing' | 'added' | 'already' | 'unverified' | 'failed';

export interface ItemState { status: ItemStatus; nodeId?: string; code?: string }

export interface PlanItem {
  /** Unique within the plan (a tree path, a pair). */
  key: string;
  /** Key of the item that must be done first (a tree's parent). */
  after?: string;
}

/** Statuses after which an item's dependants may run. */
const READY: ReadonlySet<ItemStatus> = new Set(['created', 'existing', 'unverified']);

interface StoredPlan<I extends PlanItem> {
  planId: string;
  kind: string;
  identity: string;
  /** Hash of the arguments that built the plan: a key with other arguments is `plan_mismatch`. */
  args: string;
  items: I[];
  state: Map<string, ItemState>;
  expiresAt: number;
  running: Promise<void> | null;
  /** sha256 of the confirmation key that started it — buried with the plan. */
  confirmKey: string;
}

const plans = new Map<string, StoredPlan<PlanItem>>();
/** sha256(confirmToken) → planId: the redeemed approval key works as a continuation key too. */
const byConfirmKey = new Map<string, string>();

const hashKey = (k: string) => createHash('sha256').update(k).digest('hex');

/**
 * Keys of plans that are gone (expired or made room), kept for an hour as bare
 * hashes so they answer `plan_expired` — not `null`, which sends a confirmation
 * key on to `consumeToken` and comes back as `confirm_unknown`.
 */
const ended = new Map<string, number>();
const TOMBSTONE_MS = 60 * 60 * 1000;
const MAX_TOMBSTONES = 2000;

const isComplete = (p: StoredPlan<PlanItem>) => [...p.state.values()].every(st => st.status !== 'pending');

function remove(p: StoredPlan<PlanItem>, now: number): void {
  plans.delete(p.planId);
  for (const k of [hashKey(p.planId), p.confirmKey]) ended.set(k, now + TOMBSTONE_MS);
  while (ended.size > MAX_TOMBSTONES) {
    const oldest = ended.keys().next();
    if (oldest.done) break;
    ended.delete(oldest.value);
  }
}

function sweep(now: number, identity?: string): void {
  for (const p of [...plans.values()]) if (p.expiresAt <= now) remove(p, now);
  for (const [k, until] of ended) if (until <= now) ended.delete(k);
  if (identity !== undefined) {
    // Room from the identity's own COMPLETE plans, oldest first (insertion order
    // is age order). Unfinished plans are never evicted — see PLANS_PER_IDENTITY.
    const own = [...plans.values()].filter(p => p.identity === identity);
    let excess = own.length - PLANS_PER_IDENTITY + 1;
    for (const p of own) {
      if (excess <= 0) break;
      if (isComplete(p)) { remove(p, now); excess--; }
    }
  }
  for (const [k, id] of byConfirmKey) if (!plans.has(id)) byConfirmKey.delete(k);
  // The memory bound across identities: complete plans first, the oldest
  // unfinished only when nothing else is left — buried, so it still says why.
  while (plans.size >= MAX_PLANS) {
    const victim = [...plans.values()].find(isComplete) ?? plans.values().next().value;
    if (!victim) break;
    remove(victim, now);
  }
}

/**
 * Whether the caller may start one more plan. Asked BEFORE the confirmation key
 * is redeemed, so a refusal costs the person nothing: the key stays valid until
 * one of their plans is done.
 */
export function hasPlanCapacity(now = Date.now()): boolean {
  const identity = currentIdentity();
  sweep(now);
  return [...plans.values()].filter(p => p.identity === identity && !isComplete(p)).length < PLANS_PER_IDENTITY;
}

/** Store an approved plan. `initial` carries what the preview already knew (existing nodes). */
export function startPlan<I extends PlanItem>(
  kind: string, args: string, items: I[], initial: Map<string, ItemState>, confirmToken: string, now = Date.now(),
): string {
  const identity = currentIdentity();
  sweep(now, identity);
  const planId = randomBytes(18).toString('base64url');
  const state = new Map(items.map(i => [i.key, initial.get(i.key) ?? { status: 'pending' as const }]));
  plans.set(planId, {
    planId, kind, identity, args: hashKey(args), items, state, expiresAt: now + PLAN_TTL_MS, running: null,
    confirmKey: hashKey(confirmToken),
  } as StoredPlan<PlanItem>);
  byConfirmKey.set(hashKey(confirmToken), planId);
  return planId;
}

export type PlanLookup<I extends PlanItem> =
  | { ok: true; plan: StoredPlan<I> }
  | { ok: false; code: 'plan_expired' | 'plan_mismatch' };

/** Find a plan by its continuation key or by the confirmation key that started it. */
export function findPlan<I extends PlanItem>(kind: string, key: string, args: string, now = Date.now()): PlanLookup<I> | null {
  sweep(now);
  const planId = plans.has(key) ? key : byConfirmKey.get(hashKey(key));
  if (!planId) {
    const until = ended.get(hashKey(key));
    return until !== undefined && until > now ? { ok: false, code: 'plan_expired' } : null;
  }
  const plan = plans.get(planId) as StoredPlan<I> | undefined;
  if (!plan || plan.expiresAt <= now) return { ok: false, code: 'plan_expired' };
  if (plan.kind !== kind || plan.identity !== currentIdentity() || plan.args !== hashKey(args)) {
    return { ok: false, code: 'plan_mismatch' };
  }
  return { ok: true, plan };
}

export type Step<I extends PlanItem> = (item: I, before: ItemState | undefined) => Promise<ItemState>;

export interface PlanReport {
  planId: string;
  complete: boolean;
  progress: { done: number; total: number };
  /** Set when another call is still working on the plan. */
  inProgress?: true;
}

/**
 * Run what is ready until the budget is spent. A second call while one runs gets
 * the current state with `inProgress` — two runners on one plan would race.
 */
export async function runPlan<I extends PlanItem>(plan: StoredPlan<I>, step: Step<I>): Promise<PlanReport> {
  if (plan.running) return { ...report(plan), inProgress: true };
  const run = (async () => {
    const budget = budgetOverride ?? PLAN_BUDGET_MS;
    const start = Date.now();
    const tried = new Set<string>();
    for (;;) {
      // Dependants of a failed item fail with it; their own call would only fail later.
      for (const item of plan.items) {
        const s = plan.state.get(item.key)!;
        const before = item.after ? plan.state.get(item.after) : undefined;
        if (s.status === 'pending' && before?.status === 'failed') {
          plan.state.set(item.key, { status: 'failed', code: 'parent_failed' });
        }
      }
      const ready = plan.items.filter(i => {
        if (tried.has(i.key) || plan.state.get(i.key)!.status !== 'pending') return false;
        return !i.after || READY.has(plan.state.get(i.after)!.status);
      });
      if (!ready.length) break;
      // The budget is checked BEFORE a wave, so every call does at least one wave
      // — a budget of 0 still makes progress.
      if (tried.size > 0 && Date.now() - start >= budget) break;
      await mapPool(ready, PLAN_POOL, async item => {
        tried.add(item.key);
        const before = item.after ? plan.state.get(item.after) : undefined;
        plan.state.set(item.key, await step(item, before));
        return null;
      });
    }
  })();
  plan.running = run.finally(() => { plan.running = null; });
  await plan.running;
  return report(plan);
}

function report<I extends PlanItem>(plan: StoredPlan<I>): PlanReport {
  const total = plan.items.length;
  const done = [...plan.state.values()].filter(s => s.status !== 'pending').length;
  return { planId: plan.planId, complete: done === total, progress: { done, total } };
}

/** Read access for the tool's answer. */
export function planState<I extends PlanItem>(plan: StoredPlan<I>): ReadonlyMap<string, ItemState> {
  return plan.state;
}

export type { StoredPlan };
