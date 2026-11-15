/**
 * tests/services-content-search.test.ts – the ONE content search behind
 * `search_wlo_content` and the content leg of `search_wlo_all`.
 *
 * Audit 2026-11-12, K-2: the search fetched one fixed window per call, whatever
 * was asked for. Paging the documented way — with `excludeNodeIds` — reached
 * "Keine Inhalte gefunden" after a few pages while `total` named thousands, and
 * `maxResults: 50` came back with half of that, silently. P-5: with
 * `includeTextContent` every hit cost a text read, up to fifty of them, and a
 * failed read was indistinguishable from "this record has no text".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { REFILL_ROUNDS, enrichStoredText, searchContent } from '../src/services/content-search.js';
import { TEXT_ENRICH_MAX } from '../src/services/node-details.js';
import { formatNodes } from '../src/formatter.js';
import { installFetchMock, makeNode, type MockResult } from './fetchMock.js';

const WINDOW = 25;   // the default WLO_POOL_SIZE: what one search window holds

/** A catalogue of `total` records for any query: window N holds ids n(N·25) … */
function catalogue(total: number) {
  const skips: number[] = [];
  const mock = installFetchMock((url): MockResult => {
    if (!url.includes('/ngsearch')) return { json: {} };
    const u = new URL(url);
    const skip = Number(u.searchParams.get('skipCount') ?? 0);
    const max = Number(u.searchParams.get('maxItems') ?? WINDOW);
    skips.push(skip);
    const nodes = Array.from({ length: Math.max(0, Math.min(max, total - skip)) }, (_, i) =>
      makeNode(`n${skip + i}`, `Optik ${skip + i}`, { 'ccm:wwwurl': [`https://example.org/${skip + i}`] }));
    return { json: { nodes, pagination: { total, from: skip, count: nodes.length } } };
  });
  return { mock, windows: () => [...new Set(skips)].sort((a, b) => a - b) };
}

const ids = (r: { results: Array<{ nodeId: string }> }) => r.results.map(n => n.nodeId);

test('paging with excludeNodeIds does not run dry while the catalogue holds more (K-2)', async () => {
  const { mock } = catalogue(1000);
  try {
    const seen = new Set<string>();
    for (let page = 0; page < 6; page++) {
      const r = await searchContent({ query: 'Optik', filters: [], max: 8, skipCount: 0, excluded: seen });
      assert.equal(r.results.length, 8, `page ${page + 1} of a catalogue of ${r.total}`);
      for (const id of ids(r)) { assert.equal(seen.has(id), false, `${id} came twice`); seen.add(id); }
    }
    assert.equal(seen.size, 48, 'six pages of eight — the first window alone holds 25');
  } finally { mock.restore(); }
});

test('maxResults above one window is filled, not silently halved (K-2)', async () => {
  const { mock } = catalogue(1000);
  try {
    const r = await searchContent({ query: 'Optik', filters: [], max: 50, skipCount: 0, excluded: new Set() });
    assert.equal(r.results.length, 50);
    assert.equal(r.more, undefined, 'nothing is short, so nothing is disclosed');
  } finally { mock.restore(); }
});

test('an ordinary first page costs ONE window — the refill is paid only when the page is short', async () => {
  const { mock, windows } = catalogue(1000);
  try {
    await searchContent({ query: 'Optik', filters: [], max: 8, skipCount: 0, excluded: new Set() });
    assert.deepEqual(windows(), [0]);
  } finally { mock.restore(); }
});

test('the refill is bounded, and what it could not reach is disclosed with the place to go on', async () => {
  const { mock, windows } = catalogue(100_000);
  try {
    // Everything the bounded windows can hold has been seen already.
    const seen = new Set(Array.from({ length: (REFILL_ROUNDS + 1) * WINDOW }, (_, i) => `n${i}`));
    const r = await searchContent({ query: 'Optik', filters: [], max: 8, skipCount: 0, excluded: seen });
    assert.equal(windows().length, REFILL_ROUNDS + 1, 'one window plus the bounded refills');
    assert.equal(r.results.length, 0);
    assert.deepEqual(r.more, { nextSkipCount: (REFILL_ROUNDS + 1) * WINDOW },
      'not "nothing found": the catalogue holds more, and this is where it continues');
  } finally { mock.restore(); }
});

