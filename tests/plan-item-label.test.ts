/**
 * plan-item-label.test.ts – ONE function words a plan step (audit 2026-11-14, W7).
 *
 * Seven plan tools each turned a step's state into a German word with their own
 * copy of the same three lines. The safety sentence — a `failed` step whose
 * outcome is OPEN is never worded "nicht …" — was in four of them. A tree step
 * the runner ended after its tries read "nicht angelegt" over a collection that
 * may exist; a full text or a metadata write likewise "gescheitert".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { planItemLabel } from '../src/tools/curation-plan-reply.js';

const WORDS = { created: 'angelegt', failed: 'nicht angelegt', pending: 'offen' };

test('a status is worded from the tool\'s table; an unknown one is shown as it is', () => {
  assert.equal(planItemLabel({ status: 'created' }, WORDS), 'angelegt');
  assert.equal(planItemLabel({ status: 'moved' }, WORDS), 'moved');
});

test('a failed step whose outcome is open is "offen — Ausgang unbekannt", never the table\'s "nicht …"', () => {
  const text = planItemLabel({ status: 'failed', code: 'timeout', outcomeOpen: true }, WORDS);
  assert.match(text, /^offen — Ausgang unbekannt/);
  assert.doesNotMatch(text, /nicht angelegt/);
});

test('a failed step that is NOT open keeps the table\'s word — nothing was written', () => {
  assert.equal(planItemLabel({ status: 'failed', code: 'forbidden', outcomeOpen: false }, WORDS), 'nicht angelegt (forbidden)');
  assert.equal(planItemLabel({ status: 'failed', code: 'exists' }, WORDS), 'nicht angelegt (exists)');
});

test('a code is explained where the tool has a note for it, else shown', () => {
  assert.equal(planItemLabel({ status: 'failed', code: 'exists' }, WORDS, { exists: 'gibt es schon' }), 'nicht angelegt (gibt es schon)');
  assert.equal(planItemLabel({ status: 'pending', code: 'not_checked' }, WORDS, {}), 'offen (not_checked)');
});

// Review 2026-11-14, finding 9: the shared function took two things from the tools it replaced.
test('the open-outcome sentence says WHERE to look, where the tool names a place', () => {
  const open = { status: 'failed', code: 'timeout', outcomeOpen: true } as const;
  assert.equal(planItemLabel(open, WORDS, {}, { where: 'in der Sammlung' }), 'offen — Ausgang unbekannt, bitte in der Sammlung prüfen (timeout)');
  assert.equal(planItemLabel(open, WORDS), 'offen — Ausgang unbekannt, bitte prüfen (timeout)');
});

test('a tool may set the note off with a dash — the tree\'s line form `status — Hinweis`', () => {
  assert.equal(planItemLabel({ status: 'failed', code: 'exists' }, WORDS, { exists: 'gibt es schon' }, { noteAfterDash: true }), 'nicht angelegt — gibt es schon');
  assert.equal(planItemLabel({ status: 'created' }, WORDS, {}, { noteAfterDash: true }), 'angelegt');
});

for (const [name, where] of [['add-many', 'in der Sammlung'], ['remove-many', 'in der Sammlung'], ['submit-many', 'am Datensatz']] as const) {
  test(`curation-${name}.ts keeps its pointer: an open outcome is checked ${where}`, () => {
    const source = readFileSync(new URL(`../src/tools/curation-${name}.ts`, import.meta.url), 'utf8');
    assert.match(source, new RegExp(`where: '${where}'`));
  });
}

test('curation-tree.ts words a step as `status — Hinweis`', () => {
  const source = readFileSync(new URL('../src/tools/curation-tree.ts', import.meta.url), 'utf8');
  assert.match(source, /noteAfterDash: true/);
});

// The guard: a plan tool that words a state itself is where the rule goes missing again.
const PLAN_TOOLS = ['add-many', 'delete-empty', 'fulltexts', 'remove-many', 'submit-many', 'tree', 'update-many'];

for (const name of PLAN_TOOLS) {
  test(`curation-${name}.ts words its steps through planItemLabel`, () => {
    const source = readFileSync(new URL(`../src/tools/curation-${name}.ts`, import.meta.url), 'utf8');
    assert.match(source, /planItemLabel\(/, 'the shared function is used');
    assert.doesNotMatch(source, /STATUS_LABEL\[/, 'and no table is indexed by hand');
    assert.doesNotMatch(source, /s\.outcomeOpen/, 'nor the open rule written out again');
  });
}
