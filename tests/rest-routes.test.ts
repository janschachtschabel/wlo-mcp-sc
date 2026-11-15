import { test } from 'node:test';
import assert from 'node:assert/strict';

import { routeRestRequest } from '../src/rest/routes.js';
import { installFetchMock, makeNode } from './fetchMock.js';

/** Route the upstream calls the four services make, offline. */
function installServiceMock() {
  const rawConfig = JSON.stringify({ structure: { swimlanes: [
    { heading: 'Einführung', type: 'container', grid: [{ item: 'ai-text' }] },
  ] } });
  return installFetchMock((url) => {
    // content search
    if (url.includes('/ngsearch')) {
      return { json: { nodes: [makeNode('c-1', 'Arbeitsblatt Optik')], pagination: { total: 5, from: 0, count: 1 } } };
    }
    // collection keyword search
    if (url.includes('/collections')) {
      return { json: { nodes: [
        makeNode('coll-1', 'Sammlung Optik'),
        makeNode('tp-1', 'Themenseite Optik', { 'ccm:page_config_ref': ['workspace://SpacesStore/cfg-tp-1'] }),
      ] } };
    }
    // wikipedia summary
    if (url.includes('/page/summary/')) {
      return { json: { type: 'standard', title: 'Optik', extract: 'Die Optik.', content_urls: { desktop: { page: 'https://de.wikipedia.org/wiki/Optik' } }, lang: 'de' } };
    }
    // compendium / node metadata
    if (url.includes('/metadata')) {
      if (url.includes('with-text')) {
        return { json: { node: makeNode('with-text', 'Sammlung Optik', { 'ccm:oeh_collection_compendium_text': ['Volles Kompendium.'] }) } };
      }
      if (url.includes('no-text')) return { json: { node: makeNode('no-text', 'Sammlung Leer') } };
      if (url.includes('tp-1')) {
        return { json: { node: makeNode('tp-1', 'Themenseite Optik', { 'ccm:page_config_ref': ['workspace://SpacesStore/cfg-tp-1'] }) } };
      }
    }
    // topic-page variant (children of the config folder)
    if (url.includes('/children') && url.includes('cfg-tp-1')) {
      return { json: { nodes: [makeNode('var-1', 'Variante', { 'ccm:page_variant_config': [rawConfig], 'cclom:title': ['Variante Ideal'] })] } };
    }
    return { json: {} };
  });
}

// ── path routing ─────────────────────────────────────────────────────────────

test('routeRestRequest returns null for a non-/api path (falls through to MCP/404)', async () => {
  assert.equal(await routeRestRequest('GET', '/health'), null);
  assert.equal(await routeRestRequest('POST', '/mcp'), null);
});

test('routeRestRequest returns null for an unknown /api path', async () => {
  assert.equal(await routeRestRequest('GET', '/api/does-not-exist'), null);
});

test('routeRestRequest rejects a non-GET method on a known /api path with 405', async () => {
  const r = await routeRestRequest('POST', '/api/search?q=optik');
  assert.equal(r?.status, 405);
});

test('GET /api/skills/%ZZ (malformed percent-escape) → 400, never a rejected promise', async () => {
  // Regression (deep-audit #2): decodeURIComponent threw OUTSIDE the try →
  // unhandled rejection at the http.ts call site → socket held ~30 s.
  const r = await routeRestRequest('GET', '/api/skills/%ZZ');
  assert.equal(r?.status, 400);
  assert.match((r!.json as { error: string }).error, /skill id/i);
});

// ── /api/search ──────────────────────────────────────────────────────────────

test('GET /api/search returns the combined envelope', async () => {
  const mock = installServiceMock();
  try {
    const r = await routeRestRequest('GET', '/api/search?q=optik');
    assert.equal(r?.status, 200);
    const env = r!.json as { query: string; content: { results: unknown[] }; collections: { results: { title?: string }[] }; topicPages: { results: unknown[] } };
    assert.equal(env.query, 'optik');
    assert.equal(env.content.results.length, 1);
    assert.deepEqual(env.collections.results.map(x => x.title), ['Sammlung Optik']);
    assert.equal(env.topicPages.results.length, 1);
  } finally {
    mock.restore();
  }
});

