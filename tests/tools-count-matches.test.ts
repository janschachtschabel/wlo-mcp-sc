/**
 * tools-count-matches.test.ts – how many contents per outline point?
 * (BOERDi wishlist item 5, 2026-11-06).
 *
 * The basis of the chatbot's "where does my outline have gaps?". Counting only:
 * no reranking, no query variants — ONE search per query, so the number is the
 * repository's and the same query twice gives the same number. Without
 * `withinCollectionId` (E5: the repository cannot scope a search to a subtree).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assertRejectsWithoutUpstream, connectedClient, installFetchMock, makeNode, type MockResult } from './fetchMock.js';

const TOTALS: Record<string, number> = { lichtbrechung: 87, linsen: 0, prisma: 12 };

function repository(extra?: (word: string) => MockResult | undefined) {
  return installFetchMock((url, init) => {
    if (!url.includes('/ngsearch')) return { json: {} };
    const criteria = JSON.parse(String(init?.body ?? '{}')).criteria as Array<{ property: string; values: string[] }>;
    const word = criteria.find(c => c.property === 'ngsearchword')?.values[0]?.toLowerCase() ?? '';
    const special = extra?.(word);
    if (special) return special;
    const total = TOTALS[word] ?? 0;
    const max = Number(new URL(url).searchParams.get('maxItems') ?? '0');
    const nodes = Array.from({ length: Math.min(max, total) }, (_, i) => makeNode(`${word}-${i}`, `${word} ${i}`));
    return { json: { nodes, pagination: { total, from: 0, count: nodes.length } } };
  });
}

interface Answer {
  results: Array<{ id: string; total: number; top: Array<{ nodeId: string; title: string }>; fuzzyFilters?: string[] }>;
  missing: Array<{ part: string; code: string; message?: string }>;
}

async function count(args: Record<string, unknown>, extra?: Parameters<typeof repository>[0]) {
  const mock = repository(extra);
  const c = await connectedClient();
  try {
    const r = await c.callTool({ name: 'count_wlo_content_matches', arguments: args });
    assert.notEqual(r.isError, true, JSON.stringify(r.content));
    return { sc: r.structuredContent as unknown as Answer, calls: mock.calls };
  } finally { await c.close(); mock.restore(); }
}

test('one search per query: the repository total and the top hits', async () => {
  const { sc, calls } = await count({ queries: [
    { id: 'p1', query: 'Lichtbrechung' }, { id: 'p2', query: 'Linsen' }, { id: 'p3', query: 'Prisma' },
  ] });
  assert.deepEqual(sc.results.map(r => [r.id, r.total, r.top.length]), [['p1', 87, 2], ['p2', 0, 0], ['p3', 12, 2]]);
  assert.equal(calls.filter(c => c.url.includes('/ngsearch')).length, 3, 'no query variants, no reranking pool');
  assert.deepEqual(sc.missing, []);
});

test('the same query twice gives the same number', async () => {
  const { sc } = await count({ queries: [{ id: 'a', query: 'Prisma' }, { id: 'b', query: 'Prisma' }], top: 0 });
  assert.equal(sc.results[0]!.total, sc.results[1]!.total);
  assert.deepEqual(sc.results[0]!.top, []);
});

test('an unresolved filter is NOT dropped — the query is not counted at all', async () => {
  // Counting without the filter would report a bigger number as if it were the
  // filtered one: exactly the wrong answer for a gap analysis.
  const { sc } = await count({ queries: [
    { id: 'p1', query: 'Lichtbrechung', filters: { educationalContext: 'Quatschstufe' } },
    { id: 'p2', query: 'Prisma' },
  ] });
  assert.deepEqual(sc.results.map(r => r.id), ['p2']);
  assert.equal(sc.missing[0]?.part, 'p1');
  assert.equal(sc.missing[0]?.code, 'unresolved_filter');
});

test('a guessed filter is counted and says so', async () => {
  const { sc } = await count({ queries: [{ id: 'p1', query: 'Prisma', filters: { learningResourceType: 'Arbeitsblat' } }] });
  assert.deepEqual(sc.results[0]!.fuzzyFilters, ['learningResourceType']);
});

test('a failing search is named, the rest still counts', async () => {
  const { sc } = await count(
    { queries: [{ id: 'p1', query: 'kaputt' }, { id: 'p2', query: 'Prisma' }] },
    word => (word === 'kaputt' ? { status: 500, json: {} } : undefined),
  );
  assert.deepEqual(sc.results.map(r => r.id), ['p2']);
  assert.deepEqual(sc.missing, [{ part: 'p1', code: 'upstream_error' }]);
});

test('bounds: at most 30 queries and top 3, enforced by the schema', async () => {
  const c = await connectedClient();
  try {
    await assertRejectsWithoutUpstream(c, 'count_wlo_content_matches',
      { queries: Array.from({ length: 31 }, (_, i) => ({ id: `q${i}`, query: 'x' })) }, '31 queries');
    await assertRejectsWithoutUpstream(c, 'count_wlo_content_matches',
      { queries: [{ id: 'q', query: 'x' }], top: 4 }, 'top 4');
  } finally { await c.close(); }
});
