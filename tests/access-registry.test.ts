/**
 * access-registry.test.ts – the allow-list of issued access ids (P2).
 *
 * An ALLOW-list, not a deny-list, and that choice is the whole safety argument:
 * losing the file means nothing is valid any more (everyone fetches a new
 * block), where losing a deny-list would mean every revoked block silently
 * works again. The tests below pin the fail-closed direction at each entry
 * point, because "corrupt file" and "missing file" look alike and must not be
 * treated alike.
 *
 * The registry stores IDS, never a credential — asserted here rather than
 * promised in a docstring.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_BLOCKS_PER_LABEL, openRegistry, type AccessRegistry } from '../src/auth/access-registry.js';

function tempDir(t: { after: (fn: () => void) => void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'wlo-registry-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const entry = (jti: string) => ({ jti, label: 'testuser', iat: 1_754_300_000 });

async function opened(path: string): Promise<AccessRegistry> {
  const r = await openRegistry(path);
  assert.ok(r, 'expected the registry to open');
  return r;
}

// ── T6: opening ────────────────────────────────────────────────────────────

test('a missing file is the ordinary first start, not a failure', async (t) => {
  const path = join(tempDir(t), 'registry.json');
  const registry = await opened(path);
  assert.equal(registry.has('anything'), false);
});

/**
 * Measured in Docker, not imagined (2026-08-05): a named volume mounted at a
 * path the image never creates belongs to root:root, the container runs as
 * `node`, and the registry file cannot be written. READING it still succeeds —
 * ENOENT reads as "first start" — so the server logged `access blocks are
 * enabled` and only broke when the first person tried to fetch a block.
 *
 * That is the shape of failure this project keeps hunting: enabled at startup,
 * broken at first use, with nothing in between to warn anyone. So a first start
 * WRITES the empty registry rather than assuming it could, and an unwritable
 * path is one loud line in the boot log instead of a 500 for a stranger.
 */
test('a registry path that cannot be written fails at startup, not at first use', async (t) => {
  const path = join(tempDir(t), 'missing-directory', 'registry.json');
  assert.equal(await openRegistry(path), null, 'no registry rather than one that cannot record');
});

test('a first start leaves the empty registry on disk, proving the path writable', async (t) => {
  const path = join(tempDir(t), 'registry.json');
  await opened(path);
  assert.ok(existsSync(path), 'written before anyone uses it, not at the first issuance');
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { v: 1, entries: [] });
});

test('an existing file is loaded', async (t) => {
  const path = join(tempDir(t), 'registry.json');
  writeFileSync(path, JSON.stringify({ v: 1, entries: [entry('known-id')] }), 'utf8');
  const registry = await opened(path);
  assert.equal(registry.has('known-id'), true);
  assert.equal(registry.has('other-id'), false);
});

test('an unreadable or malformed file closes the door instead of opening it', async (t) => {
  const dir = tempDir(t);

  const corrupt = join(dir, 'corrupt.json');
  writeFileSync(corrupt, '{ not json', 'utf8');
  assert.equal(await openRegistry(corrupt), null, 'corrupt JSON');

  const wrongShape = join(dir, 'shape.json');
  writeFileSync(wrongShape, JSON.stringify(['just', 'an', 'array']), 'utf8');
  assert.equal(await openRegistry(wrongShape), null, 'valid JSON, wrong shape');

  const badEntries = join(dir, 'entries.json');
  writeFileSync(badEntries, JSON.stringify({ v: 1, entries: [{ nope: true }] }), 'utf8');
  assert.equal(await openRegistry(badEntries), null, 'entries of the wrong shape');

  const asDirectory = join(dir, 'adir');
  mkdirSync(asDirectory);
  assert.equal(await openRegistry(asDirectory), null, 'a directory where a file belongs');
});

// ── T7: writing ────────────────────────────────────────────────────────────

test('an added id is listed and survives a reopen', async (t) => {
  const path = join(tempDir(t), 'registry.json');
  const registry = await opened(path);

  await registry.add(entry('fresh-id'));
  assert.equal(registry.has('fresh-id'), true);

  const reopened = await opened(path);
  assert.equal(reopened.has('fresh-id'), true, 'the write reached the disk, not just the map');
});

test('a removed id stops being listed, and removing it twice reports honestly', async (t) => {
  const path = join(tempDir(t), 'registry.json');
  const registry = await opened(path);
  await registry.add(entry('doomed'));

  assert.equal(await registry.remove('doomed'), true);
  assert.equal(registry.has('doomed'), false);
  assert.equal(await registry.remove('doomed'), false, 'already gone');
  assert.equal(await registry.remove('never-existed'), false);

  const reopened = await opened(path);
  assert.equal(reopened.has('doomed'), false, 'the removal reached the disk');
});

test('writing leaves no temporary file behind', async (t) => {
  const dir = tempDir(t);
  const registry = await opened(join(dir, 'registry.json'));
  await registry.add(entry('a'));
  await registry.remove('a');
  assert.deepEqual(readdirSync(dir), ['registry.json']);
});

