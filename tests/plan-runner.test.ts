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
