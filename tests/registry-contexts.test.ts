/**
 * registry-contexts.test.ts – resolving the name a caller typed.
 *
 * A model guesses a context name BEFORE it knows the names — that is the normal
 * case, not the exception. So every rule here answers the same question: what
 * does a caller get when the guess is off? Never nothing, never an error, and
 * never a guess of our own.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { layoutContexts, resolveContext, type RegistryContext } from '../src/services/registry-contexts.js';

const ctx = (path: string, level: 2 | 3 = 2): RegistryContext => ({
  title: path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path,
  level,
  path,
  skills: [],
  // Resolution never reads the range; it is here because the type requires it,
  // and a fixture that lies about the shape would hide the next field just as
  // well as it hides this one.
  range: { start: 0, end: 0 },
});

const PLANUNG = ctx('Planung');
const MATERIAL = ctx('Material');
const WOCHE = ctx('Planung/Wochenplanung', 3);
const ALL = [PLANUNG, WOCHE, MATERIAL];

test('no name, an empty name, and "all" all mean the whole catalogue', () => {
  for (const wanted of [undefined, '', '   ', 'all', 'ALL', ' All ']) {
    assert.equal(resolveContext(ALL, wanted).kind, 'all', `for ${JSON.stringify(wanted)}`);
  }
});

test('a name over a registry without contexts is its own outcome, not "all"', () => {
  // There is nothing to miss, so the name is not `unknown` — that would blame
  // the caller for a document with no outline. But it is not `all` either: the
  // caller DID ask for something, and folding the two together left every
  // caller to re-derive the difference. Two of them did, and they wrote
  // different conditions — `get_skill_registry` excused the reserved word
  // `all`, `subjectRegistryText` did not, so `skillContext: "all"` on a flat
  // registry answered that "all" had failed. Found in review 2026-08-18.
  const r = resolveContext([], 'Planung');
  assert.equal(r.kind, 'no_contexts');
  assert.equal(r.kind === 'no_contexts' && r.asked, 'Planung', 'the name comes back for the sentence');
});

test('the reserved word and the empty ask still mean "all", outline or not', () => {
  // `all` is the documented way to ask for everything, so it is never a miss —
  // this is the case whose duplication caused the divergence above.
  for (const wanted of [undefined, '', '  ', 'all', 'ALL', ' All ']) {
    assert.equal(resolveContext([], wanted).kind, 'all', `for ${JSON.stringify(wanted)}`);
  }
});

test('matching ignores case, surrounding space and repeated space', () => {
  for (const wanted of ['Material', 'material', '  MATERIAL  ', 'Material'.toUpperCase()]) {
    const r = resolveContext(ALL, wanted);
    assert.equal(r.kind, 'found', `for ${JSON.stringify(wanted)}`);
    assert.equal(r.kind === 'found' && r.context.path, 'Material');
  }
  const spaced = resolveContext([ctx('Vorgabe & Planung')], 'vorgabe   &   planung');
  assert.equal(spaced.kind, 'found', 'inner runs of space are collapsed');
});

test('a sub-context answers to its qualified path and to its bare title', () => {
  const byPath = resolveContext(ALL, 'Planung/Wochenplanung');
  assert.equal(byPath.kind === 'found' && byPath.context.path, 'Planung/Wochenplanung');

  const byTitle = resolveContext(ALL, 'Wochenplanung');
  assert.equal(byTitle.kind === 'found' && byTitle.context.path, 'Planung/Wochenplanung',
    'a bare title resolves as long as it is unique');
});

test('a found context names its parent and its children', () => {
  const parentHit = resolveContext(ALL, 'Planung');
  assert.equal(parentHit.kind, 'found');
  if (parentHit.kind === 'found') {
    assert.equal(parentHit.parent, undefined);
    assert.deepEqual(parentHit.children.map(c => c.path), ['Planung/Wochenplanung'],
      'the children are the next calls a caller can make');
  }

  const childHit = resolveContext(ALL, 'Planung/Wochenplanung');
  assert.equal(childHit.kind, 'found');
  if (childHit.kind === 'found') {
    assert.equal(childHit.parent?.path, 'Planung',
      'the parent comes along because its instruction applies here too');
    assert.deepEqual(childHit.children, []);
  }
});

test('the same title under two parents is ambiguous, and both paths are named', () => {
  const contexts = [ctx('Planung'), ctx('Planung/Woche', 3), ctx('Material'), ctx('Material/Woche', 3)];
  const r = resolveContext(contexts, 'Woche');

  assert.equal(r.kind, 'ambiguous', 'picking one of two would be a guess');
  assert.deepEqual(r.kind === 'ambiguous' ? r.paths : [], ['Planung/Woche', 'Material/Woche'],
    'the qualified paths are what makes the retry possible');
});

test('an exact path wins over a title that matches several times', () => {
  // "Material" is both a context of its own and the title of a sub-context
  // elsewhere. Someone typing "Material" means the one that IS "Material".
  const contexts = [ctx('Material'), ctx('Planung'), ctx('Planung/Material', 3)];
  const r = resolveContext(contexts, 'Material');

  assert.equal(r.kind, 'found');
  assert.equal(r.kind === 'found' && r.context.path, 'Material');
});

test('an unknown name yields every existing name, not an error', () => {
  const r = resolveContext(ALL, 'Klassenfahrt');

  assert.equal(r.kind, 'unknown');
  assert.deepEqual(r.kind === 'unknown' ? r.available : [],
    ['Planung', 'Planung/Wochenplanung', 'Material'],
    'the list is what a caller learns the right name from');
});

test('a block that is not a skill still ends the instruction', () => {
  // `layoutContexts` is handed the ki-skill blocks only, because `paths` must
  // line up with the catalogue entries. The instruction bound is a different
  // question: a `::: wlo-material` block is prose-ending too, and without it the
  // fence lines and the material URL land verbatim in the editors' instruction —
  // burning its 900-character budget on a link (measured 2026-08-18).
  const md = [
    '## Planung',
    '',
    'Die Anweisung der Redaktion.',
    '',
    '::: wlo-material',
    '[Ein Arbeitsblatt](https://repo.example/x)',
    ':::',
    '',
    '::: ki-skill',
    '[Stunde planen](https://repo.example/y)',
    ':::',
  ].join('\n');
  const skillBlock = { offset: md.indexOf('::: ki-skill'), nodeId: 'skill-1' };
  const materialOffset = md.indexOf('::: wlo-material');

  const layout = layoutContexts(md, [skillBlock], [materialOffset, skillBlock.offset]);

  assert.equal(layout.contexts[0]!.instruction, 'Die Anweisung der Redaktion.');
  assert.deepEqual(layout.contexts[0]!.skills, ['skill-1'], 'and the material is still not a skill');
});

test('without explicit boundaries the blocks themselves bound the instruction', () => {
  const md = ['## Planung', '', 'Anweisung.', '', '::: ki-skill', '[S](https://x/y)', ':::'].join('\n');
  const layout = layoutContexts(md, [{ offset: md.indexOf(':::'), nodeId: 's-1' }]);
  assert.equal(layout.contexts[0]!.instruction, 'Anweisung.');
});
