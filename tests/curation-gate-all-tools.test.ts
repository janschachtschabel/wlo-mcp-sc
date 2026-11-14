/**
 * curation-gate-all-tools.test.ts – EVERY curation tool refuses a caller who
 * may not write (audit 2026-11-14, T5a).
 *
 * Since 2026-08-05 the write tools are listed for everybody, so the call-time
 * gate in `registerCurationTool` is the only thing between an anonymous request
 * and the write pipeline. `curation-auth-challenge.test.ts` pins the mechanism
 * on two tools; a source scan pins that the others are REGISTERED through the
 * seam. Neither calls them. This file does, all of them, as two callers:
 *
 *   - nobody (no credential at all), and
 *   - the shared service account while `WLO_ALLOW_SERVICE_WRITES` is off.
 *
 * Each call must be refused with the login challenge and must not have sent a
 * single request upstream — a refusal that first READ the record would already
 * be an oracle for what exists.
 *
 * The arguments are built from each tool's advertised input schema, so a tool
 * added later is covered the day it is listed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createMcpServer } from '../src/server.js';
import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { ALLOW_SERVICE_WRITES } from '../src/services/write/credential-gate.js';
import { installFetchMock } from './fetchMock.js';
import { CURATION_TOOLS } from './curation-tools.js';

const ISSUER = 'https://wlo.example';
const SERVICE: WloCredential = { header: 'Basic c2VydmljZTpwdw==', label: 'service', source: 'service' };

type Schema = {
  type?: string; enum?: unknown[]; required?: string[]; properties?: Record<string, Schema>;
  items?: Schema; anyOf?: Schema[]; minLength?: number; minimum?: number;
};

/** The smallest value a schema accepts: required properties only, the first option of every choice. */
function minimal(schema: Schema): unknown {
  if (schema.enum?.length) return schema.enum[0];
  if (schema.anyOf?.length) return minimal(schema.anyOf[0]!);
  switch (schema.type) {
    case 'string': return 'node-1'.padEnd(schema.minLength ?? 0, 'x');
    case 'number': case 'integer': return schema.minimum ?? 1;
    case 'boolean': return false;
    case 'array': return [minimal(schema.items ?? { type: 'string' })];
    case 'object':
      return Object.fromEntries((schema.required ?? []).map(key => [key, minimal(schema.properties?.[key] ?? { type: 'string' })]));
    default: return 'node-1';
  }
}

async function connect(): Promise<Client> {
  const server = createMcpServer({ issuer: ISSUER });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'gate-test', version: '0.0.0' });
  await Promise.all([server.connect(st), client.connect(ct)]);
  return client;
}

test('the list this file walks is the list of tools that declare a login', async () => {
  const client = await connect();
  try {
    const { tools } = await client.listTools();
    // A read tool declares `noauth` beside `oauth2` (it works either way); a
    // curation tool declares the login ALONE.
    const schemesOf = (t: { _meta?: unknown }) =>
      ((t._meta as { securitySchemes?: Array<{ type: string }> } | undefined)?.securitySchemes ?? []).map(s => s.type);
    const declaring = tools
      .filter(t => schemesOf(t).includes('oauth2') && !schemesOf(t).includes('noauth'))
      .map(t => t.name);
    assert.deepEqual([...declaring].sort(), [...CURATION_TOOLS].sort(),
      'a curation tool missing from tests/curation-tools.ts is a tool no gate test calls');
  } finally { await client.close(); }
});

for (const [who, credential] of [['an anonymous caller', null], ['the service account without WLO_ALLOW_SERVICE_WRITES', SERVICE]] as const) {
  test(`every curation tool refuses ${who} — challenge in _meta, nothing sent upstream`, async () => {
    assert.equal(ALLOW_SERVICE_WRITES, false, 'precondition: the suite runs without WLO_ALLOW_SERVICE_WRITES');
    setServiceCredentialForTest(credential);
    const mock = installFetchMock(url => { throw new Error(`unexpected upstream call: ${url}`); });
    const client = await connect();
    try {
      const { tools } = await client.listTools();
      const failures: string[] = [];
      for (const name of CURATION_TOOLS) {
        const tool = tools.find(t => t.name === name);
        assert.ok(tool, `${name} is listed`);
        const before = mock.calls.length;
        let result: Awaited<ReturnType<Client['callTool']>>;
        try {
          result = await client.callTool({ name, arguments: minimal(tool.inputSchema as Schema) as Record<string, unknown> });
        } catch (err) {
          failures.push(`${name}: the call threw instead of answering — ${err instanceof Error ? err.message : String(err)}`);
          continue;
        }
        const code = (result.structuredContent as { error?: { code?: string } } | undefined)?.error?.code;
        const challenge = (result._meta as Record<string, unknown> | undefined)?.['mcp/www_authenticate'];
        // `login_required` proves the GATE answered: an argument the schema refused
        // would also be an error and also send nothing.
        if (result.isError !== true) failures.push(`${name}: not refused`);
        if (code !== 'login_required') failures.push(`${name}: code ${String(code)} instead of login_required`);
        if (!Array.isArray(challenge) || challenge.length !== 1 || !/^Bearer .*resource_metadata="https:\/\/wlo\.example\//.test(String(challenge[0]))) {
          failures.push(`${name}: no login challenge in _meta — ${JSON.stringify(challenge)}`);
        }
        if (mock.calls.length !== before) failures.push(`${name}: ${mock.calls.length - before} upstream call(s) before the refusal`);
      }
      assert.deepEqual(failures, []);
      assert.equal(mock.calls.length, 0);
    } finally {
      mock.restore();
      setServiceCredentialForTest(null);
      await client.close();
    }
  });
}
