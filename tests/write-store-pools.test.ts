/**
 * write-store-pools.test.ts – who can make whose pending work disappear
 * (review 2026-11-14).
 *
 * The three in-memory stores of the write side (confirmation keys, plans,
 * prepared batches) are bounded, and a bound means somebody's entry goes when
 * room is needed. A `Basic` login is never proven before a preview, so anyone
 * who can reach `/mcp` can fill a store — with a name they typed and any
 * password. Two rules keep that from reaching other people:
 *
 * - the BUDGET of an unproven credential is the whole credential, not the typed
 *   name: `Basic maria:wrong` is not Maria's fifty previews or five plans;
 * - room is made within ONE trust pool. Unproven callers fill and evict among
 *   themselves; an account the repository confirmed (and a listed block) lives
 *   in the other half of the store.
 *
 * What a key is BOUND to is not touched by any of this.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { runWithCredential, type WloCredential } from '../src/auth/credential.js';
import { budgetOf, poolShare } from '../src/services/write/store-budget.js';
import { buildChangeSet } from '../src/services/write/change-set.js';
import {
  budgetIdentity, confirmStoreSize, consumeToken, currentIdentity, mintToken,
  MAX_PENDING, MAX_PENDING_PER_IDENTITY, MAX_PENDING_SHARED_IDENTITY,
} from '../src/services/write/confirm.js';
import {
  findPlan, hasPlanCapacity, planStoreSize, startPlan, MAX_PLANS, PLANS_PER_IDENTITY, type PlanItem,
} from '../src/services/write/plan-runner.js';
import { BatchConfirmations, TooManyBatches, batchPool, type BatchPlan } from '../src/services/write/batch-confirm.js';

const basic = (user: string, password: string): WloCredential =>
  ({ header: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`, label: user, source: 'user' });
/** A listed access block; `acct` where the allow-list recorded the confirmed account. */
const block = (label: string, jti: string, acct?: string): WloCredential =>
  ({ header: `Basic ${Buffer.from(`${label}:block-secret`).toString('base64')}`, label, source: 'user', jti, ...(acct ? { acct } : {}) });
const SERVICE: WloCredential = { header: 'Basic c3ZjOnB3', label: 'svc', source: 'service' };

const as = <T>(cred: WloCredential, fn: () => T): T => runWithCredential(cred, fn);
const cs = (title: string) => buildChangeSet('node-1', 'content', { 'cclom:title': ['Alt'] }, { 'cclom:title': [title] });
const HOUR = 60 * 60 * 1000;

// ── the one rule ─────────────────────────────────────────────────────────────

test('the budget of an unproven login is the WHOLE credential; proven ones keep their key and live in the other pool', () => {
  const real = budgetOf(basic('maria', 'richtig'));
  const typed = budgetOf(basic('maria', 'falsch'));
  assert.equal(real.pool, 'unproven');
  assert.notEqual(real.key, typed.key, 'the same typed name with another password is another budget');
  assert.equal(budgetOf(basic('maria', 'richtig')).key, real.key, 'the same credential: the same budget');
  assert.ok(!real.key.includes('richtig') && !real.key.includes(Buffer.from('maria:richtig').toString('base64')),
    'the password is not kept in the key');

  assert.deepEqual(budgetOf(block('Maria.Muster', 'J1', 'maria')), { key: 'acct:maria', pool: 'proven' });
  // Listed before the account was recorded: proven as a BLOCK, keyed by its listed id — never by the typed name.
  assert.deepEqual(budgetOf(block('maria', 'J-alt')), { key: 'jti:J-alt', pool: 'proven' });
  assert.deepEqual(budgetOf(SERVICE), { key: 'service:svc', pool: 'proven' });
  assert.deepEqual(budgetOf(null), { key: 'anonymous', pool: 'unproven' });
  // No typed name reaches another namespace.
  for (const name of ['acct:maria', 'jti:J-alt', 'service:svc']) assert.ok(budgetOf(basic(name, 'x')).key.startsWith('user:'));

  // The two shares are the existing totals, split.
  for (const total of [MAX_PENDING, MAX_PLANS, 500, 6, 3]) {
    assert.equal(poolShare(total, 'proven') + poolShare(total, 'unproven'), total);
  }
  assert.equal(poolShare(MAX_PENDING, 'unproven'), MAX_PENDING / 2);
});

