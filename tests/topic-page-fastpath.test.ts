import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getTopicPageContent } from '../src/topic-page-structure.js';
import { installFetchMock, makeNode } from './fetchMock.js';

/**
 * Resolving a Themenseite by collectionId alone is a two-hop chain: read the
 * collection, then read its page-config folder's children to find the variant.
 * But `findTopicPagesByQuery` already knows BOTH ids, so the query path was
 * paying for information it had — measured ~1.07 s for the content half of
 * `get_topic_page_content(query)` on a page whose lanes embed only two nodes.
 * With both ids the variant and the collection header are fetched in parallel.
 */

const rawConfig = JSON.stringify({
  structure: { swimlanes: [{ heading: 'Einführung', type: 'container', grid: [{ item: 'ai-text' }] }] },
});

function installMock() {
  return installFetchMock((url) => {
    if (url.includes('var-1/metadata')) {
      return { json: { node: makeNode('var-1', 'Variante Ideal', {
        'ccm:page_variant_config': [rawConfig],
        'cclom:title': ['Variante Ideal'],
      }) } };
    }
    if (url.includes('coll-1/metadata')) {
      return { json: { node: makeNode('coll-1', 'Optik', {
        'cclom:title': ['Optik'],
        'cclom:general_description': ['Alles zur Optik'],
        'ccm:page_config_ref': ['workspace://SpacesStore/cfg-1'],
      }) } };
    }
    if (url.includes('cfg-1/children')) {
      return { json: { nodes: [makeNode('var-1', 'Variante Ideal', {
        'ccm:page_variant_config': [rawConfig],
        'cclom:title': ['Variante Ideal'],
      })] } };
    }
    return { json: {} };
  });
}

test('getTopicPageContent: both ids → two metadata reads, no page-config walk', async () => {
  const mock = installMock();
  try {
    const { structure, reason } = await getTopicPageContent({ collectionId: 'coll-1', variantId: 'var-1' });
    assert.equal(reason, undefined);
    assert.equal(structure?.variantId, 'var-1');
    assert.equal(structure?.collectionId, 'coll-1');
    assert.equal(structure?.swimlanes.length, 1);
    // The header must survive: it is the reason the query path preferred the
    // slow collectionId route in the first place.
    assert.equal(structure?.collectionTitle, 'Optik');
    assert.equal(structure?.description, 'Alles zur Optik');

    assert.equal(mock.calls.filter(c => c.url.includes('/children')).length, 0, 'no config-folder walk');
    assert.equal(mock.calls.length, 2, 'exactly one read per node');
  } finally {
    mock.restore();
  }
});

test('getTopicPageContent: both ids, unknown variant → node_not_found', async () => {
  const mock = installFetchMock((url) =>
    url.includes('coll-1/metadata')
      ? { json: { node: makeNode('coll-1', 'Optik', { 'cclom:title': ['Optik'] }) } }
      : { json: {} });
  try {
    const { structure, reason } = await getTopicPageContent({ collectionId: 'coll-1', variantId: 'ghost' });
    assert.equal(structure, null);
    assert.equal(reason, 'node_not_found');
  } finally {
    mock.restore();
  }
});

test('getTopicPageContent: collectionId alone still walks the page config (unchanged)', async () => {
  const mock = installMock();
  try {
    const { structure } = await getTopicPageContent({ collectionId: 'coll-1' });
    assert.equal(structure?.variantId, 'var-1');
    assert.equal(structure?.collectionTitle, 'Optik');
    assert.equal(mock.calls.filter(c => c.url.includes('/children')).length, 1, 'the walk is still used without a variantId');
  } finally {
    mock.restore();
  }
});
