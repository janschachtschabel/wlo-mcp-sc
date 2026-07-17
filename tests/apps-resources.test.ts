import { test } from 'node:test';
import assert from 'node:assert/strict';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import {
  registerWidgetResource,
  computeWidgetUri,
  widgetResourceMeta,
  WIDGET_MIME_TYPE,
} from '../src/apps/resources.js';

async function connect(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

test('computeWidgetUri is content-addressed (stable per content, changes on edit)', () => {
  const a = computeWidgetUri('search-results', '<html>A</html>');
  const b = computeWidgetUri('search-results', '<html>A</html>');
  const c = computeWidgetUri('search-results', '<html>B</html>');
  assert.equal(a, b, 'same HTML → same URI');
  assert.notEqual(a, c, 'different HTML → different URI');
  assert.match(a, /^ui:\/\/widget\/search-results-[0-9a-f]{8}\.html$/);
});

test('widgetResourceMeta whitelists the configured edu-sharing origin in its CSP', () => {
  const meta = widgetResourceMeta() as {
    ui: { domain: string; csp: { connectDomains: string[]; resourceDomains: string[] } };
  };
  // Default WLO_REPOSITORY_URL is https://redaktion.openeduhub.net/edu-sharing.
  assert.equal(meta.ui.domain, 'https://redaktion.openeduhub.net');
  assert.ok(meta.ui.csp.connectDomains.includes('https://redaktion.openeduhub.net'));
  assert.ok(meta.ui.csp.resourceDomains.includes('https://redaktion.openeduhub.net'));
});

test('widgetResourceMeta carries a per-widget description (audit A-2)', () => {
  const meta = widgetResourceMeta('search-results') as {
    ui: { description?: string };
    'openai/widgetDescription'?: string;
  };
  assert.ok(meta.ui.description && meta.ui.description.length > 0, 'ui.description present');
  assert.equal(meta['openai/widgetDescription'], meta.ui.description, 'openai alias mirrors ui.description');
});

test('registerWidgetResource exposes a fetchable mcp-app resource with CSP metadata', async () => {
  const server = new McpServer({ name: 't', version: '0' });
  const html = '<!doctype html><html><body><div id="wlo-root"></div></body></html>';
  const uri = computeWidgetUri('search-results', html);
  registerWidgetResource(server, { name: 'search-results', uri, html });
  const client = await connect(server);

  const { resources } = await client.listResources();
  const entry = resources.find(r => r.uri === uri);
  assert.ok(entry, 'resource appears in resources/list');
  assert.equal(entry?.mimeType, WIDGET_MIME_TYPE);
  const metaUi = (entry?._meta as { ui?: { csp?: { connectDomains?: string[] } } })?.ui;
  assert.ok(metaUi?.csp?.connectDomains && metaUi.csp.connectDomains.length > 0, 'CSP _meta advertised');

  const read = await client.readResource({ uri });
  const first = read.contents[0];
  assert.ok(first && 'text' in first, 'widget resource must be a TEXT resource, not a blob');
  assert.equal(first.text, html, 'read returns the inlined widget HTML');
  assert.equal(first.mimeType, WIDGET_MIME_TYPE);
  // The Apps-SDK doc places the widget _meta (CSP/domain) on the READ contents
  // entry; hosts may read it from either surface, so both must carry it.
  const contentsUi = (first._meta as { ui?: { csp?: { connectDomains?: string[] } } } | undefined)?.ui;
  assert.ok(contentsUi?.csp?.connectDomains?.length, 'contents[] entry carries the widget _meta (CSP)');

  await client.close();
});

test('widgetResourceMeta: WLO_WIDGET_DOMAIN overrides the app identity domain only, not the CSP', () => {
  // `_meta.ui.domain` is the APP identity (unique per app at submission);
  // the CSP allowlist stays the DATA origin previews are fetched from.
  process.env['WLO_WIDGET_DOMAIN'] = 'https://mcp.wirlernenonline.de';
  try {
    const meta = widgetResourceMeta() as {
      ui: { domain: string; csp: { connectDomains: string[] } };
      'openai/widgetDomain'?: string;
    };
    assert.equal(meta.ui.domain, 'https://mcp.wirlernenonline.de');
    assert.equal(meta['openai/widgetDomain'], 'https://mcp.wirlernenonline.de');
    assert.ok(meta.ui.csp.connectDomains.includes('https://redaktion.openeduhub.net'),
      'CSP keeps the edu-sharing origin');
  } finally {
    delete process.env['WLO_WIDGET_DOMAIN'];
  }
});
