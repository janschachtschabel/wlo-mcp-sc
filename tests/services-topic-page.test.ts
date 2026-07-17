import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveTopicPageSwimlanes } from '../src/services/topic-page.js';
import type { TopicPageStructure } from '../src/topic-page-api.js';
import { installFetchMock, makeNode } from './fetchMock.js';

const DISC_URI = 'http://w3id.org/openeduhub/vocabs/discipline/380';

/**
 * Routes the three upstream shapes the swimlane resolver hits:
 *   - widget metadata (carries ccm:widget_config),
 *   - content-node metadata (collection-chips / media widgets),
 *   - ngsearch (content-teaser saved query).
 */
function installSwimlaneMock() {
  return installFetchMock((url) => {
    if (url.includes('/ngsearch')) {
      return { json: {
        nodes: [makeNode('m1', 'Material 1'), makeNode('m2', 'Material 2')],
        pagination: { total: 5, from: 0, count: 2 },
      } };
    }
    if (url.includes('/metadata')) {
      if (url.includes('w1')) return { json: { node: makeNode('w1', 'Widget 1', {
        'ccm:widget_config': [JSON.stringify({ propertyFilters: { 'ccm:taxonid': [DISC_URI] } })],
      }) } };
      if (url.includes('w2')) return { json: { node: makeNode('w2', 'Widget 2', {
        'ccm:widget_config': [JSON.stringify({ sortedNodeIds: ['c1', 'c2'] })],
      }) } };
      if (url.includes('c1')) return { json: { node: makeNode('c1', 'Collection Child 1') } };
      if (url.includes('c2')) return { json: { node: makeNode('c2', 'Collection Child 2') } };
    }
    return { json: {} };
  });
}

test('resolveTopicPageSwimlanes: resolves a content-teaser and a collection-chips swimlane', async () => {
  const mock = installSwimlaneMock();
  try {
    const struct: TopicPageStructure = {
      collectionId: 'coll-42',
      variantId: 'var-1',
      variantTitle: 'Optik',
      swimlanes: [
        { heading: 'Einführung', type: 'container', items: [{ widget: 'content-teaser', nodeId: 'w1' }] },
        { heading: 'Sammlungen', type: 'container', items: [{ widget: 'wlo-collection-chips', nodeId: 'w2' }] },
      ],
      referencedNodeIds: ['w1', 'w2'],
    };

    const payload = await resolveTopicPageSwimlanes(struct, 3);

    assert.equal(payload.variantId, 'var-1');
    assert.equal(payload.collectionId, 'coll-42');
    assert.equal(payload.variantTitle, 'Optik');
    assert.ok(payload.topicPageUrl?.includes('topic-pages?collectionId=coll-42'));
    assert.equal(payload.swimlaneCount, 2);
    assert.equal(payload.swimlanesTotal, 2);

    // Swimlane 1: content-teaser saved query → ngsearch results, hasMore (total 5 > 2 shown).
    assert.equal(payload.swimlanes[0].heading, 'Einführung');
    assert.deepEqual(payload.swimlanes[0].items.map(i => i.title), ['Material 1', 'Material 2']);
    assert.equal(payload.swimlanes[0].hasMore, true);

    // Swimlane 2: fixed collection list → node metadata, exactly 2 → no more.
    assert.deepEqual(payload.swimlanes[1].items.map(i => i.title), ['Collection Child 1', 'Collection Child 2']);
    assert.equal(payload.swimlanes[1].hasMore, false);
  } finally {
    mock.restore();
  }
});

test('resolveTopicPageSwimlanes: caps at MAX_LANES=12 and reports the true total', async () => {
  const mock = installFetchMock(() => ({ json: {} }));
  try {
    // 14 content-free swimlanes (widgets without a nodeId → nothing to resolve).
    const swimlanes = Array.from({ length: 14 }, (_, i) => ({
      heading: `Lane ${i}`, type: 'container', items: [{ widget: 'ai-text' }],
    }));
    const struct: TopicPageStructure = {
      variantId: 'v', variantTitle: '', swimlanes, referencedNodeIds: [],
    };

    const payload = await resolveTopicPageSwimlanes(struct, 3);

    assert.equal(payload.swimlaneCount, 12);   // capped
    assert.equal(payload.swimlanesTotal, 14);  // true total preserved
    assert.equal(payload.collectionId, null);
    assert.equal(payload.topicPageUrl, null);  // no collectionId → no jump link
    assert.ok(payload.swimlanes.every(sl => sl.items.length === 0 && sl.hasMore === false));
  } finally {
    mock.restore();
  }
});
