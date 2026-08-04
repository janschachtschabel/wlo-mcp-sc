import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assertRejectsWithoutUpstream, connectedClient } from './fetchMock.js';

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
  'get_wlo_content_text',
  // Declared UNSAFE and registered BY DEFAULT — its absence is what the
  // operator has to configure. See tests/unsafe-gate.test.ts for the switch.
  'get_url_text',
  'search_wlo_within_collection',
  'search',
  'fetch',
  'lookup_wlo_publishers',
  'get_related_content',
  'get_node_breadcrumb',
  'get_node_collections',
  'get_collection_stats',
  'wlo_auth_status',
  // `find_wlo_skills` is deliberately NOT here: it is registered only when
  // WLO_SKILLS_COLLECTION_ID is configured, and the suite runs without it.
  // Unconfigured it failed on every call, so listing it advertised a capability
  // that could not work.
];

test('createMcpServer registers exactly the 25 unconditional read tools', async () => {
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
  await assertRejectsWithoutUpstream(
    client,
    'search_wlo_content',
    { query: 'mathe', excludeNodeIds: tooMany },
    'expected 201 excludeNodeIds to be rejected',
  );
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

test('the server instructions name the full-text tool', async () => {
  // A user asked for the Volltext of a material whose nodeId was already in the
  // conversation and got "ich kann den Volltext nicht ausgeben" — no tool call
  // at all (live report 2026-07-30). The instructions are the routing surface
  // the model reads once, and they did not mention get_wlo_content_text; they
  // steered away from extra calls entirely. A tool the routing surface never
  // names is a tool the model does not reach for.
  const client = await connectedClient();
  try {
    const instructions = client.getInstructions() ?? '';
    assert.match(instructions, /get_wlo_content_text/, 'instructions point at the full-text tool');
  } finally { await client.close(); }
});

test('no two tools advertise the same example query', async () => {
  // Three tools carried the literal example "Video zur Eiszeit"
  // (search, search_wlo_content, search_wlo_all), so the same request routed
  // to whichever the model happened to pick — and `search` cannot fill the
  // widget (audit 2026-07-30, matching the user's live report).
  //
  // `search`/`fetch` are REQUIRED by the ChatGPT knowledge convention and
  // deliberately overlap in PURPOSE; what must not overlap is the concrete
  // example a router matches on.
  const client = await connectedClient();
  try {
    const { tools } = await client.listTools();
    // Only MULTI-WORD phrases count: a single quoted term is a vocabulary
    // value ("Mathematik", "Video") that legitimately appears in many tools as
    // a filter example. What must be unique is the example REQUEST a router
    // matches a user's sentence against.
    const byPhrase = new Map<string, string[]>();
    for (const t of tools) {
      for (const m of (t.description ?? '').matchAll(/"([^"]{6,60})"/g)) {
        const key = m[1].toLowerCase().trim();
        if (key.split(/\s+/).length < 2) continue;
        byPhrase.set(key, [...new Set([...(byPhrase.get(key) ?? []), t.name])]);
      }
    }
    const collisions = [...byPhrase].filter(([, names]) => names.length > 1)
      .map(([phrase, names]) => `"${phrase}" → ${names.join(', ')}`);
    assert.deepEqual(collisions, [], `example queries must be unique per tool:\n${collisions.join('\n')}`);
  } finally { await client.close(); }
});
