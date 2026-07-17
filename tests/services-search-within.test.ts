import { test } from 'node:test';
import assert from 'node:assert/strict';

import { searchWithinCollection } from '../src/services/search.js';
import { resolveVocab } from '../src/vocabs.js';
import { installFetchMock, makeNode } from './fetchMock.js';

interface Body { criteria: { property: string; values: string[] }[] }

function parseCriteria(init?: RequestInit): Body['criteria'] {
  const body = JSON.parse(String(init?.body ?? '{}')) as Body;
  return body.criteria ?? [];
}

test('searchWithinCollection: scopes the ngsearch to the collection and applies vocab filters', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/ngsearch')) {
      return { json: { nodes: [makeNode('a', 'Video A'), makeNode('b', 'Video B')], pagination: { total: 2, from: 0, count: 2 } } };
    }
    return { json: {} };
  });
  try {
    const res = await searchWithinCollection({
      nodeId: 'coll-99',
      query: 'zellteilung',
      discipline: 'Biologie',
      maxResults: 5,
    });

    assert.equal(res.nodeId, 'coll-99');
    assert.deepEqual(res.results.map(r => r.title), ['Video A', 'Video B']);
    assert.equal(res.pagination.total, 2);

    const call = mock.calls.find(c => c.url.includes('/ngsearch'));
    assert.ok(call);
    const criteria = parseCriteria(call.init);
    // Scope criterion → the collection subtree.
    const scope = criteria.find(c => c.property === 'virtual:primaryparent_nodeid');
    assert.deepEqual(scope?.values, ['coll-99']);
    // Free-text query criterion.
    assert.ok(criteria.some(c => c.property === 'ngsearchword' && c.values.includes('zellteilung')));
    // Resolved discipline filter (Biologie → taxonid URI).
    assert.ok(criteria.some(c => c.property === 'ccm:taxonid'));
    assert.equal(res.unresolved.length, 0);
  } finally {
    mock.restore();
  }
});

test('searchWithinCollection: reports unresolved vocab filters', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/ngsearch')) return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
    return { json: {} };
  });
  try {
    const res = await searchWithinCollection({ nodeId: 'c1', query: '', discipline: 'Nichtfach123' });
    assert.equal(res.results.length, 0);
    assert.ok(res.unresolved.some(u => u.field === 'discipline' && u.value === 'Nichtfach123'));
  } finally {
    mock.restore();
  }
});

test('searchWithinCollection: falls back to /children for reference collections (audit H-A)', async () => {
  // Curated WLO collections hold *references*; the primaryparent-scoped search
  // returns nothing for them. The fallback must enumerate the actual children
  // and apply the free-text query locally.
  const mock = installFetchMock((url) => {
    if (url.includes('/ngsearch')) {
      return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
    }
    if (url.includes('/children')) {
      return { json: { nodes: [
        makeNode('m1', 'Zellteilung Video'),
        makeNode('m2', 'Photosynthese Text'),
      ], pagination: { total: 2, from: 0, count: 2 } } };
    }
    return { json: {} };
  });
  try {
    const res = await searchWithinCollection({ nodeId: 'coll-ref', query: 'zellteilung', maxResults: 5 });
    assert.deepEqual(res.results.map(r => r.title), ['Zellteilung Video']);
    assert.equal(res.pagination.total, 1);
    assert.ok(mock.calls.some(c => c.url.includes('/children')), 'children fallback was used');
  } finally {
    mock.restore();
  }
});

test('searchWithinCollection: fallback applies resolved vocab filters locally (audit H-A)', async () => {
  const bioUri = resolveVocab('Biologie', 'discipline');
  assert.ok(bioUri, 'test precondition: Biologie resolves');
  const mock = installFetchMock((url) => {
    if (url.includes('/ngsearch')) {
      return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
    }
    if (url.includes('/children')) {
      return { json: { nodes: [
        makeNode('m1', 'Zellteilung Video', { 'ccm:taxonid': [bioUri!] }),
        makeNode('m2', 'Zellteilung Arbeitsblatt'),
      ], pagination: { total: 2, from: 0, count: 2 } } };
    }
    return { json: {} };
  });
  try {
    const res = await searchWithinCollection({ nodeId: 'coll-ref', query: 'zellteilung', discipline: 'Biologie' });
    assert.deepEqual(res.results.map(r => r.nodeId), ['m1']);
  } finally {
    mock.restore();
  }
});

test('searchWithinCollection: no children fallback when the scoped search returns hits', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/ngsearch')) {
      return { json: { nodes: [makeNode('a', 'Video A')], pagination: { total: 1, from: 0, count: 1 } } };
    }
    return { json: {} };
  });
  try {
    const res = await searchWithinCollection({ nodeId: 'coll-1', query: 'video' });
    assert.equal(res.results.length, 1);
    assert.ok(!mock.calls.some(c => c.url.includes('/children')), 'no children call for a working search');
  } finally {
    mock.restore();
  }
});

test('searchWithinCollection: forwards skipCount as the backend offset', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/ngsearch')) return { json: { nodes: [], pagination: { total: 0, from: 8, count: 0 } } };
    return { json: {} };
  });
  try {
    await searchWithinCollection({ nodeId: 'c1', query: 'x', skipCount: 8 });
    const call = mock.calls.find(c => c.url.includes('/ngsearch'));
    assert.ok(call?.url.includes('skipCount=8'));
  } finally {
    mock.restore();
  }
});
