import { test } from 'node:test';
import assert from 'node:assert/strict';

import { initialBrowseState, browseReducer } from '../src/apps/widgets/browse/state.js';

function coll(id: string): any {
  return {
    nodeId: id, title: id, description: '', disciplines: [], educationalContexts: [],
    learningResourceTypes: [], url: '', contentUrl: '', previewUrl: '', previewIsIcon: true,
    license: '', publisher: '', nodeType: 'collection', topicPageUrl: '',
  };
}

test('init seeds roots + label and clears any drill-down state', () => {
  const dirty = { ...initialBrowseState(), expanded: ['x'], loadingId: 'x', childrenById: { x: [] } };
  const s = browseReducer(dirty, { type: 'init', roots: [coll('a'), coll('b')], rootLabel: 'Fachportale' });
  assert.deepEqual(s.roots.map(r => r.nodeId), ['a', 'b']);
  assert.equal(s.rootLabel, 'Fachportale');
  assert.deepEqual(s.expanded, []);
  assert.equal(s.loadingId, null);
  assert.deepEqual(s.childrenById, {});
});

test('expanding an unloaded node marks it expanded AND loading (main.ts then fetches)', () => {
  const s = browseReducer(initialBrowseState(), { type: 'expand', nodeId: 'a' });
  assert.deepEqual(s.expanded, ['a']);
  assert.equal(s.loadingId, 'a');
});

test('loaded stores children, clears loading, keeps the node expanded', () => {
  let s = browseReducer(initialBrowseState(), { type: 'expand', nodeId: 'a' });
  s = browseReducer(s, { type: 'loaded', nodeId: 'a', children: [coll('a1'), coll('a2')] });
  assert.deepEqual(s.childrenById['a']?.map(c => c.nodeId), ['a1', 'a2']);
  assert.equal(s.loadingId, null);
  assert.ok(s.expanded.includes('a'));
});

test('re-expanding an already-loaded node does not trigger another load', () => {
  let s = browseReducer(initialBrowseState(), { type: 'expand', nodeId: 'a' });
  s = browseReducer(s, { type: 'loaded', nodeId: 'a', children: [coll('a1')] });
  s = browseReducer(s, { type: 'collapse', nodeId: 'a' });
  s = browseReducer(s, { type: 'expand', nodeId: 'a' });
  assert.ok(s.expanded.includes('a'));
  assert.equal(s.loadingId, null, 'children already cached → no reload');
});

test('collapse removes the node from the open path', () => {
  let s = browseReducer(initialBrowseState(), { type: 'expand', nodeId: 'a' });
  s = browseReducer(s, { type: 'collapse', nodeId: 'a' });
  assert.deepEqual(s.expanded, []);
});

test('error on a load clears the spinner and collapses the node so it can be retried', () => {
  let s = browseReducer(initialBrowseState(), { type: 'expand', nodeId: 'a' });
  s = browseReducer(s, { type: 'error', nodeId: 'a' });
  assert.equal(s.loadingId, null);
  assert.ok(!s.expanded.includes('a'));
});
