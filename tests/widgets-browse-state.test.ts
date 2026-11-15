import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { initialBrowseState, browseReducer } from '../src/apps/widgets/browse/state.js';

// REDESIGN 2026-07-17 (user-approved): the browse widget no longer fetches
// inside the iframe. ChatGPT mirrors widget-initiated callTool results back as
// new toolOutput (and may re-mount the frame), which reset the tree on every
// drill-down — live-observed as flicker + vanishing expansions across several
// fixes. The tree now renders PRE-EXPANDED from the data the tool call already
// delivered (nested `children`, e.g. browse_collection_tree depth=2); toggles
// are purely local; deeper levels go through a follow-up-message button that
// lets the MODEL run the next tool call and render a fresh card.

function coll(id: string, title = id, children?: any[]): any {
  return {
    nodeId: id, title, description: '', disciplines: [], educationalContexts: [],
    learningResourceTypes: [], url: '', contentUrl: '', previewUrl: '', previewIsIcon: true,
    license: '', publisher: '', nodeType: 'collection', topicPageUrl: '',
    ...(children ? { children } : {}),
  };
}

test('init seeds nested children into the flat map and PRE-EXPANDS every parent', () => {
  const roots = [coll('a', 'Mathematik', [coll('a1', 'Algebra', [coll('a1x', 'Terme')]), coll('a2', 'Geometrie')])];
  const s = browseReducer(initialBrowseState(), { type: 'init', roots, rootLabel: 'Fachportale' });
  assert.equal(s.rootLabel, 'Fachportale');
  assert.deepEqual(s.childrenById['a']?.map(c => c.nodeId), ['a1', 'a2']);
  assert.deepEqual(s.childrenById['a1']?.map(c => c.nodeId), ['a1x']);
  assert.ok(s.expanded.includes('a') && s.expanded.includes('a1'), 'tree opens expanded by default');
});

test('init honours saved collapse choices (widget state) over the pre-expanded default', () => {
  const roots = [coll('a', 'Mathematik', [coll('a1', 'Algebra')]), coll('b', 'Physik', [coll('b1', 'Optik')])];
  const s = browseReducer(initialBrowseState(), { type: 'init', roots, savedExpanded: ['b'] });
  assert.deepEqual(s.expanded, ['b'], 'only the saved node stays open');
});

test('toggle collapses and re-expands locally — no fetch involved', () => {
  const roots = [coll('a', 'Mathematik', [coll('a1', 'Algebra')])];
  let s = browseReducer(initialBrowseState(), { type: 'init', roots });
  s = browseReducer(s, { type: 'toggle', nodeId: 'a' });
  assert.ok(!s.expanded.includes('a'));
  s = browseReducer(s, { type: 'toggle', nodeId: 'a' });
  assert.ok(s.expanded.includes('a'));
  assert.deepEqual(s.childrenById['a']?.map(c => c.nodeId), ['a1'], 'children stay cached throughout');
});

// Source pins — main.ts is DOM glue (excluded from tsc, verified live):
test('browse main.ts makes NO in-widget tool calls and wires the follow-up path', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/apps/widgets/browse/main.ts', import.meta.url)), 'utf8');
  assert.doesNotMatch(src, /callTool/, 'in-widget drill-down is the flicker root cause — it must not come back');
  assert.match(src, /sendFollowUp/, 'deeper levels go through the host follow-up message');
});
