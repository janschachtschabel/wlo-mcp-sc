import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient } from './fetchMock.js';

const EXPECTED_TOOLS = [
  'search_wlo_collections',
  'search_wlo_content',
  'get_collection_contents',
  'get_node_details',
  'search_wlo_all',
  'lookup_wlo_vocabulary',
  'search_wlo_topic_pages',
  'get_subject_portals',
  'browse_collection_tree',
  'wlo_health_check',
  'get_nodes_details',
  'get_topic_page_content',
  'get_wikipedia_summary',
  'get_compendium_text',
  'search_wlo_within_collection',
  'search',
  'fetch',
  'lookup_wlo_publishers',
  'get_related_content',
  'get_node_breadcrumb',
  'get_collection_stats',
  'find_wlo_skills',
];

test('createMcpServer registers exactly the 22 expected tools', async () => {
  const client = await connectedClient();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(t => t.name).sort(), [...EXPECTED_TOOLS].sort());
  await client.close();
});

test('get_topic_page_content without ids returns a validation error (no network)', async () => {
  const client = await connectedClient();
  const result = await client.callTool({ name: 'get_topic_page_content', arguments: {} });
  assert.equal(result.isError, true);
  const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
  assert.match(text, /collectionId oder variantId/);
  await client.close();
});

test('search_wlo_content rejects an over-long excludeNodeIds array (no network)', async () => {
  const client = await connectedClient();
  const tooMany = Array.from({ length: 201 }, (_, i) => `id-${i}`);
  // Invalid params must be rejected by schema validation BEFORE the handler
  // runs, so no upstream request is made. The SDK may surface this as a
  // thrown error or an isError result — accept either.
  let rejected = false;
  try {
    const result = await client.callTool({
      name: 'search_wlo_content',
      arguments: { query: 'mathe', excludeNodeIds: tooMany },
    });
    rejected = result.isError === true;
  } catch {
    rejected = true;
  }
  assert.equal(rejected, true, 'expected 201 excludeNodeIds to be rejected');
  await client.close();
});

test('every tool advertises a non-empty description and readOnlyHint (Apps-SDK metadata)', async () => {
  const client = await connectedClient();
  const { tools } = await client.listTools();
  for (const t of tools) {
    assert.ok((t.description ?? '').trim().length > 0, `${t.name} has a description`);
    assert.equal(t.annotations?.readOnlyHint, true, `${t.name} is readOnlyHint:true (all WLO tools are read-only)`);
  }
  // Wikipedia reaches an open-world external source → openWorldHint.
  const wiki = tools.find(t => t.name === 'get_wikipedia_summary');
  assert.equal(wiki?.annotations?.openWorldHint, true, 'get_wikipedia_summary is openWorldHint:true');
  await client.close();
});

test('every tool declares the no-auth security scheme (Apps-SDK read-only stance)', async () => {
  const client = await connectedClient();
  const { tools } = await client.listTools();
  for (const t of tools) {
    const schemes = (t._meta as { securitySchemes?: unknown } | undefined)?.securitySchemes;
    assert.deepEqual(
      schemes,
      [{ type: 'noauth' }],
      `${t.name} declares _meta.securitySchemes = [{ type: 'noauth' }]`,
    );
  }
  await client.close();
});

test('every tool declares the required destructiveHint + openWorldHint annotations', async () => {
  const client = await connectedClient();
  const { tools } = await client.listTools();
  for (const t of tools) {
    // The Apps-SDK marks readOnlyHint/destructiveHint/openWorldHint as required.
    assert.equal(t.annotations?.destructiveHint, false, `${t.name} declares destructiveHint:false`);
    assert.equal(typeof t.annotations?.openWorldHint, 'boolean', `${t.name} declares openWorldHint`);
  }
  await client.close();
});

test('every tool advertises toolInvocation status strings (≤64 chars)', async () => {
  const client = await connectedClient();
  const { tools } = await client.listTools();
  for (const t of tools) {
    const meta = t._meta as Record<string, unknown> | undefined;
    const invoking = meta?.['openai/toolInvocation/invoking'];
    const invoked = meta?.['openai/toolInvocation/invoked'];
    assert.equal(typeof invoking, 'string', `${t.name} has an invoking status`);
    assert.equal(typeof invoked, 'string', `${t.name} has an invoked status`);
    assert.ok((invoking as string).length > 0 && (invoking as string).length <= 64, `${t.name} invoking ≤64`);
    assert.ok((invoked as string).length > 0 && (invoked as string).length <= 64, `${t.name} invoked ≤64`);
  }
  await client.close();
});

test('the server advertises non-empty cross-tool usage instructions', async () => {
  const client = await connectedClient();
  const instructions = client.getInstructions() ?? '';
  assert.ok(instructions.length > 0, 'server advertises instructions');
  // The instructions must name the token-efficient fast path.
  assert.match(instructions, /search_wlo_all/);
  await client.close();
});

test('lookup_wlo_vocabulary lists target groups (no network)', async () => {
  const client = await connectedClient();
  const result = await client.callTool({
    name: 'lookup_wlo_vocabulary',
    arguments: { vocabulary: 'targetGroup' },
  });
  const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
  assert.match(text, /Lehrkräfte/);
  assert.match(text, /Lernende/);
  assert.match(text, /Allgemein/);
  await client.close();
});
