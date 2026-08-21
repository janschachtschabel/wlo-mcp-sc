/**
 * tools-knowledge.test.ts – The ChatGPT knowledge convention tools `search`
 * and `fetch`. Both must return the FIXED shapes AND duplicate the JSON in
 * content[0].text.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock, makeNode } from './fetchMock.js';
import { TRUNCATION_MARKER } from '../src/text-cap.js';

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

test('search cites a topic page by its topic-page URL, not the render URL', async () => {
  // Live check 2026-08-09 (staging): the topic page "Wellenoptik" came back from
  // `search` as .../components/render/<id>. formatNode fills `url` from
  // node.content.url for a collection node, so `url || topicPageUrl` never
  // reached the second branch. The mock reproduces that populated content.url —
  // without it the bug is invisible, because an empty `url` falls through.
  const topicPage = {
    ...makeNode('tp1', 'Wellenoptik', { 'ccm:page_config_ref': ['pc1'] }),
    type: 'ccm:map',
    content: { url: 'https://repo.example/edu-sharing/components/render/tp1' },
  };
  const mock = installFetchMock((url) => {
    if (url.includes('/children')) return { json: { nodes: [topicPage] } };
    if (url.includes('/collections')) return { json: { nodes: [] } };
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'search', arguments: { query: 'Wellenoptik' } });
    const sc = result.structuredContent as { results: Array<{ id: string; url: string }> };
    const hit = sc.results.find(r => r.id === 'tp1');
    assert.ok(hit, 'the topic page is among the results');
    assert.match(hit!.url, /\/components\/topic-pages\?collectionId=tp1$/, 'cites the topic page itself');
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

test('fetch cites a topic page by its topic-page URL, not the render URL', async () => {
  // Same fallback chain as `search`, same defect — see the note there.
  const topicPage = {
    ...makeNode('tp1', 'Wellenoptik', { 'ccm:page_config_ref': ['pc1'] }),
    type: 'ccm:map',
    content: { url: 'https://repo.example/edu-sharing/components/render/tp1' },
  };
  const mock = installFetchMock((url) => {
    if (url.includes('/textContent')) return { json: { content: 'Wellenoptik beschreibt …' } };
    if (url.includes('/metadata')) return { json: { node: topicPage } };
    return { json: {} };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'fetch', arguments: { id: 'tp1' } });
    const sc = result.structuredContent as { url: string };
    assert.match(sc.url, /\/components\/topic-pages\?collectionId=tp1$/, 'cites the topic page itself');
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

// ── the fetch document budget + the compendium regression (2026-08-20) ───────
// The user raised the fixed cap to 100 000 ("10 000 klingt zu wenig"). And
// while touching the site, the preference "curated compendium first" turned out
// to be DEAD since the hasCompendium change: `f.compendiumText` is never set by
// formatNode any more, so a collection fetch silently served its description.

test('fetch delivers a long document text uncut up to 100000 chars', async () => {
  const big = 'Satz ueber Optik und Lichtbrechung. '.repeat(1_600) + 'ENDE DES LANGEN DOKUMENTS';
  const mock = installFetchMock((url) => {
    if (url.includes('/textContent')) return { json: { content: big } };
    if (url.includes('/metadata')) return { json: { node: makeNode('x2', 'Langes Dokument') } };
    return { json: {} };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'fetch', arguments: { id: 'x2' } });
    const sc = result.structuredContent as { text: string };
    assert.ok(sc.text.endsWith('ENDE DES LANGEN DOKUMENTS'), 'the tail must arrive');
    assert.ok(!sc.text.includes(TRUNCATION_MARKER), 'nothing may be cut');
  } finally { await client.close(); mock.restore(); }
});

test('fetch on a collection serves the COMPENDIUM as the document body', async () => {
  const compendium = 'KOMPENDIUM-ANFANG. ' + 'Weltwissen und Lehrplanbezug der Sammlung. '.repeat(500);
  const mock = installFetchMock((url) => {
    if (url.includes('/textContent')) return { status: 404, json: {} };
    if (url.includes('/metadata')) {
      return { json: { node: makeNode('coll-1', 'Sammlung Optik', {
        'ccm:oeh_collection_compendium_text': [compendium],
      }) } };
    }
    return { json: {} };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'fetch', arguments: { id: 'coll-1' } });
    const sc = result.structuredContent as { text: string };
    assert.ok(sc.text.startsWith('KOMPENDIUM-ANFANG.'),
      'the richest body is the compendium, not the description');
  } finally { await client.close(); mock.restore(); }
});

test('fetch cuts at the 100000 cap with the marker, never silently', async () => {
  const big = 'Wort '.repeat(24_000) + 'ENDE HINTER DEM DECKEL';
  const mock = installFetchMock((url) => {
    if (url.includes('/textContent')) return { json: { content: big } };
    if (url.includes('/metadata')) return { json: { node: makeNode('x3', 'Sehr langes Dokument') } };
    return { json: {} };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'fetch', arguments: { id: 'x3' } });
    const sc = result.structuredContent as { text: string };
    assert.ok(sc.text.includes(TRUNCATION_MARKER), 'the cut is disclosed');
    assert.ok(!sc.text.includes('ENDE HINTER DEM DECKEL'), 'the tail past the cap is gone');
    assert.ok(sc.text.length <= 100_000 + TRUNCATION_MARKER.length, 'cut at the cap');
  } finally { await client.close(); mock.restore(); }
});
