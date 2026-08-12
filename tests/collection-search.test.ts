/**
 * collection-search.test.ts – the two-leg collection search.
 *
 * The repository answers "which collections match this word?" through two
 * unrelated backends, and measured 2026-08-11 against staging, NEITHER is a
 * superset of the other: the mds query alone cannot return the collection
 * `9e7ae956` ("Optik") for ANY search word — not even for terms that occur only
 * in that record's own keywords — while the REST collection search returns it
 * every time. In the other direction the mds query finds collections through
 * their compendium text, which the REST endpoint does not read.
 *
 * What is pinned here is therefore the merge, not either endpoint: a hit only
 * one leg knows must survive, must arrive with OUR projection (the REST endpoint
 * ignores `propertyFilter` and omits `ccm:page_config_ref`, the property the
 * Themenseiten split is derived from), and must not cost an upstream call when
 * there is nothing new to fetch.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { searchCollections } from '../src/services/collection-search.js';
import { installFetchMock, makeNode } from './fetchMock.js';

const MDS = '/mds_oeh/collections';
const NAME = '/collection/v1/collections/-home-/search';
const META = '/metadata';

/** A REST-leg collection: the fixed projection, WITHOUT ccm:page_config_ref. */
function restNode(id: string, title: string) {
  return { ref: { id, repo: '-home-' }, type: 'ccm:map', title, properties: { 'cm:title': [title] } };
}

test('a collection only the name leg knows reaches the merged result', async () => {
  const mock = installFetchMock(url => {
    if (url.includes(MDS)) return { json: { nodes: [makeNode('c-geo', 'Geometrische Optik')] } };
    if (url.includes(NAME)) return { json: { collections: [restNode('c-optik', 'Optik')] } };
    if (url.includes(META)) return { json: { node: makeNode('c-optik', 'Optik', { 'ccm:page_config_ref': ['ref-1'] }) } };
    throw new Error(`unexpected upstream call: ${url}`);
  });
  try {
    const out = await searchCollections('Optik', 10);
    const ids = out.map(n => n.ref?.id);
    assert.ok(ids.includes('c-optik'), `the name-leg-only collection is missing: ${ids.join(', ')}`);
    assert.ok(ids.includes('c-geo'), 'the mds hit must not be lost');
  } finally { mock.restore(); }
});

test('a name-leg-only hit arrives with OUR projection, not the endpoint fixed one', async () => {
  // The whole reason the id is re-read: `searchAll` splits its collections and
  // topicPages buckets on ccm:page_config_ref, which the REST endpoint omits.
  // Adopting its node verbatim files a Themenseite as an ordinary collection.
  const mock = installFetchMock(url => {
    if (url.includes(MDS)) return { json: { nodes: [] } };
    if (url.includes(NAME)) return { json: { collections: [restNode('c-optik', 'Optik')] } };
    if (url.includes(META)) return { json: { node: makeNode('c-optik', 'Optik', { 'ccm:page_config_ref': ['ref-1'] }) } };
    throw new Error(`unexpected upstream call: ${url}`);
  });
  try {
    const out = await searchCollections('Optik', 10);
    assert.equal(out.length, 1);
    assert.deepEqual(out[0]?.properties?.['ccm:page_config_ref'], ['ref-1']);
  } finally { mock.restore(); }
});

test('a collection both legs return appears once, and costs no metadata read', async () => {
  let metaCalls = 0;
  const mock = installFetchMock(url => {
    if (url.includes(MDS)) return { json: { nodes: [makeNode('c-1', 'Mathematik')] } };
    if (url.includes(NAME)) return { json: { collections: [restNode('c-1', 'Mathematik')] } };
    if (url.includes(META)) { metaCalls++; return { json: { node: makeNode('c-1', 'Mathematik') } }; }
    throw new Error(`unexpected upstream call: ${url}`);
  });
  try {
    const out = await searchCollections('Mathematik', 10);
    assert.equal(out.length, 1, 'the same collection from both legs must not take two result slots');
    assert.equal(metaCalls, 0, 'nothing new was found, so nothing may be re-read');
  } finally { mock.restore(); }
});

