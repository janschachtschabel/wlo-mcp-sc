// MUST stay the first import — see enable-extraction-env.ts. Without a
// configured service every call answers `service_disabled` and the tool's real
// paths stay untested.
import './enable-extraction-env.js';

/**
 * tools-url-text.test.ts – `get_url_text`, the one tool declared UNSAFE.
 *
 * Two things are pinned here that the service tests cannot see: that the tool is
 * actually offered to a host (it is registered by default, and the switch that
 * can remove it is covered in unsafe-gate.test.ts), and that a refusal still
 * produces a usable answer rather than an error — "we would not fetch that" is
 * a result, not a failure.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock, toolText } from './fetchMock.js';
import { urlTextSchema } from '../src/apps/outputSchemas.js';

const ARTICLE = 'Photosynthese ist der Vorgang, bei dem Pflanzen Lichtenergie nutzen. '.repeat(20);

/** Fakes the extraction service's POST /from-url. */
const extractionMock = (text: string) => installFetchMock(url => {
  assert.ok(url.includes('/from-url'), `unexpected upstream call: ${url}`);
  return { json: { text, lang: 'de', status: 'ok', version: '1' } };
});

test('get_url_text is offered to the host', async () => {
  const client = await connectedClient();
  try {
    const { tools } = await client.listTools();
    const tool = tools.find(t => t.name === 'get_url_text');
    assert.ok(tool, 'registered by default');
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(tool.annotations?.openWorldHint, true, 'it reaches an open-world external source');
    assert.match(tool.description ?? '', /unsicher|unsafe/i, 'the declaration must be visible to a host');
  } finally { await client.close(); }
});

test('a public URL yields the page text with its provenance', async () => {
  const mock = extractionMock(ARTICLE);
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'get_url_text',
      arguments: { url: 'https://de.wikipedia.org/wiki/Photosynthese' },
    });
    assert.notEqual(result.isError, true);
    const text = toolText(result);
    assert.match(text, /Quelle: https:\/\/de\.wikipedia\.org\/wiki\/Photosynthese/);
    assert.match(text, /Photosynthese ist der Vorgang/);
    const sc = urlTextSchema.parse(result.structuredContent);
    assert.equal(sc.url, 'https://de.wikipedia.org/wiki/Photosynthese');
    assert.equal(sc.reason, undefined);
    assert.ok(sc.charCount > 200);
  } finally { await client.close(); mock.restore(); }
});

test('a loopback URL is refused, and nothing is fetched', async () => {
  const mock = installFetchMock(url => {
    throw new Error(`nothing may be fetched for a refused URL, but got ${url}`);
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'get_url_text',
      arguments: { url: 'http://127.0.0.1:8080/admin' },
    });
    assert.notEqual(result.isError, true, 'a refusal is a result, not a tool error');
    assert.match(toolText(result), /private_host/);
    assert.equal(mock.calls.length, 0, 'the guard runs before the request, not after');
    const sc = urlTextSchema.parse(result.structuredContent);
    assert.equal(sc.reason, 'private_host');
    assert.equal(sc.text, '');
  } finally { await client.close(); mock.restore(); }
});

test('json output returns the structured payload only', async () => {
  const mock = extractionMock(ARTICLE);
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'get_url_text',
      arguments: { url: 'https://example.com/artikel', outputFormat: 'json' },
    });
    const parsed = JSON.parse(toolText(result));
    assert.equal(parsed.url, 'https://example.com/artikel');
    urlTextSchema.parse(result.structuredContent);
  } finally { await client.close(); mock.restore(); }
});

test('a truncated text discloses the cut and the full length', async () => {
  const mock = extractionMock(ARTICLE);
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'get_url_text',
      arguments: { url: 'https://example.com/artikel', maxChars: 500 },
    });
    const sc = urlTextSchema.parse(result.structuredContent);
    assert.equal(sc.truncated, true);
    assert.ok(sc.charCount > 500, 'charCount is the full length');
    assert.match(toolText(result), /gekürzt/);
  } finally { await client.close(); mock.restore(); }
});

test('a URL the schema rejects never reaches the handler', async () => {
  const mock = installFetchMock(url => { throw new Error(`unexpected upstream call: ${url}`); });
  const client = await connectedClient();
  try {
    let rejected = false;
    try {
      const result = await client.callTool({ name: 'get_url_text', arguments: { url: 'kein-url' } });
      rejected = result.isError === true;
    } catch { rejected = true; }
    assert.equal(mock.calls.length, 0);
    assert.equal(rejected, true);
  } finally { await client.close(); mock.restore(); }
});

// Same widened ceiling as get_wlo_content_text (2026-08-20): 50 000 → 200 000,
// default unchanged. The extraction service itself never caps (measured), so
// the schema bound was the only thing between a caller and the whole page.
test('maxChars 200000 is accepted and the page text arrives uncut', async () => {
  const big = 'Absatz ueber Photosynthese und Lichtenergie. '.repeat(3_500) + 'LETZTER SATZ DER SEITE';
  const mock = extractionMock(big);
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'get_url_text',
      arguments: { url: 'https://de.wikipedia.org/wiki/Photosynthese', maxChars: 200_000 },
    });
    assert.notEqual(result.isError, true, 'the ceiling must admit 200000');
    const sc = urlTextSchema.parse(result.structuredContent);
    assert.equal(sc.truncated, false);
    assert.ok((sc.text ?? '').endsWith('LETZTER SATZ DER SEITE'), 'the tail must arrive');
  } finally { await client.close(); mock.restore(); }
});

// The DEFAULT is the ceiling too (2026-08-20, user decision): no maxChars → whole page.
test('a call without maxChars delivers a long page uncut', async () => {
  const big = 'Absatz ueber Photosynthese und Lichtenergie. '.repeat(3_500) + 'LETZTER SATZ DER SEITE';
  const mock = extractionMock(big);
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'get_url_text',
      arguments: { url: 'https://de.wikipedia.org/wiki/Photosynthese' },
    });
    const sc = urlTextSchema.parse(result.structuredContent);
    assert.equal(sc.truncated, false, 'the default must not cut a 150k page');
    assert.ok((sc.text ?? '').endsWith('LETZTER SATZ DER SEITE'));
  } finally { await client.close(); mock.restore(); }
});
