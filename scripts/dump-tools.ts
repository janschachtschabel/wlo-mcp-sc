/**
 * dump-tools.ts – print what `tools/list` answers, as JSON, without a network.
 *
 * For checking the tool list against a host (function calling, a connector):
 * `node --import tsx scripts/dump-tools.ts > tools.json`. Starts no cache and
 * calls no tool, so it needs no repository.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createMcpServer } from '../src/server.js';

const server = createMcpServer({ issuer: 'http://localhost' });
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await server.connect(serverSide);
const client = new Client({ name: 'dump-tools', version: '0' });
await client.connect(clientSide);
const { tools } = await client.listTools();
process.stdout.write(JSON.stringify(tools, null, 2) + '\n');
await client.close();