test('the BINDING identity is what it was: the budget alone learned about the password', () => {
  as(basic('maria', 'richtig'), () => {
    assert.equal(currentIdentity(), 'user:maria');
    assert.notEqual(budgetIdentity(), 'user:maria');
  });
  as(block('Maria.Muster', 'J1', 'maria'), () => assert.equal(currentIdentity(), 'jti:J1'));
  as(block('maria', 'J-alt'), () => assert.equal(budgetIdentity(), currentIdentity()));
});

// ── confirmation keys ────────────────────────────────────────────────────────

test('previews: the same typed name with another password does not evict the real user\'s key', () => {
  const t0 = 100 * HOUR;
  const real = basic('pool-maria', 'richtig');
  const change = cs('Marias Änderung');
  const token = as(real, () => mintToken(change, t0));
  as(basic('pool-maria', 'geraten'), () => {
    for (let i = 0; i < MAX_PENDING_PER_IDENTITY; i++) mintToken(cs(`fremd-${i}`), t0);
  });
  assert.equal(as(real, () => consumeToken(token, change, t0 + 1)), 'ok');
});

test('previews: twenty invented names × fifty evict an unproven stranger — never a proven holder', () => {
  const t0 = 200 * HOUR;
  const proven = block('Pool.Proven', 'J-pool-1', 'pool-proven');
  const legacy = block('pool-legacy', 'J-pool-legacy');
  const bystander = basic('pool-bystander', 'eigenes');
  const [cp, cl, cb] = [cs('bewiesen'), cs('alter Block'), cs('unbewiesen')];
  const provenKey = as(proven, () => mintToken(cp, t0));
  const legacyKey = as(legacy, () => mintToken(cl, t0));
  const bystanderKey = as(bystander, () => mintToken(cb, t0));
  for (let name = 0; name < 20; name++) {
    as(basic(`erfunden-${name}`, 'x'), () => {
      for (let i = 0; i < MAX_PENDING_PER_IDENTITY; i++) mintToken(cs(`flut-${name}-${i}`), t0);
    });
  }
  assert.ok(confirmStoreSize() <= poolShare(MAX_PENDING, 'unproven') + 2, `the flood stayed in its half: ${confirmStoreSize()}`);
  assert.equal(as(proven, () => consumeToken(provenKey, cp, t0 + 1)), 'ok', 'a confirmed account is out of reach');
  assert.equal(as(legacy, () => consumeToken(legacyKey, cl, t0 + 1)), 'ok', 'and so is a listed block without one');
  assert.equal(as(bystander, () => consumeToken(bystanderKey, cb, t0 + 1)), 'unknown',
    'what the flood CAN still take: the oldest key of another unproven caller');
});

test('previews: both pools full never exceed the total, and neither starves the other', () => {
  const t0 = 300 * HOUR;
  const fill = (make: (n: number) => WloCredential, names: number) => {
    for (let name = 0; name < names; name++) {
      as(make(name), () => { for (let i = 0; i < MAX_PENDING_PER_IDENTITY; i++) mintToken(cs(`voll-${name}-${i}`), t0); });
    }
  };
  const unprovenFirst = basic('pool-first-unproven', 'x');
  const cu = cs('erster unbewiesener');
  const unprovenKey = as(unprovenFirst, () => mintToken(cu, t0));
  fill(n => basic(`voll-u-${n}`, 'x'), poolShare(MAX_PENDING, 'unproven') / MAX_PENDING_PER_IDENTITY - 1);
  assert.equal(confirmStoreSize(), poolShare(MAX_PENDING, 'unproven') - MAX_PENDING_PER_IDENTITY + 1);

  // A flood of PROVEN accounts, more than their half holds: the unproven key is not what makes room.
  fill(n => block(`Voll.P${n}`, `J-voll-${n}`, `voll-p-${n}`), poolShare(MAX_PENDING, 'proven') / MAX_PENDING_PER_IDENTITY + 3);
  assert.ok(confirmStoreSize() <= MAX_PENDING, `never more than the total: ${confirmStoreSize()}`);
  assert.equal(as(unprovenFirst, () => consumeToken(unprovenKey, cu, t0 + 1)), 'ok', 'a proven flood evicts nothing unproven either');

  // The unproven half is filled to the brim — a proven caller still gets a key, and keeps it.
  fill(n => basic(`voll-u2-${n}`, 'x'), 12);
  const late = block('Voll.Spaet', 'J-voll-spaet', 'voll-spaet');
  const clate = cs('später');
  const lateKey = as(late, () => mintToken(clate, t0));
  fill(n => basic(`voll-u3-${n}`, 'x'), 12);
  assert.ok(confirmStoreSize() <= MAX_PENDING, `never more than the total: ${confirmStoreSize()}`);
  assert.equal(as(late, () => consumeToken(lateKey, clate, t0 + 1)), 'ok');
});

