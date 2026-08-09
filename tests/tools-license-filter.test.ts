/**
 * tools-license-filter.test.ts – the `license` filter as the caller sees it.
 *
 * Measured on staging 2026-08-09 before this was built: `ccm:commonlicense_key`
 * narrows an ngsearch (query "Optik": 756 hits, 343 with `CC_BY`), while
 * `virtual:license` and `ccm:license` answer 400 `DAOValidationException`.
 * These tests pin that the resolved key reaches the upstream request from BOTH
 * search tools, and that an unrecognised licence is reported rather than
 * quietly narrowing the result set to nothing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LICENSE_PAGE, buildFilterCriteria, filterByExactLicense, pageSizeForLicense } from '../src/filter-criteria.js';
import { handleRestRequest } from '../src/rest/routes.js';
import { connectedClient, installFetchMock, makeNode, toolText } from './fetchMock.js';

/** The criteria of the last ngsearch POST the tool sent. */
function lastSearchCriteria(mock: { calls: Array<{ url: string; init?: RequestInit }> }) {
  const call = [...mock.calls].reverse().find(c => c.url.includes('ngsearch'));
  assert.ok(call, 'a search request was sent');
  return JSON.parse(String(call!.init?.body ?? '{}')).criteria as Array<{ property: string; values: string[] }>;
}

function searchMock() {
  return installFetchMock((url) => {
    if (url.includes('/collections') || url.includes('/children')) return { json: { nodes: [] } };
    return { json: { nodes: [makeNode('n1', 'Optik')], pagination: { total: 1, from: 0, count: 1 } } };
  });
}

test('search_wlo_content sends the resolved licence key upstream', async () => {
  const mock = searchMock();
  const client = await connectedClient();
  try {
    await client.callTool({
      name: 'search_wlo_content',
      arguments: { query: 'Optik', license: 'CC BY 4.0', outputFormat: 'json' },
    });
    const criteria = lastSearchCriteria(mock);
    const lic = criteria.find(c => c.property === 'ccm:commonlicense_key');
    assert.ok(lic, 'the licence criterion is present');
    assert.deepEqual(lic!.values, ['CC_BY']);
  } finally { await client.close(); mock.restore(); }
});

test('search_wlo_all sends the resolved licence key upstream', async () => {
  const mock = searchMock();
  const client = await connectedClient();
  try {
    await client.callTool({
      name: 'search_wlo_all',
      arguments: { query: 'Optik', license: 'CC BY-SA 4.0', outputFormat: 'json' },
    });
    const criteria = lastSearchCriteria(mock);
    const lic = criteria.find(c => c.property === 'ccm:commonlicense_key');
    assert.deepEqual(lic?.values, ['CC_BY_SA']);
  } finally { await client.close(); mock.restore(); }
});

test('an unrecognised licence is named in the visible output, not silently dropped', async () => {
  // A dropped licence filter is the dangerous kind: the caller believes the
  // results are CC-licensed when they are not filtered at all.
  const mock = searchMock();
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_content',
      arguments: { query: 'Optik', license: 'CC XY 9.9' },
    });
    const text = toolText(result);
    assert.match(text, /CC XY 9\.9/, 'the rejected value is named');
    assert.match(text, /license/, 'and which filter it was');
    const criteria = lastSearchCriteria(mock);
    assert.ok(!criteria.some(c => c.property === 'ccm:commonlicense_key'), 'nothing bogus is sent upstream');
  } finally { await client.close(); mock.restore(); }
});

test('the REST search endpoint forwards the licence filter', async () => {
  // A setting that only the MCP tools honour is half a feature: the REST layer
  // and the widgets read the same service.
  const mock = searchMock();
  try {
    const res = {
      rec: {} as { status?: number; body?: string },
      writeHead(status: number) { this.rec.status = status; },
      end(body?: string) { this.rec.body = body; },
    };
    const handled = await handleRestRequest(
      { method: 'GET', url: '/api/search?q=optik&license=' + encodeURIComponent('CC BY 4.0') },
      res,
    );
    assert.equal(handled, true);
    assert.equal(res.rec.status, 200);
    const lic = lastSearchCriteria(mock).find(c => c.property === 'ccm:commonlicense_key');
    assert.deepEqual(lic?.values, ['CC_BY']);
  } finally { mock.restore(); }
});

