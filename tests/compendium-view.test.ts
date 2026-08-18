/**
 * compendium-view.test.ts – the outline, the per-section cap and the passage
 * selection, against documents shaped like the real ones.
 *
 * The fixture's shape is the finding: measured on staging 2026-08-18, 10 of 10
 * compendium texts carry EXACTLY ONE H1 (the document title) and put their
 * content sections in H2. A cap applied "per H1" would therefore cap the whole
 * document.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildCompendiumView } from '../src/services/compendium-view.js';

const para = (word: string, n = 12) => Array.from({ length: n }, () => word).join(' ');

/** One H1 title, an intro before the first H2, then H2 sections with an H3. */
const DOC = [
  '# Optik',
  '',
  'Kompendialer Text zum Themenbereich.',
  '',
  '## Strahlenoptik',
  '',
  para('Lichtstrahl'),
  '',
  '### Brechung',
  '',
  para('Lichtbrechung'),
  '',
  '## Lehrpläne',
  '',
  para('Lehrplan Sachsen'),
].join('\n');

test('the outline starts below the document title: one H1 is a title, not a section', () => {
  const view = buildCompendiumView(DOC, {});
  assert.deepEqual(view.outline, [
    { title: 'Strahlenoptik', depth: 0 },
    { title: 'Brechung', depth: 1 },
    { title: 'Lehrpläne', depth: 0 },
  ]);
});

test('several H1 make H1 the top level again', () => {
  const doc = ['# Eins', '', 'a', '', '# Zwei', '', 'b'].join('\n');
  assert.deepEqual(buildCompendiumView(doc, {}).outline, [
    { title: 'Eins', depth: 0 },
    { title: 'Zwei', depth: 0 },
  ]);
});

test('a text without headings has no outline and one section holding all of it', () => {
  const view = buildCompendiumView('Nur Fließtext, keine Überschrift.', {});
  assert.deepEqual(view.outline, []);
  assert.equal(view.sections.length, 1);
  assert.match(view.sections[0]!.text, /Nur Fließtext/);
});

test('the text before the first section is kept, not dropped as a preamble', () => {
  const view = buildCompendiumView(DOC, {});
  assert.match(view.sections[0]!.text, /Kompendialer Text zum Themenbereich/,
    'the intro is content — losing it silently is worse than any cap');
});

test('each top-level section is capped on its own, and the cut is disclosed', () => {
  const long = ['## Kurz', '', 'knapp', '', '## Lang', '', para('Wort', 400)].join('\n');
  const view = buildCompendiumView(long, { maxSectionChars: 300 });
  const [kurz, lang] = view.sections.filter(s => s.title);
  assert.equal(kurz!.truncated, false, 'a short section is untouched');
  assert.equal(lang!.truncated, true);
  assert.ok(lang!.text.length < 400, `capped, got ${lang!.text.length}`);
  assert.equal(view.truncated, true, 'and the view says so as a whole');
});

test('a section that fits is left exactly as written', () => {
  const view = buildCompendiumView(DOC, { maxSectionChars: 2000 });
  assert.equal(view.truncated, false);
  assert.match(view.sections.map(s => s.text).join('\n'), /Lehrplan Sachsen/);
});

test('a query returns the passages that answer it, each under its heading path', () => {
  const view = buildCompendiumView(DOC, { query: 'Lehrplan' });
  assert.ok(view.passages.length >= 1);
  assert.deepEqual(view.passages[0]!.path, ['Lehrpläne']);
  assert.match(view.passages[0]!.text, /Lehrplan Sachsen/);
});

test('a passage never crosses a heading', () => {
  // Otherwise a hit in one section drags the next section's opening into the
  // answer under the wrong path — the path would be a claim the text denies.
  const view = buildCompendiumView(DOC, { query: 'Lichtstrahl' });
  assert.ok(view.passages.length >= 1, 'there is something to check in the first place');
  for (const p of view.passages) {
    assert.ok(!p.text.includes('##'), `a heading leaked into a passage: ${p.text.slice(0, 60)}`);
  }
});