test('previews: the shared service identity makes room from its OWN keys, not from a person\'s in its pool', () => {
  const t0 = 400 * HOUR;
  const person = block('Pool.Person', 'J-pool-person', 'pool-person');
  const cperson = cs('Person');
  // A person previews — the OLDEST key of the proven half is theirs …
  const personKey = as(person, () => mintToken(cperson, t0));
  // … the service identity takes most of that half, and other people fill the rest.
  as(SERVICE, () => { for (let i = 0; i < MAX_PENDING_SHARED_IDENTITY - 20; i++) mintToken(cs(`dienst-${i}`), t0); });
  as(block('Pool.Andere', 'J-pool-andere', 'pool-andere'), () => { for (let i = 0; i < 19; i++) mintToken(cs(`andere-${i}`), t0); });
  // The service identity is below its own cap, the pool is full: its next keys must not cost the person theirs.
  as(SERVICE, () => { for (let i = 0; i < 15; i++) mintToken(cs(`dienst-spät-${i}`), t0); });
  assert.equal(as(person, () => consumeToken(personKey, cperson, t0 + 1)), 'ok');
});

// ── plans ────────────────────────────────────────────────────────────────────

const items: PlanItem[] = [{ key: 'a' }];
let planToken = 0;
const start = (cred: WloCredential, now: number): string =>
  as(cred, () => startPlan('pools', 'args', items, new Map(), `pool-plan-token-${planToken++}`, now));
const found = (cred: WloCredential, id: string, now: number) => as(cred, () => findPlan('pools', id, 'args', now));

test('plans: typing somebody\'s name with another password neither spends their five nor is refused by them', () => {
  const now = 100 * HOUR;
  const real = basic('plan-pool-maria', 'richtig');
  const typed = basic('plan-pool-maria', 'geraten');
  for (let i = 0; i < PLANS_PER_IDENTITY; i++) start(typed, now);
  assert.equal(as(typed, () => hasPlanCapacity(now)), false);
  assert.equal(as(real, () => hasPlanCapacity(now)), true, 'her five are hers');
  // The binding is the typed name as before: this is about the cap alone.
  as(real, () => assert.equal(currentIdentity(), 'user:plan-pool-maria'));
});

test('plans: invented names end an unproven stranger\'s oldest plan — never a proven holder\'s', () => {
  const now = 200 * HOUR;
  const proven = block('Plan.Proven', 'J-plan-pool', 'plan-pool-proven');
  const legacy = block('plan-pool-legacy', 'J-plan-pool-legacy');
  const bystander = basic('plan-pool-bystander', 'eigenes');
  const provenPlan = start(proven, now);
  const legacyPlan = start(legacy, now);
  const bystanderPlan = start(bystander, now);
  // Every one of them unfinished, so nothing complete is there to make room from.
  for (let name = 0; name < MAX_PLANS / PLANS_PER_IDENTITY; name++) {
    for (let i = 0; i < PLANS_PER_IDENTITY; i++) start(basic(`plan-erfunden-${name}`, 'x'), now);
  }
  assert.ok(planStoreSize() <= poolShare(MAX_PLANS, 'unproven') + 2, `the flood stayed in its half: ${planStoreSize()}`);
  assert.equal(found(proven, provenPlan, now)?.ok, true);
  assert.equal(found(legacy, legacyPlan, now)?.ok, true);
  assert.deepEqual(found(bystander, bystanderPlan, now), { ok: false, code: 'plan_expired' },
    'what the flood CAN still end: the oldest plan of another unproven caller');

  // The unproven half is full of unfinished plans: a proven caller starts one all the same …
  const late = block('Plan.Spaet', 'J-plan-spaet', 'plan-pool-spaet');
  assert.equal(as(late, () => hasPlanCapacity(now)), true);
  const before = planStoreSize();
  const latePlan = start(late, now);
  assert.equal(planStoreSize(), before + 1, '… and nobody paid for it');
  // … and a proven flood stays in ITS half, and under the total.
  for (let name = 0; name < MAX_PLANS / PLANS_PER_IDENTITY; name++) {
    for (let i = 0; i < PLANS_PER_IDENTITY; i++) start(block(`Plan.P${name}`, `J-plan-p-${name}`, `plan-pool-p-${name}`), now);
  }
  assert.equal(planStoreSize(), MAX_PLANS, 'both halves full: the total, not more');
  assert.deepEqual(found(late, latePlan, now), { ok: false, code: 'plan_expired' }, 'proven callers evict among themselves');
  const lastUnproven = start(basic('plan-pool-letzter', 'x'), now);
  assert.equal(planStoreSize(), MAX_PLANS);
  assert.equal(found(basic('plan-pool-letzter', 'x'), lastUnproven, now)?.ok, true);
});