test('a licence filter returns ONLY that licence, not the whole family', async () => {
  // Measured on staging 2026-08-09: `ccm:commonlicense_key=CC_BY` narrows to 343
  // hits but returns CC BY-ND, CC BY-NC-SA and CC BY-NC-ND among them — the key
  // matches the CC-BY *family*, and quoting does not change it (343 either way).
  // Sub-keys are exact (CC_BY_SA 110, CC_BY_ND 19), so the ONE licence that
  // cannot be isolated upstream is plain CC BY — the one people filter for when
  // they need to remix. Returning No-Derivatives material under that filter is
  // the harmful direction, so exactness is enforced locally.
  const mock = installFetchMock((url) => {
    if (url.includes('/collections') || url.includes('/children')) return { json: { nodes: [] } };
    const nodes = [
      makeNode('exact', 'Genau CC BY', { 'ccm:commonlicense_key': ['CC_BY'] }),
      makeNode('nd', 'Keine Bearbeitung', { 'ccm:commonlicense_key': ['CC_BY_ND'] }),
      makeNode('ncsa', 'Nicht kommerziell', { 'ccm:commonlicense_key': ['CC_BY_NC_SA'] }),
    ];
    return { json: { nodes, pagination: { total: 343, from: 0, count: nodes.length } } };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_content',
      arguments: { query: 'Optik', license: 'CC BY 4.0', outputFormat: 'json' },
    });
    const sc = result.structuredContent as { total: number; results: Array<{ nodeId: string; license: string }> };
    assert.deepEqual(sc.results.map(r => r.nodeId), ['exact'], 'only the exact licence survives');
    // No facet block comes back here, so the total falls back to the upstream
    // number. What it is when the aggregation DOES answer — the exact count, not
    // this family total — is pinned in license-search.test.ts.
    assert.equal(sc.total, 343, 'the fallback keeps the upstream number');
  } finally { await client.close(); mock.restore(); }
});

test('a family key still returns its own members', async () => {
  // CC_BY_NC is itself a prefix of CC_BY_NC_SA upstream; asking for CC BY-NC
  // must not return the SA variant either.
  const mock = installFetchMock((url) => {
    if (url.includes('/collections') || url.includes('/children')) return { json: { nodes: [] } };
    const nodes = [
      makeNode('nc', 'NC', { 'ccm:commonlicense_key': ['CC_BY_NC'] }),
      makeNode('ncsa', 'NC-SA', { 'ccm:commonlicense_key': ['CC_BY_NC_SA'] }),
    ];
    return { json: { nodes, pagination: { total: 172, from: 0, count: nodes.length } } };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_content',
      arguments: { query: 'Optik', license: 'CC_BY_NC', outputFormat: 'json' },
    });
    const sc = result.structuredContent as { results: Array<{ nodeId: string }> };
    assert.deepEqual(sc.results.map(r => r.nodeId), ['nc']);
  } finally { await client.close(); mock.restore(); }
});

test('a licence filter takes more candidates, because the key over-matches', () => {
  // Without headroom the local exactness pass starves: measured live, "Optik"
  // + CC BY 4.0 has 343 backend hits, and the first page of ten contained not a
  // single exact CC BY record — the tool answered "0 Treffer" for a filter with
  // 343 hits behind it. The over-match is systematic for this one filter (the
  // key is a family prefix), so more candidates are taken only when it is used.
  //
  // Asserted on the number, not on the request: `enhancedSearch` always fetches
  // its own POOL_SIZE per query variant and uses this value to trim the ranked
  // merge — so widening shows up in how many candidates reach the licence pass,
  // never in the upstream `maxItems`.
  assert.equal(pageSizeForLicense(8, undefined), 8, 'unchanged without a licence filter');
  assert.equal(pageSizeForLicense(8, 'CC BY 4.0'), LICENSE_PAGE, 'widened with one');
  assert.equal(pageSizeForLicense(80, 'CC BY 4.0'), 80, 'never narrows a larger request');
});