test('concurrent additions do not lose each other', async (t) => {
  // Two people fetching a block at the same moment is ordinary use. This pins
  // the OUTCOME — every entry survives — not the serialisation that protects
  // it: without the chain each writer would still stringify the map it sees,
  // and whether the loser's shorter body renames last is a race, so a test
  // built on it would be flaky. See the note in access-registry.ts.
  const path = join(tempDir(t), 'registry.json');
  const registry = await opened(path);

  await Promise.all([registry.add(entry('one')), registry.add(entry('two')), registry.add(entry('three'))]);

  const reopened = await opened(path);
  for (const id of ['one', 'two', 'three']) {
    assert.equal(reopened.has(id), true, `${id} survived`);
  }
});

/**
 * A write can fail for reasons that pass: a volume briefly not mounted, a full
 * disk, a permission corrected a minute later. Two things must survive that.
 *
 * The failure must not disable writing for GOOD — the chain that serialises
 * writes carries a rejection forward, so without care every later `add` and,
 * far worse, every later `remove` fails without even trying. Revocation is the
 * one operation that has to work in an emergency.
 *
 * And a failed write must not GRANT anything: if the id stayed in memory while
 * never reaching the file, the block would authenticate until the next restart
 * and then quietly stop — an allow-list that is briefly fail-open in the one
 * direction that matters.
 */
test('a failed write neither grants access nor disables later writes', async (t) => {
  const dir = tempDir(t);
  const path = join(dir, 'registry.json');
  const registry = await opened(path);

  // A directory where the write wants its temp file — EISDIR on every platform.
  mkdirSync(`${path}.tmp`);
  await assert.rejects(registry.add(entry('lost')), 'the failure reaches the caller');
  assert.equal(registry.has('lost'), false, 'and grants nothing it could not record');

  rmSync(`${path}.tmp`, { recursive: true });
  await registry.add(entry('later'));
  assert.equal(registry.has('later'), true, 'the next write is attempted again');
  assert.equal(await registry.remove('later'), true, 'and so is a revocation');

  const onDisk = JSON.parse(readFileSync(path, 'utf8')) as { entries: { jti: string }[] };
  assert.deepEqual(onDisk.entries.map((e) => e.jti), [], 'memory and file agree');
});

/**
 * Nothing removes an entry except a person who revokes it, so without a cap the
 * file only grows: one working login can add an entry per request, and each add
 * rewrites the whole file.
 *
 * The cap is per LABEL and never global: a global one would let a single account
 * push everyone else's access out. Oldest-first by INSERTION order rather than by
 * `iat`, which comes from the browser's clock and is not ours to trust.
 */
test('a label keeps only its most recent blocks', async (t) => {
  const path = join(tempDir(t), 'registry.json');
  const registry = await opened(path);

  for (let i = 1; i <= MAX_BLOCKS_PER_LABEL + 2; i++) {
    await registry.add({ jti: `id-${i}`, label: 'vielgeraet', iat: 1_754_300_000 });
  }
  await registry.add({ jti: 'other', label: 'jemand-anders', iat: 1_754_300_000 });

  assert.equal(registry.has('id-1'), false, 'the two oldest gave way');
  assert.equal(registry.has('id-2'), false);
  assert.equal(registry.has('id-3'), true, 'the rest are untouched');
  assert.equal(registry.has(`id-${MAX_BLOCKS_PER_LABEL + 2}`), true, 'the newest above all');
  assert.equal(registry.has('other'), true, 'and another account is not affected');

  const reopened = await opened(path);
  assert.equal(reopened.has('id-1'), false, 'the file agrees, not just the memory');
  assert.equal(reopened.has('other'), true);
});

/**
 * Automatic entries must not push out the ones a person made on purpose.
 *
 * Found by audit 2026-08-13, and it is the ticket-exchange rule one level up.
 * The deterministic `jti` collapses every PAGE LOAD of one edu-sharing session
 * into a single entry — but the next session brings a new ticket, a new hash and
 * therefore a new entry. So an embedded widget files roughly one entry per
 * session, i.e. per working day, while the cap was calibrated for entries a
 * person creates deliberately: `MAX_BLOCKS_PER_LABEL`'s own docstring reasons
 * about "a laptop, a phone, two or three AI hosts".
 *
 * The consequence was silent and unrecoverable-in-place: after ten widget
 * sessions the oldest entry of that label gave way, and the oldest is typically
 * the block the person pasted into their AI host weeks earlier. Their connector
 * then answers 401, re-pasting the same block does not help — it is off the
 * allow-list — and nothing anywhere says why.
 *
 * The two kinds are therefore capped in SEPARATE classes. One constant, not a
 * second number to justify: "ten is well above real use" holds per class, and
 * for tickets it reads as roughly two working weeks before the oldest (long
 * dead) entry is retired.
 */
