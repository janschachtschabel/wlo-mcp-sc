/**
 * docs-tools.ts – print the registered tools as a compact Markdown table:
 * name → first sentence of the description. `npm run docs:tools`.
 *
 * The tool table is kept by hand in six documents (both READMEs,
 * `docs/TOOLS.md`, `TOOLS-KOMPAKT.md`, `INTEGRATION.md`, `MCP-REFERENZ.md`).
 * `tests/docs-claims.test.ts` fails when one of them does not NAME a registered
 * tool; this script is the source to copy the missing row from, so the name
 * and the one-line summary come from the server and not from memory.
 *
 * Like `dump-tools.ts`: starts no cache, calls no tool, needs no repository.
 * `WLO_BATCH_UPLOAD_ENABLED=1 npm run docs:tools` includes the batch tools.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createMcpServer } from '../src/server.js';

/** Longest summary printed; a description without an early full stop is cut at a word. */
const SUMMARY_MAX = 220;

/**
 * The first sentence of a description: up to the first `.`, `!` or `?` that is
 * followed by whitespace or the end. A full stop inside `z.B.` or `2.1` is
 * followed by a non-space and so does not end the sentence.
 */
export function firstSentence(description: string | undefined): string {
  const flat = (description ?? '').replace(/\s+/g, ' ').trim();
  const end = /[.!?](?=\s|$)/.exec(flat);
  const sentence = end ? flat.slice(0, end.index + 1) : flat;
  if (sentence.length <= SUMMARY_MAX) return sentence;
  const cut = sentence.slice(0, SUMMARY_MAX);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 1))} …`;
}

/** One table row; a pipe in the text would end the cell. */
export function toolRow(name: string, description: string | undefined): string {
  return `| \`${name}\` | ${firstSentence(description).replace(/\|/g, '\\|')} |`;
}

async function main(): Promise<void> {
  const server = createMcpServer({ issuer: 'http://localhost' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'docs-tools', version: '0' });
  await client.connect(clientSide);
  const { tools } = await client.listTools();
  await client.close();

  const lines = [
    `<!-- ${tools.length} tools, in registration order (= the order of tools/list) -->`,
    '| Tool | Summary |',
    '|---|---|',
    ...tools.map(tool => toolRow(tool.name, tool.description)),
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

// Only when run as a script — the two helpers above are imported by a test.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