test('an exact hit deep in the candidate list still surfaces', async () => {
  // 45 family members with the one exact CC BY record at position 45 — inside the widened window — which without
  // the widening it would be cut away before the licence pass ever saw it.
  const nodes = [
    ...Array.from({ length: 44 }, (_, i) =>
      makeNode(`nd${i}`, `ND ${i}`, { 'ccm:commonlicense_key': ['CC_BY_ND'], 'ccm:wwwurl': [`https://example.org/nd/${i}`] })),
    makeNode('deep', 'Genau CC BY', { 'ccm:commonlicense_key': ['CC_BY'], 'ccm:wwwurl': ['https://example.org/exact'] }),
  ];
  const mock = installFetchMock((url) => {
    if (url.includes('/collections') || url.includes('/children')) return { json: { nodes: [] } };
    return { json: { nodes, pagination: { total: 343, from: 0, count: nodes.length } } };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_content',
      arguments: { query: 'Optik', license: 'CC BY 4.0', maxResults: 8, outputFormat: 'json' },
    });
    const sc = result.structuredContent as { results: Array<{ nodeId: string }> };
    assert.deepEqual(sc.results.map(r => r.nodeId), ['deep']);
  } finally { await client.close(); mock.restore(); }
});

test('the OER bundle sends NO licence criterion — the repository cannot OR them', async () => {
  // Measured on staging 2026-08-09, and the reason this is not the obvious
  // multi-value criterion: two values at `ccm:commonlicense_key` answer
  // 400 DAOValidationException, the criterion repeated twice AND-s
  // (343 + 110 -> 110), and an "A OR B" string matches 0. The OR that works on
  // `ccm:oeh_extendedType` does NOT transfer. Narrowing on `CC_BY` instead
  // would keep both CC members but silently lose every public-domain record.
  const { criteria, labeled, unresolved } = buildFilterCriteria({ license: 'OER' });
  assert.equal(criteria.length, 0, 'nothing that would 400 goes upstream');
  assert.equal(unresolved.length, 0, 'and it is not treated as an unknown value');
  assert.deepEqual(
    [...(labeled.find(l => l.property === 'ccm:commonlicense_key')?.values ?? [])].sort(),
    ['CC_0', 'CC_BY', 'CC_BY_SA', 'COPYRIGHT_FREE', 'PDM'],
    'the selection is still reported, so _queryMeta shows what was applied',
  );
});

test('the OER bundle keeps its members and drops NC, ND and unclear licences', () => {
  const nodes = [
    { nodeId: 'by',    license: 'CC BY 4.0' },
    { nodeId: 'bysa',  license: 'CC BY-SA 4.0' },
    { nodeId: 'cc0',   license: 'CC 0' },
    { nodeId: 'nc',    license: 'CC BY-NC 4.0' },
    { nodeId: 'nd',    license: 'CC BY-ND 4.0' },
    { nodeId: 'ncsa',  license: 'CC BY-NC-SA 4.0' },
    { nodeId: 'custom', license: 'Individuelle Lizenz' },
    { nodeId: 'none',  license: '' },
  ];
  assert.deepEqual(
    filterByExactLicense(nodes, 'OER').map(n => n.nodeId),
    ['by', 'bysa', 'cc0'],
  );
});

test('a record whose licence is unknown is never reported as OER', () => {
  // The operator's rule, 2026-08-09: what is not declared cannot be declared
  // free. It matters at scale — 105 969 of staging's 403 431 records (26.3 %)
  // carry no `ccm:commonlicense_key` at all, and 88 200 of production's 318 696
  // (27.7 %). Treating "unknown" as "probably fine" would inflate the OER answer
  // by a quarter of the catalogue with material nobody has cleared.
  //
  // Its own test rather than one row in the bundle list above: a rule that
  // exists only as a list entry is one a refactor drops without noticing.
  const nodes = [
    { nodeId: 'declared', license: 'CC BY-SA 4.0' },
    { nodeId: 'empty', license: '' },
    { nodeId: 'blank', license: '   ' },
    { nodeId: 'unparseable', license: 'siehe Impressum der Anbieterin' },
  ];
  assert.deepEqual(filterByExactLicense(nodes, 'OER').map(n => n.nodeId), ['declared']);
  // Same for a single licence — the rule is about the missing declaration, not
  // about which licence was asked for.
  assert.deepEqual(filterByExactLicense(nodes, 'CC BY-SA 4.0').map(n => n.nodeId), ['declared']);
});

test('a single licence is unaffected by the bundle', () => {
  const nodes = [
    { nodeId: 'by',   license: 'CC BY 4.0' },
    { nodeId: 'bysa', license: 'CC BY-SA 4.0' },
  ];
  assert.deepEqual(filterByExactLicense(nodes, 'CC BY 4.0').map(n => n.nodeId), ['by']);
});