// DELIBERATE contract change (live-diagnosed 2026-07-17): AI fetch layers strip
// the query string from model-built URLs, so a bare /api/search was the #1 call
// shape in the wild — and a 400 status is a dead end there (the model never saw
// the JSON error body, only the status). A 200 with an envelope-shaped body +
// warnings reaches the model and teaches it the stripping-proof path form.
// Genuinely invalid input (over-long q, bogus fields) still 400s below.
test('GET /api/search without q → 200 guidance envelope (fetch layers strip query strings)', async () => {
  const r = await routeRestRequest('GET', '/api/search');
  assert.equal(r?.status, 200);
  const env = r!.json as { query: string; content: { results: unknown[] }; warnings: string[] };
  assert.equal(env.query, '', 'empty query echo → the template query-check flags it as stale');
  assert.equal(env.content.results.length, 0);
  assert.ok(env.warnings.some(w => /api\/search\//.test(w)), 'warning teaches the path form');
  assert.ok(env.warnings.some(w => /stripped/i.test(w)), 'warning names the stripped-query cause');
});

// ── path form /api/search/<term> (survives query-string stripping) ───────────

test('GET /api/search/<term> (path form) returns the combined envelope', async () => {
  const mock = installServiceMock();
  try {
    const r = await routeRestRequest('GET', '/api/search/optik');
    assert.equal(r?.status, 200);
    const env = r!.json as { query: string; content: { results: unknown[] } };
    assert.equal(env.query, 'optik');
    assert.equal(env.content.results.length, 1);
  } finally {
    mock.restore();
  }
});

test('GET /api/search/<term> keeps optional query-param filters when present', async () => {
  const mock = installServiceMock();
  try {
    const r = await routeRestRequest('GET', '/api/search/optik?discipline=Physik');
    assert.equal(r?.status, 200);
    assert.equal((r!.json as { query: string }).query, 'optik');
  } finally {
    mock.restore();
  }
});

test('GET /api/search/<term>?q=… lets the explicit q parameter win', async () => {
  const mock = installServiceMock();
  try {
    const r = await routeRestRequest('GET', '/api/search/ignored?q=optik');
    assert.equal((r!.json as { query: string }).query, 'optik');
  } finally {
    mock.restore();
  }
});

test('GET /api/search/%ZZ (malformed percent-escape) → 400, never a rejected promise', async () => {
  const r = await routeRestRequest('GET', '/api/search/%ZZ');
  assert.equal(r?.status, 400);
});

test('GET /api/search with an over-long query → 400', async () => {
  const q = 'a'.repeat(201);
  const r = await routeRestRequest('GET', `/api/search?q=${q}`);
  assert.equal(r?.status, 400);
});

test('GET /api/search?fields=title,url projects each result item (token saving)', async () => {
  const mock = installServiceMock();
  try {
    const r = await routeRestRequest('GET', '/api/search?q=optik&fields=title,url');
    assert.equal(r?.status, 200);
    const env = r!.json as { content: { results: Record<string, unknown>[] } };
    const item = env.content.results[0];
    // nodeId is always kept; only the requested fields remain — no description/publisher/etc.
    assert.deepEqual(Object.keys(item).sort(), ['nodeId', 'title', 'url']);
    assert.equal(item.title, 'Arbeitsblatt Optik');
  } finally {
    mock.restore();
  }
});

test('GET /api/search?fields=bogus → 400 before any upstream call', async () => {
  const r = await routeRestRequest('GET', '/api/search?q=optik&fields=bogus');
  assert.equal(r?.status, 400);
  assert.match((r!.json as { error: string }).error, /subset of/);
});

test('GET /api/search surfaces unresolvedFilters (+ suggestions) for a mistyped filter', async () => {
  const mock = installServiceMock();
  try {
    const r = await routeRestRequest('GET', '/api/search?q=optik&educationalContext=Grundshule');
    assert.equal(r?.status, 200);
    const env = r!.json as { unresolvedFilters?: { field: string; value: string; suggestions?: string[] }[] };
    assert.ok(env.unresolvedFilters, 'expected unresolvedFilters in the REST envelope');
    const hit = env.unresolvedFilters!.find(u => u.field === 'educationalContext');
    assert.equal(hit?.value, 'Grundshule');
    assert.ok(hit?.suggestions?.includes('Grundschule'), 'expected a "did you mean" suggestion');
  } finally {
    mock.restore();
  }
});

test('GET /api/search omits unresolvedFilters when every filter resolves', async () => {
  const mock = installServiceMock();
  try {
    const r = await routeRestRequest('GET', '/api/search?q=optik&discipline=Mathematik');
    assert.equal(r?.status, 200);
    assert.equal((r!.json as { unresolvedFilters?: unknown }).unresolvedFilters, undefined);
  } finally {
    mock.restore();
  }
});

const VIDEO_URI = 'http://w3id.org/openeduhub/vocabs/new_lrt_aggregated/38774279-af36-4ec2-8e70-811d5a51a6a1';

/** Like installServiceMock, but returns facet buckets when a facet search fires. */
function installServiceMockWithFacets() {
  return installFetchMock((url, init) => {
    if (url.includes('/collections')) return { json: { nodes: [] } };
    if (String(init?.body ?? '').includes('"facets"')) {
      return { json: { facets: [
        { property: 'ccm:oeh_lrt_aggregated', values: [{ value: VIDEO_URI, count: 1203 }] },
      ], pagination: { total: 5000, from: 0, count: 0 } } };
    }
    if (url.includes('/ngsearch')) {
      return { json: { nodes: [makeNode('c-1', 'Arbeitsblatt Optik')], pagination: { total: 5, from: 0, count: 1 } } };
    }
    return { json: {} };
  });
}

test('GET /api/search?includeFacets=1 returns resolved facet counts with uri (for generic clients)', async () => {
  const mock = installServiceMockWithFacets();
  try {
    const r = await routeRestRequest('GET', '/api/search?q=optik&includeFacets=1');
    assert.equal(r?.status, 200);
    const env = r!.json as { facets?: Record<string, { label: string; count: number; uri: string }[]> };
    assert.deepEqual(env.facets?.learningResourceType, [{ label: 'Video', count: 1203, uri: VIDEO_URI }]);
  } finally {
    mock.restore();
  }
});

test('GET /api/search without includeFacets → no facets key and no facet request', async () => {
  const mock = installServiceMock();
  try {
    const r = await routeRestRequest('GET', '/api/search?q=optik');
    assert.equal(r?.status, 200);
    assert.equal((r!.json as { facets?: unknown }).facets, undefined);
    assert.ok(!mock.calls.some(c => String(c.init?.body ?? '').includes('"facets"')), 'no facet request should fire');
  } finally {
    mock.restore();
  }
});

// ── /api/wikipedia ───────────────────────────────────────────────────────────

test('GET /api/wikipedia returns a summary', async () => {
  const mock = installServiceMock();
  try {
    const r = await routeRestRequest('GET', '/api/wikipedia?q=Optik');
    assert.equal(r?.status, 200);
    assert.equal((r!.json as { title: string }).title, 'Optik');
  } finally {
    mock.restore();
  }
});

test('GET /api/wikipedia without q → 400', async () => {
  const r = await routeRestRequest('GET', '/api/wikipedia');
  assert.equal(r?.status, 400);
});

test('GET /api/wikipedia with a malformed lang → 400 before any upstream call', async () => {
  const mock = installServiceMock();
  try {
    const r = await routeRestRequest('GET', '/api/wikipedia?q=Optik&lang=deutsch');
    assert.equal(r?.status, 400);
    assert.match((r!.json as { error: string }).error, /lang/);
    assert.equal(mock.calls.length, 0, 'validation must reject before fetching');
  } finally {
    mock.restore();
  }
});

test('GET /api/wikipedia with no matching article → 404', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/page/summary/')) return { status: 404, json: {} };
    if (url.includes('/w/api.php')) return { json: ['q', [], [], []] }; // opensearch: no title
    return { json: {} };
  });
  try {
    const r = await routeRestRequest('GET', '/api/wikipedia?q=Nichtsdergleichen');
    assert.equal(r?.status, 404);
  } finally {
    mock.restore();
  }
});

