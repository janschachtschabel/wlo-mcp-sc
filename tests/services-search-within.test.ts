/**
 * services-search-within.test.ts – searchWithinCollection.
 *
 * NOTE ON A REWRITE (2026-07-17): the earlier tests here mocked an `ngsearch`
 * scoped by `virtual:primaryparent_nodeid` as if it worked. It does not — the
 * live API rejects that criterion with **400 Bad Request** every time (probed
 * against production: `ngsearchword` alone → 1985 hits, `ccm:taxonid` → 910
 * hits, `virtual:primaryparent_nodeid` → 400). Those tests asserted a contract
 * the backend never offered and kept a permanently broken tool green, so they
 * were replaced rather than deleted quietly. The collection's own `/children`
 * listing is the only working scope, with query + vocab filters applied
 * locally.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { searchWithinCollection } from '../src/services/search.js';
import { installFetchMock, makeNode } from './fetchMock.js';

const BIO = 'http://w3id.org/openeduhub/vocabs/discipline/080';

/** The collection's file children, as `/children` returns them. */
function installChildren(nodes: ReturnType<typeof makeNode>[], total = nodes.length) {
  return installFetchMock((url) => {
    if (url.includes('/children')) {
      return { json: { nodes, pagination: { total, from: 0, count: nodes.length } } };
    }
    return { json: {} };
  });
}

test('searchWithinCollection: never sends the primaryparent criterion (live 400) — uses /children', async () => {
  const mock = installChildren([makeNode('m1', 'Zellteilung Video'), makeNode('m2', 'Photosynthese Text')]);
  try {
    const res = await searchWithinCollection({ nodeId: 'coll-1', query: 'zellteilung', maxResults: 5 });
    assert.deepEqual(res.results.map(r => r.title), ['Zellteilung Video']);
    assert.equal(res.pagination.total, 1);
    assert.ok(mock.calls.some(c => c.url.includes('/children')), '/children is the scope');
    assert.ok(!mock.calls.some(c => c.url.includes('/ngsearch')),
      'no ngsearch — the primaryparent criterion is rejected with 400 by the live API');
  } finally {
    mock.restore();
  }
});

test('searchWithinCollection: an empty query returns the collection contents', async () => {
  const mock = installChildren([makeNode('m1', 'A'), makeNode('m2', 'B')]);
  try {
    const res = await searchWithinCollection({ nodeId: 'coll-1', query: '' });
    assert.deepEqual(res.results.map(r => r.title), ['A', 'B']);
  } finally {
    mock.restore();
  }
});

test('searchWithinCollection: vocab filters are applied locally against the node metadata', async () => {
  const mock = installChildren([
    makeNode('bio', 'Zellteilung', { 'ccm:taxonid': [BIO] }),
    makeNode('other', 'Zellteilung im Film'), // matches the query, wrong subject
  ]);
  try {
    const res = await searchWithinCollection({ nodeId: 'coll-1', query: 'zellteilung', discipline: 'Biologie' });
    assert.deepEqual(res.results.map(r => r.nodeId), ['bio']);
    assert.equal(res.unresolved.length, 0);
  } finally {
    mock.restore();
  }
});

test('searchWithinCollection: reports unresolved vocab filters', async () => {
  const mock = installChildren([]);
  try {
    const res = await searchWithinCollection({ nodeId: 'c1', query: '', discipline: 'Nichtfach123' });
    assert.equal(res.results.length, 0);
    assert.ok(res.unresolved.some(u => u.field === 'discipline' && u.value === 'Nichtfach123'));
  } finally {
    mock.restore();
  }
});

test('searchWithinCollection: paginates locally over the filtered set', async () => {
  const mock = installChildren([makeNode('a', 'Bruch 1'), makeNode('b', 'Bruch 2'), makeNode('c', 'Bruch 3')]);
  try {
    const res = await searchWithinCollection({ nodeId: 'c1', query: 'bruch', maxResults: 2, skipCount: 1 });
    assert.deepEqual(res.results.map(r => r.nodeId), ['b', 'c']);
    assert.equal(res.pagination.total, 3, 'total = the whole filtered set, not the page');
    assert.equal(res.pagination.from, 1);
  } finally {
    mock.restore();
  }
});

test('searchWithinCollection: discloses when the collection is larger than the sampled window', async () => {
  // Only the first N children are fetched; a caller must be able to tell that
  // the answer is a sample rather than the whole collection (no silent caps).
  const mock = installChildren([makeNode('a', 'Bruch 1')], 500);
  try {
    const res = await searchWithinCollection({ nodeId: 'c1', query: 'bruch' });
    assert.equal(res.truncated, true, 'sampling is disclosed');
    assert.equal(res.collectionTotal, 500);
  } finally {
    mock.restore();
  }
});
