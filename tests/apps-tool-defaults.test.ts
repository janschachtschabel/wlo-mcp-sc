/**
 * apps-tool-defaults.test.ts – `applyReadOnlyToolDefaults` stamps the uniform
 * read-only descriptor defaults onto BOTH registration paths (plain
 * `server.tool` and the `registerWloTool` seam): the no-auth security scheme
 * and the required `destructiveHint`/`openWorldHint` annotations. It MERGES
 * with, rather than clobbers, existing widget `_meta` and explicit per-tool
 * annotations.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { registerWloTool } from '../src/apps/register.js';

async function listToolsFrom(register: (server: McpServer) => void) {
  const server = new McpServer({ name: 'defaults-test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  register(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}

test('applyReadOnlyToolDefaults stamps noauth + required hints on a plain server.tool', async () => {
  const tools = await listToolsFrom(server => {
    server.tool('plain', 'A plain tool.', {}, { readOnlyHint: true }, async () => ({
      content: [{ type: 'text' as const, text: 'ok' }],
    }));
  });
  const tool = tools.find(t => t.name === 'plain')!;
  assert.deepEqual((tool._meta as { securitySchemes?: unknown }).securitySchemes, [{ type: 'noauth' }]);
  assert.equal(tool.annotations?.readOnlyHint, true);
  assert.equal(tool.annotations?.destructiveHint, false);
  assert.equal(tool.annotations?.openWorldHint, false);
});

test('applyReadOnlyToolDefaults does NOT override an explicit openWorldHint', async () => {
  const tools = await listToolsFrom(server => {
    server.tool('open', 'Reaches an external source.', {}, { readOnlyHint: true, openWorldHint: true },
      async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }));
  });
  const ann = tools.find(t => t.name === 'open')!.annotations;
  assert.equal(ann?.openWorldHint, true, 'explicit true survives the default fill');
  assert.equal(ann?.destructiveHint, false);
});

test('applyReadOnlyToolDefaults merges defaults WITHOUT clobbering widget _meta on the seam', async () => {
  const tools = await listToolsFrom(server => {
    registerWloTool(server, {
      name: 'widget_tool',
      title: 'Widget tool',
      description: 'Use this when testing the merge.',
      inputSchema: { echo: z.string() },
      widgetUri: 'ui://widget/demo.html',
      widgetAccessible: true,
      annotations: { readOnlyHint: true },
      handler: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
    });
  });
  const tool = tools.find(t => t.name === 'widget_tool')!;
  const meta = tool._meta as {
    securitySchemes?: unknown;
    ui?: { resourceUri?: string; widgetAccessible?: boolean; visibility?: string[] };
    'openai/outputTemplate'?: string;
  };
  // no-auth stamped …
  assert.deepEqual(meta?.securitySchemes, [{ type: 'noauth' }]);
  // … the pre-existing widget keys survived the merge …
  assert.equal(meta?.ui?.resourceUri, 'ui://widget/demo.html');
  assert.deepEqual(meta?.ui?.visibility, ['model', 'app']);
  assert.equal(meta?.['openai/outputTemplate'], 'ui://widget/demo.html');
  // … and the required hints were filled.
  assert.equal(tool.annotations?.destructiveHint, false);
  assert.equal(tool.annotations?.openWorldHint, false);
});
