import { test } from 'node:test';
import assert from 'node:assert/strict';

import { enhancedSearch } from '../src/reranker.js';
import { connectedClient, installFetchMock, makeNode, toolText } from './fetchMock.js';

// ── enhancedSearch: RRF merge + quality rank + dedup + deleted filter ─────────

test('enhancedSearch ranks the title match first, drops deleted nodes, reports API total', async () => {
  const nodes = [
    makeNode('other', 'Zellbiologie Grundlagen'),
    makeNode('good', 'Bruchrechnung Klasse 6', { 'cclom:general_keyword': ['bruchrechnung', 'brüche'] }),
    makeNode('gone', 'Element wurde gelöscht'),
  ];
  // Every query variant hits the same /ngsearch endpoint; return the same set
  // with a large backend total to verify total propagation from the full: variant.
  const mock = installFetchMock((url) => {
    assert.ok(url.includes('/ngsearch'), `unexpected url: ${url}`);
    return { json: { nodes, pagination: { total: 999, from: 0, count: nodes.length } } };
  });
  try {
    const res = await enhancedSearch('Bruchrechnung', 'FILES', [], 5);
    const ids = res.nodes.map(n => n.ref?.id);
    assert.equal(ids[0], 'good', 'title match should rank first');
    assert.ok(!ids.includes('gone'), 'deleted node must be filtered out');
    // De-duplicated across the 5 variants: each id appears at most once.
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(res.pagination.total, 999, 'total must come from the backend, not the page size');
    assert.ok(mock.calls.length >= 1);
  } finally {
    mock.restore();
  }
});

test('enhancedSearch expands known synonyms into an extra query variant', async () => {
  // "ki" is mapped to "künstliche intelligenz" — searching one should also
  // search the other. Observable via the request bodies sent upstream.
  const mock = installFetchMock(() => ({ json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } }));
  try {
    await enhancedSearch('ki', 'FILES', [], 5);
    const bodies = mock.calls.map(c => String(c.init?.body ?? ''));
    assert.ok(
      bodies.some(b => b.includes('künstliche intelligenz')),
      'expected a query variant expanded to the synonym',
    );
  } finally {
    mock.restore();
  }
});

test('enhancedSearch: higher metadata quality wins when title relevance ties', async () => {
  // Both titles are an exact match for the query, so title score ties. The
  // node with license/description/vocab/publisher signals must rank first.
  const rich = makeNode('rich', 'Chemie interaktiv', {
    'cclom:general_description': ['Eine ausführliche interaktive Einführung in die Chemie mit vielen Experimenten und Aufgaben für den Unterricht in der Sekundarstufe.'],
    'ccm:commonlicense_key': ['CC_BY'],
    'ccm:taxonid': ['http://w3id.org/openeduhub/vocabs/discipline/100'],
    'ccm:educationalcontext': ['http://w3id.org/openeduhub/vocabs/educationalContext/sekundarstufe_1'],
    'ccm:oeh_publisher_combined': ['Serlo'],
    'ccm:wwwurl': ['https://example.org/chemie'],
  });
  const bare = makeNode('bare', 'Chemie interaktiv');
  const mock = installFetchMock(() => ({ json: { nodes: [bare, rich], pagination: { total: 2, from: 0, count: 2 } } }));
  try {
    const res = await enhancedSearch('Chemie interaktiv', 'FILES', [], 5);
    assert.equal(res.nodes[0]?.ref?.id, 'rich', 'richer metadata should rank first on a title tie');
  } finally {
    mock.restore();
  }
});

test('enhancedSearch: the quality floor ignores stopwords like the scorer does (audit #8)', async () => {
  // Query = 3 stopwords + 1 content term. Scoring only counts "optik", so the
  // floor must be calibrated on the same filtered term list. Before the fix the
  // floor was 4·3=12, the real match scored ~8 → NOTHING passed → the all-entries
  // fallback silently returned the junk node too.
  const good = makeNode('good', 'Optik Grundlagen');
  const junk = makeNode('junk', 'Zzz Chemie Basiswissen');
  const mock = installFetchMock(() => ({ json: { nodes: [junk, good], pagination: { total: 2, from: 0, count: 2 } } }));
  try {
    const res = await enhancedSearch('was ist die optik', 'FILES', [], 5);
    assert.deepEqual(res.nodes.map(n => n.ref?.id), ['good'], 'only the real match passes the floor');
  } finally {
    mock.restore();
  }
});