// ── /api/compendium ──────────────────────────────────────────────────────────

test('GET /api/compendium returns one entry per id', async () => {
  const mock = installServiceMock();
  try {
    const r = await routeRestRequest('GET', '/api/compendium?ids=with-text,no-text');
    assert.equal(r?.status, 200);
    const entries = (r!.json as { entries: { nodeId: string; compendiumText: string | null }[] }).entries;
    assert.deepEqual(entries.map(e => e.nodeId), ['with-text', 'no-text']);
    assert.equal(entries[0].compendiumText, 'Volles Kompendium.');
    assert.equal(entries[1].compendiumText, null);
  } finally {
    mock.restore();
  }
});

test('GET /api/compendium without ids → 400', async () => {
  const r = await routeRestRequest('GET', '/api/compendium');
  assert.equal(r?.status, 400);
});

test('GET /api/compendium with more than 25 ids → 400', async () => {
  const ids = Array.from({ length: 26 }, (_, i) => `id-${i}`).join(',');
  const r = await routeRestRequest('GET', `/api/compendium?ids=${ids}`);
  assert.equal(r?.status, 400);
});

test('GET /api/compendium with an over-long nodeId → 400', async () => {
  const r = await routeRestRequest('GET', `/api/compendium?nodeId=${'x'.repeat(51)}`);
  assert.equal(r?.status, 400);
});

