/**
 * collections-filters.test.ts – search_wlo_collections vocab filters
 * (deep-audit #4): the tool used to ADVERTISE discipline/educationalContext
 * filtering but no retrieval path applied it. The backend rejects extra
 * criteria on the collections query (400, live-verified 2026-07-17), so the
 * resolved criteria are applied LOCALLY against the node metadata that the
 * keyword projection / children listing does carry.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WLO_ROOT_COLLECTION_ID } from '../src/wlo-api.js';
import { connectedClient, installFetchMock, makeNode, toolText } from './fetchMock.js';

const BIO = 'http://w3id.org/openeduhub/vocabs/discipline/080';
const GS = 'http://w3id.org/openeduhub/vocabs/educationalContext/grundschule';

function resultsOf(result: unknown): Array<{ nodeId: string; title: string }> {
  const parts = (result as { content?: Array<{ text?: string }> }).content ?? [];
  return JSON.parse(parts[0]!.text as string).results;
}

test('search_wlo_collections: discipline filter excludes keyword hits without matching taxonid', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/collections')) {
      return { json: { nodes: [
        makeNode('bio-1', 'Wasser im Biologieunterricht', { 'ccm:taxonid': [BIO] }),
        makeNode('other-1', 'Wasser und Musik'), // no taxonid → must be excluded
      ] } };
    }
    return { json: {} };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_collections',
      arguments: { query: 'wasser', discipline: 'Biologie', outputFormat: 'json' },
    });
    const results = resultsOf(result);
    assert.deepEqual(results.map(r => r.nodeId), ['bio-1'], 'only the subject-matching collection may remain');
    const parsed = JSON.parse(((result as { content: Array<{ text: string }> }).content)[0].text);
    assert.equal(parsed.total, 1, 'total must reflect the filtered set');
  } finally {
    await client.close();
    mock.restore();
  }
});

test('search_wlo_collections: educationalContext filter applies to the browse (children) path', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('parent-1/children')) {
      return { json: { nodes: [
        makeNode('gs-1', 'Zahlenraum bis 100', { 'ccm:educationalcontext': [GS] }),
        makeNode('sek-1', 'Analysis', { 'ccm:educationalcontext': ['http://w3id.org/openeduhub/vocabs/educationalContext/sekundarstufe_2'] }),
      ], pagination: { total: 2, from: 0, count: 2 } } };
    }
    return { json: {} };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_collections',
      arguments: { parentNodeId: 'parent-1', educationalContext: 'Grundschule', outputFormat: 'json' },
    });
    assert.deepEqual(resultsOf(result).map(r => r.nodeId), ['gs-1']);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('search_wlo_collections: keyword hits emptied by the filter fall through to tree traversal', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/collections')) {
      // Direct hit matches the query but not the discipline → filtered out.
      return { json: { nodes: [makeNode('other-1', 'Wasser und Musik')] } };
    }
    if (url.includes(`${WLO_ROOT_COLLECTION_ID}/children`)) {
      return { json: { nodes: [makeNode('bio-portal', 'Wasser Biologie', { 'ccm:taxonid': [BIO] })], pagination: { total: 1, from: 0, count: 1 } } };
    }
    return { json: {} };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_collections',
      arguments: { query: 'wasser', discipline: 'Biologie', outputFormat: 'json' },
    });
    assert.deepEqual(resultsOf(result).map(r => r.nodeId), ['bio-portal']);
    assert.match(toolText(result as { content: Array<{ type: string; text?: string }> }), /collection_tree_traversal/);
  } finally {
    await client.close();
    mock.restore();
  }
});
