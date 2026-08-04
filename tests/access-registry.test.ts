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
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
 * Nothing ever removes an entry except the person who revokes it, so without a
 * cap the file only grows: one working login can add an entry per request, each
 * add rewrites the whole file — and in the ordinary case, blocks people fetched
 * and then lost stay valid for ever, because revoking one requires holding it.
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

test('nothing resembling a credential is ever written to disk', async (t) => {
  const path = join(tempDir(t), 'registry.json');
  const registry = await opened(path);
  await registry.add(entry('an-id'));

  const raw = readFileSync(path, 'utf8');
  assert.ok(!/secret|password|passwort|token/i.test(raw), `registry file must hold ids only, got: ${raw}`);

  const parsed = JSON.parse(raw) as { entries: Record<string, unknown>[] };
  assert.deepEqual(Object.keys(parsed.entries[0]!).sort(), ['iat', 'jti', 'label']);
});
