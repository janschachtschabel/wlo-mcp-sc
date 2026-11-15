/**
 * write-surface-1113.test.ts – chatbot feedback 2026-11-13 (addendum), the
 * small ones: B1 (several values for subject, level, type, target group), B2
 * (the vocabulary the write checks is listable) and Z5 (the create preview
 * names records filed under another spelling of the address).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { registerCurationContentTools } from '../src/tools/curation-content.js';
import { validateField } from '../src/services/write/fields.js';
import { LRT_CONCEPTS } from '../src/vocabs-lrt.js';
import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { connectedClient, installFetchMock, makeNode, toolText, type MockResult } from './fetchMock.js';

const MARIA: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };
const PHYSIK = 'http://w3id.org/openeduhub/vocabs/discipline/460';

async function curation(): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerCurationContentTools(server, 'Bearer error="invalid_request"');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  return c;
}

const token = (r: unknown) => String(((r as { structuredContent?: { confirm?: { token?: string } } }).structuredContent?.confirm)?.token ?? '');

// ── B1 ───────────────────────────────────────────────────────────────────────

test('B1: subject takes a LIST — a record can keep Physik and gain Mathematik', async () => {
  setServiceCredentialForTest(MARIA);
  const stored: Record<string, string[]> = { 'cclom:title': ['Licht'], 'ccm:taxonid': [PHYSIK] };
  const mock = installFetchMock((url, init): MockResult => {
    if ((init?.method ?? 'GET') !== 'GET') { Object.assign(stored, JSON.parse(String(init?.body ?? '{}'))); return { json: {} }; }
    return { json: { node: { ref: { id: 'n1', repo: '-home-' }, type: 'ccm:io', properties: stored } } };
  });
  try {
    const c = await curation();
    const args = { nodeId: 'n1', discipline: ['Physik', 'Mathematik'] };
    const preview = await c.callTool({ name: 'wlo_update_content', arguments: args });
    assert.match(toolText(preview), /Fach: „Physik“ → „Physik, Mathematik“/, toolText(preview));
    const done = await c.callTool({ name: 'wlo_update_content', arguments: { ...args, confirmToken: token(preview) } });
    assert.notEqual((done as { isError?: boolean }).isError, true, toolText(done));
    assert.equal(stored['ccm:taxonid']!.length, 2);
    assert.ok(stored['ccm:taxonid']!.includes(PHYSIK));
  } finally { setServiceCredentialForTest(null); mock.restore(); }
});

test('B1: the schema takes a list and says that these fields REPLACE', async () => {
  const client = await connectedClient();
  try {
    const { tools } = await client.listTools();
    const props = (tools.find(t => t.name === 'wlo_update_content')!.inputSchema as { properties: Record<string, { description?: string }> }).properties;
    for (const field of ['discipline', 'educationalContext', 'contentType', 'userRole']) {
      assert.match(JSON.stringify(props[field]), /ERSETZT/, field);
      assert.match(JSON.stringify(props[field]), /"array"/, field);
    }
    // Keywords are the one field that is merged — and still says so.
    assert.match(String(props['keywords']!.description), /HINZUGEFÜGT/);
  } finally { await client.close(); }
});

// ── B2 ───────────────────────────────────────────────────────────────────────

test('B2: every content type the vocabulary tool lists for WRITING is one the write accepts', async () => {
  const client = await connectedClient();
  try {
    const all = toolText(await client.callTool({ name: 'lookup_wlo_vocabulary', arguments: { vocabulary: 'contentType' } }));
    const names = [...all.matchAll(/^- \*\*(.+?)\*\*/gm)].map(m => m[1]!);
    assert.equal(names.length, LRT_CONCEPTS.length);
    // A name that stands for two concepts is refused by the write; for those the listing gives the URI.
    const uris = [...all.matchAll(/als Wert die URI angeben: (\S+)/g)].map(m => m[1]!);
    for (const name of names) {
      if (validateField('ccm:oeh_lrt', name).ok) continue;
      const mine = LRT_CONCEPTS.filter(c => c.label === name).map(c => c.uri);
      assert.ok(mine.length > 1 && mine.every(u => uris.includes(u)), `${name}: abgelehnt, und die Liste nennt keine URI dafür`);
    }
    for (const uri of uris) assert.equal(validateField('ccm:oeh_lrt', uri).ok, true, uri);
    assert.ok(uris.length >= 2);

    const narrowed = toolText(await client.callTool({ name: 'lookup_wlo_vocabulary', arguments: { vocabulary: 'contentType', query: 'Video' } }));
    const hits = [...narrowed.matchAll(/^- \*\*(.+?)\*\*/gm)].map(m => m[1]!);
    assert.ok(hits.length > 0 && hits.length < LRT_CONCEPTS.length, narrowed.slice(0, 300));
    assert.ok(hits.some(h => /Video/.test(h)));
  } finally { await client.close(); }
});

test('B2: the example in the field description is a value the write accepts', async () => {
  const client = await connectedClient();
  try {
    const { tools } = await client.listTools();
    const description = String((tools.find(t => t.name === 'wlo_create_content')!.inputSchema as
      { properties: Record<string, { description?: string }> }).properties['contentType']!.description);
    const examples = [...description.matchAll(/"([^"]+)"/g)].map(m => m[1]!).filter(e => e !== 'contentType');
    assert.ok(examples.length >= 2, description);
    for (const e of examples) assert.equal(validateField('ccm:oeh_lrt', e).ok, true, `„${e}“ steht als Beispiel in der Beschreibung`);
  } finally { await client.close(); }
});

// ── Z5 ───────────────────────────────────────────────────────────────────────