test('search_wlo_within_collection honours the licence filter', async () => {
  // Its filters are matched LOCALLY against the stored property
  // (`nodeMatchesCriteria` → exact `includes`), so the family over-match of the
  // search index does not apply here — but the parameter has to exist.
  const mock = installFetchMock((url) => {
    if (url.includes('/children')) {
      return { json: {
        nodes: [
          makeNode('by', 'Freies Material', { 'ccm:commonlicense_key': ['CC_BY'] }),
          makeNode('nc', 'Nicht kommerziell', { 'ccm:commonlicense_key': ['CC_BY_NC'] }),
        ],
        pagination: { total: 2, from: 0, count: 2 },
      } };
    }
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_within_collection',
      arguments: { nodeId: 'coll-1', license: 'CC BY 4.0', outputFormat: 'json' },
    });
    const sc = result.structuredContent as { results: Array<{ nodeId: string }> };
    assert.deepEqual(sc.results.map(r => r.nodeId), ['by']);
  } finally { await client.close(); mock.restore(); }
});

test('an empty licence result says WHY, instead of a bare "0 Treffer"', async () => {
  // Measured live: "Optik" + CC BY-NC 4.0 reports 172 backend hits and returns
  // none, because the checked candidates held only its NC-SA and NC-ND
  // relatives. Silence there reads as "there is nothing", which is false.
  const mock = installFetchMock((url) => {
    if (url.includes('/collections') || url.includes('/children')) return { json: { nodes: [] } };
    const nodes = [
      makeNode('a', 'NC-SA', { 'ccm:commonlicense_key': ['CC_BY_NC_SA'], 'ccm:wwwurl': ['https://example.org/a'] }),
      makeNode('b', 'NC-ND', { 'ccm:commonlicense_key': ['CC_BY_NC_ND'], 'ccm:wwwurl': ['https://example.org/b'] }),
    ];
    return { json: { nodes, pagination: { total: 172, from: 0, count: 2 } } };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_content',
      arguments: { query: 'Optik', license: 'CC BY-NC 4.0' },
    });
    const text = toolText(result);
    assert.match(text, /Kein Treffer mit genau der Lizenz "CC BY-NC 4\.0"/);
    assert.match(text, /2 geprüften Kandidaten/);
  } finally { await client.close(); mock.restore(); }
});

test('search_wlo_within_collection filters the OER bundle too', async () => {
  // The gap the single-licence test above could not see: a single licence
  // reaches this path as a CRITERION and `nodeMatchesCriteria` matches it
  // exactly, but the bundle contributes no criterion at all (a licence SET is
  // not expressible upstream, so `buildFilterCriteria` only labels it). Without
  // its own exactness pass this path answered `license: "OER"` with everything,
  // which is the worst possible failure for this parameter: the caller believes
  // the list is reusable material.
  const mock = installFetchMock((url) => {
    if (url.includes('/children')) {
      return { json: {
        nodes: [
          makeNode('sa', 'Freies Material', { 'ccm:commonlicense_key': ['CC_BY_SA'] }),
          makeNode('nd', 'Kein Remix erlaubt', { 'ccm:commonlicense_key': ['CC_BY_NC_ND'] }),
          makeNode('none', 'Ohne Lizenzangabe', {}),
        ],
        pagination: { total: 3, from: 0, count: 3 },
      } };
    }
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_within_collection',
      arguments: { nodeId: 'coll-1', license: 'OER', outputFormat: 'json' },
    });
    const sc = result.structuredContent as { results: Array<{ nodeId: string }>; total: number };
    assert.deepEqual(sc.results.map(r => r.nodeId), ['sa'], 'only the CC BY-SA record is reusable');
    assert.equal(sc.total, 1, 'the count reports the filtered set, not the collection');
  } finally { await client.close(); mock.restore(); }
});

