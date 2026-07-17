import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock, makeNode } from './fetchMock.js';

const EMPTY_SEARCH = () => ({ json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } });

function queryMetaOf(result: unknown): any {
  const parts = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  const metaPart = parts.find(p => typeof p.text === 'string' && p.text.includes('_queryMeta'));
  assert.ok(metaPart, 'expected a _queryMeta content part');
  return JSON.parse(metaPart!.text as string)._queryMeta;
}

test('search_wlo_content: an unresolvable filter is surfaced in _queryMeta.unresolvedFilters', async () => {
  const mock = installFetchMock(EMPTY_SEARCH);
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_content',
      arguments: { query: 'mathe', discipline: 'GibtEsNicht12345', outputFormat: 'json' },
    });
    const meta = queryMetaOf(result);
    assert.deepEqual(meta.unresolvedFilters, [{ field: 'discipline', value: 'GibtEsNicht12345' }]);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('search_wlo_content: a fuzzy-matchable typo filter surfaces a visible suggestion hint', async () => {
  const mock = installFetchMock(EMPTY_SEARCH);
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_content',
      arguments: { query: 'mathe', discipline: 'Matematik', outputFormat: 'json' },
    });
    const parts = (result as { content: Array<{ text?: string }> }).content;
    // The suggestion rides as its own visible content block, not only in _queryMeta.
    const hintPart = parts.find(p => typeof p.text === 'string' && p.text.includes('Meintest du'));
    assert.ok(hintPart, 'expected a visible "Meintest du" hint block');
    assert.match(hintPart!.text as string, /Mathematik/);
    // The hint block must NOT corrupt the json envelope in the first part.
    assert.doesNotThrow(() => JSON.parse(parts[0]!.text as string));
    // And it also rides in _queryMeta for machine consumers.
    const meta = queryMetaOf(result);
    assert.ok(meta.unresolvedFilters[0].suggestions.includes('Mathematik'));
  } finally {
    await client.close();
    mock.restore();
  }
});

test('search_wlo_content: all-resolvable filters emit no unresolvedFilters key', async () => {
  const mock = installFetchMock(EMPTY_SEARCH);
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_content',
      arguments: { query: 'mathe', discipline: 'Mathematik', outputFormat: 'json' },
    });
    const meta = queryMetaOf(result);
    assert.equal(meta.unresolvedFilters, undefined);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('search_wlo_content: exclusions do not cap results below maxResults (regression H1)', async () => {
  // The mock echoes the requested maxItems as its node count, so the internal
  // fetch-pool size directly determines how many results come back. The bug:
  // with excludeNodeIds set, pool was hard-capped at 20 even for maxResults>20.
  const mock = installFetchMock((url) => {
    if (url.includes('/ngsearch')) {
      const max = Number(new URL(url).searchParams.get('maxItems') ?? '0');
      const nodes = Array.from({ length: max }, (_, i) => makeNode(`n${i}`, `Titel ${i}`));
      return { json: { nodes, pagination: { total: 999, from: 0, count: nodes.length } } };
    }
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_content',
      arguments: { query: '', maxResults: 30, excludeNodeIds: ['not-in-results'], outputFormat: 'json' },
    });
    const results = firstResults(result);
    assert.equal(results.length, 30, 'with exclusions set, up to maxResults items must still be returned');
  } finally {
    await client.close();
    mock.restore();
  }
});

test('search_wlo_content: skipCount is forwarded to the backend as the search offset', async () => {
  const mock = installFetchMock(EMPTY_SEARCH);
  const client = await connectedClient();
  try {
    await client.callTool({
      name: 'search_wlo_content',
      arguments: { query: 'mathe', skipCount: 8, maxResults: 5, outputFormat: 'json' },
    });
    const searchCalls = mock.calls.filter(c => c.url.includes('/ngsearch'));
    assert.ok(searchCalls.length > 0, 'expected at least one ngsearch call');
    assert.ok(
      searchCalls.every(c => c.url.includes('skipCount=8')),
      `expected every ngsearch call to use skipCount=8, got: ${searchCalls.map(c => c.url).join(' | ')}`,
    );
  } finally {
    await client.close();
    mock.restore();
  }
});

test('search_wlo_content: skipCount defaults to 0 (offset omitted → first page)', async () => {
  const mock = installFetchMock(EMPTY_SEARCH);
  const client = await connectedClient();
  try {
    await client.callTool({
      name: 'search_wlo_content',
      arguments: { query: 'mathe', maxResults: 5, outputFormat: 'json' },
    });
    const searchCalls = mock.calls.filter(c => c.url.includes('/ngsearch'));
    assert.ok(searchCalls.every(c => c.url.includes('skipCount=0')), 'default page must be offset 0');
  } finally {
    await client.close();
    mock.restore();
  }
});

// ── #3: optional inline full text ──────────────────────────────────────
/** Search returns one node; the /textContent endpoint returns stored text. */
function installSearchWithText() {
  return installFetchMock((url) => {
    if (url.includes('/textContent')) return { json: { content: 'Volltext-Auszug für n1' } };
    return { json: { nodes: [makeNode('n1', 'Titel n1')], pagination: { total: 1, from: 0, count: 1 } } };
  });
}

