/**
 * wlo-search.test.ts – the two search endpoints of the edu-sharing client.
 *
 * The module had no test file of its own before R2 and was only exercised
 * indirectly through the search-pipeline tests. Its two error contracts differ
 * on purpose (ngsearch throws, the collection lookup degrades), so both are
 * pinned here — including what happens when the repository answers 200 with
 * something that is not JSON.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ngsearch, searchCollectionsByKeyword, searchCollectionsByName } from '../src/wlo-search.js';
import { installFetchMock, makeNode } from './fetchMock.js';

test('ngsearch: posts the criteria and maps nodes + pagination', async () => {
  const mock = installFetchMock(() => ({
    json: { nodes: [makeNode('n-1', 'Bruchrechnen')], pagination: { total: 1, from: 0, count: 1 } },
  }));
  try {
    const out = await ngsearch([{ property: 'ngsearchword', values: ['bruch'] }]);
    assert.equal(out.nodes.length, 1);
    assert.equal(out.pagination.total, 1);
    const body = JSON.parse(String(mock.calls[0].init?.body));
    assert.deepEqual(body.criteria, [{ property: 'ngsearchword', values: ['bruch'] }]);
  } finally { mock.restore(); }
});

test('ngsearch: a missing pagination block degrades to zeroes, not undefined', async () => {
  const mock = installFetchMock(() => ({ json: { nodes: [] } }));
  try {
    const out = await ngsearch([{ property: 'ngsearchword', values: ['x'] }]);
    assert.deepEqual(out.pagination, { total: 0, from: 0, count: 0 });
  } finally { mock.restore(); }
});

test('ngsearch: throws on a non-OK response', async () => {
  const mock = installFetchMock(() => ({ status: 503, json: {} }));
  try {
    await assert.rejects(
      () => ngsearch([{ property: 'ngsearchword', values: ['x'] }]),
      /ngsearch failed: 503/,
    );
  } finally { mock.restore(); }
});

test('ngsearch: a 200 that is not JSON throws a named error, not a raw SyntaxError', async () => {
  // A gateway or maintenance page in front of the repository answers 200 with
  // HTML. ngsearch's contract is to throw on failure — but with an error that
  // says which upstream call broke, not "Unexpected token <".
  const mock = installFetchMock(() => ({ text: '<html>maintenance</html>' }));
  try {
    await assert.rejects(
      () => ngsearch([{ property: 'ngsearchword', values: ['x'] }]),
      /ngsearch: upstream response was not valid JSON/,
    );
  } finally { mock.restore(); }
});

test('searchCollectionsByKeyword: returns the collection nodes', async () => {
  const mock = installFetchMock(() => ({ json: { nodes: [makeNode('c-1', 'Mathematik')] } }));
  try {
    const out = await searchCollectionsByKeyword('mathe');
    assert.equal(out[0]?.ref?.id, 'c-1');
    const body = JSON.parse(String(mock.calls[0].init?.body));
    assert.deepEqual(body.criteria, [{ property: 'ngsearchword', values: ['mathe'] }]);
  } finally { mock.restore(); }
});

test('searchCollectionsByKeyword: degrades to [] on a non-OK response', async () => {
  const mock = installFetchMock(() => ({ status: 500, json: {} }));
  try {
    assert.deepEqual(await searchCollectionsByKeyword('mathe'), []);
  } finally { mock.restore(); }
});

test('searchCollectionsByKeyword: degrades to [] when the 200 body is not JSON', async () => {
  // This function documents itself as degrading; a parse failure must take the
  // same route as an HTTP failure instead of throwing past the caller.
  const mock = installFetchMock(() => ({ text: '<html>maintenance</html>' }));
  try {
    assert.deepEqual(await searchCollectionsByKeyword('mathe'), []);
  } finally { mock.restore(); }
});

test('searchCollectionsByName: reads the `collections` key, not `nodes`', async () => {
  // The two collection endpoints disagree about the envelope key. Reading
  // `nodes` here yields an empty list from a perfectly good 200 — a silent
  // "this collection does not exist" over a record the repository just returned.
  const mock = installFetchMock(() => ({
    json: { collections: [makeNode('c-1', 'Optik')], nodes: [] },
  }));
  try {
    const out = await searchCollectionsByName('Optik');
    assert.equal(out[0]?.ref?.id, 'c-1');
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname.endsWith('/collection/v1/collections/-home-/search'), true);
    assert.equal(url.searchParams.get('query'), 'Optik');
    assert.equal(url.searchParams.get('maxItems'), '10');
    // Measured 2026-08-11: the endpoint ignores propertyFilter and answers with a
    // fixed projection. Sending one would only lengthen the URL.
    assert.equal(url.searchParams.has('propertyFilter'), false);
  } finally { mock.restore(); }
});

test('searchCollectionsByName: an empty query asks the repository nothing', async () => {
  const mock = installFetchMock(url => { throw new Error(`unexpected upstream call: ${url}`); });
  try {
    assert.deepEqual(await searchCollectionsByName('   '), []);
    assert.equal(mock.calls.length, 0);
  } finally { mock.restore(); }
});

test('searchCollectionsByName: degrades to [] on a non-OK response', async () => {
  const mock = installFetchMock(() => ({ status: 500, json: {} }));
  try {
    assert.deepEqual(await searchCollectionsByName('Optik'), []);
  } finally { mock.restore(); }
});

test('searchCollectionsByName: degrades to [] when the 200 body is not JSON', async () => {
  const mock = installFetchMock(() => ({ text: '<html>maintenance</html>' }));
  try {
    assert.deepEqual(await searchCollectionsByName('Optik'), []);
  } finally { mock.restore(); }
});
