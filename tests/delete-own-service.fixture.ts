/**
 * delete-own-service.fixture.ts – run by tests/delete-own.test.ts in a child
 * process WITH `WLO_ALLOW_SERVICE_WRITES=1` (read once at module load, so it
 * cannot be switched inside the test process). Not a test file itself.
 *
 * The service account here created the record itself, in its own home, unused
 * and private — every condition of the plan holds. The tool must still refuse:
 * "own" has no meaning for a shared account. Prints one JSON line.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { setServiceCredentialForTest } from '../src/auth/credential.js';
import { registerCurationDeleteOwnTool } from '../src/tools/curation-delete-own.js';
import { installFetchMock } from './fetchMock.js';

setServiceCredentialForTest({ header: 'Basic c2VydmljZTpwdw==', label: 'dienst', source: 'service' });
let deletes = 0;
const mock = installFetchMock((url, init) => {
  if ((init?.method ?? 'GET').toUpperCase() === 'DELETE') { deletes++; return { json: {} }; }
  if (url.includes('/iam/v1/people/-home-/-me-')) return { json: { person: { authorityName: 'dienst' } } };
  if (url.includes('/usage/v1/usages/node/')) return { json: { usages: [] } };
  if (url.includes('/-userhome-/metadata')) return { json: { node: { ref: { id: 'home-dienst' }, type: 'ccm:map', aspects: [], properties: {} } } };
  return { json: { node: {
    ref: { id: 'own' }, type: 'ccm:io', aspects: [], isPublic: false,
    properties: { 'cm:creator': ['dienst'], 'virtual:primaryparent_nodeid': ['home-dienst'], 'cclom:title': ['Eigen'] },
  } } };
});

const server = new McpServer({ name: 'test', version: '0.0.0' });
applyReadOnlyToolDefaults(server);
registerCurationDeleteOwnTool(server, 'Bearer error="invalid_request"');
const [ct, st] = InMemoryTransport.createLinkedPair();
const c = new Client({ name: 'fixture', version: '0.0.0' });
await Promise.all([server.connect(st), c.connect(ct)]);
const preview = await c.callTool({ name: 'wlo_delete_own_content', arguments: { nodeIds: ['own'] } });
const token = (preview.structuredContent as { confirm?: { token?: string } } | undefined)?.confirm?.token;
const done = token ? await c.callTool({ name: 'wlo_delete_own_content', arguments: { nodeIds: ['own'], confirmToken: token } }) : null;
await c.close();
mock.restore();
console.log(JSON.stringify({ previewError: preview.isError === true, structured: preview.structuredContent, keyIssued: Boolean(token), deletes, done: done?.structuredContent ?? null }));