test('a catalogue that IS exhausted says nothing about more', async () => {
  const { mock } = catalogue(10);
  try {
    const seen = new Set(Array.from({ length: 10 }, (_, i) => `n${i}`));
    const r = await searchContent({ query: 'Optik', filters: [], max: 8, skipCount: 0, excluded: seen });
    assert.equal(r.results.length, 0);
    assert.equal(r.more, undefined);
    assert.equal(r.total, 10);
  } finally { mock.restore(); }
});

test('skipCount is honoured as the starting window', async () => {
  const { mock, windows } = catalogue(1000);
  try {
    const r = await searchContent({ query: 'Optik', filters: [], max: 8, skipCount: 50, excluded: new Set() });
    assert.deepEqual(windows(), [50]);
    assert.ok(ids(r).every(id => Number(id.slice(1)) >= 50));
  } finally { mock.restore(); }
});

// ── P-5: the stored full text ────────────────────────────────────────────────

const nodes = (n: number) => formatNodes(Array.from({ length: n }, (_, i) => makeNode(`t${i}`, `T ${i}`)));

test('full text is read for a bounded number of hits; the rest is named, not silently empty (P-5)', async () => {
  let reads = 0;
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/textContent')) { reads++; return { json: { text: 'Volltext' } }; }
    return { json: {} };
  });
  try {
    const list = nodes(TEXT_ENRICH_MAX + 5);
    const report = await enrichStoredText(list);
    assert.equal(reads, TEXT_ENRICH_MAX);
    assert.deepEqual(report.skipped, list.slice(TEXT_ENRICH_MAX).map(n => n.nodeId));
    assert.equal(list[0]!.textContent, 'Volltext');
    assert.equal(list[TEXT_ENRICH_MAX]!.textContent, undefined, 'not fetched is not "has no text"');
  } finally { mock.restore(); }
});

test('a text read that FAILED is reported as unreadable — it is not "this record has no text" (P-5)', async () => {
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/t1/textContent')) return { status: 500, json: {} };
    if (url.includes('/t2/textContent')) return { json: { text: '' } };
    if (url.includes('/textContent')) return { json: { text: 'Volltext' } };
    return { json: {} };
  });
  try {
    const list = nodes(3);
    const report = await enrichStoredText(list);
    assert.deepEqual(report.unreadable, ['t1']);
    assert.equal(list[1]!.textContent, undefined);
    assert.equal(list[2]!.textContent, '', 'answered and empty: the record has none');
    assert.equal(list[0]!.textContent, 'Volltext');
  } finally { mock.restore(); }
});

// ── what the caller is TOLD: an envelope field the renderer drops is no disclosure ──

test('an exhausted page says where to continue — in the tool text (both formats), the structured part, and never as "nothing found"', async () => {
  const { connectedClient, toolText } = await import('./fetchMock.js');
  const { mock } = catalogue(100_000);
  const client = await connectedClient();
  try {
    const seen = Array.from({ length: (REFILL_ROUNDS + 1) * WINDOW }, (_, i) => `n${i}`);
    for (const name of ['search_wlo_content', 'search_wlo_all']) {
      const args = name === 'search_wlo_all'
        ? { query: 'Optik', include: ['content'], excludeNodeIds: seen }
        : { query: 'Optik', excludeNodeIds: seen };
      const md = await client.callTool({ name, arguments: args });
      const text = toolText(md);
      assert.match(text, /nicht das Ende/, `${name}: the first content block says it`);
      assert.match(text, /skipCount=100/, name);
      assert.match(text, /excludeNodeIds/, `${name}: and how to keep what was seen out`);
      assert.doesNotMatch(text, /Keine Inhalte gefunden/, `${name}: that would be a statement about the catalogue`);
      const sc = (md as { structuredContent: Record<string, unknown> }).structuredContent;
      const more = name === 'search_wlo_all' ? (sc['content'] as Record<string, unknown>)['more'] : sc['more'];
      assert.deepEqual(more, { nextSkipCount: 100 }, name);

      const json = await client.callTool({ name, arguments: { ...args, outputFormat: 'json' } });
      assert.match(toolText(json), /skipCount=100/, `${name}: in JSON mode the sentence rides as its own block`);
    }
  } finally { await client.close(); mock.restore(); }
});

