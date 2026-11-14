/**
 * docs-tools-script.test.ts – the helpers behind `npm run docs:tools`.
 *
 * The script is the source the hand-kept tool tables are copied from, so a
 * summary cut in the wrong place, or a pipe that splits a table cell, lands in
 * six documents.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { firstSentence, toolRow } from '../scripts/docs-tools.js';

test('firstSentence stops at the first sentence end, not at an abbreviation or a number', () => {
  assert.equal(firstSentence('Sucht Inhalte. Zweiter Satz.'), 'Sucht Inhalte.');
  assert.equal(firstSentence('Sucht z.B.Inhalte in OAuth 2.1 Clients. Mehr.'), 'Sucht z.B.Inhalte in OAuth 2.1 Clients.');
  assert.equal(firstSentence('Wirklich? Ja.'), 'Wirklich?');
});

test('firstSentence flattens whitespace and survives a missing description', () => {
  assert.equal(firstSentence('Eine\n  Zeile\tmehr. Rest'), 'Eine Zeile mehr.');
  assert.equal(firstSentence(undefined), '');
  assert.equal(firstSentence('kein Punkt am Ende'), 'kein Punkt am Ende');
});

test('firstSentence cuts an endless sentence at a word and says so', () => {
  const out = firstSentence(`${'wort '.repeat(100)}ende.`);
  assert.ok(out.length <= 222, `too long: ${out.length}`);
  assert.match(out, /wort …$/);
});

test('toolRow escapes a pipe — it would end the table cell', () => {
  assert.equal(toolRow('x_tool', 'A | B. C'), '| `x_tool` | A \\| B. |');
});
