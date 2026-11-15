/**
 * A bounded read that answers like a complete one. Three collection tools read
 * a PART — the first 50 files of each collection, the first 100 children, the
 * first 25 branches — and what they said over that part was a statement about
 * the whole: a total, "nothing found", "no such collection".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock, makeNode, type MockResult } from './fetchMock.js';
import { collectRecursiveContents, findCollectionsByTreeTraversal } from '../src/services/collection-traversal.js';

type Structured = Record<string, unknown> & { total: number; count: number };
const block = (result: unknown, i = 0) => (result as { content: { text: string }[] }).content[i]?.text ?? '';

const listing = (ids: string[], total = ids.length): MockResult => ({
  json: { nodes: ids.map(id => makeNode(id, `Titel ${id}`)), pagination: { total, from: 0, count: ids.length } },
});

/** Routes `/children` by node id and filter. */
function tree(files: (id: string) => MockResult, folders: (id: string) => string[]) {
  return installFetchMock((url) => {
    const u = new URL(url);
    const id = decodeURIComponent(u.pathname.match(/-home-\/([^/]+)\/children/)?.[1] ?? '');
    if (!id) return { json: {} };
    return u.searchParams.get('filter') === 'folders' ? listing(folders(id)) : files(id);
  });
}

// ── R4: get_collection_contents, includeSubcollections ───────────────────

test('recursive contents: a collection holding more than was read of it is said', async () => {
  // `sub` holds 300 files; one page of 2 comes back. The total counts all 300,
  // the rows are what was read.
  const mock = tree(id => (id === 'sub' ? listing(['a', 'b'], 300) : listing([])), id => (id === 'root' ? ['sub'] : []));
  try {
    const walk = await collectRecursiveContents('root', 20, new Set(), undefined);
    assert.equal(walk.contentsCut, true);
    assert.equal(walk.walkCapped, undefined);
    assert.equal(walk.totalIsLowerBound, undefined, 'every collection was visited: the sum is what it is');
  } finally { mock.restore(); }
});

test('recursive contents: the visit cap is said, and the total is then a lower bound', async () => {
  const subs = Array.from({ length: 200 }, (_, i) => `sub-${i}`);
  const mock = tree(() => listing([]), id => (id === 'root' ? subs : []));
  try {
    const walk = await collectRecursiveContents('root', 20, new Set(), undefined);
    assert.equal(walk.walkCapped, true);
    assert.equal(walk.totalIsLowerBound, true);
  } finally { mock.restore(); }
});