test('the HTML search page says it too', async () => {
  const { routeRestRequest } = await import('../src/rest/routes.js');
  // The REST page takes no excludeNodeIds, so the short page is produced the
  // other way: every window is FULL, but holds re-imports of three materials.
  const mock = installFetchMock((url): MockResult => {
    if (!url.includes('/ngsearch')) return { json: {} };
    const skip = Number(new URL(url).searchParams.get('skipCount') ?? 0);
    const nodes = Array.from({ length: WINDOW }, (_, i) => makeNode(`copy${skip + i}`, `Optik ${i % 3}`, { 'ccm:wwwurl': [`https://example.org/s${i % 3}`] }));
    return { json: { nodes, pagination: { total: 5000, from: skip, count: nodes.length } } };
  });
  try {
    const r = await routeRestRequest('GET', '/api/search?q=Optik&include=content&format=html');
    assert.equal(r?.status, 200);
    const html = String(r!.raw ?? '');
    assert.match(html, /Nur 3 neue Treffer/);
    assert.match(html, /skipCount=100/);
  } finally { mock.restore(); }
});

test('full text past the bound is named in the tool answer', async () => {
  const { connectedClient, toolText } = await import('./fetchMock.js');
  const real = catalogue(1000);
  real.mock.restore();
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/textContent')) return { json: { text: 'Volltext' } };
    if (!url.includes('/ngsearch')) return { json: {} };
    const u = new URL(url);
    const skip = Number(u.searchParams.get('skipCount') ?? 0);
    const nodes = Array.from({ length: WINDOW }, (_, i) => makeNode(`n${skip + i}`, `Optik ${skip + i}`, { 'ccm:wwwurl': [`https://example.org/${skip + i}`] }));
    return { json: { nodes, pagination: { total: 1000, from: skip, count: nodes.length } } };
  });
  const client = await connectedClient();
  try {
    const r = await client.callTool({ name: 'search_wlo_content', arguments: { query: 'Optik', maxResults: TEXT_ENRICH_MAX + 3, includeTextContent: true } });
    const sc = (r as unknown as { structuredContent: { textContentSkipped?: string[]; count: number } }).structuredContent;
    assert.equal(sc.count, TEXT_ENRICH_MAX + 3);
    assert.equal(sc.textContentSkipped?.length, 3);
    assert.match(toolText(r), new RegExp(`nur für die ersten ${TEXT_ENRICH_MAX}`));
  } finally { await client.close(); mock.restore(); }
});

test('a record that comes back in several windows is listed once — also one without a URL to dedupe on', async () => {
  // Paging the ranked search is not a partition: the same record can sit in two windows.
  const mock = installFetchMock((url): MockResult => {
    if (!url.includes('/ngsearch')) return { json: {} };
    // A FULL window every time (so the search goes on), always the same three records.
    const nodes = Array.from({ length: WINDOW }, (_, i) => makeNode(`same${i % 3}`, `Optik ${i % 3}`));   // no ccm:wwwurl
    return { json: { nodes, pagination: { total: 5000, from: 0, count: nodes.length } } };
  });
  try {
    const r = await searchContent({ query: 'Optik', filters: [], max: 8, skipCount: 0, excluded: new Set() });
    assert.deepEqual(ids(r).sort(), ['same0', 'same1', 'same2']);
  } finally { mock.restore(); }
});

// ── review of this package: the end is read off the WINDOW, not off `total` ──

const bodyOf = (init?: RequestInit): { criteria?: Array<{ property: string; values: string[] }>; facets?: unknown[] } => {
  try { return JSON.parse(String(init?.body ?? '{}')); } catch { return {}; }
};

