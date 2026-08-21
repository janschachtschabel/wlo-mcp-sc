/**
 * query-expand.test.ts – The framing words a teacher says must not delete the
 * result set.
 *
 * Measured live against staging on 2026-08-21, and the numbers are the whole
 * reason this variant exists — the repository ANDs every extra word, and the
 * request-framing nouns are absent from virtually every record:
 *
 *   "Französische Revolution"                        480 hits
 *   "Unterrichtsstunde Französische Revolution"        0 hits
 *   "Optik"                                          825 hits
 *   "Bildungsinhalte zur Optik"                        4 hits
 *   "Photosynthese"                                  211 hits
 *   "Erklärvideo Photosynthese"                        1 hit
 *
 * Inflection is NOT the cause ("Französischen Revolution" still answers 450):
 * one framing noun is enough. A model that receives 0–4 records reports a count
 * instead of recommending anything, which is exactly what was observed in
 * Claude — where no widget hides the thinness of the answer.
 *
 * The existing stopword list cannot catch this: it holds function words
 * (`der`, `zur`, `für`), and "Unterrichtsstunde" is a noun.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { expandQuery } from '../src/query-expand.js';

const labels = (q: string): string[] => expandQuery(q).map(v => v.label);
const topic = (q: string): string | undefined => labels(q).find(l => l.startsWith('topic:'));

test('a framing noun yields a topic variant carrying only the subject', () => {
  assert.equal(topic('Unterrichtsstunde zur Französischen Revolution'), 'topic:"Französischen Revolution"');
  assert.equal(topic('Erklärvideo Photosynthese'), 'topic:"Photosynthese"');
  assert.equal(topic('Arbeitsblatt zur Zellteilung'), 'topic:"Zellteilung"');
  assert.equal(topic('Material zum Klimawandel für Klasse 8'), 'topic:"Klimawandel"');
});

test('the request VERB is framing too, and it costs results when it survives', () => {
  // Measured: with `suche` left in, "Ich suche Bildungsinhalte zur Optik für
  // die Sekundarstufe I" narrows to a single record — worse than the framing
  // nouns alone achieved. The phrasing is our own: TOOLS.md offers exactly
  // "Ich suche Bildungsinhalte für eine Mathestunde zur Bruchrechnung" as the
  // trigger to type.
  assert.equal(topic('Ich suche Bildungsinhalte zur Optik für die Sekundarstufe I'), 'topic:"Optik"');
  assert.equal(topic('Zeig mir ein Video zur Eiszeit'), 'topic:"Eiszeit"');
});

test('no topic variant when nothing was stripped — it would only repeat `full`', () => {
  assert.equal(topic('Photosynthese'), undefined);
  assert.equal(topic('Französische Revolution'), undefined);
});

test('a query made only of framing words yields no topic variant', () => {
  // Nothing is left to search for, and an empty query variant would match
  // everything — a worse answer than the honest few hits.
  assert.equal(topic('Arbeitsblatt'), undefined);
  assert.equal(topic('Material für die Klasse'), undefined);
});

test('framing words match whole words only', () => {
  // "Klassenarbeit" is a subject, "Klasse" is framing. Substring matching would
  // strip the one word the user actually searched for.
  assert.equal(topic('Klassenarbeit Bruchrechnung'), undefined, 'nothing to strip here');
  assert.match(expandQuery('Klassenarbeit Bruchrechnung')[0]!.label, /Klassenarbeit/);
});

test('the topic variant survives the variant cap', () => {
  // It is worth nothing if it is trimmed away: with framing words present it is
  // usually the ONLY variant that returns anything at all.
  const all = labels('Unterrichtsstunde zur Französischen Revolution');
  assert.ok(all.some(l => l.startsWith('topic:')), `topic variant missing from ${all.join(' | ')}`);
});

test('the exact-phrase variants are kept — nothing is taken away', () => {
  // The topic variant ADDS coverage. A record that matches the full phrasing
  // must still rank first, which is what the higher `full`/`title` weight does.
  const variants = expandQuery('Erklärvideo Photosynthese');
  assert.equal(variants[0]!.label, 'full:"Erklärvideo Photosynthese"');
  assert.ok(variants.some(v => v.label.startsWith('title:')));
});

test('the topic variant takes the last slot from the synonym variant — knowingly', () => {
  // Pinned because it is the surprising part, and because the obvious "fix"
  // (raising MAX_VARIANTS) would cost every search another upstream call.
  // The dropped variant could not have worked: synonyms are expanded from the
  // WHOLE query, so it would have read `syn:"arbeitsblatt zu künstliche
  // intelligenz"` — still carrying the framing noun that empties the result.
  const withFraming = labels('Arbeitsblatt zu KI');
  assert.ok(withFraming.some(l => l.startsWith('topic:')));
  assert.ok(!withFraming.some(l => l.startsWith('syn:')), 'crowded out, and it was dead anyway');

  // Without framing there is nothing to crowd it out with, so KI still expands.
  assert.ok(labels('KI').some(l => l.startsWith('syn:')), 'the synonym path itself is intact');
});
