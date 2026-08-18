import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { searchWithLicense } from '../src/services/license-search.js';
import type { SearchCriterion, SearchResponse } from '../src/wlo-api.js';
import { FACET_BUCKET_MAX, FACET_LIMIT } from '../src/wlo-api.js';
import { installFetchMock } from './fetchMock.js';

/**
 * The OER bundle cannot be expressed as one upstream criterion (measured
 * 2026-08-09: two values → 400, the criterion twice → AND, "A OR B" → 0), so it
 * used to send NO criterion and filter the generic result page locally.
 *
 * That page is the wrong place to look. Measured on staging the same day:
 * `Mathematik` has 18 793 records carrying an OER licence — 41.9 % of everything
 * with a licence at all — and the tool answered **"kein Treffer"**, because the
 * first 50 by relevance carried no `ccm:commonlicense_key` at all (50/50 absent
 * in the plain search; 23× CC BY-NC-SA + 2× CUSTOM through `enhancedSearch`).
 * A filter that answers "there is none" over 18 793 records is not a weak
 * filter, it is a wrong one.
 *
 * Each key on its own DOES narrow upstream. So the bundle fans out over its keys
 * and merges. These tests pin that, and they do it without a network: the
 * caller passes the search as a function, which is also what lets the same rule
 * serve `enhancedSearch` and plain `ngsearch`.
 */

const LICENSE_PROPERTY = 'ccm:commonlicense_key';

/** The criteria the caller searched with — what the facet count aggregates over. */
const QUERY: SearchCriterion[] = [{ property: 'ngsearchword', values: ['Mathematik'] }];

function node(id: string) {
  return { ref: { id, repo: '-home-' }, name: id, properties: {} } as unknown as SearchResponse['nodes'][number];
}

/**
 * The exact-count request goes upstream for real (it is a plain `ngsearch`
 * aggregation, not the injected `run`), so every test in this file needs it
 * mocked. Tests that care set `facetBuckets`; the rest get no facet block back,
 * which is the documented degradation path.
 */
let facetBuckets: Array<{ value: string; count: number }> | null = null;
let mock: { restore: () => void; calls: Array<{ url: string; init?: RequestInit }> } | null = null;

beforeEach(() => {
  facetBuckets = null;
  mock = installFetchMock((_url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { facets?: unknown };
    if (!body.facets) return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
    return {
      json: {
        nodes: [],
        pagination: { total: 0, from: 0, count: 0 },
        ...(facetBuckets ? { facets: [{ property: LICENSE_PROPERTY, values: facetBuckets }] } : {}),
      },
    };
  });
});
afterEach(() => { mock?.restore(); mock = null; });

/** Every upstream request that asked for a facet aggregation. */
const facetCalls = () =>
  (mock?.calls ?? []).filter(c => {
    try { return !!JSON.parse(String(c.init?.body ?? '{}')).facets; } catch { return false; }
  });

/** Records every call and answers with one node named after the licence key. */
function recorder(perKeyTotal = 10) {
  const calls: Array<{ extra: SearchCriterion[]; size: number; skip: number }> = [];
  const run = async (extra: SearchCriterion[], size: number, skip: number): Promise<SearchResponse> => {
    calls.push({ extra, size, skip });
    const key = extra.find(c => c.property === LICENSE_PROPERTY)?.values[0] ?? 'none';
    return { nodes: [node(`${key}-1`), node(`${key}-2`)], pagination: { total: perKeyTotal, from: 0, count: 2 } };
  };
  return { calls, run };
}

const keyOf = (c: { extra: SearchCriterion[] }) =>
  c.extra.find(x => x.property === LICENSE_PROPERTY)?.values[0] ?? null;

test('no licence: one search, no licence criterion added', async () => {
  const { calls, run } = recorder();
  await searchWithLicense({ license: undefined, criteria: QUERY, size: 10, skipCount: 0, run });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!.extra, []);
});

test('a single licence: one search — the criterion is already in the caller filters', async () => {
  const { calls, run } = recorder();
  await searchWithLicense({ license: 'CC BY-SA 4.0', criteria: QUERY, size: 10, skipCount: 0, run });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!.extra, []);
});

