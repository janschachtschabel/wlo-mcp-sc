/**
 * apps-structured-content.test.ts – Task 3.2 contract: every migrated display
 * tool returns BOTH legacy text content (back-compat) AND a `structuredContent`
 * that validates against its advertised outputSchema. The SDK already throws on
 * a schema mismatch, so a green call plus these explicit assertions pin the
 * shape the model + widgets consume.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock, makeNode, toolText } from './fetchMock.js';
import {
  nodeListSchema,
  searchAllEnvelopeSchema,
  swimlanePayloadSchema,
  browseTreeSchema,
  subjectPortalListSchema,
} from '../src/apps/outputSchemas.js';

const oneNode = () => ({ json: { nodes: [makeNode('n1', 'Titel n1')], pagination: { total: 1, from: 0, count: 1 } } });

test('search_wlo_content returns text + nodeList structuredContent', async () => {
  const mock = installFetchMock(oneNode);
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'search_wlo_content', arguments: { query: 'mathe' } });
    assert.ok(toolText(result).length > 0, 'legacy text present');
    const sc = nodeListSchema.parse(result.structuredContent);
    assert.equal(sc.results[0]?.nodeId, 'n1');
  } finally { await client.close(); mock.restore(); }
});

test('search_wlo_all returns text + searchAllEnvelope structuredContent', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/collections')) return { json: { nodes: [] } };
    return oneNode();
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'search_wlo_all', arguments: { query: 'mathe', include: ['content'] } });
    assert.ok(toolText(result).length > 0, 'legacy text present');
    const env = searchAllEnvelopeSchema.parse(result.structuredContent);
    assert.equal(env.content.results[0]?.nodeId, 'n1');
  } finally { await client.close(); mock.restore(); }
});

test('search_wlo_collections returns text + nodeList structuredContent', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/collections')) return { json: { nodes: [makeNode('c1', 'Sammlung 1')] } };
    return { json: { nodes: [] } };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'search_wlo_collections', arguments: { query: 'klima' } });
    assert.ok(toolText(result).length > 0, 'legacy text present');
    const sc = nodeListSchema.parse(result.structuredContent);
    assert.ok(sc.results.some(r => r.nodeId === 'c1'));
  } finally { await client.close(); mock.restore(); }
});

test('get_subject_portals returns text + subjectPortalList structuredContent', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/children')) return { json: { nodes: [makeNode('p1', 'Mathematik')] } };
    return { json: { nodes: [] } };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'get_subject_portals', arguments: {} });
    assert.ok(toolText(result).length > 0, 'legacy text present');
    const sc = subjectPortalListSchema.parse(result.structuredContent);
    assert.ok(sc.results.some(r => r.nodeId === 'p1'));
  } finally { await client.close(); mock.restore(); }
});

test('browse_collection_tree returns text + browseTree structuredContent', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/children')) return { json: { nodes: [makeNode('s1', 'Unter-Sammlung')] } };
    return { json: { nodes: [] } };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'browse_collection_tree', arguments: { nodeId: 'root-1' } });
    assert.ok(toolText(result).length > 0, 'legacy text present');
    const tree = browseTreeSchema.parse(result.structuredContent);
    assert.equal(tree.parent, 'root-1');
    assert.ok(tree.results.some(r => r.nodeId === 's1'));
  } finally { await client.close(); mock.restore(); }
});

test('get_topic_page_content returns a valid (empty) swimlane payload when nothing is found', async () => {
  // No topic-page structure resolvable → the tool must STILL honour the
  // structuredContent contract with a valid empty payload (not an error).
  const mock = installFetchMock(() => ({ json: {} }));
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'get_topic_page_content', arguments: { variantId: 'v1' } });
    assert.ok(toolText(result).length > 0, 'legacy text present');
    const payload = swimlanePayloadSchema.parse(result.structuredContent);
    assert.equal(payload.variantId, 'v1');
    assert.deepEqual(payload.swimlanes, []);
  } finally { await client.close(); mock.restore(); }
});
