/**
 * tools-topic-pages.test.ts – the search_wlo_topic_pages contract.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock, makeNode } from './fetchMock.js';
import { nodeListSchema } from '../src/apps/outputSchemas.js';

test('search_wlo_topic_pages returns a nodeList the results widget can render', async () => {
  // The last hit-list tool without structuredContent. One tile per theme page
  // (not per variant): nodeId = the owning collectionId, nodeType=collection
  // and topicPageUrl set, so the tile lands in the collection band with the
  // "Themenseite öffnen" action. Variants stay in the text output.
  const mock = installFetchMock((url) => {
    if (url.includes('/children')) {
      return {
        json: {
          nodes: [makeNode('coll-1', 'Optik', {
            'ccm:page_config_ref': ['workspace://SpacesStore/cfg-1'],
          })],
        },
      };
    }
    return { json: { nodes: [] } };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'search_wlo_topic_pages', arguments: { query: 'Optik' } });
    const sc = nodeListSchema.parse(result.structuredContent);
    for (const r of sc.results) {
      assert.equal(r.nodeType, 'collection', 'a theme page renders as a collection tile');
      assert.ok(r.topicPageUrl, 'carrying its topic-page URL, which drives the button');
      assert.ok(r.nodeId, 'and the collection id the follow-up needs');
    }
  } finally { await client.close(); mock.restore(); }
});