/** A repository holding ONE record, under the clean spelling of an address. */
function withStoredUrl(storedUrl: string, opts: { searchFails?: boolean } = {}) {
  return installFetchMock((url, init): MockResult => {
    if (url.includes('/ngsearch')) {
      const body = String(init?.body ?? '');
      if (opts.searchFails && !body.includes('utm_source')) return { status: 503, json: {} };
      const asked = (JSON.parse(body) as { criteria: Array<{ property: string; values: string[] }> }).criteria
        .find(c => c.property === 'ccm:wwwurl')?.values[0];
      const hit = asked === storedUrl ? [{ ...makeNode('alt-1', 'Optik-Seite'), properties: { 'cclom:title': ['Optik-Seite'], 'ccm:wwwurl': [storedUrl] } }] : [];
      return { json: { nodes: hit, pagination: { total: hit.length, from: 0, count: hit.length } } };
    }
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
}

test('Z5: the create preview names a record filed under a cleaned spelling — and still offers the key', async () => {
  setServiceCredentialForTest(MARIA);
  const mock = withStoredUrl('https://example.org/optik');
  try {
    const c = await curation();
    const r = await c.callTool({ name: 'wlo_create_content', arguments: { title: 'Optik', url: 'https://example.org/optik/?utm_source=mail' } });
    assert.notEqual((r as { isError?: boolean }).isError, true, toolText(r));
    assert.match(toolText(r), /anderen Schreibweise derselben Adresse/);
    assert.match(toolText(r), /alt-1/);
    assert.ok(token(r), 'a note, not a refusal — the person decides');
  } finally { setServiceCredentialForTest(null); mock.restore(); }
});

test('Z5: a similar-address search that failed is SAID in the preview — and the key is still offered', async () => {
  setServiceCredentialForTest(MARIA);
  const mock = withStoredUrl('https://example.org/optik', { searchFails: true });
  try {
    const c = await curation();
    const r = await c.callTool({ name: 'wlo_create_content', arguments: { title: 'Optik', url: 'https://example.org/optik/?utm_source=mail' } });
    assert.notEqual((r as { isError?: boolean }).isError, true, toolText(r));
    assert.match(toolText(r), /ließ sich gerade nicht prüfen/);
    assert.doesNotMatch(toolText(r), /anderen Schreibweise derselben Adresse/);
    assert.ok(token(r), 'not being able to look is no refusal');
  } finally { setServiceCredentialForTest(null); mock.restore(); }
});

test('Z5: with the other searches down, the exact spelling is STILL refused', async () => {
  setServiceCredentialForTest(MARIA);
  // Only the search for the spelling as given answers; the cleaned ones fail.
  const stored = 'https://example.org/optik/?utm_source=mail';
  const mock = withStoredUrl(stored, { searchFails: true });
  try {
    const c = await curation();
    const r = await c.callTool({ name: 'wlo_create_content', arguments: { title: 'Optik', url: stored } });
    assert.equal((r as { isError?: boolean }).isError, true, toolText(r));
    assert.equal((r as { structuredContent?: { error?: { code?: string } } }).structuredContent?.error?.code, 'exists');
    assert.equal(token(r), '');
  } finally { setServiceCredentialForTest(null); mock.restore(); }
});

test('Z5: the preview asks each spelling of the address ONCE, and a spelling differing only in case is refused, not noted', async () => {
  setServiceCredentialForTest(MARIA);
  const mock = withStoredUrl('https://example.org/optik');
  try {
    const c = await curation();
    await c.callTool({ name: 'wlo_create_content', arguments: { title: 'Akustik', url: 'https://example.org/akustik/?utm_source=mail' } });
    const asked = mock.calls.filter(k => k.url.includes('/ngsearch')).map(k =>
      (JSON.parse(String(k.init?.body)) as { criteria: Array<{ property: string; values: string[] }> }).criteria
        .find(x => x.property === 'ccm:wwwurl')?.values[0]);
    assert.equal(asked.length, 3, asked.join(' | '));
    assert.equal(new Set(asked).size, 3, 'no spelling twice');
  } finally { mock.restore(); }

  // The repository's criterion ignores case; the stored spelling differs in case only.
  const cased = installFetchMock((url): MockResult => {
    const hit = url.includes('/ngsearch')
      ? [{ ...makeNode('alt-1', 'Optik-Seite'), properties: { 'cclom:title': ['Optik-Seite'], 'ccm:wwwurl': ['https://Example.org/Optik'] } }] : [];
    return { json: { nodes: hit, pagination: { total: hit.length, from: 0, count: hit.length } } };
  });
  try {
    const c = await curation();
    const r = await c.callTool({ name: 'wlo_create_content', arguments: { title: 'Optik', url: 'https://example.org/optik' } });
    assert.equal((r as { structuredContent?: { error?: { code?: string; existing?: { nodeId?: string } } } }).structuredContent?.error?.code, 'exists', toolText(r));
    assert.equal(token(r), '');
  } finally { setServiceCredentialForTest(null); cased.restore(); }
});

test('Z5: no such record, no note; the exact spelling is still refused as before', async () => {
  setServiceCredentialForTest(MARIA);
  const mock = withStoredUrl('https://example.org/optik');
  try {
    const c = await curation();
    const other = await c.callTool({ name: 'wlo_create_content', arguments: { title: 'Akustik', url: 'https://example.org/akustik' } });
    assert.doesNotMatch(toolText(other), /Schreibweise/);
    const exact = await c.callTool({ name: 'wlo_create_content', arguments: { title: 'Optik', url: 'https://example.org/optik' } });
    assert.equal((exact as { isError?: boolean }).isError, true);
    assert.equal(token(exact), '');
  } finally { setServiceCredentialForTest(null); mock.restore(); }
});