test('an empty licence result in a collection says WHY there, too', async () => {
  // The licence pass introduced above can empty this path's result, and a bare
  // "0 Treffer" here has the same failure mode it has in search_wlo_content:
  // the caller reads it as "this collection holds nothing on the topic" and goes
  // looking elsewhere for material that is sitting right there under a licence
  // they did not ask for.
  const mock = installFetchMock((url) => {
    if (url.includes('/children')) {
      return { json: {
        nodes: [
          makeNode('nc', 'Nur NC', { 'ccm:commonlicense_key': ['CC_BY_NC_SA'] }),
          makeNode('nd', 'Nur ND', { 'ccm:commonlicense_key': ['CC_BY_NC_ND'] }),
        ],
        pagination: { total: 2, from: 0, count: 2 },
      } };
    }
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_within_collection',
      arguments: { nodeId: 'coll-1', license: 'OER' },
    });
    const text = toolText(result);
    assert.match(text, /Kein Treffer mit genau der Lizenz "OER"/);
    assert.match(text, /2 geprüften Kandidaten/);
  } finally { await client.close(); mock.restore(); }
});

test('search_wlo_all says WHY its licence filter emptied the content bucket', async () => {
  // The third search path with a `license` parameter, and the last one that
  // filtered silently. `search_wlo_content` and `search_wlo_within_collection`
  // both name the reason; here the drop happened inside `searchAll`, and the
  // envelope carried no number the tool could have said it with.
  const mock = installFetchMock((url) => {
    if (url.includes('/collections') || url.includes('/children')) return { json: { nodes: [] } };
    const nodes = [
      makeNode('nc', 'Nicht kommerziell', { 'ccm:commonlicense_key': ['CC_BY_NC_SA'], 'ccm:wwwurl': ['https://example.org/a'] }),
      makeNode('nd', 'Keine Bearbeitung', { 'ccm:commonlicense_key': ['CC_BY_NC_ND'], 'ccm:wwwurl': ['https://example.org/b'] }),
    ];
    return { json: { nodes, pagination: { total: 172, from: 0, count: nodes.length } } };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_all',
      arguments: { query: 'Optik', license: 'OER', include: ['content'] },
    });
    const text = toolText(result);
    assert.match(text, /Kein Treffer mit genau der Lizenz "OER"/);
    assert.match(text, /geprüften Kandidaten/);
  } finally { await client.close(); mock.restore(); }
});

test('search_wlo_all stays quiet when the licence filter dropped nothing', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/collections') || url.includes('/children')) return { json: { nodes: [] } };
    const nodes = [makeNode('sa', 'Frei', { 'ccm:commonlicense_key': ['CC_BY_SA'], 'ccm:wwwurl': ['https://example.org/a'] })];
    return { json: { nodes, pagination: { total: 1, from: 0, count: 1 } } };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_all',
      arguments: { query: 'Optik', license: 'OER', include: ['content'] },
    });
    assert.doesNotMatch(toolText(result), /genau der Lizenz/);
  } finally { await client.close(); mock.restore(); }
});

test('paging over the OER bundle says that the pages are not a continuation', async () => {
  // The bundle asks once per licence key and passes the SAME skipCount to each,
  // so page 2 is "the second page of every licence", not "the next 8 results".
  // Silently handing that back as a page looks like ordinary paging and quietly
  // repeats and skips material.
  const mock = searchMock();
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_content',
      arguments: { query: 'Optik', license: 'OER', skipCount: 8 },
    });
    const text = toolText(result);
    assert.match(text, /keine Fortsetzung/);
    assert.match(text, /excludeNodeIds/);
  } finally { await client.close(); mock.restore(); }
});

test('the paging notice is silent on the first page and for a single licence', async () => {
  const mock = searchMock();
  const client = await connectedClient();
  try {
    const first = await client.callTool({
      name: 'search_wlo_content',
      arguments: { query: 'Optik', license: 'OER', skipCount: 0 },
    });
    assert.doesNotMatch(toolText(first), /keine Fortsetzung/, 'page one continues nothing');
    const single = await client.callTool({
      name: 'search_wlo_content',
      arguments: { query: 'Optik', license: 'CC BY-SA 4.0', skipCount: 8 },
    });
    assert.doesNotMatch(toolText(single), /keine Fortsetzung/, 'one key pages normally');
  } finally { await client.close(); mock.restore(); }
});

test('the paging notice stays silent when no content search ran', async () => {
  // `license` only affects the content leg. Asking search_wlo_all for
  // collections alone and getting told that "this page is not a continuation"
  // describes a search that did not happen.
  const mock = searchMock();
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_all',
      arguments: { query: 'Optik', license: 'OER', include: ['collections'], skipCount: 8 },
    });
    assert.doesNotMatch(toolText(result), /keine Fortsetzung/);
  } finally { await client.close(); mock.restore(); }
});
