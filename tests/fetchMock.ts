/**
 * fetchMock.ts – Test helper (NOT a test file; excluded by the `*.test.ts`
 * glob). Installs a global `fetch` stub that routes by URL so the search
 * pipeline and tool handlers can be exercised fully offline.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import type { WloNode } from '../src/wlo-api.js';
import { createMcpServer } from '../src/server.js';

/**
 * Fresh MCP server wired to an in-memory client — the standard harness for
 * tool-level tests (was duplicated verbatim across ~19 test files). Callers
 * `await client.close()` in a finally.
 */
export async function connectedClient(): Promise<Client> {
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

export interface MockResult {
  status?: number;
  /** JSON body (default). Ignored when `text` is given. */
  json?: unknown;
  /** Raw text body — for non-JSON endpoints (e.g. the eduservlet file download). */
  text?: string;
}

export interface InstalledMock {
  /** Every fetch call seen, in order. */
  calls: Array<{ url: string; init?: RequestInit }>;
  restore: () => void;
}

/**
 * Replace `globalThis.fetch` with a handler that maps (url, init) → a JSON
 * Response. Returns the captured calls and a restore() to put the real fetch
 * back — always call restore() in a `finally`.
 */
export function installFetchMock(
  handler: (url: string, init?: RequestInit) => MockResult,
): InstalledMock {
  const real = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input);
    calls.push({ url, init });
    const { status = 200, json, text } = handler(url, init);
    const isRaw = text !== undefined;
    return new Response(isRaw ? text : JSON.stringify(json), {
      status,
      headers: { 'Content-Type': isRaw ? 'text/markdown; charset=utf-8' : 'application/json' },
    });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

/** Build a minimal WloNode with the given id/title and extra properties. */
export function makeNode(
  id: string,
  title: string,
  props: Record<string, string[]> = {},
): WloNode {
  return {
    ref: { id, repo: '-home-' },
    type: 'ccm:io',
    properties: { 'cclom:title': [title], ...props },
  };
}

/**
 * Extract the concatenated text of all text-content parts of a tool result.
 * Takes `unknown` because the SDK's CallToolResult is a union that includes a
 * legacy `{toolResult}` shape without `content` — narrowing happens here once
 * instead of with an `as any` at every call site.
 */
export function toolText(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content
    .filter(p => p.type === 'text' && typeof p.text === 'string')
    .map(p => p.text as string)
    .join('\n');
}
