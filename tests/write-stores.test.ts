/**
 * write-stores.test.ts – the bounded in-memory stores of the write pipeline
 * (audit 2026-11-14, W10 / W13 / W14 / W15).
 *
 * - A LOOKUP never makes room: `findPlan`, `livePlans` and `hasPlanCapacity`
 *   evicted the oldest unfinished plan whenever the store was full — a caller
 *   merely asking after its plan ended somebody else's.
 * - An expired key answers `expired` every time, also when it was still in the
 *   pending store when first presented.
 * - A step that THROWS counts as a try, so it ends instead of staying open.
 * - A budget per identity is a budget per ACCOUNT where the credential names
 *   the confirmed one — several spellings of one login are one person.
 * - Each store says how much it holds (for metrics), without changing it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { buildChangeSet } from '../src/services/write/change-set.js';
import {
  findPlan, hasPlanCapacity, livePlans, planStoreSize, runPlan, startPlan,
  MAX_OPEN_TRIES, MAX_PLANS as MAX_PLANS_TOTAL, PLANS_PER_IDENTITY, type PlanItem,
} from '../src/services/write/plan-runner.js';
import { poolShare } from '../src/services/write/store-budget.js';
import {
  budgetIdentity, confirmStoreSize, consumeToken, currentIdentity, mintToken, MAX_PENDING_PER_IDENTITY, TOKEN_TTL_MS,
} from '../src/services/write/confirm.js';
import { markRedeemed, replayStoreSize, withReplayContext } from '../src/services/write/confirm-replay.js';
import { UploadSlots, sharedUploadSlots, slotIdentity, uploadStoreBytes } from '../src/services/write/upload-slot.js';

const who = (label: string, extra: Partial<WloCredential> = {}): WloCredential =>
  ({ header: `Basic ${label}`, label, source: 'user', ...extra });
const items: PlanItem[] = [{ key: 'a' }];
const cs = (to: string) => buildChangeSet('node-1', 'content', { 'cclom:title': ['Alt'] }, { 'cclom:title': [to] });

// ── W10: a lookup never evicts ──────────────────────────────────────────────

test('a full plan store: looking a plan up evicts nobody — room is made only when a plan STARTS', () => {
  try {
    // Fill the store with unfinished plans of many identities (five each) — the
    // half of it these unproven logins share (`store-budget.ts`); what "full"
    // means for them, since room is made within one pool.
    const MAX_PLANS = poolShare(MAX_PLANS_TOTAL, 'unproven');
    let first = '';
    for (let i = 0; planStoreSize() < MAX_PLANS; i++) {
      setServiceCredentialForTest(who(`fill-${Math.floor(i / PLANS_PER_IDENTITY)}`));
      const id = startPlan('w10', 'args', items, new Map(), `fill-token-${i}`);
      first ||= id;
    }
    const full = planStoreSize();
    setServiceCredentialForTest(who('fill-0'));
    assert.equal(findPlan('w10', 'no-such-key', 'args'), null);
    livePlans('w10');
    hasPlanCapacity();
    assert.equal(planStoreSize(), full, 'three lookups, nobody evicted');
    assert.equal(findPlan('w10', first, 'args')?.ok, true, 'the oldest unfinished plan is still there');
    // Starting one more is what makes room.
    setServiceCredentialForTest(who('newcomer-w10'));
    startPlan('w10', 'args', items, new Map(), 'newcomer-token');
    assert.equal(planStoreSize(), full, 'one out, one in');
  } finally { setServiceCredentialForTest(null); }
});

// ── W13: a key that expired while still pending ─────────────────────────────

test('an expired key that was never pruned answers expired — and expired again, not unknown', () => {
  try {
    setServiceCredentialForTest(who('expiry-w13'));
    const t0 = 50_000_000;
    const change = cs('Abgelaufen');
    const token = mintToken(change, t0);
    // No mint in between: the entry is still in the pending store when it is presented.
    assert.equal(consumeToken(token, change, t0 + TOKEN_TTL_MS + 1), 'expired');
    assert.equal(consumeToken(token, change, t0 + TOKEN_TTL_MS + 2), 'expired', 'the second answer is the first one');
  } finally { setServiceCredentialForTest(null); }
});

// ── W13: a step that throws ─────────────────────────────────────────────────

test('a step that THROWS counts as a try: after MAX_OPEN_TRIES it ends as failed and open, not pending for ever', async () => {
  try {
    setServiceCredentialForTest(who('thrower-w13'));
    const id = startPlan('w13', 'args', items, new Map(), 'thrower-token');
    const found = findPlan<PlanItem>('w13', id, 'args');
    assert.ok(found?.ok);
    const plan = found.plan;
    let calls = 0;
    const step = async () => { calls++; throw new Error('kaputt'); };
    for (let run = 1; run < MAX_OPEN_TRIES; run++) {
      const report = await runPlan(plan, step);
      assert.equal(report.complete, false, `run ${run}: still open`);
    }
    const last = await runPlan(plan, step);
    assert.equal(last.complete, true);
    assert.equal(calls, MAX_OPEN_TRIES);
    const state = plan.state.get('a')!;
    assert.deepEqual([state.status, state.outcomeOpen], ['failed', true]);
  } finally { setServiceCredentialForTest(null); }
});

// ── W14: a budget per account ───────────────────────────────────────────────

test('the budget identity is the CONFIRMED account where the credential names one; the binding identity is unchanged', () => {
  try {
    setServiceCredentialForTest(who('Maria.Muster', { acct: 'maria' }));
    const typedOne = currentIdentity();
    assert.equal(budgetIdentity(), 'acct:maria');
    setServiceCredentialForTest(who('maria@example.org', { acct: 'maria' }));
    assert.equal(budgetIdentity(), 'acct:maria', 'another spelling of the same login: the same budget');
    assert.notEqual(currentIdentity(), typedOne, 'a key stays bound to the credential it was approved under');
    setServiceCredentialForTest(who('otto'));
    // No confirmed account: its own budget, in the `user:` namespace — and no
    // longer the bare typed name, which anybody can type (`write-store-pools.test.ts`).
    assert.match(budgetIdentity(), /^user:otto:[0-9a-f]{64}$/);
    assert.equal(currentIdentity(), 'user:otto', 'the binding identity is the name, as before');
  } finally { setServiceCredentialForTest(null); }
});

test('two spellings of one login share ONE budget of pending previews', () => {
  try {
    const t0 = 70_000_000;
    setServiceCredentialForTest(who('Budget.A', { acct: 'budget-w14' }));
    const oldest = mintToken(cs('erste'), t0);
    for (let i = 1; i < MAX_PENDING_PER_IDENTITY; i++) mintToken(cs(`a-${i}`), t0);
    setServiceCredentialForTest(who('budget.a@example.org', { acct: 'budget-w14' }));
    mintToken(cs('eine mehr'), t0);
    // The account's oldest preview made room — the second spelling got no fresh fifty.
    setServiceCredentialForTest(who('Budget.A', { acct: 'budget-w14' }));
    assert.equal(consumeToken(oldest, cs('erste'), t0 + 1), 'unknown');
  } finally { setServiceCredentialForTest(null); }
});

// A `Basic` header is never proven before a preview, and its name is whatever
// the caller typed. Keyed `user:<acct>`, a confirmed account's budget was the
// very string `Basic <acct>:anything` produces (review 2026-11-14, finding 1).
test('a typed Basic name never lands in the budget of the CONFIRMED account of that name', () => {
  try {
    const t0 = 80_000_000;
    const victim = who('Maria.Muster', { header: 'Bearer wlo2.x', jti: 'J-collide', acct: 'collide-maria' });
    const typed = who('collide-maria', { header: 'Basic Y29sbGlkZS1tYXJpYTp3cm9uZw==' });
    setServiceCredentialForTest(victim);
    const change = cs('Opfer');
    const token = mintToken(change, t0);
    setServiceCredentialForTest(typed);
    assert.notEqual(budgetIdentity(), 'acct:collide-maria');
    for (let i = 0; i < MAX_PENDING_PER_IDENTITY; i++) mintToken(cs(`angriff-${i}`), t0);
    setServiceCredentialForTest(victim);
    assert.equal(consumeToken(token, change, t0 + 1), 'ok', 'fifty previews under the typed name evicted nothing of hers');
    // Not even a name typed WITH the prefix reaches it: the unproven form keeps its own.
    setServiceCredentialForTest(who('acct:collide-maria'));
    assert.notEqual(budgetIdentity(), 'acct:collide-maria');
    assert.notEqual(slotIdentity(typed), slotIdentity(victim), 'nor her upload slots');
  } finally { setServiceCredentialForTest(null); }
});

test('the plan CAP goes by the confirmed account — and a typed name does not spend it', () => {
  try {
    const one = who('Plan.A', { jti: 'J-plan-1', acct: 'plan-w9' });
    const two = who('plan.a@example.org', { jti: 'J-plan-2', acct: 'plan-w9' });
    setServiceCredentialForTest(one);
    const ids: string[] = [];
    for (let i = 0; i < PLANS_PER_IDENTITY; i++) ids.push(startPlan('w9', 'args', items, new Map(), `plan-w9-token-${i}`));
    assert.equal(hasPlanCapacity(), false);
    setServiceCredentialForTest(two);
    assert.equal(hasPlanCapacity(), false, 'a second block of the same account gets no fresh five');
    // The BINDING is untouched: the other block may not continue the first one's plan.
    assert.equal(findPlan('w9', ids[0]!, 'args')?.ok, false);
    setServiceCredentialForTest(one);
    assert.equal(findPlan('w9', ids[0]!, 'args')?.ok, true);
    // An unproven Basic header typing the account name has a cap of its own.
    setServiceCredentialForTest(who('plan-w9'));
    assert.equal(hasPlanCapacity(), true);
    for (let i = 0; i < PLANS_PER_IDENTITY; i++) startPlan('w9', 'args', items, new Map(), `plan-w9-typed-${i}`);
    setServiceCredentialForTest(one);
    assert.equal(findPlan('w9', ids[0]!, 'args')?.ok, true, 'and its plans evict none of hers');
  } finally { setServiceCredentialForTest(null); }
});

test('an upload slot belongs to the account, not to the spelling', () => {
  assert.notEqual(slotIdentity(who('maria', { acct: 'maria' })), slotIdentity(who('maria')), 'confirmed and typed are apart');
  assert.equal(slotIdentity(who('Maria.Muster', { acct: 'maria' })), slotIdentity(who('maria@example.org', { acct: 'maria' })));
  assert.notEqual(slotIdentity(who('maria')), slotIdentity(who('otto')));
  assert.equal(slotIdentity({ label: 'svc', source: 'service' }), null);
});

// ── W15: size getters ───────────────────────────────────────────────────────

test('each store says how much it holds, and asking changes nothing', async () => {
  try {
    setServiceCredentialForTest(who('sizes-w15'));
    // Not "one more than before": the test above left the store FULL, so a start swaps one out.
    startPlan('w15', 'args', items, new Map(), 'sizes-token');
    const plans = planStoreSize();
    assert.ok(plans >= 1 && plans <= 200, `a count of plans: ${plans}`);
    assert.equal(planStoreSize(), plans, 'asking twice gives the same');

    // (A mint also prunes what expired, so the count is taken AFTER it.)
    const change = cs('Größe');
    mintToken(cs('bleibt'));
    const pending = confirmStoreSize();
    const token = mintToken(change);
    assert.equal(confirmStoreSize(), pending + 1);

    const replays = replayStoreSize();
    await withReplayContext(token, {}, async () => { markRedeemed(token, currentIdentity()); });
    assert.equal(replayStoreSize(), replays + 1);

    const before = uploadStoreBytes();
    const pdf = Buffer.from('%PDF-1.7 x %%EOF', 'latin1');
    const put = await sharedUploadSlots().put('sizes-w15', Readable.from([pdf]), 'a.pdf');
    assert.ok(put.ok);
    assert.equal(uploadStoreBytes(), before + pdf.length);
    sharedUploadSlots().take(put.slot.ref, 'sizes-w15');
    assert.equal(uploadStoreBytes(), before);
    assert.equal(new UploadSlots().bytes, 0);
  } finally { setServiceCredentialForTest(null); }
});
