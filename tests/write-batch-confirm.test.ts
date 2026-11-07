/**
 * write-batch-confirm.test.ts – MA-3: one approval for a whole batch, redeemed file by file.
 *
 * `wlo_prepare_file_batch` shows the person what will be filed (target, folder name, count, size,
 * each entry) and mints ONE token for exactly that list. `wlo_store_batch_file` redeems it per index:
 *  - only the identity that prepared it (else `mismatch`);
 *  - each index once (`already`, with the earlier result — a retry must not file twice);
 *  - within 30 minutes (`expired`);
 *  - the list order is part of the approval: the same entries in another order are another batch.
 * The token binds the server-held plan; nothing the caller sends later can widen it.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { BatchConfirmations, batchFingerprint, type BatchPlan } from '../src/services/write/batch-confirm.js';

const PLAN: BatchPlan = {
  target: 'home', folderName: 'Physik 7', layout: 'folder',
  entries: [
    { index: 0, title: 'Mechanik', sha256: 'a'.repeat(64), size: 10, ext: 'pdf', fileName: 'mechanik.pdf' },
    { index: 1, title: 'Optik', sha256: 'b'.repeat(64), size: 20, ext: 'docx', fileName: 'optik.docx' },
  ],
};

describe('BatchConfirmations', () => {
  let now: number;
  let bc: BatchConfirmations;

  beforeEach(() => {
    now = 1_000_000;
    bc = new BatchConfirmations({ clock: () => now, maxPerOwner: 2 });
  });

  it('redeems each index once for the same identity', () => {
    const token = bc.mint('person-a', PLAN);
    const r = bc.redeem(token, 'person-a', 1);
    assert.equal(r.outcome, 'ok');
    assert.equal(r.outcome === 'ok' && r.entry.title, 'Optik');
    bc.record(token, 1, { status: 'stored', nodeId: 'n-1' });
    const zweimal = bc.redeem(token, 'person-a', 1);
    assert.deepEqual(zweimal, { outcome: 'already', result: { status: 'stored', nodeId: 'n-1' } });
  });

  it('refuses another identity, an unknown token and an index outside the plan', () => {
    const token = bc.mint('person-a', PLAN);
    assert.equal(bc.redeem(token, 'person-b', 0).outcome, 'mismatch');
    assert.equal(bc.redeem('erfunden', 'person-a', 0).outcome, 'unknown');
    assert.equal(bc.redeem(token, 'person-a', 2).outcome, 'unknown');
  });

  it('expires after 30 minutes', () => {
    const token = bc.mint('person-a', PLAN);
    now += 30 * 60 * 1000 + 1;
    assert.equal(bc.redeem(token, 'person-a', 0).outcome, 'expired');
  });

  it('caps open batches per identity (the oldest goes)', () => {
    const erster = bc.mint('person-a', PLAN);
    bc.mint('person-a', PLAN);
    bc.mint('person-a', PLAN);
    assert.equal(bc.redeem(erster, 'person-a', 0).outcome, 'unknown');
  });

  it('makes the folder once per batch, and forgets a failed attempt', async () => {
    const token = bc.mint('person-a', PLAN);
    let versuche = 0;
    const mach = async () => { versuche++; return versuche === 1
      ? { ok: false as const, detail: 'x' } : { ok: true as const, parent: 'ordner-1', denied: false }; };
    assert.equal((await bc.folder(token, mach)).ok, false);
    const [a, b] = await Promise.all([bc.folder(token, mach), bc.folder(token, mach)]);
    assert.ok(a.ok && b.ok && a.parent === 'ordner-1');
    assert.equal(versuche, 2);
  });

  it('files the manifest once, and checks expiry before ownership', () => {
    const token = bc.mint('person-a', PLAN);
    assert.equal(bc.claimManifest(token, 'person-b'), 'mismatch');
    assert.ok('plan' in (bc.claimManifest(token, 'person-a') as object));
    assert.ok('already' in (bc.claimManifest(token, 'person-a') as object));
    bc.releaseManifest(token);
    assert.equal(typeof bc.claimManifest(token, 'person-a'), 'object');
    now += 31 * 60 * 1000;
    assert.equal(bc.redeem(token, 'person-b', 0).outcome, 'expired');
  });
});

describe('BatchConfirmations — review R-A (2026-11-06)', () => {
  it('a manifest in flight is not reported as filed; the recorded result is', () => {
    const bc = new BatchConfirmations();
    const token = bc.mint('person-a', PLAN);
    assert.ok('plan' in (bc.claimManifest(token, 'person-a') as object));
    const während = bc.claimManifest(token, 'person-a') as { already: { status: string } };
    assert.notEqual(während.already.status, 'stored', 'nothing is known to be filed yet');
    bc.recordManifest(token, { status: 'unverified', detail: 'abgebrochen' });
    assert.equal((bc.claimManifest(token, 'person-a') as { already: { status: string } }).already.status, 'unverified');
    bc.recordManifest(token, { status: 'stored', nodeId: 'm-1' });
    assert.deepEqual((bc.claimManifest(token, 'person-a') as { already: unknown }).already, { status: 'stored', nodeId: 'm-1' });
  });

  it('caps the batches held in total, oldest out — not only per owner', () => {
    const bc = new BatchConfirmations({ maxTotal: 2 });
    const erste = bc.mint('person-a', PLAN);
    bc.mint('person-b', PLAN);
    const dritte = bc.mint('person-c', PLAN);
    assert.equal(bc.redeem(erste, 'person-a', 0).outcome, 'unknown');
    assert.equal(bc.redeem(dritte, 'person-c', 0).outcome, 'ok');
  });
});

describe('batchFingerprint', () => {
  it('ignores the order of fields but not the order of the list', () => {
    const gedreht: BatchPlan = {
      layout: 'folder', entries: PLAN.entries.map((e) => ({ fileName: e.fileName, ext: e.ext, size: e.size,
        sha256: e.sha256, title: e.title, index: e.index })), folderName: 'Physik 7', target: 'home',
    };
    assert.equal(batchFingerprint(gedreht), batchFingerprint(PLAN));
    const andersrum: BatchPlan = { ...PLAN, entries: [...PLAN.entries].reverse() };
    assert.notEqual(batchFingerprint(andersrum), batchFingerprint(PLAN));
  });
});
