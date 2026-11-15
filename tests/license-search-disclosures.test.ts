/**
 * Two things the licence search knew and did not say: that a licence key did
 * not answer (so the merged list may lack hits, and an empty one is no
 * finding), and that the total it reports is the FAMILY count because the exact
 * one could not be had.
 */
import { test, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { searchWithLicense } from '../src/services/license-search.js';
import { searchContent } from '../src/services/content-search.js';
import type { SearchCriterion, SearchResponse } from '../src/wlo-api.js';
import { installFetchMock, makeNode } from './fetchMock.js';

const LICENSE_PROPERTY = 'ccm:commonlicense_key';
const QUERY: SearchCriterion[] = [{ property: 'ngsearchword', values: ['Mathematik'] }];
const keyOf = (extra: SearchCriterion[]) => extra.find(c => c.property === LICENSE_PROPERTY)?.values[0] ?? '';
const hit = (id: string) => ({ ref: { id, repo: '-home-' }, name: id, properties: {} }) as unknown as SearchResponse['nodes'][number];

/** The facet request (the exact total) answers with these buckets, or with none. */
let facetBuckets: Array<{ value: string; count: number }> | null = null;
let mock: { restore: () => void } | null = null;
beforeEach(() => {
  facetBuckets = null;
  mock = installFetchMock(() => ({
    json: {
      nodes: [], pagination: { total: 99, from: 0, count: 0 },
      ...(facetBuckets ? { facets: [{ property: LICENSE_PROPERTY, values: facetBuckets }] } : {}),
    },
  }));
});
afterEach(() => { mock?.restore(); mock = null; });

const bundle = (run: (extra: SearchCriterion[]) => Promise<SearchResponse>) =>
  searchWithLicense({ license: 'OER', criteria: QUERY, size: 10, skipCount: 0, run });

// ── R6: a key that did not answer ────────────────────────────────────────

test('OER bundle: a key that failed makes the answer incomplete', async () => {
  const res = await bundle(async (extra) => {
    if (keyOf(extra) === 'CC_BY') throw new Error('upstream said no');
    return { nodes: [hit(`${keyOf(extra)}-1`)], pagination: { total: 3, from: 0, count: 1 } };
  });
  assert.equal(res.incomplete, true);
});

test('OER bundle: a failed key with NO hits from the others is still incomplete — not "nothing found"', async () => {
  const res = await bundle(async (extra) => {
    if (keyOf(extra) === 'CC_BY_SA') throw new Error('upstream said no');
    return { nodes: [], pagination: { total: 0, from: 0, count: 0 }, exhausted: true };
  });
  assert.deepEqual(res.nodes, []);
  assert.equal(res.incomplete, true);
});

test('OER bundle: a key whose own search was incomplete carries that on', async () => {
  const res = await bundle(async (extra) => ({
    nodes: [hit(`${keyOf(extra)}-1`)], pagination: { total: 1, from: 0, count: 1 },
    ...(keyOf(extra) === 'CC_0' ? { incomplete: true } : {}),
  }));
  assert.equal(res.incomplete, true);
});

test('OER bundle: every key answered in full — no flag', async () => {
  const res = await bundle(async (extra) => ({ nodes: [hit(`${keyOf(extra)}-1`)], pagination: { total: 1, from: 0, count: 1 } }));
  assert.equal(res.incomplete, undefined);
});

// ── R12: the total when the exact count could not be had ─────────────────

test('OER bundle without a facet answer: the summed families are marked as an upper bound', async () => {
  const res = await bundle(async (extra) => ({ nodes: [hit(`${keyOf(extra)}-1`)], pagination: { total: 7, from: 0, count: 1 } }));
  assert.equal(res.pagination.total, 28);
  assert.equal(res.totalIsUpperBound, true);
});

test('a single licence without a facet answer: the family total is marked as an upper bound', async () => {
  const res = await searchWithLicense({
    license: 'CC BY', criteria: QUERY, size: 10, skipCount: 0,
    run: async () => ({ nodes: [hit('a')], pagination: { total: 343, from: 0, count: 1 } }),
  });
  assert.equal(res.pagination.total, 343);
  assert.equal(res.totalIsUpperBound, true);
});

test('with the exact count, and without a licence, the total is not marked', async () => {
  facetBuckets = [{ value: 'CC_BY', count: 42 }];
  const run = async (): Promise<SearchResponse> => ({ nodes: [hit('a')], pagination: { total: 343, from: 0, count: 1 } });
  const exact = await searchWithLicense({ license: 'CC BY', criteria: QUERY, size: 10, skipCount: 0, run });
  assert.equal(exact.pagination.total, 42);
  assert.equal(exact.totalIsUpperBound, undefined);
  const none = await searchWithLicense({ license: undefined, criteria: QUERY, size: 10, skipCount: 0, run });
  assert.equal(none.totalIsUpperBound, undefined);
});

test('a window that did not ASK for the total claims nothing about it', async () => {
  const res = await searchWithLicense({
    license: 'OER', criteria: QUERY, size: 10, skipCount: 0, withTotal: false,
    run: async (extra) => ({ nodes: [hit(`${keyOf(extra)}-1`)], pagination: { total: 7, from: 0, count: 1 } }),
  });
  assert.equal(res.totalIsUpperBound, undefined);
});

test('searchContent hands the mark on to its caller', async () => {
  mock?.restore();
  mock = installFetchMock((_url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { facets?: unknown };
    // Records match, and the answer carries no facet block. (A total of 0 here
    // WOULD be an answer: nothing matches, so nothing carries the licence.)
    if (body.facets) return { json: { nodes: [], pagination: { total: 343, from: 0, count: 0 } } };
    return { json: {
      nodes: [makeNode('a', 'Bruchrechnung', { 'ccm:commonlicense_key': ['CC_BY'] })],
      pagination: { total: 343, from: 0, count: 1 },
    } };
  });
  const res = await searchContent({ query: '', filters: [{ property: LICENSE_PROPERTY, values: ['CC_BY'] }], license: 'CC BY', max: 5, skipCount: 0, excluded: new Set() });
  assert.equal(res.total, 343);
  assert.equal(res.totalIsUpperBound, true);
});

// ── An ANSWERED count of zero is a count ─────────────────────────────────

/** The facet request answers with `facetReply`; every other request with nothing. */
function facetAnswers(facetReply: Record<string, unknown>): void {
  mock?.restore();
  mock = installFetchMock(() => ({ json: { nodes: [], ...facetReply } }));
}

const nothingFound = async (): Promise<SearchResponse> => ({ nodes: [], pagination: { total: 0, from: 0, count: 0 }, exhausted: true });

for (const [name, reply] of [
  ['a facet entry without buckets', { pagination: { total: 12, from: 0, count: 0 }, facets: [{ property: LICENSE_PROPERTY, values: [] }] }],
  ['an empty facet list', { pagination: { total: 12, from: 0, count: 0 }, facets: [] }],
  ['no record matching the query at all', { pagination: { total: 0, from: 0, count: 0 } }],
] as const) {
  test(`zero hits, and the count ANSWERED (${name}): the total is 0 and exact — no upper bound`, async () => {
    facetAnswers(reply);
    for (const license of ['CC BY', 'OER']) {
      const res = await searchWithLicense({ license, criteria: QUERY, size: 10, skipCount: 0, run: nothingFound });
      assert.equal(res.pagination.total, 0);
      assert.equal(res.totalIsUpperBound, undefined, license);
    }
  });
}

test('a facet request that FAILED, or answered hits without any facet block, stays unknown', async () => {
  const run = async (): Promise<SearchResponse> => ({ nodes: [hit('a')], pagination: { total: 343, from: 0, count: 1 } });
  facetAnswers({ pagination: { total: 500, from: 0, count: 0 } });
  assert.equal((await searchWithLicense({ license: 'CC BY', criteria: QUERY, size: 10, skipCount: 0, run })).totalIsUpperBound, true);
  mock?.restore();
  mock = installFetchMock(() => ({ status: 503, json: {} }));
  assert.equal((await searchWithLicense({ license: 'CC BY', criteria: QUERY, size: 10, skipCount: 0, run })).totalIsUpperBound, true);
});

// ── A sum that lacks a key is not an upper bound ─────────────────────────

test('OER bundle, a key LOST and no exact count: the sum is called neither bound — the answer is incomplete', async () => {
  const res = await bundle(async (extra) => {
    if (keyOf(extra) === 'CC_BY') throw new Error('upstream said no');
    return { nodes: [hit(`${keyOf(extra)}-1`)], pagination: { total: 7, from: 0, count: 1 } };
  });
  assert.equal(res.pagination.total, 21);
  assert.equal(res.incomplete, true);
  assert.equal(res.totalIsUpperBound, undefined, 'the lost family may hold more than all the others together');
});