test('a framing query whose FULL variant matches nothing still pages through what its topic variant holds', async () => {
  // "Unterrichtsstunde Französische Revolution": the whole phrase matches 0, the
  // topic 480. `total` is the full variant's count — 0 — and said nothing about the end.
  const mock = installFetchMock((url, init): MockResult => {
    const skip = Number(new URL(url).searchParams.get('skipCount') ?? 0);
    const word = (bodyOf(init).criteria ?? []).find(c => c.property === 'ngsearchword')?.values?.[0] ?? '';
    if (word !== 'Französische Revolution') return { json: { nodes: [], pagination: { total: 0, from: skip, count: 0 } } };
    const nodes = Array.from({ length: Math.max(0, Math.min(WINDOW, 480 - skip)) }, (_, i) =>
      makeNode(`n${skip + i}`, `Französische Revolution ${skip + i}`, { 'ccm:wwwurl': [`https://example.org/${skip + i}`] }));
    return { json: { nodes, pagination: { total: 480, from: skip, count: nodes.length } } };
  });
  try {
    const seen = new Set<string>();
    for (let page = 0; page < 8; page++) {
      const r = await searchContent({ query: 'Unterrichtsstunde Französische Revolution', filters: [], max: 8, skipCount: 0, excluded: seen });
      assert.equal(r.results.length, 8, `page ${page + 1}`);
      for (const id of ids(r)) seen.add(id);
    }
    assert.equal(seen.size, 64);
  } finally { mock.restore(); }
});

test('a single licence pages through its FAMILY — the exact total is not where the windows end', async () => {
  // Family 343, of which every tenth record is exactly CC BY (the facet says 35).
  let facetCalls = 0;
  const mock = installFetchMock((url, init): MockResult => {
    const skip = Number(new URL(url).searchParams.get('skipCount') ?? 0);
    if (bodyOf(init).facets?.length) {
      facetCalls++;
      return { json: { nodes: [], pagination: { total: 343, from: 0, count: 0 },
        facets: [{ property: 'ccm:commonlicense_key', values: [{ value: 'CC_BY', count: 35 }, { value: 'CC_BY_NC_ND', count: 308 }] }] } };
    }
    const nodes = Array.from({ length: Math.max(0, Math.min(WINDOW, 343 - skip)) }, (_, i) => { const k = skip + i;
      return makeNode(`n${k}`, `Optik ${k}`, { 'ccm:wwwurl': [`https://example.org/${k}`], 'ccm:commonlicense_key': [k % 10 === 0 ? 'CC_BY' : 'CC_BY_NC_ND'] }); });
    return { json: { nodes, pagination: { total: 343, from: skip, count: nodes.length } } };
  });
  try {
    const r = await searchContent({ query: 'Optik', filters: [{ property: 'ccm:commonlicense_key', values: ['CC_BY'] }], license: 'CC BY', max: 8, skipCount: 0, excluded: new Set() });
    assert.equal(r.total, 35, 'the exact count is what is REPORTED');
    assert.equal(r.results.length, 8, 'and the windows went on past it: 100 family records hold 10 exact ones');
    assert.equal(facetCalls, 1, 'the exact total is asked once, not per window');
  } finally { mock.restore(); }
});

test('a page left short by the dedupe is filled from the window in hand first — its better-ranked rest', async () => {
  // The first six hits are copies of one material. The page used to jump to the
  // next backend window (n025…) and never looked at n008…n024, which rank higher.
  const pad = (k: number) => String(k).padStart(3, '0');
  const skips: number[] = [];
  const mock = installFetchMock((url): MockResult => {
    const u = new URL(url); const skip = Number(u.searchParams.get('skipCount') ?? 0);
    skips.push(skip);
    const nodes = Array.from({ length: WINDOW }, (_, i) => { const k = skip + i;
      return makeNode(`n${pad(k)}`, `Optik ${pad(k)}`, { 'ccm:wwwurl': [k < 6 ? 'https://example.org/same' : `https://example.org/${k}`] }); });
    return { json: { nodes, pagination: { total: 1000, from: skip, count: nodes.length } } };
  });
  try {
    const r = await searchContent({ query: 'Optik', filters: [], max: 8, skipCount: 0, excluded: new Set() });
    assert.equal(r.results.length, 8);
    assert.ok(ids(r).every(id => Number(id.slice(1)) < WINDOW), `all from the first window: ${ids(r).join(',')}`);
    assert.deepEqual([...new Set(skips)], [0], 'and no second window was read for it');
  } finally { mock.restore(); }
});

