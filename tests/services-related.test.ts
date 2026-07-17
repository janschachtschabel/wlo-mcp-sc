import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getRelatedContent } from '../src/services/related.js';
import { installFetchMock, makeNode } from './fetchMock.js';

test('getRelatedContent: an unreadable parent collection must not fail the whole tool', async () => {
  // Live-found 2026-07-17: the siblings lookup hit `403 Forbidden` on a real
  // node, getCollectionContents threw, and the ENTIRE tool failed — discarding
  // the related results it had already fetched. The optional enrichment must
  // degrade, like the wiki/collections legs of searchAll.
  const mock = installFetchMock((url) => {
    if (url.includes('/metadata')) {
      // taxonid is what the related search relates ON — without it there is
      // nothing to search for and the assertion would test nothing.
      return { json: { node: makeNode('seed', 'Seed', {
        'ccm:taxonid': ['http://w3id.org/openeduhub/vocabs/discipline/080'],
        'virtual:primaryparent_nodeid': ['parent-forbidden'],
      }) } };
    }
    if (url.includes('/ngsearch')) {
      return { json: { nodes: [makeNode('r1', 'Verwandt 1')], pagination: { total: 1, from: 0, count: 1 } } };
    }
    if (url.includes('/children')) return { status: 403, json: { error: 'Forbidden' } };
    return { json: {} };
  });
  try {
    const res = await getRelatedContent({ nodeId: 'seed', includeSiblings: true });
    assert.ok(res, 'the tool must still return a result');
    assert.deepEqual(res.results.map(r => r.title), ['Verwandt 1'], 'related results must survive');
    assert.deepEqual(res.siblings, [], 'siblings degrade to empty instead of throwing');
  } finally {
    mock.restore();
  }
});

const BIO = 'http://w3id.org/openeduhub/vocabs/discipline/080';
const SEK1 = 'http://w3id.org/openeduhub/vocabs/educationalContext/sekundarstufe_1';

interface Body { criteria: { property: string; values: string[] }[] }
function parseCriteria(init?: RequestInit): Body['criteria'] {
  return (JSON.parse(String(init?.body ?? '{}')) as Body).criteria ?? [];
}

function installSeedMock(extraProps: Record<string, string[]> = {}) {
  return installFetchMock((url) => {
    if (url.includes('/metadata')) {
      return { json: { node: makeNode('seed', 'Seed-Material', {
        'ccm:taxonid': [BIO],
        'ccm:educationalcontext': [SEK1],
        ...extraProps,
      }) } };
    }
    if (url.includes('/ngsearch')) {
      // Backend returns the seed itself plus two neighbours.
      return { json: { nodes: [
        makeNode('seed', 'Seed-Material'),
        makeNode('r1', 'Verwandt 1'),
        makeNode('r2', 'Verwandt 2'),
      ], pagination: { total: 3, from: 0, count: 3 } } };
    }
    if (url.includes('/children')) {
      return { json: { nodes: [
        makeNode('seed', 'Seed-Material'),
        makeNode('s1', 'Nachbar 1'),
      ], pagination: { total: 2, from: 0, count: 2 } } };
    }
    return { json: {} };
  });
}

test('getRelatedContent: filters by the seed vocab and excludes the seed itself', async () => {
  const mock = installSeedMock();
  try {
    const res = await getRelatedContent({ nodeId: 'seed', maxResults: 5 });
    assert.ok(res);
    assert.equal(res.seedNodeId, 'seed');
    assert.equal(res.seedTitle, 'Seed-Material');
    // Seed excluded; neighbours kept.
    assert.deepEqual(res.results.map(r => r.nodeId), ['r1', 'r2']);

    const call = mock.calls.find(c => c.url.includes('/ngsearch'));
    const criteria = parseCriteria(call?.init);
    assert.ok(criteria.some(c => c.property === 'ccm:taxonid' && c.values.includes(BIO)));
    assert.ok(criteria.some(c => c.property === 'ccm:educationalcontext' && c.values.includes(SEK1)));
  } finally {
    mock.restore();
  }
});

test('getRelatedContent: returns null when the seed node is not found', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/metadata')) return { status: 404, json: {} };
    return { json: {} };
  });
  try {
    assert.equal(await getRelatedContent({ nodeId: 'missing' }), null);
  } finally {
    mock.restore();
  }
});

test('getRelatedContent: no vocab on the seed → empty results, no search fired', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/metadata')) return { json: { node: makeNode('bare', 'Ohne Vokabular') } };
    return { json: {} };
  });
  try {
    const res = await getRelatedContent({ nodeId: 'bare' });
    assert.ok(res);
    assert.deepEqual(res.results, []);
    assert.ok(!mock.calls.some(c => c.url.includes('/ngsearch')));
  } finally {
    mock.restore();
  }
});

test('getRelatedContent: includeSiblings pulls the primary-parent contents, minus self', async () => {
  const mock = installSeedMock({ 'virtual:primaryparent_nodeid': ['coll-1'] });
  try {
    const res = await getRelatedContent({ nodeId: 'seed', includeSiblings: true });
    assert.ok(res);
    assert.deepEqual(res.siblings?.map(s => s.nodeId), ['s1']);
    const call = mock.calls.find(c => c.url.includes('/children'));
    assert.ok(call?.url.includes('coll-1'));
  } finally {
    mock.restore();
  }
});