test('a sub-heading path names the whole chain from the top-level section down', () => {
  const view = buildCompendiumView(DOC, { query: 'Lichtbrechung' });
  assert.deepEqual(view.passages[0]!.path, ['Strahlenoptik', 'Brechung']);
});

test('short paragraphs are merged so a table row cannot outrank the prose', () => {
  // Measured: 329 of 972 real paragraphs are under 40 characters (table rows,
  // list items). BM25 normalises on length, so alone each would beat the
  // paragraph that explains it.
  const doc = ['## Tabelle', '', '| a | b |', '', '| c | d |', '', '| e | f |', '', para('Erklärung')].join('\n');
  const view = buildCompendiumView(doc, { query: 'Erklärung' });
  assert.ok(view.passages.length >= 1, 'there is something to check in the first place');
  assert.deepEqual(view.passages.filter(p => p.text.length < 40), [], 'no passage is a bare table row');
  assert.match(view.passages[0]!.text, /\| a \| b \|/, 'the rows travel WITH the prose that explains them');
});

test('query terms that occur nowhere in this text are reported', () => {
  const view = buildCompendiumView(DOC, { query: 'Lehrplan Thüringen Regelschule' });
  assert.deepEqual(view.unmatchedTerms, ['thüringen', 'regelschule']);
});

test('a query that matches nothing yields no passages — and is not an error', () => {
  const view = buildCompendiumView(DOC, { query: 'Quantenfeldtheorie' });
  assert.deepEqual(view.passages, []);
  assert.deepEqual(view.unmatchedTerms, ['quantenfeldtheorie']);
  assert.ok(view.outline.length, 'the outline still tells the caller what IS in there');
});

test('the two modes do not do each others work', () => {
  assert.deepEqual(buildCompendiumView(DOC, {}).passages, [], 'no query, no passage selection');
  assert.deepEqual(buildCompendiumView(DOC, { query: 'Lehrplan' }).sections, [],
    'a query answer is a selection — capping all sections as well would be wasted work');
});

test('charCount is the length of the whole text in both modes', () => {
  assert.equal(buildCompendiumView(DOC, {}).charCount, DOC.length);
  assert.equal(buildCompendiumView(DOC, { query: 'Lehrplan' }).charCount, DOC.length);
});

test('a query answer always declares itself partial', () => {
  // It is a selection by construction, whatever it selected. `truncated` is
  // what tells a caller that "not in the answer" does not mean "not in the text".
  assert.equal(buildCompendiumView(DOC, { query: 'Lehrplan' }).truncated, true);
});

test('at most maxPassages come back, best first', () => {
  const doc = ['## S', '', ...Array.from({ length: 30 }, (_, i) => `${para('Brechung')} Nummer ${i}\n`)].join('\n');
  const view = buildCompendiumView(doc, { query: 'Brechung', maxPassages: 3 });
  assert.equal(view.passages.length, 3);
});

test('a heading without a title is transparent, not a blank entry', () => {
  // `## ` on its own is legal Markdown. Left in, it renders as a bare "- " in
  // the outline — which reads as a missing entry — and as an empty "### " above
  // its passage. The section still owns its text; it just has no name to show,
  // so it inherits the path of whatever named section encloses it.
  const doc = ['## ', '', 'Zielwort ' + 'y'.repeat(60), '', '## Beta', '', 'b'].join('\n');
  const view = buildCompendiumView(doc, {});
  assert.deepEqual(view.outline, [{ title: 'Beta', depth: 0 }]);

  const hit = buildCompendiumView(doc, { query: 'Zielwort' });
  assert.equal(hit.passages.length, 1, 'the text under it is still findable');
  assert.deepEqual(hit.passages[0]!.path, [], 'and carries no empty path element');
});

test('an unnamed sub-heading leaves its parent in the path', () => {
  const doc = ['## Alpha', '', 'a'.repeat(40), '', '### ', '', 'Zielwort ' + 'y'.repeat(60)].join('\n');
  const hit = buildCompendiumView(doc, { query: 'Zielwort' });
  assert.deepEqual(hit.passages[0]!.path, ['Alpha']);
});
