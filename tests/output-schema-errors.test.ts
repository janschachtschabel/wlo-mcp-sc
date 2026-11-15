/**
 * output-schema-errors.test.ts – a coded error must reach a client that follows
 * the specification (review 2026-11-13).
 *
 * The SDK client validates `structuredContent` against the tool's advertised
 * `outputSchema` whenever it is PRESENT — also on an `isError` result. Every
 * coded error of this server carries `structuredContent.error`, so a strict
 * success-only schema made `callTool` THROW and the client saw neither code nor
 * message. No earlier test could see it: none listed the tools before calling.
 *
 * Proven generically for every tool with an output schema (so a new tool
 * cannot regress), and end to end for real error paths.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { registerWloTool } from '../src/apps/register.js';
import { stopSkillRegistryCache } from '../src/services/skill-registry-cache.js';
import {
  installFetchMock, makeNode, outputValidator, strictClient, successSchemaOf, toolText, type MockResult,
} from './fetchMock.js';

interface ErrorContent { error?: { code?: string; message?: string; candidates?: unknown[] } }

const collection = (id: string, title: string) => ({
  ...makeNode(id, title, { 'cm:title': [title] }), type: 'ccm:map', aspects: ['ccm:collection'],
});

/** One call through a client that has the tool list, i.e. validates every answer. */
async function strictCall(name: string, args: Record<string, unknown>, handler: (url: string) => MockResult) {
  stopSkillRegistryCache();
  const mock = installFetchMock(handler);
  const client = await strictClient();
  try {
    const r = await client.callTool({ name, arguments: args });
    return { r, error: (r.structuredContent as ErrorContent | undefined)?.error, text: toolText(r), calls: mock.calls };
  } finally { await client.close(); mock.restore(); }
}

// ── Every tool, generically ─────────────────────────────────────────────────

test('every advertised output schema is an object schema that accepts a coded error and nothing looser', async () => {
  const client = await strictClient();
  try {
    const tools = (await client.listTools()).tools.filter(t => t.outputSchema);
    assert.ok(tools.length >= 20, `tools with an output schema: ${tools.length}`);
    for (const tool of tools) {
      const schema = tool.outputSchema as { type?: string; anyOf?: unknown[] };
      // The specification requires an object schema at the top.
      assert.equal(schema.type, 'object', tool.name);
      const validate = outputValidator(tool);
      assert.equal(validate({ error: { code: 'x', message: 'y' } }).valid, true, `${tool.name}: a coded error`);
      assert.equal(validate({ error: { code: 'upstream_busy', message: 'y', retryAfter: 3, candidates: [{ nodeId: 'a' }] } }).valid, true,
        `${tool.name}: what a client reads beside the code`);
      assert.equal(validate({ error: { code: 'x' } }).valid, false, `${tool.name}: an error without a message`);
      assert.equal(validate({ error: 'boom' }).valid, false, `${tool.name}: an error that is no object`);
      // The success shape stays closed: an undeclared key is still a violation.
      assert.equal(validate({ undeclaredKeyForThisTest: 1 }).valid, false, `${tool.name}: an undeclared key`);
      assert.equal((successSchemaOf(tool) as { additionalProperties?: unknown }).additionalProperties, false,
        `${tool.name}: the success shape is published closed`);
    }
  } finally { await client.close(); }
});

// ── Real error paths, end to end ────────────────────────────────────────────

test('get_collection_overview: an unknown collection is a readable not_found', async () => {
  const { r, error } = await strictCall('get_collection_overview', { collectionId: 'nope' }, () => ({ status: 404, json: {} }));
  assert.equal(r.isError, true);
  assert.equal(error?.code, 'not_found');
  assert.ok(error?.message);
});

test('get_collection_contents: neither id nor title is a readable invalid_input', async () => {
  const { r, error, calls } = await strictCall('get_collection_contents', {}, () => ({ json: {} }));
  assert.equal(r.isError, true);
  assert.equal(error?.code, 'invalid_input');
  assert.equal(calls.length, 0);
});

test('get_collection_contents: an ambiguous title is readable with its candidates', async () => {
  const twins = [collection('a', 'Optik'), collection('b', 'Optik')];
  const { r, error } = await strictCall('get_collection_contents', { collection: 'Optik' }, url => {
    if (url.includes('/mds_oeh/collections')) return { json: { nodes: twins } };
    if (url.includes('/collections/-home-/search')) return { json: { collections: [] } };
    return { json: { nodes: [] } };
  });
  assert.equal(r.isError, true);
  assert.equal(error?.code, 'ambiguous_collection');
  assert.equal(error?.candidates?.length, 2);
});

test('search_wlo_content_many: a duplicate id is a readable invalid_input', async () => {
  const { r, error } = await strictCall('search_wlo_content_many',
    { queries: [{ id: 'a', query: 'Optik' }, { id: 'a', query: 'Linsen' }] }, () => ({ json: {} }));
  assert.equal(r.isError, true);
  assert.equal(error?.code, 'invalid_input');
});

test('search_wlo_content: a repository failure (toolError) is readable', async () => {
  const { r, error } = await strictCall('search_wlo_content', { query: 'Optik' }, () => ({ status: 500, json: {} }));
  assert.equal(r.isError, true);
  assert.equal(error?.code, 'upstream_error');
});

test('wrong arguments (the SDK\'s own error) are readable as invalid_input', async () => {
  const { r, error } = await strictCall('get_collection_overview', { maxContents: 'viele' }, () => ({ json: {} }));
  assert.equal(r.isError, true);
  assert.equal(error?.code, 'invalid_input');
});

// ── Success is still checked ────────────────────────────────────────────────

async function seamClient(structuredContent: unknown): Promise<Client> {
  const server = new McpServer({ name: 'seam-test', version: '0.0.0' });
  registerWloTool(server, {
    name: 'seam_strict', title: 'Seam', description: 'Test.', inputSchema: {},
    outputSchema: z.object({ total: z.number(), note: z.string().optional() }),
    handler: async () => ({ content: [{ type: 'text' as const, text: 'ok' }], structuredContent }),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  await client.listTools();
  return client;
}

test('a success answer with an undeclared key still fails a strict client', async () => {
  const good = await seamClient({ total: 1 });
  try {
    assert.deepEqual((await good.callTool({ name: 'seam_strict', arguments: {} })).structuredContent, { total: 1 });
  } finally { await good.close(); }
  const bad = await seamClient({ total: 1, undeclared: true });
  try {
    await assert.rejects(bad.callTool({ name: 'seam_strict', arguments: {} }), /does not match the tool's output schema/);
  } finally { await bad.close(); }
});

test('a success answer missing a required key is still refused by the server', async () => {
  const client = await seamClient({ note: 'no total' });
  try {
    const r = await client.callTool({ name: 'seam_strict', arguments: {} });
    assert.equal(r.isError, true);
    assert.match(toolText(r), /Output validation error/);
  } finally { await client.close(); }
});
