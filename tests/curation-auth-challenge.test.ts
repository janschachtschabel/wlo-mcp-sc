/**
 * curation-auth-challenge.test.ts – the official Apps-SDK pattern for a server
 * where some tools are anonymous and some are not.
 *
 * Reference: `openai/openai-apps-sdk-examples`, `authenticated_server_python/
 * main.py` — OpenAI's own server for exactly this case (read 2026-08-05). It
 * does two things we did not:
 *
 *   - the protected tool is ALWAYS in `tools/list`, declares `oauth2`, and
 *     refuses at call time;
 *   - the refusal carries `_meta["mcp/www_authenticate"]` and `isError`, so the
 *     client learns it should start a login. The transport stays at 200 —
 *     anonymous reading is untouched.
 *
 * That is the mechanism we lacked: a model that never sees a write tool never
 * calls one, so nothing ever asks the host to log the user in. Hiding the tools
 * looked safer and was the reason the login never started.
 *
 * The refusal itself is unchanged and absolute — that is what the last two
 * assertions here pin down.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createMcpServer } from '../src/server.js';
import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { installFetchMock } from './fetchMock.js';

const ISSUER = 'https://wlo.example';
const USER: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };

async function clientFor(issuer: string | null = ISSUER): Promise<Client> {
  const server = createMcpServer({ issuer });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'challenge-test', version: '0.0.0' });
  await Promise.all([server.connect(st), client.connect(ct)]);
  return client;
}

/** The `mcp/www_authenticate` entries of a tool result, or undefined. */
function challengeOf(result: unknown): string[] | undefined {
  const meta = (result as { _meta?: Record<string, unknown> })._meta;
  const value = meta?.['mcp/www_authenticate'];
  return Array.isArray(value) ? (value as string[]) : undefined;
}

test('a write tool is listed even without an identity', async () => {
  const client = await clientFor();
  try {
    const names = (await client.listTools()).tools.map(t => t.name);
    assert.ok(names.includes('wlo_update_content'),
      'the protected tool must be visible, or the client never learns a login exists');
    assert.ok(names.includes('wlo_delete_content'));
  } finally {
    await client.close();
  }
});

test('calling it without an identity answers with the login challenge, and writes nothing', async () => {
  setServiceCredentialForTest(null);
  const mock = installFetchMock(url => { throw new Error(`unexpected upstream call: ${url}`); });
  const client = await clientFor();
  try {
    const result = await client.callTool({
      name: 'wlo_update_content',
      arguments: { nodeId: 'node-1', title: 'Neuer Titel' },
    });

    assert.equal(result.isError, true, 'the refusal is an error result');
    const challenge = challengeOf(result);
    assert.ok(challenge && challenge.length === 1, 'exactly one WWW-Authenticate value');
    assert.match(challenge[0]!, /^Bearer /);
    assert.match(challenge[0]!, /error="invalid_request"/);
    assert.match(
      challenge[0]!,
      /resource_metadata="https:\/\/wlo\.example\/\.well-known\/oauth-protected-resource"/,
      'the pointer tells a client that never probed us where to read who may authorize it',
    );
    // The load-bearing half: the tool is visible now, so the refusal has to hold
    // on its own. Nothing may reach the repository.
    assert.equal(mock.calls.length, 0, 'no upstream request was made');
  } finally {
    mock.restore();
    await client.close();
  }
});

test('without a public origin the verdict stands and only the pointer falls away', async () => {
  setServiceCredentialForTest(null);
  const client = await clientFor(null);
  try {
    const result = await client.callTool({ name: 'wlo_delete_content', arguments: { nodeId: 'node-1' } });
    const challenge = challengeOf(result);
    assert.ok(challenge, 'still challenged');
    assert.doesNotMatch(challenge[0]!, /resource_metadata/,
      'naming an origin we did not choose would be worse than saying nothing');
  } finally {
    await client.close();
  }
});

test('a caller who may write is not challenged', async () => {
  setServiceCredentialForTest(USER);
  const mock = installFetchMock(() => ({
    json: { node: { ref: { id: 'node-1', repo: '-home-' }, properties: { 'cclom:title': ['Alt'] } } },
  }));
  const client = await clientFor();
  try {
    const result = await client.callTool({
      name: 'wlo_update_content',
      arguments: { nodeId: 'node-1', title: 'Neuer Titel' },
    });
    assert.equal(challengeOf(result), undefined, 'no login is being asked for');
    assert.notEqual(result.isError, true, 'the two-step preview is a normal reply');
  } finally {
    mock.restore();
    setServiceCredentialForTest(null);
    await client.close();
  }
});

test('the shared service account without write permission is challenged too', async () => {
  // A login as an individual is exactly what would help here, so the client
  // should be told to start one — the message names the other way out as well.
  setServiceCredentialForTest({ header: 'Basic y', label: 'wlo-mcp', source: 'service' });
  const mock = installFetchMock(url => { throw new Error(`unexpected upstream call: ${url}`); });
  const client = await clientFor();
  try {
    const result = await client.callTool({
      name: 'wlo_update_content',
      arguments: { nodeId: 'node-1', title: 'Neuer Titel' },
    });
    assert.equal(result.isError, true);
    assert.ok(challengeOf(result), 'challenged');
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
    setServiceCredentialForTest(null);
    await client.close();
  }
});
