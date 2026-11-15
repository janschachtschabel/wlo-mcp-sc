/**
 * short-cache.test.ts – a minute of memory for reads that every request repeats
 * (audit 2026-11-12, P-4), and the two reads that use it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shortCache, clearShortCaches } from '../src/short-cache.js';
import { searchTopicPageCollectionsResult } from '../src/topic-page-api.js';
import { describeEntries } from '../src/services/skill-registry.js';
import { installFetchMock, makeNode, type MockResult } from './fetchMock.js';

test('an answer is kept for its time and no longer; the oldest goes when the bound is met', () => {
  const cache = shortCache<string>(2, 1000);
  cache.set('a', 'A', 0);
  assert.equal(cache.get('a', 999), 'A');
  assert.equal(cache.get('a', 1000), undefined, 'not one millisecond past its time');
  cache.set('a', 'A', 0); cache.set('b', 'B', 1); cache.set('c', 'C', 2);
  assert.deepEqual([cache.get('a', 3), cache.get('b', 3), cache.get('c', 3)], [undefined, 'B', 'C']);
  clearShortCaches();
  assert.equal(cache.get('c', 3), undefined);
});

test('the portal list is asked ONCE for several searches — and an unanswered listing is never kept', async () => {
  let down = true;
  const portal = { ...makeNode('p-1', 'Physik'), properties: { 'cclom:title': ['Physik'], 'ccm:page_config_ref': ['workspace://SpacesStore/cfg'] } };
  const mock = installFetchMock((url): MockResult => {
    if (!url.includes('/children')) return { json: {} };
    return down ? { status: 503, json: {} } : { json: { nodes: [portal], pagination: { total: 1, from: 0, count: 1 } } };
  });
  try {
    assert.equal((await searchTopicPageCollectionsResult('Physik')).reachable, false);
    down = false;
    const first = await searchTopicPageCollectionsResult('Physik');
    assert.deepEqual([first.reachable, first.nodes.length], [true, 1], 'the outage was not remembered');
    const before = mock.calls.length;
    await searchTopicPageCollectionsResult('Physik');
    await searchTopicPageCollectionsResult('Chemie');
    assert.equal(mock.calls.length, before, 'no further request for the same list');
  } finally { mock.restore(); }
});

test('a skill description is read once; a head that could not be read is asked again', async () => {
  let readable = false;
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/s-ok/')) return { json: { node: { ref: { id: 's-ok' }, properties: { 'cclom:general_description': ['Plant eine Stunde.'] } } } };
    if (url.includes('/s-flaky/')) {
      return readable
        ? { json: { node: { ref: { id: 's-flaky' }, properties: { 'cclom:general_description': ['Jetzt lesbar.'] } } } }
        : { status: 503, json: {} };
    }
    return { status: 404, json: {} };
  });
  try {
    const entries = [{ nodeId: 's-ok', title: 'Stunde planen' }, { nodeId: 's-flaky', title: 'Wackelig' }];
    const a = await describeEntries(entries);
    assert.deepEqual([a.described.map(e => e.nodeId), a.unreadable.map(e => e.nodeId)], [['s-ok'], ['s-flaky']]);
    readable = true;
    const before = mock.calls.length;
    const b = await describeEntries(entries);
    assert.deepEqual(b.described.map(e => e.description), ['Plant eine Stunde.', 'Jetzt lesbar.']);
    assert.equal(mock.calls.length - before, 1, 'only the head that had not answered was asked again');
  } finally { mock.restore(); }
});
