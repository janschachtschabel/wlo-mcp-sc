/**
 * widgets-followup-drift.test.ts – the follow-up dispatch exists TWICE.
 *
 * `shared/mount.ts` owns the tile shell (list → detail → back → Escape → focus)
 * and `search-results/main.ts` keeps its own copy because it also owns the
 * multi-select. Folding them together would mean parameterising the shell for a
 * single caller, and these `main.ts` files have no behavioural test coverage at
 * all — the widget tests exercise `render.ts`, not the interaction glue — so a
 * refactor could not be verified as behaviour-preserving. The duplication is
 * therefore deliberate.
 *
 * What is NOT acceptable is the two copies drifting apart unnoticed. They did
 * come close: when `followUpPrompt` gained per-action parameter names
 * (2026-07-31), both copies had to move together, and nothing would have said
 * so. This pins them at source level — the same idiom the project already uses
 * for `main.ts` in `widgets-focus-scroll.test.ts`.
 *
 * If this test fails: you changed one copy. Change the other the same way, or
 * remove the duplication properly (which needs interaction tests first).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const SHELL = '../src/apps/widgets/shared/mount.ts';
const SEARCH = '../src/apps/widgets/search-results/main.ts';

/**
 * The `[data-follow-up]` branch of the click handler, whitespace-normalised.
 * Bounded by the marker that opens it and the lookup that follows it, so the
 * slice does not depend on brace counting.
 */
function followUpBranch(src: string): string {
  const start = src.indexOf("const followUp = el?.closest?.('[data-follow-up]');");
  assert.notEqual(start, -1, 'the follow-up branch must still start with the documented marker');
  const end = src.indexOf('const detailsBtn', start);
  assert.notEqual(end, -1, 'the follow-up branch must still be followed by the details lookup');
  return src.slice(start, end).replace(/\s+/g, ' ').trim();
}

test('the follow-up dispatch is identical in the tile shell and in search-results', () => {
  assert.equal(
    followUpBranch(read(SEARCH)),
    followUpBranch(read(SHELL)),
    'the two copies of the follow-up dispatch have drifted apart',
  );
});

test('both copies still read the attributes the renderers emit', () => {
  // A rename on one side only would otherwise be caught by the comparison above
  // but not explained; this says which contract is at stake.
  for (const rel of [SHELL, SEARCH]) {
    const branch = followUpBranch(read(rel));
    for (const attr of ['data-follow-up', 'data-node-id', 'data-node-title']) {
      assert.ok(branch.includes(attr), `${rel}: the dispatch must read ${attr}`);
    }
    assert.match(branch, /followUpPrompt\(/, `${rel}: the dispatch must build the prompt centrally`);
  }
});
