/**
 * unsafe-gate.test.ts – The registration gate for tools declared unsafe.
 *
 * `registerWloTool` is the one seam every tool goes through, so the gate lives
 * there and a second unsafe tool costs one field instead of a new concept. What
 * these tests pin is the part that is easy to get subtly wrong: the switch must
 * act ONLY on tools that declared themselves unsafe. A gate that also silences
 * ordinary tools turns a security knob into an outage.
 *
 * Absence is asserted against `client.listTools()` — the surface a host actually
 * sees — following the pattern of apps-register.test.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerWloTool } from '../src/apps/register.js';

async function clientFor(register: (server: McpServer) => void): Promise<Client> {
  const server = new McpServer({ name: 'gate-test', version: '0.0.0' });
  register(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

const handler = async () => ({ content: [{ type: 'text' as const, text: 'ok' }] });

const safeDef = {
  name: 'safe_tool',
  title: 'Safe',
  description: 'An ordinary tool.',
  inputSchema: { q: z.string() },
  handler,
};

const unsafeDef = {
  ...safeDef,
  name: 'unsafe_tool',
  unsafe: { reason: 'fetches a caller-supplied URL' },
};

const disableEverything = () => true;
const disableNothing = () => false;

async function toolNames(register: (server: McpServer) => void): Promise<string[]> {
  const client = await clientFor(register);
  try {
    const { tools } = await client.listTools();
    return tools.map(t => t.name);
  } finally {
    await client.close();
  }
}

test('a tool that did NOT declare itself unsafe is registered even when everything is disabled', async () => {
  // The whole point of the declaration: the switch is scoped to tools that opted
  // into it. Without this, WLO_DISABLE_UNSAFE_TOOLS=all would empty the server.
  const names = await toolNames(s => registerWloTool(s, safeDef, disableEverything));
  assert.deepEqual(names, ['safe_tool']);
});

test('an unsafe tool is registered when the operator did not switch it off', async () => {
  const names = await toolNames(s => registerWloTool(s, unsafeDef, disableNothing));
  assert.deepEqual(names, ['unsafe_tool'], 'unsafe tools are on by default');
});

test('an unsafe tool disappears from tools/list when it is switched off', async () => {
  // The safe tool is not decoration: an McpServer with NO tool at all never
  // advertises the tools capability, so `tools/list` answers -32601 and the
  // assertion would fail for a reason that has nothing to do with the gate.
  // A real server always has the other 24 — this fixture mirrors that.
  const names = await toolNames(s => {
    registerWloTool(s, safeDef, disableEverything);
    registerWloTool(s, unsafeDef, disableEverything);
  });
  assert.deepEqual(names, ['safe_tool'], 'a model cannot call a tool it cannot see');
});

test('switching one unsafe tool off leaves the others alone', async () => {
  const other = { ...unsafeDef, name: 'other_unsafe_tool' };
  const names = await toolNames(s => {
    registerWloTool(s, unsafeDef, n => n === 'unsafe_tool');
    registerWloTool(s, other, n => n === 'unsafe_tool');
    registerWloTool(s, safeDef, n => n === 'unsafe_tool');
  });
  assert.deepEqual(names.sort(), ['other_unsafe_tool', 'safe_tool']);
});