// ── /api/collection ──────────────────────────────────────────────────────────

test('GET /api/collection lists a collection\'s file contents with downloadUrl', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/children')) {
      return { json: { nodes: [
        { ...makeNode('sk-1', 'WLO Search', { 'cclom:general_description': ['Find OER and summarise for the user.'] }),
          downloadUrl: 'https://redaktion.openeduhub.net/edu-sharing/eduservlet/download?nodeId=sk-1' },
      ], pagination: { total: 1, from: 0, count: 1 } } };
    }
    return { json: {} };
  });
  try {
    const r = await routeRestRequest('GET', '/api/collection?nodeId=skills-coll');
    assert.equal(r?.status, 200);
    const body = r!.json as { collectionId: string; query: string | null; total: number;
      results: { nodeId: string; title: string; description: string; downloadUrl: string }[] };
    assert.equal(body.collectionId, 'skills-coll');
    assert.equal(body.query, null);
    assert.equal(body.total, 1);
    assert.equal(body.results[0].nodeId, 'sk-1');
    assert.equal(body.results[0].title, 'WLO Search');
    assert.match(body.results[0].description, /Find OER/);
    assert.match(body.results[0].downloadUrl, /eduservlet\/download\?nodeId=sk-1/);
  } finally {
    mock.restore();
  }
});

test('GET /api/collection with q searches within the collection', async () => {
  // Scope = the collection's /children listing, matched locally: the backend
  // rejects a primaryparent-scoped ngsearch with 400 (live-verified).
  const mock = installFetchMock((url) => {
    if (url.includes('/children')) {
      return { json: { nodes: [
        makeNode('sk-2', 'Video Skill'),
        makeNode('sk-3', 'Textblatt'),
      ], pagination: { total: 2, from: 0, count: 2 } } };
    }
    return { json: {} };
  });
  try {
    const r = await routeRestRequest('GET', '/api/collection?nodeId=coll-1&q=video');
    assert.equal(r?.status, 200);
    const body = r!.json as { query: string; total: number; results: { nodeId: string }[] };
    assert.equal(body.query, 'video');
    assert.equal(body.total, 1, 'total = the filtered set');
    assert.equal(body.results[0].nodeId, 'sk-2');
    assert.ok(!mock.calls.some(c => c.url.includes('/ngsearch')), 'no primaryparent ngsearch');
  } finally {
    mock.restore();
  }
});

