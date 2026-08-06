/**
 * apps-tool-defaults.test.ts – `applyReadOnlyToolDefaults` stamps the uniform
 * read-only descriptor defaults onto BOTH registration paths (plain
 * `server.tool` and the `registerWloTool` seam): the mixed `noauth` + `oauth2`
 * security declaration and the required `destructiveHint`/`openWorldHint`
 * annotations. It MERGES
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
import { createMcpServer } from '../src/server.js';
import { CURATION_TOOLS } from './curation-tools.js';

test('EVERY tool carries the full Apps-SDK metadata set (title, hints, schemes, status)', async () => {
  // Conformance pin for all current AND future tools: the Apps SDK requires a
  // human-readable title alongside the machine name, the three annotation
  // hints, an auth declaration, and (ChatGPT extension) the invocation status
  // strings. 14 plain-registered tools shipped without a title (found in the
  // 2026-07-17 metadata audit) — this test makes that class of gap impossible
  // to reintroduce silently.
  const server = createMcpServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'conformance', version: '0.0.0' });
  await Promise.all([server.connect(st), client.connect(ct)]);
  const { tools } = await client.listTools();
  assert.ok(tools.length >= 22, `expected the full tool set, got ${tools.length}`);
  const curation = new Set(CURATION_TOOLS);
  for (const t of tools) {
    const title = (t as { title?: string }).title ?? t.annotations?.title;
    assert.ok(title && title.trim().length > 0, `${t.name}: missing human-readable title`);
    // Since 2026-08-05 the list contains the curation tools too, for every
    // caller. What every tool must carry is the same; what it may SAY differs,
    // so the two halves are asserted apart rather than loosened into one.
    assert.equal(typeof t.annotations?.readOnlyHint, 'boolean', `${t.name}: readOnlyHint`);
    assert.equal(typeof t.annotations?.destructiveHint, 'boolean', `${t.name}: destructiveHint`);
    assert.equal(typeof t.annotations?.openWorldHint, 'boolean', `${t.name}: openWorldHint`);
    const m = (t as { _meta?: Record<string, unknown> })._meta ?? {};
    assert.deepEqual(
      m.securitySchemes,
      curation.has(t.name)
        ? [{ type: 'oauth2', scopes: ['wlo'] }]
        : [{ type: 'noauth' }, { type: 'oauth2', scopes: ['wlo'] }],
      `${t.name}: securitySchemes`,
    );
    assert.ok(m['openai/toolInvocation/invoking'], `${t.name}: invoking status`);
    assert.ok(m['openai/toolInvocation/invoked'], `${t.name}: invoked status`);
  }
  await client.close();
});

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

test('applyReadOnlyToolDefaults stamps the mixed schemes + required hints on a plain server.tool', async () => {
  const tools = await listToolsFrom(server => {
    server.tool('plain', 'A plain tool.', {}, { readOnlyHint: true }, async () => ({
      content: [{ type: 'text' as const, text: 'ok' }],
    }));
  });
  const tool = tools.find(t => t.name === 'plain')!;
  assert.deepEqual((tool._meta as { securitySchemes?: unknown }).securitySchemes,
    [{ type: 'noauth' }, { type: 'oauth2', scopes: ['wlo'] }]);
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
  // the mixed declaration stamped …
  assert.deepEqual(meta?.securitySchemes, [{ type: 'noauth' }, { type: 'oauth2', scopes: ['wlo'] }]);
  // … the pre-existing widget keys survived the merge …
  assert.equal(meta?.ui?.resourceUri, 'ui://widget/demo.html');
  assert.deepEqual(meta?.ui?.visibility, ['model', 'app']);
  assert.equal(meta?.['openai/outputTemplate'], 'ui://widget/demo.html');
  // … and the required hints were filled.
  assert.equal(tool.annotations?.destructiveHint, false);
  assert.equal(tool.annotations?.openWorldHint, false);
});
