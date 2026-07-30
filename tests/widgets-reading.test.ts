import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { renderReading, readingFollowUpPrompt } from '../src/apps/widgets/reading/render.js';

/**
 * W5 renders a long text and — crucially — lets the reader carry it into the
 * conversation ("summarize this", "derive exercises"). Those buttons hand the
 * CONVERSATION a request; the widget never calls a tool itself, because ChatGPT
 * mirrors a widget-initiated result back as new toolOutput and re-mounts the
 * frame (live 2026-07-17, browse widget).
 */

const payload = (over: Record<string, unknown> = {}) => ({
  nodeId: 'n1',
  title: 'Prozentrechnung — Arbeitsblatt',
  text: '# Grundlagen\n\nDer **Grundwert** ist die Bezugsgröße.\n\n- Prozentwert\n- Prozentsatz',
  source: 'repository',
  sourceUrl: null,
  charCount: 120,
  truncated: false,
  ...over,
});

test('renders the title as the single h1 and the text below it', () => {
  const html = renderReading(payload(), 'de');
  assert.equal((html.match(/<h1/g) ?? []).length, 1, 'exactly one h1 on the page');
  assert.match(html, /Prozentrechnung — Arbeitsblatt/);
  assert.match(html, /<strong>Grundwert<\/strong>/, 'the text is rendered, not shown raw');
  assert.match(html, /<h2[^>]*>Grundlagen<\/h2>/, 'document headings start below the title');
});

test('states where the text came from', () => {
  assert.match(renderReading(payload(), 'de'), /WLO-Repository/);
  const ext = renderReading(payload({ source: 'external-extraction', sourceUrl: 'https://tutory.de/d/1' }), 'de');
  assert.match(ext, /verlinkte Seite/);
  assert.match(ext, /href="https:\/\/tutory\.de\/d\/1"/, 'and links it');
});

test('a truncated text says so', () => {
  assert.match(renderReading(payload({ truncated: true }), 'de'), /Gekürzt/);
});

test('follow-up buttons are rendered only when the host supports them', () => {
  const without = renderReading(payload(), 'de');
  assert.doesNotMatch(without, /wlo-reading__action\b/, 'no dead controls');
  const withFollow = renderReading(payload(), 'de', { canFollowUp: true });
  assert.match(withFollow, /Zusammenfassen/);
  assert.match(withFollow, /Einfacher formulieren/);
  assert.match(withFollow, /Aufgaben ableiten/);
});

test('every follow-up button is a real button carrying the node id', () => {
  const html = renderReading(payload(), 'de', { canFollowUp: true });
  const buttons = [...html.matchAll(/<button[^>]*class="wlo-reading__action"[^>]*>/g)].map(m => m[0]);
  assert.equal(buttons.length, 3);
  for (const b of buttons) {
    assert.match(b, /type="button"/, 'never a div-as-button — keyboard operable by default');
    assert.match(b, /data-node-id="n1"/, 'downstream tools resolve the material by id');
    assert.match(b, /data-action="\w+"/);
  }
});

test('the follow-up message names the material AND its node id', () => {
  // A title-only prompt made the model ask for a Node ID (live 2026-07-17).
  const prompt = readingFollowUpPrompt('exercises', 'Prozentrechnung', 'abc-123', 'de');
  assert.match(prompt, /aufgaben/i);
  assert.match(prompt, /Prozentrechnung/);
  assert.match(prompt, /nodeId: abc-123/);
});

test('each empty cause gets its own wording, never a blank panel', () => {
  const cases: Array<[string, RegExp]> = [
    ['access_denied', /nicht öffentlich/i],
    ['extraction_failed', /verlinkten Seite/i],
    ['node_not_found', /nicht gefunden/i],
    ['no_text_no_url', /kein Text/i],
  ];
  for (const [reason, expected] of cases) {
    const html = renderReading(payload({ text: '', reason }), 'de');
    assert.match(html, expected, `reason ${reason}`);
    assert.doesNotMatch(html, /wlo-reading__action\b/, 'no actions without content');
  }
});

test('escapes hostile title and text (XSS guard)', () => {
  const html = renderReading(payload({
    title: '<script>alert(1)</script>',
    text: '<img src=x onerror=alert(1)>',
  }), 'de');
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<img/i);
});

test('is localizable — no German hardcoded into the renderer', () => {
  const html = renderReading(payload({ truncated: true }), 'en', { canFollowUp: true });
  assert.match(html, /WLO repository/);
  assert.match(html, /Shortened/);
  assert.match(html, /Summarize/);
});

test('every button gets a visible focus ring by default (WCAG 2.4.7)', () => {
  // The shared stylesheet declared focus rings PER CLASS, so a newly added
  // button shipped without one until someone remembered. A general rule makes
  // the accessible state the default instead of an act of memory.
  const base = readFileSync('src/apps/widgets/shared/base.css', 'utf8');
  assert.match(base, /button:focus-visible/, 'a general button focus rule exists');
  const reading = readFileSync('src/apps/widgets/reading/styles.css', 'utf8');
  assert.match(reading, /min-height:\s*3[0-9]px/, 'action targets are at least 24px tall (SC 2.5.8)');
  assert.match(reading, /flex-wrap:\s*wrap/, 'the action row reflows instead of overflowing at 320px');
});

test('the widget entry does not call tools from inside the iframe', () => {
  // Source-level pin: an in-widget tools/call is what broke the browse tree.
  const src = readFileSync('src/apps/widgets/reading/main.ts', 'utf8');
  assert.doesNotMatch(src, /callTool/, 'no widget-initiated tool call');
  assert.match(src, /sendFollowUp/, 'actions go through the conversation');
});
