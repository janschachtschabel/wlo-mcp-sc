import { test } from 'node:test';
import assert from 'node:assert/strict';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { registerContentSearchTools } from '../src/tools/content-search.js';
import { registerCollectionTools } from '../src/tools/collections.js';
import { registerNodeRelationTools } from '../src/tools/node-relations.js';
import { registerBrowseTools } from '../src/tools/browse.js';
import { registerTopicPageContentTool } from '../src/tools/topic-page-content.js';

async function connect(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

const URI = 'ui://widget/search-results-abc12345.html';

function metaUi(tool: { _meta?: unknown } | undefined): { resourceUri?: string } | undefined {
  return (tool?._meta as { ui?: { resourceUri?: string } })?.ui;
}

test('search_wlo_all advertises its widget resourceUri (+ openai alias) when wired', async () => {
  const server = new McpServer({ name: 't', version: '0' });
  registerContentSearchTools(server, URI);
  const client = await connect(server);

  const { tools } = await client.listTools();
  const all = tools.find(x => x.name === 'search_wlo_all');
  assert.equal(metaUi(all)?.resourceUri, URI);
  assert.equal((all?._meta as Record<string, unknown>)?.['openai/outputTemplate'], URI);

  // search_wlo_content renders through the SAME widget — see the node-LIST
  // test below for why that stopped being an exception.
  const content = tools.find(x => x.name === 'search_wlo_content');
  assert.equal(metaUi(content)?.resourceUri, URI);

  await client.close();
});

test('search_wlo_all omits widget metadata when no widget is wired', async () => {
  const server = new McpServer({ name: 't', version: '0' });
  registerContentSearchTools(server);
  const client = await connect(server);

  const { tools } = await client.listTools();
  const all = tools.find(x => x.name === 'search_wlo_all');
  assert.equal(metaUi(all)?.resourceUri, undefined);

  await client.close();
});

test('both browse tools advertise the W2 widget resourceUri when wired', async () => {
  const uri = 'ui://widget/browse-deadbeef.html';
  const server = new McpServer({ name: 't', version: '0' });
  registerBrowseTools(server, uri);
  const client = await connect(server);

  const { tools } = await client.listTools();
  assert.equal(metaUi(tools.find(x => x.name === 'get_subject_portals'))?.resourceUri, uri);
  assert.equal(metaUi(tools.find(x => x.name === 'browse_collection_tree'))?.resourceUri, uri);

  await client.close();
});

test('get_topic_page_content advertises the W4 widget resourceUri when wired', async () => {
  const uri = 'ui://widget/topic-page-cafe1234.html';
  const server = new McpServer({ name: 't', version: '0' });
  registerTopicPageContentTool(server, uri);
  const client = await connect(server);

  const { tools } = await client.listTools();
  assert.equal(metaUi(tools.find(x => x.name === 'get_topic_page_content'))?.resourceUri, uri);

  await client.close();
});

test('every node-LIST tool carries the search-results widget', async () => {
  // Reversal of an earlier decision, on live evidence (2026-07-30): wiring the
  // widget to search_wlo_all alone made the UI look random to users — "ich suche
  // etwas zur Eiszeit" answered as plain text, "ich suche inhalte zu
  // bruchrechnung" as a widget, purely because the model picked a different
  // search tool. Whether a result renders must not depend on which of several
  // equivalent tools the model chose. The tools below all return a node list,
  // which the widget now renders.
  const server = new McpServer({ name: 't', version: '0' });
  registerContentSearchTools(server, URI);
  registerCollectionTools(server, URI);
  registerNodeRelationTools(server, URI);
  const client = await connect(server);

  const { tools } = await client.listTools();
  for (const name of ['search_wlo_all', 'search_wlo_content', 'search_wlo_collections',
                      'get_collection_contents', 'search_wlo_within_collection', 'get_related_content']) {
    const tool = tools.find(x => x.name === name);
    assert.ok(tool, `${name} is registered`);
    assert.equal(metaUi(tool)?.resourceUri, URI, `${name} advertises the widget`);
  }
  await client.close();
});