function firstResults(result: unknown): any[] {
  const parts = (result as { content?: Array<{ text?: string }> }).content ?? [];
  const envelope = JSON.parse(parts[0]!.text as string);
  return envelope.results;
}

test('search_wlo_content: includeTextContent enriches each result with textContent', async () => {
  const mock = installSearchWithText();
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_content',
      arguments: { query: 'mathe', includeTextContent: true, outputFormat: 'json' },
    });
    const results = firstResults(result);
    assert.match(results[0].textContent, /Volltext-Auszug für n1/);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('search_wlo_content: without includeTextContent, no textContent and no extra fetch', async () => {
  const mock = installSearchWithText();
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_content',
      arguments: { query: 'mathe', outputFormat: 'json' },
    });
    const results = firstResults(result);
    assert.equal(results[0].textContent, undefined);
    assert.ok(!mock.calls.some(c => c.url.includes('/textContent')));
  } finally {
    await client.close();
    mock.restore();
  }
});

// ── #4: opt-in facet counts (inline, resolved to labels) ───────────────
const VIDEO_URI = 'http://w3id.org/openeduhub/vocabs/new_lrt_aggregated/38774279-af36-4ec2-8e70-811d5a51a6a1';

/** Routes the facet-carrying ngsearch (body contains "facets") vs a normal search. */
function installSearchWithFacets() {
  return installFetchMock((_url, init) => {
    const body = String(init?.body ?? '');
    if (body.includes('"facets"')) {
      return { json: { facets: [
        { property: 'ccm:oeh_lrt_aggregated', values: [{ value: VIDEO_URI, count: 1203 }] },
      ], pagination: { total: 5000, from: 0, count: 0 } } };
    }
    return { json: { nodes: [makeNode('n1', 'Titel n1')], pagination: { total: 5000, from: 0, count: 1 } } };
  });
}

test('search_wlo_content: includeFacets adds resolved facet counts to _queryMeta', async () => {
  const mock = installSearchWithFacets();
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_content',
      arguments: { query: 'mathe', includeFacets: true, outputFormat: 'json' },
    });
    const meta = queryMetaOf(result);
    assert.deepEqual(meta.facets.learningResourceType, [{ label: 'Video', count: 1203, uri: VIDEO_URI }]);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('search_wlo_content: without includeFacets, no facets key and no facet request', async () => {
  const mock = installSearchWithFacets();
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_content',
      arguments: { query: 'mathe', outputFormat: 'json' },
    });
    const meta = queryMetaOf(result);
    assert.equal(meta.facets, undefined);
    assert.ok(!mock.calls.some(c => String(c.init?.body ?? '').includes('"facets"')));
  } finally {
    await client.close();
    mock.restore();
  }
});

test('search_wlo_all: includeWikipedia surfaces a wikipedia summary in the envelope (tool delegates to searchAll)', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/page/summary/')) return { json: {
      type: 'standard', title: 'Mathematik', extract: 'Mathematik ist eine Wissenschaft.',
      content_urls: { desktop: { page: 'https://de.wikipedia.org/wiki/Mathematik' } }, lang: 'de',
    } };
    if (url.includes('/collections')) return { json: { nodes: [] } };
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_all',
      arguments: { query: 'mathe', include: ['content'], includeWikipedia: true },
    });
    // Format-independent: the envelope always rides in structuredContent.
    const env = (result as { structuredContent: { wikipedia?: { title: string; extract: string } } }).structuredContent;
    assert.equal(env.wikipedia?.title, 'Mathematik');
    assert.match(env.wikipedia?.extract ?? '', /Wissenschaft/);
    // The markdown default renders the Wikipedia section into the text too.
    const parts = (result as { content: Array<{ text?: string }> }).content;
    assert.match(parts[0]!.text ?? '', /# Wikipedia/);
    assert.match(parts[0]!.text ?? '', /Mathematik/);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('search_wlo_all: includeFacets adds facet counts to the content _queryMeta', async () => {
  const mock = installFetchMock((url, init) => {
    const body = String(init?.body ?? '');
    if (url.includes('/collections')) return { json: { nodes: [] } };
    if (body.includes('"facets"')) return { json: { facets: [
      { property: 'ccm:oeh_lrt_aggregated', values: [{ value: VIDEO_URI, count: 900 }] },
    ], pagination: { total: 900, from: 0, count: 0 } } };
    return { json: { nodes: [makeNode('c1', 'Inhalt 1')], pagination: { total: 900, from: 0, count: 1 } } };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_all',
      arguments: { query: 'mathe', include: ['content'], includeFacets: true },
    });
    // First _queryMeta is the content sub-search.
    const meta = queryMetaOf(result);
    assert.deepEqual(meta.facets.learningResourceType, [{ label: 'Video', count: 900, uri: VIDEO_URI }]);
  } finally {
    await client.close();
    mock.restore();
  }
});
