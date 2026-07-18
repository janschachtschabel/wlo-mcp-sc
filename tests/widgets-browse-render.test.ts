import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderBrowse, askFollowUpPrompt } from '../src/apps/widgets/browse/render.js';
import { initialBrowseState } from '../src/apps/widgets/browse/state.js';

function coll(id: string, title = id): any {
  return {
    nodeId: id, title, description: '', disciplines: [], educationalContexts: [],
    learningResourceTypes: [], url: '', contentUrl: '', previewUrl: '', previewIsIcon: true,
    license: '', publisher: '', nodeType: 'collection', topicPageUrl: '',
  };
}

test('renderBrowse shows the label; only nodes WITH children get a disclosure toggle', () => {
  const state = {
    ...initialBrowseState(),
    rootLabel: 'Fachportale',
    roots: [coll('a', 'Mathematik'), coll('b', 'Biologie')],
    childrenById: { a: [coll('a1', 'Algebra')] },
  };
  const html = renderBrowse(state, 'de');
  assert.match(html, /Fachportale/);
  assert.match(html, /class="wlo-tree__toggle"[^>]*aria-expanded="false"[^>]*data-node-id="a"/, 'child-bearing node gets a collapsed toggle');
  assert.doesNotMatch(html, /wlo-tree__toggle"[^>]*data-node-id="b"/, 'childless node gets NO toggle (nothing local to expand)');
  assert.match(html, /Mathematik/);
  assert.match(html, /Biologie/);
});

test('renderBrowse renders loaded children under an expanded node with aria-expanded=true', () => {
  const state = {
    ...initialBrowseState(),
    roots: [coll('a', 'Mathematik')],
    expanded: ['a'],
    childrenById: { a: [coll('a1', 'Algebra')] },
  };
  const html = renderBrowse(state, 'de');
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /Algebra/);
  // The expanded toggle references its disclosure region (a11y: aria-controls).
  assert.match(html, /aria-controls="wlo-region-a"/);
  assert.match(html, /<div class="wlo-tree__children" id="wlo-region-a">/);
});

test('renderBrowse offers a follow-up button carrying BOTH id and title (id is what the tool needs)', () => {
  const state = { ...initialBrowseState(), roots: [coll('b-123', 'Biologie')] };
  const withFollowUp = renderBrowse(state, 'de', { canFollowUp: true });
  assert.match(withFollowUp, /wlo-tree__ask/, 'follow-up button rendered');
  assert.match(withFollowUp, /data-node-title="Biologie"/, 'button carries the title');
  assert.match(withFollowUp, /data-node-id="b-123"/, 'button carries the nodeId — the tool resolves by id, not title');
  // Without host support the button would be dead — it must not render.
  assert.doesNotMatch(renderBrowse(state, 'de'), /wlo-tree__ask/);
});

test('askFollowUpPrompt embeds the nodeId and names the tool so the model can act without asking for an id', () => {
  const p = askFollowUpPrompt('Biologie', 'b-123', 'de');
  assert.match(p, /Biologie/, 'human title for context');
  assert.match(p, /b-123/, 'the nodeId the tool needs (the bug: it was missing)');
  assert.match(p, /get_collection_contents/, 'names the tool that resolves the collection by nodeId');
  assert.match(askFollowUpPrompt('X', 'y', 'en'), /get_collection_contents/, 'EN variant too');
});

test('renderBrowse drops dangerous URL schemes in open and leaf links', () => {
  const openColl = { ...coll('a', 'Mathematik'), url: 'javascript:alert(1)' };
  const leaf = { ...coll('l', 'Blatt'), nodeType: 'content', url: 'javascript:alert(1)' };
  const state = { ...initialBrowseState(), roots: [openColl, leaf] };
  const html = renderBrowse(state, 'de');
  assert.doesNotMatch(html, /href="javascript:/i, 'no javascript: href anywhere');
  assert.doesNotMatch(html, /wlo-tree__open/, 'no open-link anchor for a dangerous URL');
  assert.match(html, />Blatt</, 'leaf title still rendered as text');
});

test('renderBrowse escapes node titles and renders an empty state with no roots', () => {
  const state = { ...initialBrowseState(), roots: [coll('a', '<script>x</script>')] };
  assert.match(renderBrowse(state, 'de'), /&lt;script&gt;/);
  assert.match(renderBrowse(initialBrowseState(), 'de'), /Keine Treffer gefunden/);
});