/**
 * `/api/collection?q=…` takes `license` like the other search paths and runs the
 * same exactness pass — but the response carried only the post-filter `total`,
 * so a filter that removed every child was indistinguishable from an empty
 * collection. Same disclosure contract as `/api/search`: `licenseFilter
 * {checked, kept}`.
 */
test('GET /api/collection with a licence discloses the exactness pass', async () => {
  // The BUNDLE is where this pass does the work: a single licence arrives as a
  // criterion and `nodeMatchesCriteria` already matches it exactly, but a SET is
  // not expressible upstream, so `buildFilterCriteria` only labels it and the
  // exactness pass is the only thing standing between `license=OER` and every
  // child of the collection.
  const mock = installFetchMock((url) => {
    if (url.includes('/children')) {
      return { json: { nodes: [
        makeNode('sk-2', 'Video offen lizenziert', { 'ccm:commonlicense_key': ['CC_BY'] }),
        makeNode('sk-4', 'Video NC-Verwandte', { 'ccm:commonlicense_key': ['CC_BY_NC'] }),
      ], pagination: { total: 2, from: 0, count: 2 } } };
    }
    return { json: {} };
  });
  try {
    const r = await routeRestRequest('GET', '/api/collection?nodeId=coll-1&q=video&license=OER');
    const body = r!.json as {
      total: number;
      results: { nodeId: string }[];
      licenseFilter?: { checked: number; kept: number };
    };
    assert.equal(body.results.length, 1, 'only the exact licence survives');
    assert.equal(body.results[0].nodeId, 'sk-2');
    assert.deepEqual(body.licenseFilter, { checked: 2, kept: 1 }, 'and the response says a pass ran');
  } finally {
    mock.restore();
  }
});

/**
 * Filters used to apply only alongside `q`, because a query-less call went to
 * the plain listing. Measured before the fix: `license=OER` over three children
 * returned all three — CC BY-NC-ND and an undeclared record included — with no
 * `licenseFilter` to show for it. The MCP tool never had this gap; its schema
 * says "Empty = all contents (filtered)" and it always matches locally.
 */
test('GET /api/collection applies filters without q too', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/children')) {
      return { json: { nodes: [
        makeNode('a', 'Offen', { 'ccm:commonlicense_key': ['CC_BY'] }),
        makeNode('b', 'NC-ND', { 'ccm:commonlicense_key': ['CC_BY_NC_ND'] }),
        makeNode('c', 'Ohne Lizenzangabe'),
      ], pagination: { total: 3, from: 0, count: 3 } } };
    }
    return { json: {} };
  });
  try {
    const r = await routeRestRequest('GET', '/api/collection?nodeId=coll-1&license=OER');
    const body = r!.json as {
      total: number;
      results: { nodeId: string }[];
      licenseFilter?: { checked: number; kept: number };
    };
    assert.deepEqual(body.results.map(x => x.nodeId), ['a'], 'only the OER record survives');
    assert.equal(body.total, 1);
    assert.deepEqual(body.licenseFilter, { checked: 3, kept: 1 });
  } finally {
    mock.restore();
  }
});

/**
 * Local matching reads at most 100 children in one call, so on a larger
 * collection the answer is a SAMPLE. The MCP tool says so ("Durchsucht wurden
 * die ersten 100 von N"); the REST response has to carry the same fact, or a
 * filtered result over a 900-item collection reads as exhaustive.
 */
test('GET /api/collection discloses when the matched window was a sample', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/children')) {
      return { json: { nodes: [makeNode('a', 'Video A')], pagination: { total: 150, from: 0, count: 1 } } };
    }
    return { json: {} };
  });
  try {
    const r = await routeRestRequest('GET', '/api/collection?nodeId=coll-1&q=video');
    const body = r!.json as { truncated?: boolean; collectionTotal?: number };
    assert.equal(body.truncated, true);
    assert.equal(body.collectionTotal, 150, 'how many the collection actually holds');
  } finally {
    mock.restore();
  }
});

