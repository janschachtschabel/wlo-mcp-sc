/**
 * tool-security-schemes.test.ts – every tool declares a scheme the client knows.
 *
 * Measured 2026-08-05 against the Apps SDK's own documentation
 * (developers.openai.com/apps-sdk/build/auth): **two scheme types exist** —
 *
 *   { "type": "noauth" }
 *   { "type": "oauth2", "scopes": [...] }
 *
 * and nothing else. The 13 curation tools declared `{ type: 'http' }`, which is
 * not one of them. That mattered live: ChatGPT connected fine anonymously (25
 * tools, all `noauth`) and refused the connection once a login added the 13 —
 * "Beim Herstellen der Verbindung ist ein Problem aufgetreten", with no further
 * detail from the client and nothing in our log, because the request itself was
 * answered correctly.
 *
 * The rule is checked over the WHOLE surface, both modes, because a single tool
 * with an unknown scheme takes the entire connection down with it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createMcpServer } from '../src/server.js';
import { CURATION_TOOLS } from './curation-tools.js';

/** The complete set the Apps SDK accepts. */
const KNOWN_TYPES = new Set(['noauth', 'oauth2']);

const WRITE_TOOLS = new Set(CURATION_TOOLS);

async function toolsOf() {
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'scheme-test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}

test('every tool declares a scheme type the client knows', async () => {
  const tools = await toolsOf();
  assert.ok(tools.length > 0);
  for (const tool of tools) {
    const schemes = (tool._meta as { securitySchemes?: Array<Record<string, unknown>> } | undefined)
      ?.securitySchemes;
    assert.ok(Array.isArray(schemes) && schemes.length > 0, `${tool.name}: no securitySchemes`);
    for (const scheme of schemes) {
      assert.ok(
        KNOWN_TYPES.has(String(scheme['type'])),
        `${tool.name}: "${String(scheme['type'])}" is not a scheme type the Apps SDK knows ` +
          `(only ${[...KNOWN_TYPES].join(', ')}) — one unknown type refuses the whole connection`,
      );
      if (scheme['type'] === 'oauth2') {
        assert.ok(
          Array.isArray(scheme['scopes']) && scheme['scopes'].length > 0,
          `${tool.name}: an oauth2 scheme must name the scopes, or the consent screen is wrong`,
        );
      }
    }
  }
});

test('a tool that needs an identity says so, and one that does not says both', async () => {
  // Since 2026-08-05 the tool list no longer depends on the caller, so the
  // declaration is what tells the two apart — which is exactly what the Apps SDK
  // reads it for. A read tool names both schemes because both work; a write tool
  // names only `oauth2`, because anonymous is not one of its options.
  for (const tool of await toolsOf()) {
    const schemes = (tool._meta as { securitySchemes?: Array<Record<string, unknown>> })
      .securitySchemes!;
    const types = schemes.map((s) => String(s['type']));
    if (WRITE_TOOLS.has(tool.name)) {
      assert.deepEqual(types, ['oauth2'],
        `${tool.name} changes data, so it must not claim to be callable without an identity`);
    } else {
      assert.deepEqual(types, ['noauth', 'oauth2'],
        `${tool.name} works anonymously and better with a login — it should say both`);
    }
  }
});
