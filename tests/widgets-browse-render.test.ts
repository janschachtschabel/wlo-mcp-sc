import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderBrowse } from '../src/apps/widgets/browse/render.js';
import { initialBrowseState } from '../src/apps/widgets/browse/state.js';

function coll(id: string, title = id): any {
  return {
    nodeId: id, title, description: '', disciplines: [], educationalContexts: [],
    learningResourceTypes: [], url: '', contentUrl: '', previewUrl: '', previewIsIcon: true,
    license: '', publisher: '', nodeType: 'collection', topicPageUrl: '',
  };
}

test('renderBrowse shows the label and a collapsed disclosure toggle per root collection', () => {
  const state = { ...initialBrowseState(), rootLabel: 'Fachportale', roots: [coll('a', 'Mathematik'), coll('b', 'Biologie')] };
  const html = renderBrowse(state, 'de');
  assert.match(html, /Fachportale/);
  assert.match(html, /data-node-id="a"/);
  assert.match(html, /data-node-id="b"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /Mathematik/);
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

test('renderBrowse shows a loading indicator while a node is fetching', () => {
  const state = { ...initialBrowseState(), roots: [coll('a')], expanded: ['a'], loadingId: 'a' };
  assert.match(renderBrowse(state, 'de'), /Wird geladen/);
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