// ── prepared batches ─────────────────────────────────────────────────────────

const PLAN: BatchPlan = {
  target: 'home', folderName: 'Physik 7', layout: 'folder',
  entries: [{ index: 0, title: 'Mechanik', sha256: 'a'.repeat(64), size: 10, ext: 'pdf', fileName: 'mechanik.pdf', role: 'content' }],
};

test('batches: rotating passwords evict an unproven stranger\'s prepared batch — never a proven holder\'s', () => {
  const bc = new BatchConfirmations({ clock: () => 1_000_000, maxPerOwner: 2, maxTotal: 6 });
  const proven = bc.mint('proven-owner', PLAN, 'proven');
  const bystander = bc.mint('bystander', PLAN, 'unproven');
  for (let i = 0; i < 20; i++) bc.mint(`rotated-${i}`, PLAN, 'unproven');
  assert.equal(bc.size, 4, 'three unproven and the one proven: the rotation stayed in its half');
  assert.equal(bc.redeem(bystander, 'bystander', 0).outcome, 'unknown', 'what rotating CAN still take');
  assert.equal(bc.redeem(proven, 'proven-owner', 0).outcome, 'ok');
});

test('batches: a pool whose batches are all under way refuses its own callers only; the total holds', () => {
  const bc = new BatchConfirmations({ clock: () => 1_000_000, maxPerOwner: 2, maxTotal: 6 });
  for (let i = 0; i < 3; i++) bc.redeem(bc.mint(`busy-${i}`, PLAN), `busy-${i}`, 0);   // the default pool is the unproven one
  assert.throws(() => bc.mint('one-more', PLAN), (err: unknown) => err instanceof TooManyBatches && err.scope === 'server');
  const tokens = [0, 1, 2].map(i => bc.mint(`proven-${i}`, PLAN, 'proven'));
  assert.equal(bc.size, 6);
  const fourth = bc.mint('proven-3', PLAN, 'proven');
  assert.equal(bc.size, 6, 'never more than the total');
  assert.equal(bc.redeem(tokens[0]!, 'proven-0', 0).outcome, 'unknown', 'proven callers make room among themselves');
  assert.equal(bc.redeem(fourth, 'proven-3', 0).outcome, 'ok');
});

test('batches: the pool comes from the credential, and the tool hands it to the store', () => {
  assert.equal(batchPool(basic('maria', 'geheim')), 'unproven');
  assert.equal(batchPool(block('Maria.Muster', 'J1', 'maria')), 'proven');
  assert.equal(batchPool(block('maria', 'J-alt')), 'proven');
  assert.equal(batchPool(null), 'unproven');
  // A mint without the pool lands in the unproven half — safe, and wrong for every proven caller.
  const tool = readFileSync(new URL('../src/tools/curation-batch.ts', import.meta.url), 'utf8');
  assert.match(tool, /batches\.mint\(wer\.owner, plan, wer\.pool\)/);
  assert.match(tool, /pool: batchPool\(cred\)/);
});
