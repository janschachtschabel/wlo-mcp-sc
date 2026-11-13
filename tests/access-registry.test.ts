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
import {
  EXPIRED_KEPT_S, MAX_BLOCKS_PER_LABEL, openRegistry, SESSION_BLOCK_TTL_S, type AccessRegistry,
} from '../src/auth/access-registry.js';

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

// ── File permissions (audit 2026-11-05) ────────────────────────────────────

test('the registry file is readable by its owner only', async (t) => {
  // The ids are secrets (AUTH.md §4: revocation acts on them). POSIX only —
  // Windows has no owner/group/other bits to assert, and CI runs on Linux.
  if (process.platform === 'win32') { t.skip('no POSIX file modes on Windows'); return; }
  const { statSync } = await import('node:fs');
  const path = join(tempDir(t), 'registry.json');
  const registry = await opened(path);
  await registry.add(entry('private-id'));
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

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

/**
 * The `k` field was added to an on-disk format that is already deployed, and the
 * format version was deliberately NOT bumped — a mismatch makes `parseEntries`
 * answer null, which switches per-user access OFF entirely, so a bump would take
 * every existing block out of service on deploy with nothing but a log line.
 *
 * That is only defensible while both directions are safe, which is what these
 * two pin. The rollback direction is not hypothetical: it is one `docker
 * compose` away at any time.
 */
test('a registry file written before `k` existed still loads, and its entries are deliberate', async (t) => {
  const path = join(tempDir(t), 'registry.json');
  writeFileSync(path, JSON.stringify({
    v: 1,
    entries: [{ jti: 'alt-1', label: 'lehrerin', iat: 1_754_300_000 }],
  }), 'utf8');

  const registry = await opened(path);
  assert.equal(registry.has('alt-1'), true, 'an old entry is not discarded');

  // No `k` reads as deliberate, so it is counted in that class: filling the
  // TICKET class must not touch it.
  for (let i = 1; i <= MAX_BLOCKS_PER_LABEL + 1; i++) {
    await registry.add({ jti: `t-${i}`, label: 'lehrerin', iat: 1_754_400_000 + i, k: 'ticket' });
  }
  assert.equal(registry.has('alt-1'), true, 'and the widget cannot push it out');
});

test('an entry naming a kind we cannot interpret fails the whole file closed', async (t) => {
  // Fail closed, not "drop the odd entry": a kind this build does not know is a
  // record written by something it does not understand, and guessing which class
  // it belongs to is how someone loses a pasted block. Losing the allow-list
  // means everyone fetches a new one — the recoverable direction.
  const path = join(tempDir(t), 'registry.json');
  writeFileSync(path, JSON.stringify({
    v: 1,
    entries: [{ jti: 'a', label: 'lehrerin', iat: 1_754_300_000, k: 'aus-der-zukunft' }],
  }), 'utf8');

  assert.equal(await openRegistry(path), null, 'per-user access stays off rather than half-understood');
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

// ── R1: an expiry in the allow-list, not in the token (plan 2026-11-07) ──────

test('an entry past its exp is no longer listed; one without exp never expires', async (t) => {
  const registry = await opened(join(tempDir(t), 'registry.json'));
  const nowS = 1_800_000_000;
  await registry.add({ jti: 'session', label: 'lehrerin', iat: nowS, exp: nowS + SESSION_BLOCK_TTL_S, k: 'ticket' });
  await registry.add({ jti: 'pasted', label: 'lehrerin', iat: nowS });

  assert.equal(registry.has('session', (nowS + SESSION_BLOCK_TTL_S - 1) * 1000), true, 'a second before');
  assert.equal(registry.has('session', (nowS + SESSION_BLOCK_TTL_S) * 1000), false, 'at exp');
  assert.equal(registry.has('pasted', (nowS + 10 * SESSION_BLOCK_TTL_S) * 1000), true, 'no exp, no expiry');
  assert.equal(registry.expiresAt('session'), nowS + SESSION_BLOCK_TTL_S);
  assert.equal(registry.expiresAt('pasted'), undefined);
  assert.equal(SESSION_BLOCK_TTL_S, 12 * 3600);
});

test('expired entries never push a pasted block out — the cap counts live entries only', async (t) => {
  // A widget's OAuth login carries no `k`, so it counts in the class of pasted
  // blocks; logging in again every 12 h would otherwise retire the block the
  // person pasted into their AI host within a week (the 2026-08-13 defect).
  const registry = await opened(join(tempDir(t), 'registry.json'));
  const nowS = Math.floor(Date.now() / 1000);
  for (let i = 0; i < MAX_BLOCKS_PER_LABEL - 1; i++) await registry.add({ jti: `pasted-${i}`, label: 'lehrerin', iat: nowS - 1000 + i });
  await registry.add({ jti: 'widget-old', label: 'lehrerin', iat: nowS - 50_000, exp: nowS - 1 });
  await registry.add({ jti: 'widget-new', label: 'lehrerin', iat: nowS, exp: nowS + SESSION_BLOCK_TTL_S });
  for (let i = 0; i < MAX_BLOCKS_PER_LABEL - 1; i++) assert.equal(registry.has(`pasted-${i}`), true, `pasted-${i}`);
  assert.equal(registry.has('widget-new'), true);
  assert.equal(registry.has('widget-old'), false, 'expired');
  assert.equal(registry.known('widget-old'), true, 'but kept as the record that stops a re-issue');
});

test('an expired entry is kept as a record for two days — then dropped at the next write', async (t) => {
  const registry = await opened(join(tempDir(t), 'registry.json'));
  const nowS = Math.floor(Date.now() / 1000);
  await registry.add({ jti: 'recent', label: 'lehrerin', iat: nowS - 20_000, exp: nowS - 10 });
  await registry.add({ jti: 'ancient', label: 'lehrerin', iat: nowS - 300_000, exp: nowS - EXPIRED_KEPT_S - 10 });
  await registry.add({ jti: 'trigger', label: 'lehrerin', iat: nowS });
  assert.equal(registry.known('recent'), true, 'still known: an expired block must not be issued again');
  assert.equal(registry.has('recent'), false, 'but no longer listed');
  assert.equal(registry.known('ancient'), false, 'past the record period: gone');
});

test('the per-account cap counts only LIVE entries', async (t) => {
  const registry = await opened(join(tempDir(t), 'registry.json'));
  const nowS = Math.floor(Date.now() / 1000);
  for (let i = 0; i < 5; i++) await registry.add({ jti: `expired-${i}`, label: 'lehrerin', iat: nowS - 100_000 + i, exp: nowS - 1 });
  for (let i = 0; i < MAX_BLOCKS_PER_LABEL; i++) await registry.add({ jti: `live-${i}`, label: 'lehrerin', iat: nowS + i });
  for (let i = 0; i < MAX_BLOCKS_PER_LABEL; i++) assert.equal(registry.has(`live-${i}`), true, `live-${i}`);
});

test('a failed write leaves the order as it was — the next eviction still removes the oldest', async (t) => {
  const path = join(tempDir(t), 'registry.json');
  const registry = await opened(path);
  for (let i = 0; i < MAX_BLOCKS_PER_LABEL; i++) await registry.add({ jti: `b-${i}`, label: 'lehrerin', iat: i });
  mkdirSync(`${path}.tmp`);
  await assert.rejects(registry.add({ jti: 'failed', label: 'lehrerin', iat: 99 }));
  rmSync(`${path}.tmp`, { recursive: true, force: true });
  await registry.add({ jti: 'next', label: 'lehrerin', iat: 100 });
  assert.equal(registry.has('b-0'), false, 'the oldest goes');
  assert.equal(registry.has('b-1'), true, 'not a younger one');
});

test('exp survives a restart, and an exp that is not a number fails closed', async (t) => {
  const dir = tempDir(t);
  const path = join(dir, 'registry.json');
  const registry = await opened(path);
  const exp = Math.floor(Date.now() / 1000) + 60;
  await registry.add({ jti: 'session', label: 'lehrerin', iat: exp - 120, exp });
  const again = await opened(path);
  assert.equal(again.expiresAt('session'), exp);
  assert.equal(again.has('session', (exp + 1) * 1000), false);

  const bad = join(dir, 'bad.json');
  writeFileSync(bad, JSON.stringify({ v: 1, entries: [{ jti: 'x', label: 'l', iat: 1, exp: 'morgen' }] }));
  assert.equal(await openRegistry(bad), null);
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

test('a renewed entry counts as the NEWEST — renewal does not leave it first in line for eviction', async (t) => {
  const registry = await opened(join(tempDir(t), 'registry.json'));
  const nowS = Math.floor(Date.now() / 1000);
  await registry.add({ jti: 't-0', label: 'lehrerin', iat: nowS - 50_000, exp: nowS - 1, k: 'ticket' });
  for (let i = 1; i < MAX_BLOCKS_PER_LABEL; i++) {
    await registry.add({ jti: `t-${i}`, label: 'lehrerin', iat: nowS, exp: nowS + 3600, k: 'ticket' });
  }
  await registry.add({ jti: 't-0', label: 'lehrerin', iat: nowS, exp: nowS + 3600, k: 'ticket' });
  await registry.add({ jti: 't-new', label: 'lehrerin', iat: nowS, exp: nowS + 3600, k: 'ticket' });
  assert.equal(registry.has('t-0'), true, 'the renewed one stays');
  assert.equal(registry.has('t-1'), false, 'the oldest live one goes');
});

// ── audit 2026-11-12, S-1/S-2: whose entry it is ──────────────────────────────

test('labelOf names the account an id was listed for, and nothing for an unknown id', async (t) => {
  const registry = await opened(join(tempDir(t), 'registry.json'));
  await registry.add({ jti: 'a', label: 'lehrerin', iat: 1 });
  assert.equal(registry.labelOf('a'), 'lehrerin');
  assert.equal(registry.labelOf('fehlt'), undefined);
});

test('the confirmed account name survives a restart and is what revocation and the cap go by (audit S-2)', async (t) => {
  const path = join(tempDir(t), 'registry.json');
  const registry = await opened(path);
  // edu-sharing accepts "Lehrerin" and "LEHRERIN" for the account "lehrerin" (measured 2026-11-12).
  await registry.add({ jti: 'laptop', label: 'Lehrerin', acct: 'lehrerin', iat: 1 });
  await registry.add({ jti: 'handy', label: 'LEHRERIN', acct: 'lehrerin', iat: 2 });
  await registry.add({ jti: 'widget', label: 'lehrerin', iat: 3, k: 'ticket' });
  await registry.add({ jti: 'fremd', label: 'jemand', acct: 'jemand', iat: 4 });

  const reopened = await opened(path);
  assert.equal(reopened.labelOf('laptop'), 'Lehrerin', 'the label stays the spelling the block carries');
  assert.equal(await reopened.removeByLabel('lehrerin'), 3, 'every spelling of the one account goes');
  assert.equal(reopened.has('fremd'), true);
});

test('the per-account cap counts every spelling of one account together (audit S-2)', async (t) => {
  const registry = await opened(join(tempDir(t), 'registry.json'));
  for (let i = 1; i <= MAX_BLOCKS_PER_LABEL + 1; i++) {
    // A new spelling each time: counted per label this would never reach the cap.
    await registry.add({ jti: `id-${i}`, label: `Lehrerin${'!'.repeat(i)}`, acct: 'lehrerin', iat: i });
  }
  assert.equal(registry.has('id-1'), false, 'the oldest gave way');
  assert.equal(registry.has(`id-${MAX_BLOCKS_PER_LABEL + 1}`), true);
});

test('an account name that is not a string fails the file closed', async (t) => {
  const bad = join(tempDir(t), 'bad.json');
  writeFileSync(bad, JSON.stringify({ v: 1, entries: [{ jti: 'x', label: 'l', iat: 1, acct: 7 }] }));
  assert.equal(await openRegistry(bad), null);
});

test('the spelling typed now finds only entries WITHOUT a confirmed account — never another account by its name (review P1, 2)', async (t) => {
  const registry = await opened(join(tempDir(t), 'registry.json'));
  await registry.add({ jti: 'fremd', label: 'x', acct: 'alias', iat: 1 });   // someone else's account "alias"
  await registry.add({ jti: 'alt', label: 'alias', iat: 2 });                // my own legacy entry, typed "alias"
  // I am "ich"; the instance accepted "alias" as a spelling of my login.
  assert.equal(await registry.removeByLabel('ich', 'alias'), 1);
  assert.equal(registry.has('fremd'), true, 'the typed spelling must not match a confirmed account');
  assert.equal(registry.has('alt'), false);
});

test('noteAccount adds the confirmed account to a legacy entry and keeps everything else (review P1, 3)', async (t) => {
  const path = join(tempDir(t), 'registry.json');
  const registry = await opened(path);
  await registry.add({ jti: 'alt', label: 'Lehrerin', iat: 5, exp: 9_999_999_999 });
  await registry.add({ jti: 'neuer', label: 'jemand', iat: 6 });
  await registry.noteAccount('alt', 'lehrerin');

  const reopened = await opened(path);
  assert.equal(reopened.expiresAt('alt'), 9_999_999_999, 'the expiry survives');
  assert.equal(reopened.labelOf('alt'), 'Lehrerin');
  assert.equal(await reopened.removeByLabel('lehrerin'), 1, 'and the entry is now found by its account');
  // An entry that already has one keeps it; an unknown id is not created.
  await registry.noteAccount('unbekannt', 'x');
  assert.equal(registry.known('unbekannt'), false);
});
