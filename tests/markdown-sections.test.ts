/**
 * markdown-sections.test.ts – what counts as a section heading, and where a
 * section ends.
 *
 * The offsets are the whole point: the registry assigns a `::: ki-skill` block
 * to a context by comparing the block's offset against these ranges. An `end`
 * that is off by one line files a skill under the wrong context, and nothing
 * about the resulting catalogue looks wrong.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseSections } from '../src/services/markdown-sections.js';

test('three H2 in a row yield three sections whose ranges tile the document', () => {
  const md = '# Titel\n\nVorwort.\n\n## Eins\n\nA\n\n## Zwei\n\nB\n\n## Drei\n\nC\n';
  const s = parseSections(md);

  assert.deepEqual(s.map(x => x.title), ['Titel', 'Eins', 'Zwei', 'Drei']);
  assert.deepEqual(s.map(x => x.level), [1, 2, 2, 2]);

  for (const sec of s) {
    assert.equal(md.slice(sec.headingStart, sec.headingStart + 1), '#',
      `headingStart of "${sec.title}" must point at the '#'`);
    assert.ok(sec.bodyStart > sec.headingStart && sec.end >= sec.bodyStart);
  }

  // "Eins" ends where "Zwei" begins — same level, so the section closes.
  assert.equal(s[1]!.end, s[2]!.headingStart);
  assert.equal(s[3]!.end, md.length, 'the last section runs to the end of the document');
  assert.equal(md.slice(s[1]!.bodyStart, s[1]!.end).trim(), 'A');
});

test('an H2 section contains its H3 — it ends at the next H2, not at the first H3', () => {
  const md = '## Planung\n\nVorspann.\n\n### Woche\n\nX\n\n### Halbjahr\n\nY\n\n## Material\n\nZ\n';
  const s = parseSections(md);

  assert.deepEqual(s.map(x => x.title), ['Planung', 'Woche', 'Halbjahr', 'Material']);
  const [planung, woche, halbjahr, material] = s;

  assert.equal(planung!.end, material!.headingStart, 'a lower level does not close a section');
  assert.ok(woche!.headingStart > planung!.bodyStart && woche!.end <= planung!.end,
    'the H3 lies inside its H2');
  assert.equal(woche!.end, halbjahr!.headingStart, 'an H3 closes at the next H3');
  assert.equal(halbjahr!.end, material!.headingStart, 'and the last H3 closes at the next H2');
});

test('a heading inside a fenced code block is not a heading', () => {
  // A registry document is editorial prose and may well show the format it
  // documents. A fenced example must not become a context.
  const md = '## Echt\n\n```\n## Beispiel\n```\n\n## Auch echt\n';
  assert.deepEqual(parseSections(md).map(x => x.title), ['Echt', 'Auch echt']);
});

test('a tilde fence hides headings too, and a different fence char does not close it', () => {
  const md = '## Echt\n\n~~~markdown\n## Nicht\n```\n## Immer noch nicht\n~~~\n\n## Wieder echt\n';
  assert.deepEqual(parseSections(md).map(x => x.title), ['Echt', 'Wieder echt']);
});

test('an unclosed fence swallows the rest of the document', () => {
  // Deliberate: guessing where the author meant to close it would invent
  // structure. A malformed document yields fewer contexts, never wrong ones.
  const md = '## Echt\n\n```\n## Nicht\n\n## Auch nicht\n';
  assert.deepEqual(parseSections(md).map(x => x.title), ['Echt']);
});

test('setext headings are ignored', () => {
  // Not in use in the WLO editor, and `---` under a line is indistinguishable
  // from a thematic break at a glance — a rule that surprises a curator is
  // worse than one that ignores a form nobody writes.
  const md = 'Titel\n=====\n\nText\n\nUnterTitel\n-----\n\n## Echt\n';
  assert.deepEqual(parseSections(md).map(x => x.title), ['Echt']);
});

test('the ATX rules are followed: space required, at most three of indent, at most six hashes', () => {
  assert.deepEqual(parseSections('#Kein Leerzeichen\n').map(x => x.title), []);
  assert.deepEqual(parseSections('   ## Drei Leerzeichen\n').map(x => x.title), ['Drei Leerzeichen']);
  assert.deepEqual(parseSections('    ## Vier Leerzeichen\n').map(x => x.title), [],
    'four spaces make it an indented code block');
  assert.deepEqual(parseSections('####### Sieben\n').map(x => x.title), []);
  assert.deepEqual(parseSections('###### Sechs\n').map(x => x.level), [6]);
});

test('a closing hash sequence is not part of the title', () => {
  // `## Material ##` is valid Markdown. Carrying the hashes into the title would
  // make the context unaddressable by the name a curator sees.
  assert.deepEqual(parseSections('## Material ##\n').map(x => x.title), ['Material']);
  assert.deepEqual(parseSections('## C# lernen\n').map(x => x.title), ['C# lernen'],
    'a hash inside the title survives — only a trailing run preceded by space closes');
});

test('CRLF line endings leave no carriage return in the title', () => {
  const md = '## Eins\r\n\r\nA\r\n\r\n## Zwei\r\n';
  const s = parseSections(md);
  assert.deepEqual(s.map(x => x.title), ['Eins', 'Zwei']);
  assert.equal(s[0]!.end, s[1]!.headingStart);
});

test('an empty heading is reported with an empty title rather than dropped', () => {
  // The parser stays faithful; whether an unnameable context is usable is the
  // registry's decision, not the parser's.
  assert.deepEqual(parseSections('##\n\nText\n').map(x => x.title), ['']);
  assert.deepEqual(parseSections('##   \n').map(x => x.title), ['']);
});

test('a document with no headings, and an empty document, yield nothing', () => {
  assert.deepEqual(parseSections(''), []);
  assert.deepEqual(parseSections('Nur Text.\n\nUnd noch einer.\n'), []);
});

test('a heading on the last line without a trailing newline still has a range', () => {
  const md = '## Ende';
  const [sec] = parseSections(md);
  assert.equal(sec!.title, 'Ende');
  assert.equal(sec!.bodyStart, md.length);
  assert.equal(sec!.end, md.length);
});

test('the title is trimmed but its inner spacing is left alone', () => {
  assert.deepEqual(parseSections('##    Viel   Luft   \n').map(x => x.title), ['Viel   Luft']);
});
