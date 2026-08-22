/**
 * fetchMock.ts – Test helper (NOT a test file; excluded by the `*.test.ts`
 * glob). Installs a global `fetch` stub that routes by URL so the search
 * pipeline and tool handlers can be exercised fully offline.
 */

import assert from 'node:assert/strict';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import type { WloNode } from '../src/wlo-api.js';
import { createMcpServer } from '../src/server.js';

/**
 * Fresh MCP server wired to an in-memory client — the standard harness for
 * tool-level tests (was duplicated verbatim across ~19 test files). Callers
 * `await client.close()` in a finally.
 *
 * Takes no write mode any more: since 2026-08-05 every server offers the same
 * tool list and the curation tools refuse at call time, so what a test needs to
 * vary is the CREDENTIAL in scope (`setServiceCredentialForTest`), not the way
 * the server was built.
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
  /** JSON body (default). Ignored when `text` or `body` is given. */
  json?: unknown;
  /** Raw text body — for non-JSON endpoints (e.g. the eduservlet file download). */
  text?: string;
  /** Binary body — for image endpoints (the inline-preview fetch). */
  body?: Uint8Array;
  /** Extra/override response headers (e.g. an image content-type). */
  headers?: Record<string, string>;
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
    const { status = 200, json, text, body, headers } = handler(url, init);
    const isRaw = text !== undefined;
    const payload = body !== undefined ? body : isRaw ? text : JSON.stringify(json);
    // Lower-cased and merged BEFORE the Headers object is built: an init object
    // holding both 'Content-Type' and 'content-type' appends both, and the
    // resulting "a, b" value fails every equality check downstream.
    const merged: Record<string, string> = {
      'content-type': body !== undefined
        ? 'application/octet-stream'
        : isRaw ? 'text/markdown; charset=utf-8' : 'application/json',
    };
    for (const [k, v] of Object.entries(headers ?? {})) merged[k.toLowerCase()] = v;
    return new Response(payload as BodyInit, { status, headers: merged });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

/**
 * Assert that a tool call is rejected by SCHEMA VALIDATION — i.e. before the
 * handler runs, and therefore before any upstream request.
 *
 * Calling a test "(no network)" does not make it so. Measured 2026-08-03: with
 * the `excludeNodeIds` cap deleted from the schema, the handler ran, its upstream
 * call failed because the network was unreachable, and the `catch` around the
 * call reported that failure AS the rejection — the test stayed green over a
 * removed input-validation constraint. Only the upstream-call count proves the
 * cap is doing the work.
 *
 * Both rejection shapes are accepted (the SDK surfaces invalid params either as
 * a thrown error or as an isError result, depending on version); the call count
 * is what makes the assertion real.
 */
export async function assertRejectsWithoutUpstream(
  client: Client,
  name: string,
  args: Record<string, unknown>,
  message: string,
): Promise<void> {
  const mock = installFetchMock(url => { throw new Error(`unexpected upstream call: ${url}`); });
  try {
    let rejected = false;
    try {
      const result = await client.callTool({ name, arguments: args });
      rejected = (result as { isError?: boolean }).isError === true;
    } catch {
      rejected = true;
    }
    // Checked first: it produces the informative failure when a constraint is gone.
    assert.equal(mock.calls.length, 0, `${message} — validation must reject BEFORE any upstream request`);
    assert.equal(rejected, true, message);
  } finally {
    mock.restore();
  }
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