test('recursive contents: a walk that stopped at a full page counted only what it visited', async () => {
  const mock = tree(id => listing([`${id}-1`, `${id}-2`]), id => (id === 'root' ? ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'] : []));
  try {
    const walk = await collectRecursiveContents('root', 4, new Set(), undefined);
    assert.equal(walk.nodes.length, 4);
    assert.equal(walk.totalIsLowerBound, true, 'collections were left unvisited');
    assert.equal(walk.walkCapped, undefined, 'not the cap — the page was full');
  } finally { mock.restore(); }
});

test('recursive contents: a subtree read to its end carries none of the three', async () => {
  const mock = tree(id => (id === 'sub' ? listing(['a']) : listing([])), id => (id === 'root' ? ['sub'] : []));
  try {
    const walk = await collectRecursiveContents('root', 20, new Set(), undefined);
    assert.deepEqual([walk.walkCapped, walk.contentsCut, walk.totalIsLowerBound], [undefined, undefined, undefined]);
  } finally { mock.restore(); }
});

test('get_collection_contents: the bounds stand in block 0 (Markdown) and in the structured answer', async () => {
  const subs = Array.from({ length: 200 }, (_, i) => `sub-${i}`);
  const mock = tree(id => (id === 'sub-0' ? listing(['a', 'b'], 300) : listing([])), id => (id === 'root' ? subs : []));
  const client = await connectedClient();
  try {
    const args = { nodeId: 'root', includeSubcollections: true };
    const md = await client.callTool({ name: 'get_collection_contents', arguments: args });
    assert.match(block(md), /nicht vollständig durchlaufen/);
    assert.match(block(md), /nur die ersten 50 Inhalte/);
    assert.match(block(md), /Treffer gesamt: mindestens \d+/);
    assert.doesNotMatch(block(md), /Untergrenze/, 'said in the count line, not as a sentence of its own');
    const structured = md.structuredContent as Structured;
    assert.equal(structured['walkCapped'], true);
    assert.equal(structured['contentsCut'], true);
    assert.equal(structured['totalIsLowerBound'], true);

    const json = await client.callTool({ name: 'get_collection_contents', arguments: { ...args, outputFormat: 'json' } });
    assert.doesNotThrow(() => JSON.parse(block(json)), 'block 0 stays pure JSON');
    assert.match(block(json, 1), /nicht vollständig durchlaufen/);
    assert.equal((json.structuredContent as Structured)['walkCapped'], true);
  } finally { await client.close(); mock.restore(); }
});

test('get_collection_contents: an empty subtree behind the cap is not "Sammlung ist leer"', async () => {
  const subs = Array.from({ length: 200 }, (_, i) => `sub-${i}`);
  const mock = tree(() => listing([]), id => (id === 'root' ? subs : []));
  const client = await connectedClient();
  try {
    const md = await client.callTool({ name: 'get_collection_contents', arguments: { nodeId: 'root', includeSubcollections: true } });
    assert.doesNotMatch(block(md), /Sammlung ist leer/);
    assert.match(block(md), /nicht vollständig durchlaufen/);
  } finally { await client.close(); mock.restore(); }
});

test('get_collection_contents: an offset past what the recursive path takes is said, not silently clamped', async () => {
  const mock = tree(() => listing([]), () => []);
  const client = await connectedClient();
  try {
    const past = await client.callTool({ name: 'get_collection_contents', arguments: { nodeId: 'root', includeSubcollections: true, skipCount: 900 } });
    assert.match(block(past), /skipCount reicht hier nur bis 400/);
    assert.equal((past.structuredContent as Structured)['skipLimitReached'], true);
    const within = await client.callTool({ name: 'get_collection_contents', arguments: { nodeId: 'root', includeSubcollections: true, skipCount: 400 } });
    assert.equal((within.structuredContent as Structured)['skipLimitReached'], undefined);
  } finally { await client.close(); mock.restore(); }
});

// ── R5: search_wlo_within_collection ─────────────────────────────────────

test('search_wlo_within_collection: nothing among the first 100 of 500 is not "nothing in this collection"', async () => {
  const mock = installFetchMock((url) => (url.includes('/children')
    ? { json: { nodes: [makeNode('a', 'Photosynthese')], pagination: { total: 500, from: 0, count: 1 } } }
    : { json: {} }));
  const client = await connectedClient();
  try {
    const args = { nodeId: 'coll-1', query: 'bruchrechnung' };
    const md = await client.callTool({ name: 'search_wlo_within_collection', arguments: args });
    // Neither the sentence nor the bare count line: both say "nothing here".
    assert.doesNotMatch(block(md), /Keine Inhalte in dieser Sammlung gefunden|Treffer gesamt: 0/);
    assert.match(block(md), /der Rest wurde nicht durchsucht/);
    assert.match(block(md), /ersten 100 von 500/);
    const structured = md.structuredContent as Structured;
    assert.equal(structured['truncated'], true);
    assert.equal(structured['collectionTotal'], 500);

    const json = await client.callTool({ name: 'search_wlo_within_collection', arguments: { ...args, outputFormat: 'json' } });
    assert.doesNotThrow(() => JSON.parse(block(json)));
    assert.equal((json.structuredContent as Structured)['truncated'], true);
  } finally { await client.close(); mock.restore(); }
});

test('search_wlo_within_collection: hits from a sample carry the disclosure in block 0', async () => {
  const mock = installFetchMock((url) => (url.includes('/children')
    ? { json: { nodes: [makeNode('a', 'Bruchrechnung üben')], pagination: { total: 500, from: 0, count: 1 } } }
    : { json: {} }));
  const client = await connectedClient();
  try {
    const md = await client.callTool({ name: 'search_wlo_within_collection', arguments: { nodeId: 'coll-1', query: 'bruchrechnung' } });
    assert.match(block(md), /Bruchrechnung üben/);
    assert.match(block(md), /ersten 100 von 500/);
  } finally { await client.close(); mock.restore(); }
});

test('search_wlo_within_collection: a collection read whole carries neither the sentence nor the flag', async () => {
  const mock = installFetchMock((url) => (url.includes('/children')
    ? { json: { nodes: [makeNode('a', 'Photosynthese')], pagination: { total: 1, from: 0, count: 1 } } }
    : { json: {} }));
  const client = await connectedClient();
  try {
    const md = await client.callTool({ name: 'search_wlo_within_collection', arguments: { nodeId: 'coll-1', query: 'bruchrechnung' } });
    assert.doesNotMatch(block(md), /ersten 100 von|nicht durchsucht/);
    assert.equal((md.structuredContent as Structured)['truncated'], undefined);
  } finally { await client.close(); mock.restore(); }
});

// ── R9: the tree fallback of search_wlo_collections ──────────────────────

const collection = (id: string) => ({ ...makeNode(id, `Sammlung ${id}`), type: 'ccm:map' });

test('tree fallback: more branches than the scan reads is reported', async () => {
  const level1 = Array.from({ length: 40 }, (_, i) => collection(`p-${i}`));
  const mock = installFetchMock(() => ({ json: { nodes: [] } }));
  try {
    const scan = await findCollectionsByTreeTraversal(level1, 'quantenphysik');
    assert.deepEqual(scan.matches, []);
    assert.equal(scan.capped, true);
    assert.equal(mock.calls.length, 25, 'the cap itself is unchanged');
  } finally { mock.restore(); }
});

test('tree fallback: a full sub-listing counts as cut; a scan that saw everything is not capped', async () => {
  let mock = installFetchMock((url) => (url.includes('/p-0/')
    ? { json: { nodes: Array.from({ length: 50 }, (_, i) => collection(`c-${i}`)) } }
    : { json: { nodes: [] } }));
  try {
    assert.equal((await findCollectionsByTreeTraversal([collection('p-0')], 'quantenphysik')).capped, true);
  } finally { mock.restore(); }
  mock = installFetchMock(() => ({ json: { nodes: [] } }));
  try {
    assert.equal((await findCollectionsByTreeTraversal([collection('p-0')], 'quantenphysik')).capped, undefined);
  } finally { mock.restore(); }
});

test('tree fallback: unread, refused and answered sub-listings are still told apart', async () => {
  const level1 = ['ok', 'down', 'closed', 'thrown'].map(collection);
  const mock = installFetchMock((url) => {
    if (url.includes('/down/')) return { status: 503, json: {} };
    if (url.includes('/closed/')) return { status: 403, json: {} };
    if (url.includes('/thrown/')) throw new Error('socket hang up');
    return { json: { nodes: [{ ...makeNode('hit', 'Quantenphysik'), type: 'ccm:map' }] } };
  });
  try {
    const scan = await findCollectionsByTreeTraversal(level1, 'quantenphysik');
    assert.deepEqual(scan.matches.map(n => n.ref?.id), ['hit']);
    assert.equal(scan.unread, 2);
    assert.equal(scan.refused, 1);
  } finally { mock.restore(); }
});

test('tree fallback: the level-2 listings are read a few at a time, not all at once', async () => {
  const level1 = Array.from({ length: 25 }, (_, i) => collection(`p-${i}`));
  let open = 0;
  let peak = 0;
  const real = globalThis.fetch;
  globalThis.fetch = (async () => {
    open++; peak = Math.max(peak, open);
    await new Promise(resolve => setTimeout(resolve, 5));
    open--;
    return new Response(JSON.stringify({ nodes: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    await findCollectionsByTreeTraversal(level1, 'quantenphysik');
    assert.ok(peak <= 10, `at most ten listings open at once, saw ${peak}`);
  } finally { globalThis.fetch = real; }
});

test('search_wlo_collections: nothing found in a capped scan is not "there is none"', async () => {
  const many = Array.from({ length: 100 }, (_, i) => collection(`p-${i}`));
  const mock = installFetchMock((url) => {
    if (url.includes('/children')) return { json: { nodes: url.includes('/p-') ? [] : many } };
    return { json: { nodes: [], collections: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
  const client = await connectedClient();
  try {
    const md = await client.callTool({ name: 'search_wlo_collections', arguments: { query: 'quantenphysik' } });
    assert.doesNotMatch(block(md), /Keine Sammlungen gefunden für/);
    assert.match(block(md), /nur ein Teil des Sammlungsbaums/);
    assert.equal((md.structuredContent as Structured)['scanCapped'], true);

    const json = await client.callTool({ name: 'search_wlo_collections', arguments: { query: 'quantenphysik', outputFormat: 'json' } });
    assert.doesNotThrow(() => JSON.parse(block(json)));
    assert.match(block(json, 1), /nur ein Teil des Sammlungsbaums/);
  } finally { await client.close(); mock.restore(); }
});

test('search_wlo_collections: a scan that saw the whole tree keeps "Keine Sammlungen gefunden für"', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/children')) return { json: { nodes: url.includes('/p-') ? [] : [collection('p-0')] } };
    return { json: { nodes: [], collections: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
  const client = await connectedClient();
  try {
    const md = await client.callTool({ name: 'search_wlo_collections', arguments: { query: 'quantenphysik' } });
    assert.match(block(md), /Keine Sammlungen gefunden für/);
    assert.equal((md.structuredContent as Structured)['scanCapped'], undefined);
  } finally { await client.close(); mock.restore(); }
});

// ── JSON block 0 says what the structured answer says ────────────────────
//
// A client that parses block 0 and never reads `structuredContent` is the
// reason `incomplete` and `restricted` are in the block. The bounds are the
// same kind of statement, and were in the structured answer alone.

/** The disclosure keys of an answer — everything but the list itself. */
const said = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o)
  .filter(([k]) => !['total', 'count', 'results', 'resolvedCollection', 'unresolvedFilters'].includes(k)));

test('search_wlo_collections (json): block 0 carries scanCapped', async () => {
  const many = Array.from({ length: 100 }, (_, i) => collection(`p-${i}`));
  const mock = installFetchMock((url) => {
    if (url.includes('/children')) return { json: { nodes: url.includes('/p-') ? [] : many } };
    return { json: { nodes: [], collections: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
  const client = await connectedClient();
  try {
    const json = await client.callTool({ name: 'search_wlo_collections', arguments: { query: 'quantenphysik', outputFormat: 'json' } });
    const parsed = JSON.parse(block(json));
    assert.equal(parsed.scanCapped, true);
    assert.deepEqual(said(parsed), said(json.structuredContent as Structured));
  } finally { await client.close(); mock.restore(); }
});

test('get_collection_contents (json): block 0 carries the walk\'s bounds and the offset limit', async () => {
  const subs = Array.from({ length: 200 }, (_, i) => `sub-${i}`);
  const mock = tree(id => (id === 'sub-0' ? listing(['a', 'b'], 300) : listing([])), id => (id === 'root' ? subs : []));
  const client = await connectedClient();
  try {
    const json = await client.callTool({ name: 'get_collection_contents',
      arguments: { nodeId: 'root', includeSubcollections: true, skipCount: 900, outputFormat: 'json' } });
    const parsed = JSON.parse(block(json));
    assert.deepEqual(
      [parsed.walkCapped, parsed.contentsCut, parsed.totalIsLowerBound, parsed.skipLimitReached],
      [true, true, true, true]);
    assert.deepEqual(said(parsed), said(json.structuredContent as Structured));
  } finally { await client.close(); mock.restore(); }
});

test('search_wlo_within_collection (json): block 0 carries truncated and collectionTotal', async () => {
  const mock = installFetchMock((url) => (url.includes('/children')
    ? { json: { nodes: [makeNode('a', 'Photosynthese')], pagination: { total: 500, from: 0, count: 1 } } }
    : { json: {} }));
  const client = await connectedClient();
  try {
    const json = await client.callTool({ name: 'search_wlo_within_collection',
      arguments: { nodeId: 'coll-1', query: 'bruchrechnung', outputFormat: 'json' } });
    const parsed = JSON.parse(block(json));
    assert.equal(parsed.truncated, true);
    assert.equal(parsed.collectionTotal, 500);
    assert.deepEqual(said(parsed), said(json.structuredContent as Structured));
  } finally { await client.close(); mock.restore(); }
});

test('a complete answer carries none of the bounds in block 0', async () => {
  const mock = tree(id => (id === 'sub' ? listing(['a']) : listing([])), id => (id === 'root' ? ['sub'] : []));
  const client = await connectedClient();
  try {
    const json = await client.callTool({ name: 'get_collection_contents',
      arguments: { nodeId: 'root', includeSubcollections: true, outputFormat: 'json' } });
    assert.deepEqual(Object.keys(JSON.parse(block(json))).sort(), ['count', 'results', 'total']);
    const md = await client.callTool({ name: 'get_collection_contents', arguments: { nodeId: 'root', includeSubcollections: true } });
    assert.match(block(md), /Treffer gesamt: 1,/);
    assert.doesNotMatch(block(md), /mindestens/);
  } finally { await client.close(); mock.restore(); }
});

test('get_collection_contents: a first page of a larger subtree says "mindestens" in the count line — and nothing more', async () => {
  // The ordinary case: the page is full before the subtree is walked. One word
  // in the line that prints the number, not a sentence on every first page.
  const mock = tree(id => listing([`${id}-1`, `${id}-2`]), id => (id === 'root' ? ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'] : []));
  const client = await connectedClient();
  try {
    const args = { nodeId: 'root', includeSubcollections: true, maxResults: 4 };
    const md = await client.callTool({ name: 'get_collection_contents', arguments: args });
    assert.match(block(md), /Gefundene Treffer gesamt: mindestens \d+, zeige 4/);
    assert.doesNotMatch(block(md), /Hinweis:/);
    assert.equal((md.structuredContent as Structured)['totalIsLowerBound'], true);

    const json = await client.callTool({ name: 'get_collection_contents', arguments: { ...args, outputFormat: 'json' } });
    assert.equal(JSON.parse(block(json)).totalIsLowerBound, true);
    const blocks = (json as { content: { text: string }[] }).content.map(c => c.text);
    assert.ok(!blocks.some(t => /Untergrenze|mindestens/.test(t) && !t.startsWith('{')), 'no prose block for it — the field is in block 0');
  } finally { await client.close(); mock.restore(); }
});

test('search_wlo_within_collection: the sub-collection hint does not speak for the unread part', async () => {
  const mock = installFetchMock((url) => (url.includes('/children')
    ? { json: { nodes: [makeNode('a', 'Photosynthese')], pagination: { total: 500, from: 0, count: 1 } } }
    : { json: {} }));
  const client = await connectedClient();
  try {
    const md = await client.callTool({ name: 'search_wlo_within_collection', arguments: { nodeId: 'coll-1', query: 'bruchrechnung' } });
    const all = (md as { content: { text: string }[] }).content.map(c => c.text).join('\n');
    assert.doesNotMatch(all, /Keiner der 500 direkten Inhalte/, '400 of them were never looked at');
    assert.match(all, /Keiner der ersten 100 von 500 direkten Inhalte dieser Sammlung passt zur Suche/);
    assert.match(all, /Unter-Sammlung\(en\)/, 'the way on is still named');
  } finally { await client.close(); mock.restore(); }
});

test('search_wlo_collections: a refused branch AND a capped scan are both said', async () => {
  const many = Array.from({ length: 100 }, (_, i) => collection(`p-${i}`));
  const mock = installFetchMock((url) => {
    if (url.includes('/p-0/')) return { status: 403, json: {} };
    if (url.includes('/children')) return { json: { nodes: url.includes('/p-') ? [] : many } };
    return { json: { nodes: [], collections: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
  const client = await connectedClient();
  try {
    const md = await client.callTool({ name: 'search_wlo_collections', arguments: { query: 'quantenphysik' } });
    assert.match(block(md), /In den lesbaren Teilen wurde keine Sammlung/);
    assert.match(block(md), /mit dieser Anmeldung nicht lesbar/);
    assert.match(block(md), /nur ein Teil des Sammlungsbaums/, 'the bound is not swallowed by the refusal');
    const structured = md.structuredContent as Structured;
    assert.deepEqual([structured['restricted'], structured['scanCapped']], [true, true]);
  } finally { await client.close(); mock.restore(); }
});