test('an unresolvable licence changes nothing — the caller reports it as unresolved', async () => {
  const { calls, run } = recorder();
  await searchWithLicense({ license: 'CC XY', criteria: QUERY, size: 10, skipCount: 0, run });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!.extra, []);
});

test('the OER bundle fans out: one search per key, each with its own criterion', async () => {
  const { calls, run } = recorder();
  await searchWithLicense({ license: 'OER', criteria: QUERY, size: 10, skipCount: 0, run });
  assert.equal(calls.length, 4);
  assert.deepEqual(
    calls.map(keyOf).sort(),
    ['CC_0', 'CC_BY', 'CC_BY_SA', 'PDM'],
  );
});

test('the OER bundle contains no licence that merely grants free ACCESS', async () => {
  // `COPYRIGHT_FREE` was in the bundle until 2026-08-12 and is not an open
  // licence: the repository's own description reads "Das Werk ist kostenfrei
  // zugänglich. Nutzung und Quellenangabe gemäß den allgemeingültigen
  // gesetzlichen Regelungen (UrhG)" — gratis, not libre. Nothing may be remixed
  // or redistributed under it.
  //
  // It was 12 445 of 403 461 records (measured 2026-08-12), all of them answered
  // to a caller asking for "every freely reusable licence". That is the
  // direction `filterByExactLicense` already calls harmful: a surplus MORE
  // restrictive than what was asked for, which the caller cannot see.
  //
  // All three tool descriptions promised the four keys below and never named the
  // fifth, so the code was the outlier — and the mislabelling that hid this
  // ("urheberrechtsfrei") is the same root cause fixed in `vocabs.ts`.
  const { calls, run } = recorder();
  await searchWithLicense({ license: 'OER', criteria: QUERY, size: 10, skipCount: 0, run });
  assert.ok(!calls.map(keyOf).includes('COPYRIGHT_FREE'));
});

test('the bundle result carries nodes from every key', async () => {
  const { run } = recorder();
  const res = await searchWithLicense({ license: 'OER', criteria: QUERY, size: 10, skipCount: 0, run });
  const ids = res.nodes.map(n => n.ref?.id ?? '');
  for (const key of ['CC_0', 'PDM', 'CC_BY', 'CC_BY_SA']) {
    assert.ok(ids.includes(`${key}-1`), `${key} contributed`);
  }
});

test('a record found under two keys appears once', async () => {
  // Not hypothetical: the keys match FAMILIES, so one record can answer to more
  // than one of them, and a duplicate would spend a result slot on itself.
  const run = async (extra: SearchCriterion[]): Promise<SearchResponse> => {
    const key = extra.find(c => c.property === LICENSE_PROPERTY)?.values[0] ?? '';
    return {
      nodes: key === 'CC_BY' || key === 'CC_BY_SA' ? [node('shared')] : [],
      pagination: { total: 1, from: 0, count: 1 },
    };
  };
  const res = await searchWithLicense({ license: 'OER', criteria: QUERY, size: 10, skipCount: 0, run });
  assert.deepEqual(res.nodes.map(n => n.ref?.id), ['shared']);
});

test('no licence: the upstream total is passed through and nothing is counted', async () => {
  const { run } = recorder(42);
  const res = await searchWithLicense({ license: undefined, criteria: QUERY, size: 10, skipCount: 0, run });
  assert.equal(res.pagination.total, 42);
  assert.equal(facetCalls().length, 0, 'an unfiltered search pays for no extra request');
});

test('the total is the exact facet count, not the sum of overlapping families', async () => {
  // Measured on staging 2026-08-09 and the reason this exists: summing the five
  // `pagination.total` overcounts by 98–164 %. `ccm:commonlicense_key` matches a
  // FAMILY, and the CC_BY family CONTAINS CC_BY_SA (Mathematik: family 27 351 vs
  // exact 3 848 + 9 554), so the same record is counted twice — and the family
  // total also carries the NC/ND records, which are not OER at all. The facet
  // counts EXACT keys server-side over the whole result set. These are the real
  // Mathematik buckets.
  facetBuckets = [
    { value: 'CC_BY', count: 3848 },
    { value: 'CC_BY_SA', count: 9554 },
    { value: 'CC_0', count: 169 },
    { value: 'PDM', count: 7 },
    { value: 'COPYRIGHT_FREE', count: 765 },
    { value: 'CC_BY_NC_SA', count: 5000 },
    { value: 'CUSTOM', count: 900 },
  ];
  const { run } = recorder(27351);
  const res = await searchWithLicense({ license: 'OER', criteria: QUERY, size: 10, skipCount: 0, run });
  assert.equal(res.pagination.total, 13578, 'the four OER buckets, each counted once');
});

