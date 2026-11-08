/**
 * plan-runner.test.ts – the plan store's bounds (review of P5, 2026-11-06;
 * chatbot feedback 2026-11-07, points 5 and 7).
 *
 * One identity may hold only a few plans. Room is made from its OWN COMPLETE
 * plans; an unfinished plan is never evicted — that ended a running filing with
 * `plan_expired` halfway through. With every slot unfinished, a new plan is
 * refused (`hasPlanCapacity`) before the confirmation key is spent.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { findPlan, hasPlanCapacity, startPlan, PLANS_PER_IDENTITY, PLAN_TTL_MS } from '../src/services/write/plan-runner.js';

const items = [{ key: 'a' }];
const who = (label: string): WloCredential => ({ header: `Basic ${label}`, label, source: 'user' });

test('unfinished plans are never evicted; a full identity is refused, another is not', () => {
  try {
    setServiceCredentialForTest(who('otto-pr'));
    const ottos = startPlan('k', 'args', items, new Map(), 'otto-token');
    setServiceCredentialForTest(who('maria-pr'));
    const marias = Array.from({ length: PLANS_PER_IDENTITY }, (_, i) => startPlan('k', 'args', items, new Map(), `maria-${i}`));
    assert.equal(hasPlanCapacity(), false, 'five unfinished plans: no sixth');
    assert.equal(findPlan('k', marias[0]!, 'args')?.ok, true, 'the oldest unfinished plan is still there');
    setServiceCredentialForTest(who('otto-pr'));
    assert.equal(hasPlanCapacity(), true);
    assert.equal(findPlan('k', ottos, 'args')?.ok, true, 'Otto\'s plan untouched');
  } finally { setServiceCredentialForTest(null); }
});

test('a complete plan makes room, and its key then answers plan_expired, not unknown', () => {
  try {
    setServiceCredentialForTest(who('lena-pr'));
    const plans = Array.from({ length: PLANS_PER_IDENTITY }, (_, i) => startPlan('k', 'args', items, new Map(), `lena-${i}`));
    const first = findPlan<{ key: string }>('k', plans[0]!, 'args');
    assert.ok(first?.ok);
    if (first?.ok) first.plan.state.set('a', { status: 'created', nodeId: 'x' });
    assert.equal(hasPlanCapacity(), true, 'a complete plan does not hold a slot');
    startPlan('k', 'args', items, new Map(), 'lena-new');
    assert.deepEqual(findPlan('k', plans[0]!, 'args'), { ok: false, code: 'plan_expired' });
    assert.deepEqual(findPlan('k', 'lena-0', 'args'), { ok: false, code: 'plan_expired' }, 'its confirm key too');
    assert.equal(findPlan('k', plans[1]!, 'args')?.ok, true, 'the unfinished ones stay');
  } finally { setServiceCredentialForTest(null); }
});

test('an expired plan answers plan_expired by its confirm key after the sweep removed it', () => {
  try {
    setServiceCredentialForTest(who('jan-pr'));
    const t0 = 9_000_000;
    startPlan('k', 'args', items, new Map(), 'jan-confirm', t0);
    // A later sweep (any lookup) removes the expired plan itself.
    findPlan('k', 'irgendwas', 'args', t0 + PLAN_TTL_MS + 1);
    assert.deepEqual(findPlan('k', 'jan-confirm', 'args', t0 + PLAN_TTL_MS + 2), { ok: false, code: 'plan_expired' });
  } finally { setServiceCredentialForTest(null); }
});

test('independent items run in waves of PLAN_POOL — the budget bounds a call, not only a tree (review P3)', async () => {
  const { PLAN_POOL, runPlan, setPlanBudgetForTest } = await import('../src/services/write/plan-runner.js');
  setServiceCredentialForTest(who('wellen'));
  setPlanBudgetForTest(0);
  try {
    // 200 independent items used to be ONE wave: the budget was checked only
    // between waves, so a whole metadata plan ran in one call past any limit.
    const many = Array.from({ length: PLAN_POOL * 3 }, (_, i) => ({ key: `i${i}` }));
    const id = startPlan('waves', 'a', many, new Map(), 'wellen-token');
    const plan = findPlan<{ key: string }>('waves', id, 'a');
    assert.ok(plan?.ok);
    const first = await runPlan(plan.plan, async () => ({ status: 'stored' as const }));
    assert.deepEqual(first.progress, { done: PLAN_POOL, total: PLAN_POOL * 3 });
    assert.equal(first.complete, false);
  } finally {
    setPlanBudgetForTest(null);
    setServiceCredentialForTest(null);
  }
});

test('no next wave when the last one says it would cross the budget (review W2, finding 3)', async () => {
  const { runPlan } = await import('../src/services/write/plan-runner.js');
  setServiceCredentialForTest(who('vorausschau'));
  try {
    // A wave takes ~100 ms, the budget is 150 ms: after the first wave 100 ms
    // are spent, and a second would end near 200 — past the client's limit.
    // Checking only "is the budget spent yet" started it anyway.
    const many = Array.from({ length: 8 }, (_, i) => ({ key: `v${i}` }));
    const id = startPlan('ahead', 'a', many, new Map(), 'vorausschau-token');
    const plan = findPlan<{ key: string }>('ahead', id, 'a');
    assert.ok(plan?.ok);
    const slow = async () => { await new Promise(r => setTimeout(r, 100)); return { status: 'stored' as const }; };
    const first = await runPlan(plan.plan, slow, 150);
    assert.deepEqual(first.progress, { done: 4, total: 8 });
  } finally { setServiceCredentialForTest(null); }
});

test('a call whose caller spent its whole budget reading starts the plan without a wave (review 3, finding 5)', async () => {
  const { runPlan } = await import('../src/services/write/plan-runner.js');
  setServiceCredentialForTest(who('ausgelesen'));
  try {
    const many = Array.from({ length: 4 }, (_, i) => ({ key: `a${i}` }));
    const id = startPlan('spent', 'a', many, new Map(), 'ausgelesen-token');
    const plan = findPlan<{ key: string }>('spent', id, 'a');
    assert.ok(plan?.ok);
    let ran = 0;
    const first = await runPlan(plan.plan, async () => { ran++; return { status: 'stored' as const }; }, 0);
    assert.equal(ran, 0, 'no wave on top of a budget already spent — the answer would miss the client limit');
    assert.deepEqual([first.complete, first.progress.done], [false, 0]);
    // The next call (a continuation) has its full budget and makes progress.
    const next = await runPlan(plan.plan, async () => { ran++; return { status: 'stored' as const }; });
    assert.equal(next.complete, true);
  } finally { setServiceCredentialForTest(null); }
});
