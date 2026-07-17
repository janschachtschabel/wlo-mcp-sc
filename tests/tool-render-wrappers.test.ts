/**
 * tool-render-wrappers.test.ts – Markdown rendering of the thin tool wrappers
 * whose SERVICES are tested but whose render layer was not (audit test-gap):
 * get_related_content (the `_Basis:` line + siblings section), the
 * get_node_breadcrumb ' › ' join + empty-path message, and
 * get_collection_stats' sampled-breakdown hint.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock, makeNode, toolText } from './fetchMock.js';

const BIO = 'http://w3id.org/openeduhub/vocabs/discipline/080';
const SEK1 = 'http://w3id.org/openeduhub/vocabs/educationalContext/sekundarstufe_1';

test('get_related_content (markdown): renders the Basis line and the siblings section', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/metadata')) {
      return { json: { node: makeNode('seed', 'Seed-Material', {
        'ccm:taxonid': [BIO],
        'ccm:educationalcontext': [SEK1],
        // The siblings lookup needs the seed's primary parent collection.
        'virtual:primaryparent_nodeid': ['parent-1'],
      }) } };
    }
    if (url.includes('/ngsearch')) {
      return { json: { nodes: [makeNode('r1', 'Verwandt 1')], pagination: { total: 1, from: 0, count: 1 } } };
    }
    if (url.includes('parent-1/children')) {
      return { json: { nodes: [makeNode('seed', 'Seed-Material'), makeNode('s1', 'Nachbar 1')], pagination: { total: 2, from: 0, count: 2 } } };
    }
    return { json: {} };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'get_related_content',
      arguments: { nodeId: 'seed', includeSiblings: true },
    });
    const md = toolText(result);
    assert.match(md, /# Verwandte Inhalte zu „Seed-Material"/);
    assert.match(md, /_Basis: .*Bildungsstufe/, 'Basis line carries the seed profile');
    assert.match(md, /Verwandt 1/);
    assert.match(md, /## Aus derselben Sammlung \(1\)/, 'seed excluded from its own siblings');
    assert.match(md, /Nachbar 1/);
  } finally { await client.close(); mock.restore(); }
});

test('get_node_breadcrumb (markdown): joins the path with › and reports an empty path', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/coll-leaf/parents')) {
      // edu-sharing returns the chain self-first: [self, parent, root].
      return { json: { nodes: [
        makeNode('coll-leaf', 'Optik'),
        makeNode('coll-mid', 'Physik'),
        makeNode('coll-root', 'WLO'),
      ] } };
    }
    if (url.includes('/file-1/parents')) return { json: { nodes: [] } };
    return { json: {} };
  });
  const client = await connectedClient();
  try {
    const path = await client.callTool({ name: 'get_node_breadcrumb', arguments: { nodeId: 'coll-leaf' } });
    assert.equal(toolText(path), 'WLO › Physik › Optik');

    const empty = await client.callTool({ name: 'get_node_breadcrumb', arguments: { nodeId: 'file-1' } });
    assert.match(toolText(empty), /Kein Pfad für file-1 verfügbar/);
  } finally { await client.close(); mock.restore(); }
});

test('get_collection_stats (markdown): flags a sampled breakdown when the collection is larger', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/metadata')) return { json: { node: makeNode('coll-1', 'Biologie-Sammlung') } };
    if (url.includes('/children')) {
      if (url.includes('filter=folders')) return { json: { nodes: [], pagination: { total: 2, from: 0, count: 0 } } };
      // 2 sampled files, but 500 in total → the sampled hint must appear.
      return { json: { nodes: [
        makeNode('f1', 'f1', { 'ccm:oeh_lrt_aggregated_DISPLAYNAME': ['Video'] }),
        makeNode('f2', 'f2', { 'ccm:oeh_lrt_aggregated_DISPLAYNAME': ['Video'] }),
      ], pagination: { total: 500, from: 0, count: 2 } } };
    }
    return { json: {} };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'get_collection_stats', arguments: { nodeId: 'coll-1' } });
    const md = toolText(result);
    assert.match(md, /Biologie-Sammlung/);
    assert.match(md, /Aufschlüsselung aus 2 von 500 Inhalten/, 'sampling disclosed in the output');
    assert.match(md, /Video/);
  } finally { await client.close(); mock.restore(); }
});
