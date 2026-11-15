/**
 * text-bm25.test.ts – the ranking rule, against known-answer corpora.
 *
 * Kept away from any Markdown fixture on purpose: what BM25 gets wrong is
 * arithmetic (a common word outweighing a rare one, a one-line table row
 * outranking the paragraph that explains it), and that is only visible when the
 * corpus is small enough to reason about by hand.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rankBm25 } from '../src/text-bm25.js';

/** `n` filler tokens that contain none of the query terms used below. */
const filler = (n: number) => Array.from({ length: n }, () => 'füllwort').join(' ');

test('rankBm25: an empty query ranks nothing and claims no terms', () => {
  const r = rankBm25(['Licht und Schatten', 'Brechung am Prisma'], '   ');
  assert.deepEqual(r.hits, []);
  assert.deepEqual(r.unmatched, []);
});

test('rankBm25: a term nobody carries is reported as unmatched, not silently dropped', () => {
  // The measured case (Optik, staging 2026-08-18): "Lehrplan Thüringen
  // Regelschule" scores through `lehrplan` alone, and the answer fills up with
  // Rheinland-Pfalz. Without this list the caller cannot tell that two thirds
  // of the question went unanswered.
  const r = rankBm25(['Der Lehrplan von Sachsen', 'Lehrplan Rheinland-Pfalz'], 'Lehrplan Thüringen Regelschule');
  assert.deepEqual(r.unmatched, ['thüringen', 'regelschule']);
  assert.equal(r.hits.length, 2, 'the documents that do carry a term still rank');
});

test('rankBm25: one hit of a rare term beats three hits of a term everybody has', () => {
  const docs = [
    `photon ${filler(30)}`,
    `licht licht licht ${filler(28)}`,
    `licht ${filler(30)}`,
    `licht ${filler(30)}`,
    `licht ${filler(30)}`,
    `licht ${filler(30)}`,
  ];
  const r = rankBm25(docs, 'photon licht');
  assert.equal(r.hits[0]?.index, 0,
    'IDF is the whole point: a word in five of six documents separates nothing');
  assert.ok(r.hits[0]!.score > (r.hits[1]?.score ?? 0) * 2, 'and it is not a close call');
});

test('rankBm25: of two documents with the same hit, the shorter one ranks higher', () => {
  const r = rankBm25([`brechung ${filler(60)}`, `brechung ${filler(2)}`], 'Brechung');
  assert.equal(r.hits[0]?.index, 1, 'length normalisation (b = 0.75)');
});

test('rankBm25: a query word is found inside a German compound', () => {
  // The reason the term frequency counts through `termMatches` rather than
  // token equality — the same measured rule `node-match.ts` exists for.
  const r = rankBm25(['Die Lichtbrechung am Prisma', 'Ein Text über Vögel'], 'Brechung');
  assert.equal(r.hits.length, 1);
  assert.equal(r.hits[0]?.index, 0);
});

test('rankBm25: a stopword is no term — it is neither scored nor reported missing', () => {
  // German stopwords sit INSIDE ordinary words ("Stu-die-n"), so counting them
  // would score every document. Measured live 2026-08-03: one article turned 0
  // matches into 43.
  //
  // The document deliberately does NOT contain "die": were it a term, it would
  // have to show up as unmatched. An empty list is therefore proof it was
  // dropped, not merely proof it was found.
  const r = rankBm25(['Brechung am Prisma'], 'die Brechung');
  assert.deepEqual(r.unmatched, []);
  assert.equal(r.hits.length, 1);
});

test('rankBm25: equal scores keep the document order', () => {
  const r = rankBm25([`brechung ${filler(5)}`, `brechung ${filler(5)}`], 'Brechung');
  assert.equal(r.hits[0]?.score, r.hits[1]?.score);
  assert.deepEqual(r.hits.map(h => h.index), [0, 1], 'a stable order beats an arbitrary one');
});

test('rankBm25: documents with no term at all do not appear', () => {
  const r = rankBm25(['Brechung', 'Nichts davon', 'Brechung erneut'], 'Brechung');
  assert.deepEqual(r.hits.map(h => h.index).sort(), [0, 2]);
});

// ── One tokenizer for both sides (review 2026-08-18, finding 1) ─────────────

test('rankBm25: a hyphenated query word matches the text that contains it', () => {
  // The query side used to split on whitespace alone while the documents were
  // split on letters and digits, so "rheinland-pfalz" could match no token at
  // all — and came back as NOT FOUND over a text that names it on every page.
  const docs = ['Der Lehrplan Rheinland-Pfalz nennt die Wellenoptik in Stufe 11.', 'Sachsen regelt das anders.'];
  const r = rankBm25(docs, 'Lehrplan Rheinland-Pfalz');
  assert.deepEqual(r.unmatched, [], 'nothing in this query is missing from that text');
  assert.equal(r.hits[0]?.index, 0);
});

test('rankBm25: a question mark does not swallow the word it follows', () => {
  // The common shape for a chat tool: the last word of a natural question.
  const r = rankBm25(['Die Wellenoptik erklaert Interferenz.'], 'Was sagt der Text zur Wellenoptik?');
  assert.ok(!r.unmatched.includes('wellenoptik'), `"?" no longer hides it: ${JSON.stringify(r.unmatched)}`);
  assert.equal(r.hits.length, 1);

  // What IS reported is every other word of the sentence that the document
  // genuinely lacks. That stays: the tool asks for a search text, not a
  // sentence, and deciding which of a caller's words "mattered" would be
  // guessing — while the list as it stands is exactly true.
  assert.deepEqual(r.unmatched, ['was', 'sagt', 'text']);
});

test('rankBm25: a slash separates two words, it does not hide both', () => {
  const r = rankBm25(['Physik und Chemie im Verbund'], 'Physik/Chemie');
  assert.deepEqual(r.unmatched, []);
});

test('rankBm25: a word repeated in the query counts once', () => {
  // Otherwise the score doubles for saying the same thing twice, and the
  // disclosure reads "Nicht gefunden: xyzzy, xyzzy".
  const docs = ['Der Lehrplan nennt die Wellenoptik.', 'Sachsen regelt das anders.'];
  const once = rankBm25(docs, 'Lehrplan Xyzzy');
  const twice = rankBm25(docs, 'Lehrplan Lehrplan Xyzzy Xyzzy');
  assert.deepEqual(twice.unmatched, ['xyzzy']);
  assert.equal(twice.hits[0]?.score, once.hits[0]?.score, 'and the ranking is unchanged');
});