test('the OER bundle: what a page that stays short costs is bounded and counted', async () => {
  // Four keys; nothing in the windows is exactly an open licence, so every round is short.
  let facetCalls = 0;
  const mock = installFetchMock((url, init): MockResult => {
    const skip = Number(new URL(url).searchParams.get('skipCount') ?? 0);
    const b = bodyOf(init);
    if (b.facets?.length) { facetCalls++; return { json: { nodes: [], pagination: { total: 9000, from: 0, count: 0 }, facets: [] } }; }
    const key = (b.criteria ?? []).find(c => c.property === 'ccm:commonlicense_key')?.values?.[0] ?? 'X';
    const nodes = Array.from({ length: WINDOW }, (_, i) => makeNode(`${key}${skip + i}`, `Klima ${skip + i}`,
      { 'ccm:wwwurl': [`https://example.org/${key}${skip + i}`], 'ccm:commonlicense_key': ['CC_BY_NC_ND'] }));
    return { json: { nodes, pagination: { total: 9000, from: skip, count: nodes.length } } };
  });
  try {
    const r = await searchContent({ query: 'Klima', filters: [], license: 'OER', max: 8, skipCount: 0, excluded: new Set() });
    assert.equal(r.results.length, 0);
    assert.ok(r.more, 'short, and not at the end');
    assert.equal(facetCalls, 1);
    const searches = mock.calls.length - facetCalls;
    assert.equal(searches % (REFILL_ROUNDS + 1), 0, 'the same number of requests in each of the four rounds');
    assert.ok(searches <= 4 * 6 * (REFILL_ROUNDS + 1), `${searches} search requests — at most keys × variants × rounds`);
  } finally { mock.restore(); }
});

test('listing by filters alone (no query) pages by its own window, and a short one is the end', async () => {
  const sizes: number[] = [];
  const mock = installFetchMock((url): MockResult => {
    const u = new URL(url); const skip = Number(u.searchParams.get('skipCount') ?? 0); const max = Number(u.searchParams.get('maxItems') ?? 0);
    sizes.push(max);
    const nodes = Array.from({ length: Math.max(0, Math.min(max, 13 - skip)) }, (_, i) => makeNode(`b${skip + i}`, `B ${skip + i}`));
    return { json: { nodes, pagination: { total: 13, from: skip, count: nodes.length } } };
  });
  try {
    const first = await searchContent({ query: '', filters: [], max: 8, skipCount: 0, excluded: new Set(), emptyQuery: 'browse' });
    assert.equal(first.results.length, 8);
    assert.deepEqual(sizes, [8], 'one plain request of the page size');
    const rest = await searchContent({ query: '', filters: [], max: 8, skipCount: 8, excluded: new Set(), emptyQuery: 'browse' });
    assert.equal(rest.results.length, 5);
    assert.equal(rest.more, undefined, 'five of eight in the last window: that is the end, not a shortfall');
  } finally { mock.restore(); }
});

test('a client that hung up ends the search as a hang-up — not as "search failed"', async () => {
  const { runWithRequestSignal, ClientGoneError, isClientGone } = await import('../src/request-scope.js');
  const mock = installFetchMock(() => ({ json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } }));
  const client = new AbortController();
  client.abort(new ClientGoneError());
  try {
    for (const license of [undefined, 'OER']) {
      const err = await runWithRequestSignal(client.signal, () =>
        searchContent({ query: 'Optik', filters: [], max: 8, skipCount: 0, excluded: new Set(), ...(license ? { license } : {}) })).then(() => null, e => e as unknown);
      assert.equal(isClientGone(err), true, `license=${license}: ${String((err as Error)?.message)}`);
    }
    assert.equal(mock.calls.length, 0, 'and nothing was sent for it');
  } finally { mock.restore(); }
});

test('stored text that is blank or binary debris is no text in the search path either; a body naming none is unreadable', async () => {
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/t0/textContent')) return { json: { text: '\u0000\u0001\u0002 \u0003' } };
    if (url.includes('/t1/textContent')) return { json: {} };
    return { json: { text: 'Volltext' } };
  });
  try {
    const list = nodes(3);
    const report = await enrichStoredText(list);
    assert.equal(list[0]!.textContent, '', 'debris is shown as no text, as the detail tool does');
    assert.deepEqual(report.unreadable, ['t1'], 'a 200 that names no text is no answer');
    assert.equal(list[2]!.textContent, 'Volltext');
  } finally { mock.restore(); }
});
