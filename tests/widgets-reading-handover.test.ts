/**
 * widgets-reading-handover.test.ts – Compendium material goes to the model, not
 * onto the screen.
 *
 * User decision 2026-08-21: `get_compendium_text` answers with editorial prose
 * cut into paragraph chunks — with `query` the BM25 passages, without it the
 * per-section capped text. Both are INPUT for the model: read straight off the
 * screen they are disjointed fragments, and the reader is supposed to see what
 * the model made of them, not the raw material.
 *
 * The widget therefore renders a handover line instead of the text. What the
 * MODEL receives is deliberately untouched — the `content` block and
 * `structuredContent.text` still carry everything, because the whole point is
 * that the model has the full material to work from.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderReading } from '../src/apps/widgets/reading/render.js';

const handover = (over: Record<string, unknown> = {}) => ({
  nodeId: 'n1',
  title: 'Optik',
  text: '### Lehrplan › Thüringen\n\nDie Regelschule sieht in Klasse 8 …',
  source: 'repository',
  sourceUrl: null,
  charCount: 65250,
  truncated: false,
  forModel: true,
  ...over,
});

test('a handover payload shows what was passed on, never the passages themselves', () => {
  const html = renderReading(handover({ passageCount: 12 }), 'de');

  assert.match(html, /12/, 'how many passages went over');
  assert.match(html, /Optik/, 'and from which collection');
  assert.doesNotMatch(html, /Regelschule/, 'the material itself must not be on screen');
  assert.doesNotMatch(html, /wlo-reading__body/, 'no rendered document body at all');
});

test('a whole-text handover says so without inventing a passage count', () => {
  const html = renderReading(handover(), 'de'); // no passageCount → not a query answer
  assert.doesNotMatch(html, /Regelschule/);
  // No passage wording at all: there were no passages, there was a whole text.
  assert.doesNotMatch(html, /Passage/i);
});

test('a shortened handover still says it was shortened', () => {
  // `WLO_COMPENDIUM_SECTION_MAX` caps each main section, and the biggest text on
  // staging goes 65 250 → 18 744 characters. The disclosure matters MORE here
  // than in the document view, not less: with the text out of sight the reader
  // cannot check for themselves, and the model's answer would otherwise read as
  // a statement about the whole compendium (review 2026-08-21).
  const cut = renderReading(handover({ passageCount: 4, truncated: true }), 'de');
  assert.match(cut, /ekürzt/, 'the truncation must survive the handover branch');

  const whole = renderReading(handover({ passageCount: 4 }), 'de');
  assert.doesNotMatch(whole, /ekürzt/, 'and must not appear when nothing was cut');
});

test('a handover names the search terms the text does not contain', () => {
  // The project's own measured rule: "Lehrplan Thüringen Regelschule" on the
  // Optik collection matches only via `lehrplan` and answers with plans from
  // Rheinland-Pfalz — without the line that reads as an answer to the question
  // that was asked. The document view carried it in its hint line, so the
  // handover must not lose it. Same reasoning as `truncated`, and the reason
  // this was wrongly waved through as "the model gets it anyway": the model
  // gets the truncation notice too.
  const html = renderReading(
    handover({ passageCount: 4, unmatchedTerms: ['thüringen', 'regelschule'] }),
    'de',
  );
  assert.match(html, /thüringen/i);
  assert.match(html, /regelschule/i);

  // Silent when every term matched — a disclosure that always fires says nothing.
  assert.doesNotMatch(renderReading(handover({ passageCount: 4 }), 'de'), /Nicht gefunden/i);
});

test('an unmatched term is escaped — it is the caller’s own text', () => {
  const html = renderReading(handover({ passageCount: 1, unmatchedTerms: ['<script>x</script>'] }), 'de');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('the handover line is localized', () => {
  const de = renderReading(handover({ passageCount: 3 }), 'de');
  const en = renderReading(handover({ passageCount: 3 }), 'en');
  assert.notEqual(de, en, 'German and English must differ');
  assert.match(en, /model/i);
});

test('the follow-up buttons survive — they are the point of the handover', () => {
  // The reader cannot read the material, so the one thing they must be able to
  // do is ask the model about it.
  const html = renderReading(handover({ passageCount: 5 }), 'de', { canFollowUp: true });
  assert.match(html, /wlo-reading__action/, 'summarize / simplify / exercises stay reachable');
  assert.match(html, /data-node-id="n1"/);
});

test('without the flag the reading view is unchanged', () => {
  // `get_wlo_content_text` shares this widget and this schema, and the user
  // deliberately left it alone — a document there still renders as a document.
  const html = renderReading(handover({ forModel: false }), 'de');
  assert.match(html, /wlo-reading__body/);
  assert.match(html, /Regelschule/);
});
