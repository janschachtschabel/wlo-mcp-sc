/**
 * tests/live/cleanup.ts – helper (NOT a test file): leaving staging as it was
 * found, also when a test fails (audit 2026-11-14, T6).
 *
 * Two things the `finally { assert… }` blocks got wrong:
 *
 *   - they asserted on the FIRST delete, so a failed one skipped the deletes
 *     after it — and a throw out of `finally` replaces the error of the test
 *     body, so what was reported was "NICHT GELÖSCHT" and never why the test
 *     had failed;
 *   - `make()` failed on any outcome other than `created`, although the
 *     repository is measured to answer 500 for a create that DID land
 *     (sibling creates at once, CLAUDE.md) — the collection stayed behind.
 */

import assert from 'node:assert/strict';

import { searchCollectionsByNameResult } from '../../src/wlo-search.js';
import { createCollection, deleteCollection } from '../../src/services/write/collections.js';
import { normTitle, rawCollectionTitle, subCollectionsByTitle } from '../../src/services/write/collection-children.js';

/** One thing to remove: what it is, and the call that removes it. */
export type Cleanup = readonly [what: string, remove: () => Promise<{ status: string }>];

/** Run EVERY removal, whatever the earlier ones did; return what is still there. */
async function removeAll(cleanups: readonly Cleanup[]): Promise<string[]> {
  const left: string[] = [];
  for (const [what, remove] of cleanups) {
    try {
      const outcome = await remove();
      if (outcome.status !== 'ok') left.push(`${what} ${JSON.stringify(outcome)}`);
    } catch (err) {
      left.push(`${what} (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  return left;
}

/**
 * Run `body`, then every cleanup. The body's own failure is what the test
 * reports; a leftover is added to it, never put in its place. A clean body with
 * a leftover fails for the leftover — cleanup is part of the contract.
 *
 * `cleanups` is a function because the list grows while the body runs.
 */
export async function withCleanup(body: () => Promise<void>, cleanups: () => readonly Cleanup[]): Promise<void> {
  let failed: { error: unknown } | undefined;
  try {
    await body();
  } catch (error) {
    failed = { error };
  }
  const left = await removeAll(cleanups());
  if (failed) {
    if (left.length) console.error(`NICHT GELÖSCHT (nach einem fehlgeschlagenen Test):\n  ${left.join('\n  ')}`);
    throw failed.error;
  }
  assert.deepEqual(left, [], 'NICHT GELÖSCHT');
}

/** The collection titled `title` under `parent` (null = top level), if one can be found. */
async function findByTitle(parent: string | null, title: string): Promise<string | undefined> {
  if (parent) return (await subCollectionsByTitle(parent))?.get(normTitle(title));
  // The top level has no listing of its own here; a stamped title is unique, so
  // the name search answers for it.
  const { nodes } = await searchCollectionsByNameResult(title, 10);
  return nodes.find(n => normTitle(rawCollectionTitle(n)) === normTitle(title))?.ref?.id;
}

/**
 * Create a throwaway collection and return its id.
 *
 * On any outcome other than `created` the collection is LOOKED FOR before the
 * test fails: a refused create can have created it, and then this is the only
 * place that still knows its title.
 */
export async function makeCollection(parent: string | null, title: string, extra?: Record<string, string[]>): Promise<string> {
  const made = await createCollection(parent, { title, ...(extra ? { extra } : {}) });
  if (made.status === 'created') {
    if (!extra || made.check.status === 'ok') return made.nodeId;
    // Created, but not as asked: its id is known only here, so it goes before the test fails.
    const gone = await deleteCollection(made.nodeId).then(o => o.status, () => 'threw');
    assert.fail(`Rücklesen: ${JSON.stringify(made.check)}${gone === 'ok' ? '' : ` — NICHT GELÖSCHT: ${made.nodeId}`}`);
  }
  let leftover = 'ob sie trotzdem entstanden ist, ließ sich nicht klären';
  try {
    const id = await findByTitle(parent, title);
    if (!id) leftover = parent
      ? 'unter diesem Titel ist nichts entstanden'
      // Top level: asked of the name INDEX, which lags — not finding it there is not "nothing there".
      : 'im Namens-Index nicht gefunden (er hinkt nach — ein Überbleibsel ist damit nicht ausgeschlossen)';
    else leftover = (await deleteCollection(id)).status === 'ok' ? `trotzdem entstanden (${id}) und wieder gelöscht` : `trotzdem entstanden und NICHT GELÖSCHT: ${id}`;
  } catch (err) {
    leftover += ` (${err instanceof Error ? err.message : String(err)})`;
  }
  assert.fail(`Sammlung „${title}“ abgelehnt: ${JSON.stringify(made)} — ${leftover}`);
}