test('ticket entries and deliberate blocks are capped apart, not against each other', async (t) => {
  const path = join(tempDir(t), 'registry.json');
  const registry = await opened(path);

  // What the person did on purpose: one block per AI host.
  await registry.add({ jti: 'pasted-into-chatgpt', label: 'lehrerin', iat: 1_754_300_000 });
  await registry.add({ jti: 'pasted-into-claude', label: 'lehrerin', iat: 1_754_300_001 });

  // What merely visiting a page does, over more sessions than the cap allows.
  for (let i = 1; i <= MAX_BLOCKS_PER_LABEL + 3; i++) {
    await registry.add({ jti: `ticket-${i}`, label: 'lehrerin', iat: 1_754_400_000 + i, k: 'ticket' });
  }

  assert.equal(registry.has('pasted-into-chatgpt'), true, 'a deliberate block survives the widget');
  assert.equal(registry.has('pasted-into-claude'), true);
  assert.equal(registry.has('ticket-1'), false, 'ticket entries still give way — to each other');
  assert.equal(registry.has('ticket-3'), false);
  assert.equal(registry.has(`ticket-${MAX_BLOCKS_PER_LABEL + 3}`), true, 'the current session above all');

  const reopened = await opened(path);
  assert.equal(reopened.has('pasted-into-chatgpt'), true, 'the file agrees, not just the memory');
  assert.equal(reopened.has('ticket-1'), false);
});

test('revocation-by-account still takes both kinds', async (t) => {
  // The classes are separate for EVICTION only. `removeByLabel` is what someone
  // reaches for when their account is compromised, and a ticket block is exactly
  // as much of an access as a pasted one — leaving them behind would answer
  // "everything revoked" over a widget that keeps working.
  const registry = await opened(join(tempDir(t), 'registry.json'));
  await registry.add({ jti: 'pasted', label: 'lehrerin', iat: 1_754_300_000 });
  await registry.add({ jti: 'from-ticket', label: 'lehrerin', iat: 1_754_300_001, k: 'ticket' });

  assert.equal(await registry.removeByLabel('lehrerin'), 2, 'both kinds went');
  assert.equal(registry.has('from-ticket'), false);
});

// ── removing every block of one account ────────────────────────────────────

/**
 * The gap this closes: over OAuth the person never SEES their block — it goes to
 * the client — so `remove(jti)` is unreachable for them, and an access issued
 * that way could only be ended by the operator editing this file. Revoking by
 * account is the only path that works without one.
 *
 * Matching is EXACT, never case-folded, and that is a deliberate refusal to
 * guess: whether edu-sharing treats `Jan` and `jan` as one login has not been
 * measured. Folding would be a nicety if they are the same account and a way to
 * wipe a stranger's accesses if they are not. Exact matching can only ever leave
 * one of your own entries behind, which the page reports as a count.
 */
test('revoking by account removes exactly that account and reports how many', async (t) => {
  const path = join(tempDir(t), 'registry.json');
  const registry = await opened(path);

  await registry.add({ jti: 'laptop', label: 'lehrerin', iat: 1_754_300_000 });
  await registry.add({ jti: 'handy', label: 'lehrerin', iat: 1_754_300_001 });
  await registry.add({ jti: 'fremd', label: 'jemand-anders', iat: 1_754_300_002 });
  await registry.add({ jti: 'gross', label: 'Lehrerin', iat: 1_754_300_003 });

  assert.equal(await registry.removeByLabel('lehrerin'), 2, 'both of this account went');
  assert.equal(registry.has('laptop'), false);
  assert.equal(registry.has('handy'), false);
  assert.equal(registry.has('fremd'), true, 'another account is untouched');
  assert.equal(registry.has('gross'), true, 'and so is a different spelling');

  const reopened = await opened(path);
  assert.equal(reopened.has('laptop'), false, 'the file agrees, not just the memory');
  assert.equal(reopened.has('fremd'), true);
});

test('revoking an account with nothing listed removes nothing and says so', async (t) => {
  const path = join(tempDir(t), 'registry.json');
  const registry = await opened(path);
  await registry.add(entry('an-id'));

  assert.equal(await registry.removeByLabel('niemand'), 0);
  assert.equal(registry.has('an-id'), true);
});

/**
 * The same fail-closed rule `add` and `remove` follow: a removal that could not
 * be written must not be reported as done. Reporting it would tell someone whose
 * account is compromised that the door is shut while the next restart reopens it.
 */
test('an account revocation that cannot be written is not reported as done', async (t) => {
  const path = join(tempDir(t), 'registry.json');
  const registry = await opened(path);
  await registry.add({ jti: 'laptop', label: 'lehrerin', iat: 1_754_300_000 });

  mkdirSync(`${path}.tmp`);
  await assert.rejects(registry.removeByLabel('lehrerin'), 'the failure reaches the caller');
  assert.equal(registry.has('laptop'), true, 'and the entry is still listed');
});

test('nothing resembling a credential is ever written to disk', async (t) => {
  const path = join(tempDir(t), 'registry.json');
  const registry = await opened(path);
  await registry.add(entry('an-id'));

  const raw = readFileSync(path, 'utf8');
  assert.ok(!/secret|password|passwort|token/i.test(raw), `registry file must hold ids only, got: ${raw}`);

  const parsed = JSON.parse(raw) as { entries: Record<string, unknown>[] };
  assert.deepEqual(Object.keys(parsed.entries[0]!).sort(), ['iat', 'jti', 'label']);
});