test('the merge is round-robin, so the cap cannot go entirely to one leg', async () => {
  // Same rule and same reason as the licence bundle (services/license-search.ts):
  // concatenating hands the whole result cap to whichever list comes first.
  const mock = installFetchMock(url => {
    if (url.includes(MDS)) return { json: { nodes: [makeNode('m-1', 'M1'), makeNode('m-2', 'M2'), makeNode('m-3', 'M3')] } };
    if (url.includes(NAME)) return { json: { collections: [restNode('r-1', 'R1'), restNode('r-2', 'R2')] } };
    if (url.includes(META)) {
      const id = /nodes\/-home-\/([^/]+)\//.exec(url)?.[1] ?? '';
      return { json: { node: makeNode(id, id.toUpperCase()) } };
    }
    throw new Error(`unexpected upstream call: ${url}`);
  });
  try {
    const out = await searchCollections('x', 4);
    assert.deepEqual(out.map(n => n.ref?.id), ['m-1', 'r-1', 'm-2', 'r-2']);
  } finally { mock.restore(); }
});

test('the name leg is asked for few results however large the caller cap is', async () => {
  // A cost decision, pinned because it is invisible from the outside and a
  // silent change to it triples the collections leg. Measured 2026-08-11 against
  // staging, that endpoint's latency scales with the number of collections it
  // returns: "Mathematik" costs 889 ms at 3, 1275 ms at 5 and 2565 ms at 10.
  //
  // 5 rather than 3: the collection this leg exists to recover ("Optik") sits at
  // position 3 of its own ranking, so 3 would leave no margin at all.
  //
  // The leg is a REPAIR, not a second full search — its value is a record the
  // mds index cannot return at any rank, and such a record ranks high in a
  // name-oriented list. Positions 6–10 of a second ranking are merely different,
  // and measured 7–10 of 10 name hits were new for broad terms, i.e. the caller
  // would pay the full re-read for results nobody was missing.
  const asked: Record<string, string | null> = {};
  const mock = installFetchMock(url => {
    if (url.includes(MDS)) {
      asked['mds'] = new URL(url).searchParams.get('maxItems');
      return { json: { nodes: [] } };
    }
    if (url.includes(NAME)) {
      asked['name'] = new URL(url).searchParams.get('maxItems');
      return { json: { collections: [] } };
    }
    throw new Error(`unexpected upstream call: ${url}`);
  });
  try {
    await searchCollections('x', 50);
    assert.equal(asked['mds'], '50', 'the mds leg keeps the caller cap');
    assert.equal(asked['name'], '5', 'the name leg is capped independently');
  } finally { mock.restore(); }
});

test('one failing leg does not discard the other leg results', async () => {
  const mock = installFetchMock(url => {
    if (url.includes(MDS)) return { json: { nodes: [makeNode('c-1', 'Mathematik')] } };
    if (url.includes(NAME)) return { status: 500, json: {} };
    throw new Error(`unexpected upstream call: ${url}`);
  });
  try {
    assert.deepEqual((await searchCollections('Mathematik', 10)).map(n => n.ref?.id), ['c-1']);
  } finally { mock.restore(); }
});

test('a name-leg id that cannot be re-read is dropped, not adopted half-projected', async () => {
  // getNodesMetadata drops what it cannot read. Keeping the endpoint node as a
  // fallback would put a node without ccm:page_config_ref back into the pool —
  // the exact shape this re-read exists to prevent.
  const mock = installFetchMock(url => {
    if (url.includes(MDS)) return { json: { nodes: [makeNode('c-1', 'Mathematik')] } };
    if (url.includes(NAME)) return { json: { collections: [restNode('c-gone', 'Weg')] } };
    if (url.includes(META)) return { status: 404, json: {} };
    throw new Error(`unexpected upstream call: ${url}`);
  });
  try {
    assert.deepEqual((await searchCollections('x', 10)).map(n => n.ref?.id), ['c-1']);
  } finally { mock.restore(); }
});
