/**
 * apps-register.test.ts – The Apps-SDK registration seam (`registerWloTool`)
 * and the structuredContent output schemas.
 *
 * These verify the P3 foundation in isolation (no real tool touched): a tool
 * registered through the seam advertises annotations + outputSchema + the
 * widget `_meta` keys, and returns BOTH text content (back-compat) and
 * structuredContent (Apps-SDK). The schemas accept real formatter output.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerWloTool } from '../src/apps/register.js';
import {
  formattedNodeSchema,
  nodeListSchema,
  searchAllEnvelopeSchema,
  swimlanePayloadSchema,
  browseTreeSchema,
} from '../src/apps/outputSchemas.js';
import { formatNode } from '../src/formatter.js';
import { makeNode } from './fetchMock.js';

async function clientFor(register: (server: McpServer) => void): Promise<Client> {
  const server = new McpServer({ name: 'seam-test', version: '0.0.0' });
  register(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

// ── outputSchemas accept real formatter output ──────────────────────────────

test('formattedNodeSchema accepts real formatNode output and rejects a partial', () => {
  const fn = formatNode(makeNode('n1', 'Zellteilung'));
  assert.equal(formattedNodeSchema.safeParse(fn).success, true);
  assert.equal(formattedNodeSchema.safeParse({ nodeId: 'n1' }).success, false);
});

test('nodeListSchema and searchAllEnvelopeSchema accept their envelopes', () => {
  const fn = formatNode(makeNode('n1', 'Titel'));
  assert.equal(nodeListSchema.safeParse({ total: 1, count: 1, results: [fn] }).success, true);

  const envelope = {
    query: 'photosynthese',
    content: { total: 3, count: 1, results: [fn] },
    collections: { total: 0, count: 0, results: [] },
    topicPages: { total: 0, count: 0, results: [] },
  };
  assert.equal(searchAllEnvelopeSchema.safeParse(envelope).success, true);
  // wikipedia is optional and a topic-page result may carry swimlane content.
  const enriched = {
    ...envelope,
    topicPages: {
      total: 1, count: 1,
      results: [{ ...fn, topicPageContent: {
        variantId: 'v1', collectionId: 'c1', variantTitle: 'T', topicPageUrl: null,
        swimlaneCount: 0, swimlanesTotal: 0, swimlanes: [],
      } }],
    },
    wikipedia: { title: 'Photosynthese', extract: '…', url: 'https://de.wikipedia.org/wiki/x', lang: 'de' },
  };
  assert.equal(searchAllEnvelopeSchema.safeParse(enriched).success, true);
});

test('swimlanePayloadSchema and browseTreeSchema accept their envelopes', () => {
  const fn = formatNode(makeNode('n1', 'Titel'));
  const swimlane = {
    variantId: 'v1', collectionId: null, variantTitle: 'T', topicPageUrl: null,
    swimlaneCount: 1, swimlanesTotal: 1,
    swimlanes: [{ heading: 'Grundlagen', type: 'default', items: [fn], hasMore: false }],
  };
  assert.equal(swimlanePayloadSchema.safeParse(swimlane).success, true);

  const tree = {
    parent: 'p1', depth: 2, total: 1,
    results: [{ ...fn, fileCount: 5, contentPreview: [fn], children: [{ ...fn }] }],
  };
  assert.equal(browseTreeSchema.safeParse(tree).success, true);
});

// ── the seam ────────────────────────────────────────────────────────────────

test('registerWloTool advertises annotations, outputSchema and widget _meta', async () => {
  const fn = formatNode(makeNode('n1', 'Titel'));
  const client = await clientFor(server => {
    registerWloTool(server, {
      name: 'seam_demo',
      title: 'Seam demo',
      description: 'Use this when testing the seam. Do not use for real search.',
      inputSchema: { echo: z.string() },
      outputSchema: nodeListSchema,
      annotations: { readOnlyHint: true },
      widgetUri: 'ui://widget/demo.html',
      handler: async (args: { echo: string }) => ({
        content: [{ type: 'text' as const, text: `echo:${args.echo}` }],
        structuredContent: { total: 1, count: 1, results: [fn] },
      }),
    });
  });

  const { tools } = await client.listTools();
  const tool = tools.find(t => t.name === 'seam_demo');
  assert.ok(tool, 'seam_demo registered');
  assert.equal(tool!.annotations?.readOnlyHint, true);
  assert.equal((tool!.outputSchema as { type?: string })?.type, 'object');
  const meta = tool!._meta as { ui?: { resourceUri?: string }; 'openai/outputTemplate'?: string } | undefined;
  assert.equal(meta?.ui?.resourceUri, 'ui://widget/demo.html');
  assert.equal(meta?.['openai/outputTemplate'], 'ui://widget/demo.html');

  await client.close();
});

test('registerWloTool emits widgetAccessible aliases when the flag is set', async () => {
  const client = await clientFor(server => {
    registerWloTool(server, {
      name: 'seam_wa',
      title: 'Seam WA',
      description: 'Use this when testing widgetAccessible.',
      inputSchema: { echo: z.string() },
      widgetUri: 'ui://widget/wa.html',
      widgetAccessible: true,
      annotations: { readOnlyHint: true },
      handler: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
    });
  });
  const { tools } = await client.listTools();
  const meta = tools.find(t => t.name === 'seam_wa')!._meta as {
    ui?: { resourceUri?: string; widgetAccessible?: boolean; visibility?: string[] };
    'openai/widgetAccessible'?: boolean;
  } | undefined;
  assert.equal(meta?.ui?.resourceUri, 'ui://widget/wa.html');
  // Current MCP-Apps standard: a widget-callable tool is app-visible (so the
  // widget may `tools/call` it) while staying model-visible.
  assert.deepEqual(meta?.ui?.visibility, ['model', 'app']);
  // Legacy ChatGPT aliases kept for older runtimes.
  assert.equal(meta?.ui?.widgetAccessible, true);
  assert.equal(meta?.['openai/widgetAccessible'], true);
  await client.close();
});

test('registerWloTool returns both text content and structuredContent', async () => {
  const fn = formatNode(makeNode('n1', 'Titel'));
  const client = await clientFor(server => {
    registerWloTool(server, {
      name: 'seam_demo',
      title: 'Seam demo',
      description: 'Use this when testing the seam.',
      inputSchema: { echo: z.string() },
      outputSchema: nodeListSchema,
      annotations: { readOnlyHint: true },
      handler: async (args: { echo: string }) => ({
        content: [{ type: 'text' as const, text: `echo:${args.echo}` }],
        structuredContent: { total: 1, count: 1, results: [fn] },
      }),
    });
  });

  const result = await client.callTool({ name: 'seam_demo', arguments: { echo: 'hi' } });
  const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
  assert.equal(text, 'echo:hi');
  const sc = result.structuredContent as { total: number; results: unknown[] };
  assert.equal(sc.total, 1);
  assert.equal(sc.results.length, 1);

  await client.close();
});

test('registerWloTool error result needs no structuredContent (SDK skips validation)', async () => {
  const client = await clientFor(server => {
    registerWloTool(server, {
      name: 'seam_err',
      title: 'Seam error',
      description: 'Use this when testing the error path.',
      inputSchema: { echo: z.string() },
      outputSchema: nodeListSchema,
      annotations: { readOnlyHint: true },
      handler: async () => ({
        content: [{ type: 'text' as const, text: 'boom' }],
        isError: true,
      }),
    });
  });

  const result = await client.callTool({ name: 'seam_err', arguments: { echo: 'x' } });
  assert.equal(result.isError, true);
  const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
  assert.equal(text, 'boom');

  await client.close();
});