test('a bucket spelled with spaces counts, because the node filter resolves it too', async () => {
  // `CC BY-SA` exists as its own key beside `CC_BY_SA` in staging's index.
  // Summing the literal bucket name would count it as neither, while
  // `filterByExactLicense` — which resolves the node's licence — keeps the
  // record. The count has to answer to the same rule or it contradicts the list
  // it is reporting on.
  facetBuckets = [{ value: 'CC BY-SA', count: 4 }, { value: 'CC_BY_SA', count: 6 }];
  const { run } = recorder(999);
  const res = await searchWithLicense({ license: 'OER', criteria: QUERY, size: 10, skipCount: 0, run });
  assert.equal(res.pagination.total, 10);
});

test('a single licence gets its exact count, not the family it was filtered by', async () => {
  // Optik + CC BY: the upstream criterion answers 343, of which exactly 42 are
  // plain CC BY. Reporting 343 over a list of 42 is the same lie in a smaller size.
  facetBuckets = [
    { value: 'CC_BY', count: 42 },
    { value: 'CC_BY_ND', count: 100 },
    { value: 'CC_BY_NC_SA', count: 201 },
  ];
  const { run } = recorder(343);
  const res = await searchWithLicense({ license: 'CC BY 4.0', criteria: QUERY, size: 10, skipCount: 0, run });
  assert.equal(res.pagination.total, 42);
});

test('without a facet answer the total degrades to the sum over the keys', async () => {
  // The old behaviour, kept as the fallback: a failed aggregation must not turn
  // a working search into a wrong one, and `licenseFilterNotice` already tells
  // the caller the number counts more than the list.
  const { run } = recorder(7);
  const res = await searchWithLicense({ license: 'OER', criteria: QUERY, size: 10, skipCount: 0, run });
  assert.equal(res.pagination.total, 28);
});

test('when every key fails the bundle throws instead of reporting "no hits"', async () => {
  // Losing ONE key is tolerated — losing the others with it would be worse.
  // Losing ALL of them is a different event: an empty answer is indistinguishable
  // from "there is no OER material on this topic", and the single-licence path
  // throws in exactly this situation.
  const run = async (): Promise<SearchResponse> => { throw new Error('upstream is down'); };
  await assert.rejects(
    () => searchWithLicense({ license: 'OER', criteria: QUERY, size: 10, skipCount: 0, run }),
    /Lizenz/,
  );
});

test('one failing key does not lose the other three', async () => {
  const run = async (extra: SearchCriterion[]): Promise<SearchResponse> => {
    const key = extra.find(c => c.property === LICENSE_PROPERTY)?.values[0] ?? '';
    if (key === 'CC_BY') throw new Error('upstream said no');
    return { nodes: [node(`${key}-1`)], pagination: { total: 3, from: 0, count: 1 } };
  };
  const res = await searchWithLicense({ license: 'OER', criteria: QUERY, size: 10, skipCount: 0, run });
  assert.equal(res.nodes.length, 3);
  assert.equal(res.pagination.total, 9);
});

test('the keys are interleaved, not concatenated', async () => {
  // Concatenating hands the whole result cap to whichever key is listed first.
  // Measured live: `Mathematik` + OER returned six hits, all CC 0 — the rarest
  // of them (191 records) — while the 11 563 CC BY-SA ones never reached the
  // page. There is no ranking ACROSS the result sets, so the fair merge is
  // round-robin: each key contributes its best hit before any key contributes
  // its second.
  const run = async (extra: SearchCriterion[]): Promise<SearchResponse> => {
    const key = extra.find(c => c.property === LICENSE_PROPERTY)?.values[0] ?? '';
    return {
      nodes: [node(`${key}-1`), node(`${key}-2`), node(`${key}-3`)],
      pagination: { total: 3, from: 0, count: 3 },
    };
  };
  const res = await searchWithLicense({ license: 'OER', criteria: QUERY, size: 10, skipCount: 0, run });
  const firstFour = res.nodes.slice(0, 4).map(n => n.ref?.id ?? '');
  assert.deepEqual(
    [...new Set(firstFour.map(id => id.replace(/-\d$/, '')))].sort(),
    ['CC_0', 'CC_BY', 'CC_BY_SA', 'PDM'],
    `the first four results should hold one per key, got ${firstFour.join(', ')}`,
  );
  assert.ok(firstFour.every(id => id.endsWith('-1')), 'each key contributes its best hit first');
});

