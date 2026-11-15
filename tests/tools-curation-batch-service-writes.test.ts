/**
 * The batch tools' OWN personal-login refusal (chatbot feedback 2026-11-07,
 * point 8). It only fires when the operator allows service-account writes —
 * then the curation gate lets the service account through and `personal()`
 * is what refuses. That refusal must ask the client to sign in, like the gate.
 *
 * `WLO_ALLOW_SERVICE_WRITES` is read at module load, so it is set before the
 * dynamic imports; the test runner gives each file its own process.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env['WLO_ALLOW_SERVICE_WRITES'] = '1';
process.env['WLO_BATCH_UPLOAD_ENABLED'] = '1';

test('a service account allowed to write is still refused here — with the sign-in challenge', async () => {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const { registerCurationBatchTools } = await import('../src/tools/curation-batch.js');
  const { setServiceCredentialForTest } = await import('../src/auth/credential.js');
  const { installFetchMock } = await import('./fetchMock.js');

  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerCurationBatchTools(server, 'Bearer error="invalid_request"');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'c', version: '0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  setServiceCredentialForTest({ header: 'Basic y', label: 'dienst', source: 'service' });
  const mock = installFetchMock(() => ({ json: {} }));
  try {
    const r = await c.callTool({ name: 'wlo_prepare_file_batch', arguments: {
      target: 'home', folderName: 'X', entries: [{ title: 'a', sha256: 'a'.repeat(64), size: 1, ext: 'pdf' }] } });
    const s = r as { structuredContent?: { error?: { code?: string } }; _meta?: Record<string, unknown> };
    assert.equal(s.structuredContent?.error?.code, 'login_required');
    assert.deepEqual(s._meta?.['mcp/www_authenticate'], ['Bearer error="invalid_request"']);
    assert.equal(mock.calls.length, 0);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});
