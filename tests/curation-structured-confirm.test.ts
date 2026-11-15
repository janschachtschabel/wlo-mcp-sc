/**
 * curation-structured-confirm.test.ts – the confirmation, readable by a program.
 *
 * Until 2026-11-06 the key lived only in the preview TEXT ("… confirmToken: …"),
 * and the BOERDi chatbot pulled it out with a regular expression — one wording
 * change away from breaking every write it offers. The preview now also carries
 * `structuredContent.confirm`; the text stays for people.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { registerCurationContentTools } from '../src/tools/curation-content.js';
import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { TOKEN_TTL_MS } from '../src/services/write/confirm.js';
import { connectedClient, installFetchMock, toolText } from './fetchMock.js';

const USER: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };
const NODE = 'node-1';

async function curationClient(): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerCurationContentTools(server, 'Bearer error="invalid_request"');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), client.connect(ct)]);
  return client;
}

interface StructuredConfirm {
  token: string;
  expiresAt: string;
  preview: {
    action: string;
    tool: string;
    target: { nodeId: string; kind: string; title: string };
    fields: Array<{
      name: string; label: string; old: string[] | null; new: string[] | null;
      oldLabels?: string[] | null; newLabels?: string[] | null;
    }>;
  };
}

test('a preview carries the key and the change as structured content, matching the text', async () => {
  setServiceCredentialForTest(USER);
  // Stores what is written, so the tool's read-back sees the new value.
  const stored: Record<string, string[]> = { 'cclom:title': ['Alt'] };
  const mock = installFetchMock((_url, init) => {
    if ((init?.method ?? 'GET') === 'GET') return { json: { node: { ref: { id: NODE, repo: '-home-' }, properties: { ...stored } } } };
    Object.assign(stored, JSON.parse(String(init?.body ?? '{}')));
    return { json: {} };
  });
  const client = await curationClient();
  try {
    const before = Date.now();
    const res = await client.callTool({ name: 'wlo_update_content', arguments: { nodeId: NODE, title: 'Neu' } });
    const confirm = (res.structuredContent as { confirm?: StructuredConfirm } | undefined)?.confirm;
    assert.ok(confirm, 'structuredContent.confirm is present');
    assert.ok(toolText(res).includes(`confirmToken: ${confirm.token}`), 'the SAME key the text names');
    const expires = Date.parse(confirm.expiresAt);
    assert.ok(expires >= before + TOKEN_TTL_MS && expires <= Date.now() + TOKEN_TTL_MS, 'expiry is the token\'s own');
    assert.equal(confirm.preview.action, 'change');
    assert.equal(confirm.preview.tool, 'wlo_update_content', 'names WHICH write, so create and update read differently');
    assert.equal(confirm.preview.target.nodeId, NODE);
    assert.deepEqual(confirm.preview.fields, [{ name: 'cclom:title', label: 'Titel', old: ['Alt'], new: ['Neu'] }]);

    // And it works: the structured key performs the write.
    const done = await client.callTool({
      name: 'wlo_update_content', arguments: { nodeId: NODE, title: 'Neu', confirmToken: confirm.token },
    });
    assert.ok(mock.calls.some(c => (c.init?.method ?? 'GET') !== 'GET'), 'the write went out');
    assert.notEqual(done.isError, true);
  } finally {
    await client.close(); mock.restore(); setServiceCredentialForTest(null);
  }
});

test('a deletion preview says so in the structured action', async () => {
  setServiceCredentialForTest(USER);
  const mock = installFetchMock(() => ({
    json: { node: { ref: { id: NODE, repo: '-home-' }, type: 'ccm:io', properties: { 'cclom:title': ['Weg damit'] } } },
  }));
  const client = await connectedClient();
  try {
    const res = await client.callTool({ name: 'wlo_delete_content', arguments: { nodeId: NODE } });
    const confirm = (res.structuredContent as { confirm?: StructuredConfirm } | undefined)?.confirm;
    assert.ok(confirm, toolText(res));
    assert.equal(confirm.preview.action, 'delete');
    assert.equal(confirm.preview.tool, 'wlo_delete_content');
    assert.equal(confirm.preview.target.title, 'Weg damit');
  } finally {
    await client.close(); mock.restore(); setServiceCredentialForTest(null);
  }
});

test('the batch upload tools are wired into the server — behind their switch', async () => {
  const names = async () => {
    const c = await connectedClient();
    try { return (await c.listTools()).tools.map(t => t.name); } finally { await c.close(); }
  };
  const batch = ['wlo_prepare_file_batch', 'wlo_store_batch_file', 'wlo_store_batch_manifest'];
  const saved = process.env['WLO_BATCH_UPLOAD_ENABLED'];
  try {
    delete process.env['WLO_BATCH_UPLOAD_ENABLED'];
    const off = await names();
    for (const n of batch) assert.ok(!off.includes(n), `${n} stays absent while the switch is off`);
    process.env['WLO_BATCH_UPLOAD_ENABLED'] = '1';
    const on = await names();
    for (const n of batch) assert.ok(on.includes(n), `${n} is listed once the operator switches it on`);
  } finally {
    if (saved === undefined) delete process.env['WLO_BATCH_UPLOAD_ENABLED'];
    else process.env['WLO_BATCH_UPLOAD_ENABLED'] = saved;
  }
});

test('a vocabulary field carries its labels beside the stored URIs; a free-text field does not', async () => {
  setServiceCredentialForTest(USER);
  const mock = installFetchMock(() => ({
    json: { node: { ref: { id: NODE, repo: '-home-' }, properties: { 'cclom:title': ['Alt'] } } },
  }));
  const client = await curationClient();
  try {
    const res = await client.callTool({
      name: 'wlo_update_content',
      arguments: { nodeId: NODE, title: 'Neu', educationalContext: 'Sekundarstufe I' },
    });
    const fields = (res.structuredContent as { confirm: StructuredConfirm }).confirm.preview.fields;
    const level = fields.find(f => f.name === 'ccm:educationalcontext');
    assert.ok(level, JSON.stringify(fields));
    assert.match(String(level.new?.[0]), /^http:\/\/w3id\.org\/.*sekundarstufe_1$/, 'the stored value stays the URI');
    assert.deepEqual(level.newLabels, ['Sekundarstufe I'], 'and its label rides along');
    const title = fields.find(f => f.name === 'cclom:title');
    assert.ok(title && !('newLabels' in title), 'no labels where the value IS the label');
  } finally {
    await client.close(); mock.restore(); setServiceCredentialForTest(null);
  }
});

test('nothing to confirm says so in structured content instead of leaving it out', async () => {
  setServiceCredentialForTest(USER);
  const mock = installFetchMock(() => ({
    json: { node: { ref: { id: NODE, repo: '-home-' }, properties: { 'cclom:title': ['Gleich'] } } },
  }));
  const client = await curationClient();
  try {
    const res = await client.callTool({ name: 'wlo_update_content', arguments: { nodeId: NODE, title: 'Gleich' } });
    assert.deepEqual(res.structuredContent, { confirm: null, unchanged: true });
  } finally {
    await client.close(); mock.restore(); setServiceCredentialForTest(null);
  }
});
