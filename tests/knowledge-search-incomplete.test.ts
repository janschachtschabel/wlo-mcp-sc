/**
 * Lean `search` answers `{results}` and has no field for "a source did not
 * answer". An empty list over a search that did not fully answer is therefore
 * an ERROR — and one a program can read: it was free text without a code, and
 * the content leg's own `incomplete` was not looked at.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock, makeNode, toolText, type MockResult } from './fetchMock.js';

type Coded = { error?: { code?: string; message?: string }; results?: unknown[] };
const EMPTY: MockResult = { json: { nodes: [], collections: [], pagination: { total: 0, from: 0, count: 0 } } };

/** The search words of an `ngsearch` request body. */
function wordsOf(init?: RequestInit): string {
  try {
    const body = JSON.parse(String(init?.body ?? '{}')) as { criteria?: { property: string; values: string[] }[] };
    return body.criteria?.find(c => c.property === 'ngsearchword')?.values.join(' ') ?? '';
  } catch { return ''; }
}

test('search (lean): collections that did not answer and no hit — a CODED error', async () => {
  const mock = installFetchMock((url) => (url.includes('/collection') ? { status: 503, json: {} } : EMPTY));
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'search', arguments: { query: 'Photosynthese' } });
    assert.equal(result.isError, true);
    const structured = result.structuredContent as Coded;
    assert.equal(structured.error?.code, 'upstream_error');
    assert.match(structured.error?.message ?? '', /nicht \(vollständig\) geantwortet|nicht geantwortet|nicht erreichbar/);
    assert.equal(toolText(result), structured.error?.message);
  } finally { await client.close(); mock.restore(); }
});

test('search (lean): a content search whose variants did not all answer is not an empty result', async () => {
  // The full query fails, its shorter variant answers with nothing.
  const query = 'Arbeitsblatt Photosynthese Sekundarstufe I';
  const mock = installFetchMock((url, init) => {
    if (url.includes('/ngsearch') && wordsOf(init) === query) return { status: 500, json: {} };
    return EMPTY;
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'search', arguments: { query } });
    assert.equal(result.isError, true, 'not {results: []}');
    const structured = result.structuredContent as Coded;
    assert.equal(structured.error?.code, 'upstream_error');
    assert.match(structured.error?.message ?? '', /Inhaltssuche hat nicht \(vollständig\) geantwortet/);
  } finally { await client.close(); mock.restore(); }
});

test('search (lean): with hits the convention shape stays first and alone', async () => {
  const query = 'Arbeitsblatt Photosynthese Sekundarstufe I';
  const mock = installFetchMock((url, init) => {
    if (url.includes('/ngsearch') && wordsOf(init) === query) return { status: 500, json: {} };
    if (url.includes('/ngsearch')) return { json: { nodes: [makeNode('n1', 'Photosynthese')], pagination: { total: 1, from: 0, count: 1 } } };
    return EMPTY;
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'search', arguments: { query } });
    assert.notEqual(result.isError, true);
    assert.deepEqual(Object.keys(result.structuredContent as object), ['results']);
    assert.equal((result.structuredContent as Coded).results?.length, 1);
  } finally { await client.close(); mock.restore(); }
});

test('search (lean): everything answered and nothing matched stays a plain empty result', async () => {
  const mock = installFetchMock(() => EMPTY);
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'search', arguments: { query: 'Photosynthese' } });
    assert.notEqual(result.isError, true);
    assert.deepEqual(result.structuredContent, { results: [] });
  } finally { await client.close(); mock.restore(); }
});
