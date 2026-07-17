import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { initialBrowseState, browseReducer, isOwnDrilldownEcho } from '../src/apps/widgets/browse/state.js';

function coll(id: string): any {
  return {
    nodeId: id, title: id, description: '', disciplines: [], educationalContexts: [],
    learningResourceTypes: [], url: '', contentUrl: '', previewUrl: '', previewIsIcon: true,
    license: '', publisher: '', nodeType: 'collection', topicPageUrl: '',
  };
}

// Live failure 2026-07-17 (ChatGPT): expanding a node made the tree flicker
// and reset. ChatGPT mirrors a WIDGET-initiated callTool result back as a new
// toolOutput (openai:set_globals); onUpdate treated it as a fresh seed and
// re-initialised the whole tree. An output whose `parent` is a nodeId THIS
// widget loaded itself is an echo — keep the tree state, never re-init.
test('isOwnDrilldownEcho: recognises the echo of an own drill-down, not a fresh seed', () => {
  const self = new Set(['node-1']);
  assert.equal(isOwnDrilldownEcho({ parent: 'node-1', results: [] }, self), true, 'own drill-down echo');
  assert.equal(isOwnDrilldownEcho({ parent: 'other', results: [] }, self), false, 'foreign drill-down = new seed');
  assert.equal(isOwnDrilldownEcho({ results: [] }, self), false, 'portal list (no parent) = new seed');
  assert.equal(isOwnDrilldownEcho(undefined, self), false, 'no output');
});

test('browse main.ts wires the echo guard (source pin — main.ts is DOM glue, verified live)', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/apps/widgets/browse/main.ts', import.meta.url)), 'utf8');
  assert.match(src, /isOwnDrilldownEcho/, 'onUpdate must consult the echo guard before re-initialising');
});

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