test('enhancedSearch with an empty query browses via the wildcard variant', async () => {
  const nodes = [makeNode('n1', 'Irgendein Material')];
  const mock = installFetchMock(() => ({ json: { nodes, pagination: { total: 5, from: 0, count: 1 } } }));
  try {
    const res = await enhancedSearch('', 'FILES', [], 5);
    assert.equal(res.nodes.length, 1);
    const bodies = mock.calls.map(c => String(c.init?.body ?? ''));
    assert.ok(bodies.some(b => b.includes('"values":["*"]')), 'empty query should send the wildcard browse variant');
  } finally {
    mock.restore();
  }
});

// ── search_wlo_content handler: end-to-end offline through the MCP client ──────

test('search_wlo_content returns formatted results plus a _queryMeta block', async () => {
  const nodes = [makeNode('c1', 'Bruchrechnung interaktiv', {
    'cclom:general_description': ['Interaktive Übungen'],
    'ccm:wwwurl': ['https://example.org/bruch'],
  })];
  const mock = installFetchMock(() => ({ json: { nodes, pagination: { total: 7, from: 0, count: 1 } } }));
  try {
    const client = await connectedClient();
    const result = await client.callTool({
      name: 'search_wlo_content',
      arguments: { query: 'Bruchrechnung', maxResults: 5 },
    });
    const text = toolText(result as any);
    assert.match(text, /Bruchrechnung interaktiv/);
    assert.match(text, /Gefundene Treffer gesamt: 7/);
    assert.match(text, /_queryMeta/);
    assert.match(text, /search_wlo_content/);
    await client.close();
  } finally {
    mock.restore();
  }
});

// ── get_collection_contents handler: excludeNodeIds filtering ─────────────────

test('get_collection_contents drops excluded node IDs from the output', async () => {
  const nodes = [
    makeNode('keep', 'Behaltenes Material'),
    makeNode('drop', 'Schon gesehen'),
  ];
  const mock = installFetchMock((url) => {
    assert.ok(url.includes('/children'), `unexpected url: ${url}`);
    return { json: { nodes, pagination: { total: 2, from: 0, count: 2 } } };
  });
  try {
    const client = await connectedClient();
    const result = await client.callTool({
      name: 'get_collection_contents',
      arguments: { nodeId: 'coll-1', excludeNodeIds: ['drop'] },
    });
    const text = toolText(result as any);
    assert.match(text, /Behaltenes Material/);
    assert.doesNotMatch(text, /Schon gesehen/);
    await client.close();
  } finally {
    mock.restore();
  }
});

// ── wlo_health_check handler: ok and error paths ──────────────────────────────

test('wlo_health_check reports ok when the root node resolves', async () => {
  const mock = installFetchMock((url) => {
    assert.ok(url.includes('/metadata'), `unexpected url: ${url}`);
    return { json: { node: makeNode('root', 'WLO Root', { 'cclom:title': ['WLO Root'] }) } };
  });
  try {
    const client = await connectedClient();
    const result = await client.callTool({ name: 'wlo_health_check', arguments: {} });
    const payload = JSON.parse(toolText(result as any));
    assert.equal(payload.ok, true);
    assert.equal(payload.rootResolved, 'WLO Root');
    assert.equal(typeof payload.latencyMs, 'number');
    await client.close();
  } finally {
    mock.restore();
  }
});

test('wlo_health_check reports not-ok when the repository returns an error', async () => {
  const mock = installFetchMock(() => ({ status: 503, json: { error: 'down' } }));
  try {
    const client = await connectedClient();
    const result = await client.callTool({ name: 'wlo_health_check', arguments: {} });
    const payload = JSON.parse(toolText(result as any));
    assert.equal(payload.ok, false);
    await client.close();
  } finally {
    mock.restore();
  }
});
