/**
 * tools-knowledge.test.ts – The ChatGPT knowledge convention tools `search`
 * and `fetch`. Both must return the FIXED shapes AND duplicate the JSON in
 * content[0].text.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock, makeNode } from './fetchMock.js';

test('search returns {results:[{id,title,url}]} and duplicates the JSON in content[0].text', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/collections')) return { json: { nodes: [] } };
    return { json: { nodes: [makeNode('n1', 'Titel n1')], pagination: { total: 1, from: 0, count: 1 } } };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'search', arguments: { query: 'mathe' } });
    const sc = result.structuredContent as { results: Array<{ id: string; title: string; url: string }> };
    assert.ok(Array.isArray(sc.results), 'results is an array');
    const hit = sc.results.find(r => r.id === 'n1');
    assert.ok(hit, 'n1 present');
    assert.equal(hit!.title, 'Titel n1');
    // A node with no www/topic URL still gets an absolute, openable link.
    assert.match(hit!.url, /\/components\/render\/n1$/, 'url falls back to the render URL');
    // content[0].text must be the SAME JSON (ChatGPT reads it there too).
    const text = (result.content as Array<{ text: string }>)[0].text;
    assert.deepEqual(JSON.parse(text), sc);
  } finally { await client.close(); mock.restore(); }
});

test('fetch returns {id,title,text,url,metadata} and duplicates the JSON in content[0].text', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/textContent')) return { json: { content: 'Voller Dokumenttext.' } };
    if (url.includes('/metadata')) return { json: { node: makeNode('x1', 'Dokument X', { 'ccm:wwwurl': ['https://example.org/x'] }) } };
    return { json: {} };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'fetch', arguments: { id: 'x1' } });
    const sc = result.structuredContent as { id: string; title: string; text: string; url: string; metadata?: unknown };
    assert.equal(sc.id, 'x1');
    assert.equal(sc.title, 'Dokument X');
    assert.match(sc.text, /Voller Dokumenttext/);
    assert.equal(sc.url, 'https://example.org/x');
    assert.ok(sc.metadata, 'metadata present');
    const text = (result.content as Array<{ text: string }>)[0].text;
    assert.deepEqual(JSON.parse(text), sc);
  } finally { await client.close(); mock.restore(); }
});

test('fetch on an unknown id returns an error result', async () => {
  const mock = installFetchMock(() => ({ json: {} }));
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'fetch', arguments: { id: 'nope' } });
    assert.equal(result.isError, true);
  } finally { await client.close(); mock.restore(); }
});
