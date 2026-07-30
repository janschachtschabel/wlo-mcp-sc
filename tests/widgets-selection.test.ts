import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { renderSearchResults } from '../src/apps/widgets/search-results/render.js';
import { selectionFollowUpPrompt } from '../src/apps/widgets/search-results/selection.js';
import { renderTile } from '../src/apps/widgets/shared/tile.js';

/**
 * Teachers want to pick several results and carry them into the conversation
 * ("make a lesson from these three"). The selection therefore has to hand the
 * model the nodeIds — a title-only prompt made it ask for an id (live
 * 2026-07-17, browse widget). Like every other widget action it goes through
 * the CONVERSATION: an in-widget tool call is mirrored back as new toolOutput
 * and re-mounts the frame.
 */

const node = (id: string, title: string) => ({
  nodeId: id, title, description: 'Beschreibung', keywords: [],
  disciplines: ['Mathematik'], educationalContexts: [], userRoles: [],
  learningResourceTypes: [], url: `https://example.org/${id}`, downloadUrl: '',
  contentUrl: '', previewUrl: '', previewIsIcon: true, mimeType: '', fileSize: 0,
  license: 'CC BY 4.0', publisher: 'Serlo', nodeType: 'content' as const, topicPageUrl: '',
});

const payload = {
  query: 'Bruchrechnung',
  content: { total: 2, count: 2, results: [node('a1', 'Erstes Material'), node('b2', 'Zweites Material')] },
  collections: { total: 0, count: 0, results: [] },
  topicPages: { total: 0, count: 0, results: [] },
};

test('a content tile offers a labelled selection checkbox when selection is on', () => {
  const html = renderTile(node('a1', 'Erstes Material'), { locale: 'de', selectable: true });
  assert.match(html, /type="checkbox"/, 'a native checkbox, not a div');
  assert.match(html, /data-node-id="a1"/);
  // A checkbox without a name is unusable with a screen reader.
  assert.ok(/aria-label="[^"]+"/.test(html) || /<label[^>]*>/.test(html), 'the checkbox is named');
});

test('no checkbox is rendered when the host cannot take a follow-up', () => {
  const html = renderTile(node('a1', 'Erstes Material'), { locale: 'de' });
  assert.doesNotMatch(html, /type="checkbox"/, 'no dead controls');
});

test('the action bar appears only once something is selected', () => {
  const none = renderSearchResults(payload, 'de', { canSelect: true, selectedIds: [] });
  assert.doesNotMatch(none, /wlo-selection\b/, 'nothing to act on, nothing shown');

  const some = renderSearchResults(payload, 'de', { canSelect: true, selectedIds: ['a1'] });
  assert.match(some, /wlo-selection\b/);
  assert.match(some, /1/, 'states how many are selected');
});

test('the action bar announces changes politely to screen readers', () => {
  const html = renderSearchResults(payload, 'de', { canSelect: true, selectedIds: ['a1', 'b2'] });
  assert.match(html, /aria-live="polite"/, 'a count that changes must be announced');
});

test('selected tiles are marked as checked', () => {
  const html = renderSearchResults(payload, 'de', { canSelect: true, selectedIds: ['b2'] });
  const b2 = /data-node-id="b2"[^>]*>/.exec(html)?.[0] ?? '';
  assert.match(html, /checked/, 'the checked state survives a repaint');
  assert.ok(b2.length > 0);
});

test('the follow-up message lists every selected material with its node id', () => {
  const prompt = selectionFollowUpPrompt(
    [{ nodeId: 'a1', title: 'Erstes Material' }, { nodeId: 'b2', title: 'Zweites Material' }],
    'de',
  );
  assert.match(prompt, /Erstes Material/);
  assert.match(prompt, /Zweites Material/);
  assert.match(prompt, /a1/);
  assert.match(prompt, /b2/);
  assert.match(prompt, /nodeId/i, 'the ids are labelled, not left as bare strings');
});

test('the follow-up message is empty for an empty selection', () => {
  assert.equal(selectionFollowUpPrompt([], 'de'), '');
});

test('a selection restored without its titles still names something usable', () => {
  // Widget state persists ids, not titles — after a host re-mount the titles
  // must be backfilled or, failing that, the id must stand in. Empty quotes
  // would tell the model nothing.
  const prompt = selectionFollowUpPrompt([{ nodeId: 'a1', title: '' }], 'de');
  assert.match(prompt, /a1/);
  assert.doesNotMatch(prompt, /„“|""/, 'never an empty pair of quotes');
});

test('main.ts backfills titles for a restored selection', () => {
  const src = readFileSync('src/apps/widgets/search-results/main.ts', 'utf8');
  assert.match(src, /data-node-title/, 'titles are read back from the rendered tiles');
});

test('selection never triggers a tool call from inside the iframe', () => {
  const src = readFileSync('src/apps/widgets/search-results/main.ts', 'utf8');
  assert.doesNotMatch(src, /callTool/, 'no widget-initiated tool call');
  assert.match(src, /sendFollowUp/, 'the selection goes through the conversation');
  assert.match(src, /setWidgetState/, 'and survives a re-mount');
});