test('interleaving survives keys of unequal length', async () => {
  const run = async (extra: SearchCriterion[]): Promise<SearchResponse> => {
    const key = extra.find(c => c.property === LICENSE_PROPERTY)?.values[0] ?? '';
    const n = key === 'CC_BY_SA' ? 3 : key === 'CC_BY' ? 1 : 0;
    return {
      nodes: Array.from({ length: n }, (_, i) => node(`${key}-${i + 1}`)),
      pagination: { total: n, from: 0, count: n },
    };
  };
  const res = await searchWithLicense({ license: 'OER', criteria: QUERY, size: 10, skipCount: 0, run });
  assert.deepEqual(res.nodes.map(n => n.ref?.id),
    ['CC_BY-1', 'CC_BY_SA-1', 'CC_BY_SA-2', 'CC_BY_SA-3']);
});

test('every key gets the full window — splitting it would starve the exactness pass', async () => {
  // The window exists because the key matches a family and the exact matches
  // have to be found inside it. Handing each key a fifth of it re-creates the
  // starvation `pageSizeForLicense` was added to fix.
  const { calls, run } = recorder();
  await searchWithLicense({ license: 'OER', criteria: QUERY, size: 50, skipCount: 0, run });
  for (const c of calls) assert.equal(c.size, 50);
});

/** `length` buckets, the first of which is a licence the OER bundle selects. */
const buckets = (length: number) =>
  Array.from({ length }, (_, i) => ({ value: i === 0 ? 'CC_BY' : `OTHER_${i}`, count: 1 }));

test('a facet answer that may be truncated is not trusted as a total', async () => {
  // A response carrying the most buckets the server will return cannot be proven
  // complete, and a silently truncated sum would understate the corpus while
  // looking authoritative. Falling back to the upstream number is the honest
  // answer.
  facetBuckets = buckets(FACET_BUCKET_MAX);
  const { run } = recorder(7);
  const res = await searchWithLicense({ license: 'OER', criteria: QUERY, size: 10, skipCount: 0, run });
  assert.equal(res.pagination.total, 28, 'the summed fallback, not the possibly-partial 1');
});

test('one bucket short of the maximum is a complete answer and is used', async () => {
  facetBuckets = buckets(FACET_BUCKET_MAX - 1);
  const { run } = recorder(7);
  const res = await searchWithLicense({ license: 'OER', criteria: QUERY, size: 10, skipCount: 0, run });
  assert.equal(res.pagination.total, 1);
});

test('more buckets than were ASKED for is normal, and the answer is still used', async () => {
  // Measured 2026-08-17: `facetLimit` is not a cap. The server answers with up to
  // FIVE times the requested limit (ccm:taxonid: 1→5, 2→10, 10→50, 50→250,
  // 80→376 = every distinct value there is). So a list longer than FACET_LIMIT is
  // the normal case, not evidence of truncation — and staging really does hold 23
  // distinct licence keys corpus-wide against a requested limit of 20.
  //
  // Treating that as "possibly truncated" discarded a correct exact count and
  // fell back to the family total, which this module documents as overstating by
  // 98–164 %. The old threshold was the requested limit, so this was live.
  assert.ok(FACET_BUCKET_MAX > FACET_LIMIT, 'a response may exceed the requested limit');
  facetBuckets = buckets(23);
  const { run } = recorder(7);
  const res = await searchWithLicense({ license: 'OER', criteria: QUERY, size: 10, skipCount: 0, run });
  assert.equal(res.pagination.total, 1, 'the exact count, not the 28 the families sum to');
});