/**
 * The plain listing must stay the plain listing: it pages upstream, while local
 * matching samples at most 100 children in one call. `maxItems` in the request
 * is what tells the two apart.
 */
test('GET /api/collection with neither q nor filters still lists upstream-paged', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/children')) {
      return { json: { nodes: [makeNode('a', 'Irgendwas')], pagination: { total: 1, from: 0, count: 1 } } };
    }
    return { json: {} };
  });
  try {
    await routeRestRequest('GET', '/api/collection?nodeId=coll-1&max=20');
    const children = mock.calls.find(c => c.url.includes('/children'));
    assert.match(children?.url ?? '', /maxItems=20/, 'the caller\'s page size, not the 100-child sampling window');
  } finally {
    mock.restore();
  }
});

test('GET /api/collection without a licence carries no licenseFilter field', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/children')) {
      return { json: { nodes: [makeNode('sk-2', 'Video Skill')], pagination: { total: 1, from: 0, count: 1 } } };
    }
    return { json: {} };
  });
  try {
    const r = await routeRestRequest('GET', '/api/collection?nodeId=coll-1&q=video');
    assert.equal((r!.json as { licenseFilter?: unknown }).licenseFilter, undefined);
  } finally {
    mock.restore();
  }
});

test('GET /api/collection without nodeId (and no WLO_SKILLS_COLLECTION_ID) → 400', async () => {
  const r = await routeRestRequest('GET', '/api/collection');
  assert.equal(r?.status, 400);
});

test('GET /api/collection?fields=title,url projects each result item', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/children')) {
      return { json: { nodes: [makeNode('sk-2', 'Video Skill')], pagination: { total: 1, from: 0, count: 1 } } };
    }
    return { json: {} };
  });
  try {
    const r = await routeRestRequest('GET', '/api/collection?nodeId=coll-1&q=video&fields=title,url');
    assert.equal(r?.status, 200);
    const body = r!.json as { results: Record<string, unknown>[] };
    assert.deepEqual(Object.keys(body.results[0]).sort(), ['nodeId', 'title', 'url']);
    assert.equal(body.results[0].title, 'Video Skill');
  } finally {
    mock.restore();
  }
});

test('GET /api/collection?fields=bogus → 400 before any upstream call', async () => {
  const r = await routeRestRequest('GET', '/api/collection?nodeId=coll-1&fields=bogus');
  assert.equal(r?.status, 400);
  assert.match((r!.json as { error: string }).error, /subset of/);
});

// ── /api/topic-page ──────────────────────────────────────────────────────────

test('GET /api/topic-page resolves swimlanes for a collectionId', async () => {
  const mock = installServiceMock();
  try {
    const r = await routeRestRequest('GET', '/api/topic-page?collectionId=tp-1');
    assert.equal(r?.status, 200);
    const payload = r!.json as { swimlanes: { heading: string }[] };
    assert.equal(payload.swimlanes[0].heading, 'Einführung');
  } finally {
    mock.restore();
  }
});

test('GET /api/topic-page without collectionId or variantId → 400', async () => {
  const r = await routeRestRequest('GET', '/api/topic-page');
  assert.equal(r?.status, 400);
});

/**
 * Same contract as `resolveStaticRoute`: an unparseable target belongs to no
 * route, so it is declined rather than thrown over. The throw used to escape
 * `handleRestRequest` into the http handler, whose returned promise node:http
 * never awaits — no response, socket held until `requestTimeout`.
 */
test('routeRestRequest declines a target that will not parse', async () => {
  for (const target of ['//[', '//[bad]x', '//user@[::1]x']) {
    assert.equal(await routeRestRequest('GET', target), null, target);
  }
});

/** Same total contract as the static router for a missing target. */
test('routeRestRequest declines when there is no target at all', async () => {
  assert.equal(await routeRestRequest('GET', undefined), null);
});
