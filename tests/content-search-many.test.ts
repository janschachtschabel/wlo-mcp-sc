/**
 * content-search-many.test.ts – several content searches in ONE call (Z4,
 * chatbot team, 2026-11-13): the service.
 *
 * What is pinned here is what makes the batch a batch: fewer and smaller
 * repository requests per query, one shared bound on how many are open, a
 * deadline per query and per call, and that a part which could not be answered
 * is NAMED — never an empty list.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installFetchMock, makeNode } from './fetchMock.js';
import { fullTextOnly, installManyMock } from './searchManyMock.js';
import { buildFilterCriteria } from '../src/filter-criteria.js';
import { expandQuery } from '../src/query-expand.js';
import { ENHANCED_POOL_SIZE, enhancedSearch } from '../src/reranker.js';
import { createLimiter } from '../src/concurrency.js';
import { ClientGoneError, isClientGone, runWithRequestSignal } from '../src/request-scope.js';
import {
  batchCeiling, inputProblem, MANY_LICENSE_POOL, MANY_POOL, MANY_VARIANTS_MAX, searchContentMany, type Timers,
} from '../src/services/content-search-many.js';
import { DISPLAY_PROPS } from '../src/wlo-config.js';

const optik = [makeNode('o1', 'Optik'), makeNode('o2', 'Optik im Alltag'), makeNode('o3', 'Optik Versuche'), makeNode('o4', 'Optik Quiz')];
const linsen = [makeNode('l1', 'Linsen'), makeNode('l2', 'Linsen bauen')];

test('each query is answered under its own id, in short form', async () => {
  const mock = installManyMock(fullTextOnly({
    optik: { nodes: [makeNode('o1', 'Optik', {
      'cclom:general_description': [`${'Licht und Schatten '.repeat(20)}Ende`],
      'ccm:wwwurl': ['https://example.org/optik'],
      'ccm:commonlicense_key': ['CC_BY'],
    }), ...optik.slice(1)] },
    linsen: { nodes: linsen },
  }));
  try {
    const answer = await searchContentMany({
      queries: [{ id: 's1', query: 'Optik' }, { id: 's2', query: 'Linsen' }], maxResults: 3,
    });
    assert.deepEqual(Object.keys(answer.results), ['s1', 's2']);
    assert.deepEqual(answer.results['s1']!.results.map(r => r.nodeId), ['o1', 'o2', 'o3']);
    assert.equal(answer.results['s1']!.count, 3);
    assert.deepEqual(answer.results['s2']!.results.map(r => r.nodeId), ['l1', 'l2']);
    assert.deepEqual(answer.missing, []);
    const first = answer.results['s1']!.results[0]!;
    assert.equal(first.url, 'https://example.org/optik');
    assert.ok(first.description.length <= 201, `description is cut: ${first.description.length}`);
    assert.match(first.description, /…$/);
    assert.ok(first.license.length > 0, 'the licence label of formatNode');
    assert.equal(answer.distinctApplied, undefined);
  } finally { mock.restore(); }
});

test('at most three variants per query, each over the small window', async () => {
  const mock = installManyMock(fullTextOnly({}));
  try {
    // Five variants in the single search: full, title, keyword, no-stopword, topic.
    const query = 'Arbeitsblatt für die Optik';
    assert.ok(expandQuery(query).length > MANY_VARIANTS_MAX, 'the premise: the single search asks more');
    await searchContentMany({ queries: [{ id: 'a', query }], maxResults: 3 });
    assert.equal(mock.searches.length, MANY_VARIANTS_MAX);
    assert.equal(MANY_VARIANTS_MAX, 3);
    assert.deepEqual([...new Set(mock.searches.map(s => s.maxItems))], [MANY_POOL]);
    assert.ok(MANY_POOL < ENHANCED_POOL_SIZE, 'a smaller window than the single search reads');
  } finally { mock.restore(); }
});

test('the SINGLE search is unchanged: the same five requests — URL and body', async () => {
  const mock = installFetchMock(() => ({ json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } }));
  try {
    const query = 'Arbeitsblatt für die Optik';
    const filter = { property: 'ccm:taxonid', values: ['x'] };
    await enhancedSearch(query, 'FILES', [filter], 8);
    assert.equal(mock.calls.length, expandQuery(query).length);

    // Literals, not derived from the code under test: what the single search
    // sent before the batch options (`maxVariants`, `poolSize`, `schedule`) existed.
    const sent = mock.calls.map(c => (JSON.parse(String(c.init?.body)) as { criteria: unknown[] }).criteria);
    assert.deepEqual(sent, [
      [{ property: 'ngsearchword', values: ['Arbeitsblatt für die Optik'] }, filter],
      [{ property: 'cclom:title', values: ['Arbeitsblatt für die Optik'] }, filter],
      [{ property: 'ngsearchword', values: ['Optik'] }, filter],
      [{ property: 'cclom:general_keyword', values: ['Arbeitsblatt', 'für', 'die', 'Optik'] }, filter],
      [{ property: 'ngsearchword', values: ['Arbeitsblatt Optik'] }, filter],
    ]);
    for (const call of mock.calls) {
      assert.equal(call.init?.method, 'POST');
      assert.deepEqual(Object.keys(JSON.parse(String(call.init?.body)) as object), ['criteria'], 'nothing beside the criteria');
      const url = new URL(call.url);
      assert.match(url.pathname, /\/rest\/search\/v1\/queries\/-home-\/mds_oeh\/ngsearch$/);
      const params = [...url.searchParams].filter(([k]) => k !== 'propertyFilter');
      assert.deepEqual(params, [['contentType', 'FILES'], ['maxItems', '25'], ['skipCount', '0']]);
      assert.deepEqual(url.searchParams.getAll('propertyFilter'), DISPLAY_PROPS, 'the projection of every search');
    }
    assert.equal(ENHANCED_POOL_SIZE, 25);
  } finally { mock.restore(); }
});

test('an empty per-query filter is "not given": it does not drop the shared one', async () => {
  const mock = installManyMock(fullTextOnly({}));
  let resolutions = 0;
  try {
    await searchContentMany({
      queries: [
        { id: 'a', query: 'Optik', filters: { license: '', discipline: '   ' } },
        { id: 'b', query: 'Linsen', filters: { license: ' ', educationalContext: 'Sekundarstufe I' } },
      ],
      shared: { license: 'CC BY', discipline: 'Physik' },
      maxResults: 3,
      resolveFilters: (f) => { resolutions++; return buildFilterCriteria(f); },
    });
    const has = (word: string, property: string) => mock.searches.filter(s => s.word === word)
      .every(s => s.criteria.some(c => c.property === property));
    assert.ok(mock.searches.length > 0);
    for (const word of ['optik', 'linsen']) {
      assert.ok(has(word, 'ccm:commonlicense_key'), `${word}: the shared licence still applies`);
      assert.ok(has(word, 'ccm:taxonid'), `${word}: the shared subject still applies`);
    }
    assert.ok(has('linsen', 'ccm:educationalcontext'), 'and the filter that WAS given is added');
    // The licence window too — it follows the merged filter.
    assert.deepEqual([...new Set(mock.searches.map(s => s.maxItems))], [MANY_LICENSE_POOL]);
    assert.equal(resolutions, 2, 'only blanks is no override: `a` reuses the shared resolution');
  } finally { mock.restore(); }
});

test('the shared filters are resolved ONCE, a per-query filter overrides them', async () => {
  const mock = installManyMock(fullTextOnly({}));
  let resolutions = 0;
  try {
    await searchContentMany({
      queries: [
        { id: 'a', query: 'Optik' }, { id: 'b', query: 'Linsen' },
        { id: 'c', query: 'Prisma', filters: { discipline: 'Mathematik' } },
      ],
      shared: { discipline: 'Physik', educationalContext: 'Sekundarstufe I' },
      maxResults: 3,
      resolveFilters: (f) => { resolutions++; return buildFilterCriteria(f); },
    });
    // Once for the shared set, once for the one query that changes it.
    assert.equal(resolutions, 2);
    const physik = buildFilterCriteria({ discipline: 'Physik' }).criteria[0]!.values[0];
    const mathe = buildFilterCriteria({ discipline: 'Mathematik' }).criteria[0]!.values[0];
    const taxon = (word: string) => mock.searches.find(s => s.word === word)!
      .criteria.find(c => c.property === 'ccm:taxonid')?.values[0];
    assert.equal(taxon('optik'), physik);
    assert.equal(taxon('linsen'), physik);
    assert.equal(taxon('prisma'), mathe, 'the override replaces the shared subject');
    // What the override did not name still applies.
    assert.ok(mock.searches.filter(s => s.word === 'prisma')
      .every(s => s.criteria.some(c => c.property === 'ccm:educationalcontext')));
  } finally { mock.restore(); }
});

test('an unresolved filter is NOT dropped: that query is not searched, the others are', async () => {
  const mock = installManyMock(fullTextOnly({ linsen: { nodes: linsen } }));
  try {
    const answer = await searchContentMany({
      queries: [{ id: 'a', query: 'Optik', filters: { educationalContext: 'Quatschstufe' } }, { id: 'b', query: 'Linsen' }],
      maxResults: 3,
    });
    assert.deepEqual(Object.keys(answer.results), ['b']);
    assert.equal(answer.missing.length, 1);
    assert.equal(answer.missing[0]!.part, 'a');
    assert.equal(answer.missing[0]!.code, 'unresolved_filter');
    assert.match(answer.missing[0]!.message ?? '', /Quatschstufe/);
    assert.equal(mock.searches.filter(s => s.word === 'optik').length, 0, 'no request without the filter');
  } finally { mock.restore(); }
});

test('an unresolved SHARED filter leaves every query unanswered', async () => {
  const mock = installManyMock(fullTextOnly({}));
  try {
    const answer = await searchContentMany({
      queries: [{ id: 'a', query: 'Optik' }, { id: 'b', query: 'Linsen' }],
      shared: { license: 'Quatschlizenz' }, maxResults: 3,
    });
    assert.deepEqual(answer.missing.map(m => [m.part, m.code]), [['a', 'unresolved_filter'], ['b', 'unresolved_filter']]);
    assert.equal(mock.searches.length, 0);
  } finally { mock.restore(); }
});

test('a query whose search failed is in missing with the wait — the others are answered', async () => {
  const mock = installManyMock(fullTextOnly({
    optik: { status: 503, headers: { 'retry-after': '7' } },
    linsen: { nodes: linsen },
  }));
  try {
    const answer = await searchContentMany({
      queries: [{ id: 'a', query: 'Optik' }, { id: 'b', query: 'Linsen' }], maxResults: 3,
    });
    assert.deepEqual(answer.missing, [{ part: 'a', code: 'upstream_busy', retryAfter: 7 }]);
    assert.equal(answer.results['a'], undefined, 'never an empty list for a search that did not answer');
    assert.equal(answer.results['b']!.count, 2);
  } finally { mock.restore(); }
});

test('a query that answered with nothing is an empty result, not a missing part', async () => {
  const mock = installManyMock(fullTextOnly({}));
  try {
    const answer = await searchContentMany({ queries: [{ id: 'a', query: 'Optik' }], maxResults: 3 });
    assert.deepEqual(answer.results['a'], { count: 0, results: [] });
    assert.deepEqual(answer.missing, []);
  } finally { mock.restore(); }
});

// The three tests below run on NO clock: the deadlines are fired by the test
// (`timers`), the repository answers when the test says so (`until`), and what
// is asserted is the ORDER of events. A wall-clock margin fails on a busy runner.

/** A clock whose timers fire only when told to. */
function manualTimers() {
  const pending = new Set<{ fn: () => void; ms: number }>();
  const timers: Timers = {
    set: (fn, ms) => { const t = { fn, ms }; pending.add(t); return t; },
    clear: handle => { pending.delete(handle as { fn: () => void; ms: number }); },
  };
  return {
    timers,
    armed: (ms: number) => [...pending].filter(t => t.ms === ms).length,
    fire: (ms: number) => { for (const t of [...pending]) if (t.ms === ms) { pending.delete(t); t.fn(); } },
  };
}

/** A promise the test settles. */
function gate() {
  let open!: () => void;
  const closed = new Promise<void>(resolve => { open = resolve; });
  return { closed, open };
}

/** Wait — in turns of the event loop, not in milliseconds — until `condition` holds. */
async function until(condition: () => boolean, what: string): Promise<void> {
  for (let turn = 0; turn < 10_000; turn++) {
    if (condition()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail(`never happened: ${what}`);
}

const PER_QUERY = 111;
const WHOLE_CALL = 999;

test('the deadline per query: the slow one is named as timeout, the fast one answered', async () => {
  const repository = gate();
  const clock = manualTimers();
  const mock = installManyMock(fullTextOnly({ optik: { until: repository.closed, nodes: optik }, linsen: { nodes: linsen } }));
  try {
    let answered = false;
    const pending = searchContentMany({
      queries: [{ id: 'slow', query: 'Optik' }, { id: 'fast', query: 'Linsen' }],
      maxResults: 3, perQueryMs: PER_QUERY, totalMs: WHOLE_CALL, timers: clock.timers,
    }).finally(() => { answered = true; });
    // Each query armed its clock with its first request; the fast one is done
    // when it has put its own away.
    await until(() => mock.searches.length === 2 * MANY_VARIANTS_MAX && clock.armed(PER_QUERY) === 1, 'the fast query finished');
    assert.equal(answered, false, 'the call waits for the slow query — until ITS deadline');
    clock.fire(PER_QUERY);
    const answer = await pending;
    assert.deepEqual(answer.missing, [{ part: 'slow', code: 'timeout' }]);
    assert.equal(answer.results['fast']!.count, 2);
    assert.equal(clock.armed(PER_QUERY) + clock.armed(WHOLE_CALL), 0, 'no clock is left running');
  } finally { repository.open(); mock.restore(); }
});

test('the deadline of the whole call: what is not finished is missing, the call still answers', async () => {
  const repository = gate();
  const clock = manualTimers();
  const mock = installManyMock(fullTextOnly({
    optik: { until: repository.closed, nodes: optik }, linsen: { until: repository.closed, nodes: linsen },
  }));
  try {
    const pending = searchContentMany({
      queries: [{ id: 'a', query: 'Optik' }, { id: 'b', query: 'Linsen' }],
      maxResults: 3, perQueryMs: PER_QUERY, totalMs: WHOLE_CALL, timers: clock.timers,
    });
    await until(() => mock.searches.length === 2 * MANY_VARIANTS_MAX, 'every request is open');
    clock.fire(WHOLE_CALL);
    // The repository has NOT answered (its gate is still closed): the call
    // answers at its deadline, not when the repository does.
    const answer = await pending;
    assert.deepEqual(answer.missing.map(m => [m.part, m.code]), [['a', 'timeout'], ['b', 'timeout']]);
    assert.deepEqual(answer.results, {});
    assert.equal(clock.armed(PER_QUERY) + clock.armed(WHOLE_CALL), 0, 'no clock is left running');
  } finally { repository.open(); mock.restore(); }
});

test('a pool of ONE still makes progress: every query is answered, one request at a time', async () => {
  const mock = installManyMock(fullTextOnly({ optik: { nodes: optik }, linsen: { nodes: linsen } }));
  try {
    const answer = await searchContentMany({
      queries: [{ id: 'a', query: 'Optik' }, { id: 'b', query: 'Linsen' }], maxResults: 3, ceiling: batchCeiling(1),
    });
    assert.deepEqual(answer.missing, []);
    assert.deepEqual([answer.results['a']!.count, answer.results['b']!.count], [3, 2]);
    assert.equal(mock.searches.length, 2 * MANY_VARIANTS_MAX);
    assert.equal(mock.maxOpen(), 1);
  } finally { mock.restore(); }
});

test('one shared pool: never more open repository calls than the ceiling', async () => {
  const mock = installManyMock(() => ({ delayMs: 3 }));
  try {
    const queries = Array.from({ length: 8 }, (_, i) => ({ id: `q${i}`, query: `Thema${i} Begriff${i}` }));
    await searchContentMany({ queries, maxResults: 3 });
    assert.equal(mock.searches.length, 8 * MANY_VARIANTS_MAX);
    // Default gate limit 24 → half of it.
    assert.equal(batchCeiling(24), 12);
    assert.equal(mock.maxOpen(), batchCeiling(), 'the pool is used up to the ceiling and not past it');
  } finally { mock.restore(); }
});

test('the ceiling: half the gate limit, at least 1 and never the whole gate, a fixed 12 when the gate is off', () => {
  assert.equal(batchCeiling(24), 12);
  assert.equal(batchCeiling(9), 4);
  assert.equal(batchCeiling(4), 2);
  assert.equal(batchCeiling(3), 1);
  assert.equal(batchCeiling(2), 1);
  assert.equal(batchCeiling(1), 1);
  assert.equal(batchCeiling(0), 12);
});

test('createLimiter: a waiter whose signal aborts leaves the queue at once, and its slot is not lost', async () => {
  const run = createLimiter(1);
  const first = gate();
  const order: string[] = [];
  const holder = run(async () => { await first.closed; order.push('holder done'); });
  const leaver = new AbortController();
  let started = false;
  const left = run(async () => { started = true; }, leaver.signal).then(
    () => order.push('leaver ran'), (err: unknown) => order.push(`leaver left: ${(err as Error).message}`));
  const patient = run(async () => { order.push('patient ran'); });

  leaver.abort(new Error('gone'));
  await left;
  // The slot is still held: the waiter left WITHOUT waiting for it.
  assert.deepEqual(order, ['leaver left: gone']);
  first.open();
  await Promise.all([holder, patient]);
  assert.deepEqual(order, ['leaver left: gone', 'holder done', 'patient ran']);
  assert.equal(started, false);
  // And the bound is intact afterwards: one at a time, nothing stuck.
  assert.equal(await run(async () => 'next'), 'next');
});

test('createLimiter runs at most `limit` tasks at once and keeps going after a failure', async () => {
  const run = createLimiter(2);
  let open = 0;
  let most = 0;
  const task = (fail: boolean) => run(async () => {
    open++; most = Math.max(most, open);
    await new Promise(r => setTimeout(r, 2));
    open--;
    if (fail) throw new Error('boom');
    return 'ok';
  });
  const settled = await Promise.allSettled([task(false), task(true), task(false), task(false), task(false)]);
  assert.equal(most, 2);
  assert.deepEqual(settled.map(s => s.status), ['fulfilled', 'rejected', 'fulfilled', 'fulfilled', 'fulfilled']);
});

test('distinct: a material stays with the query it fits best, the other is refilled from its own window', async () => {
  // `x` is the exact title for "Linsen" and only a keyword hit for "Optik".
  const x = makeNode('m-x', 'Linsen', { 'cclom:general_keyword': ['Optik'] });
  const reserve = makeNode('z-o3', 'Lichtlehre', { 'cclom:general_keyword': ['Optik'] });
  const mock = installManyMock(fullTextOnly({
    optik: { nodes: [makeNode('a-o1', 'Optik'), x, reserve] },
    linsen: { nodes: [x, makeNode('l2', 'Linsen bauen'), makeNode('l3', 'Linsen schleifen')] },
  }));
  try {
    const args = { queries: [{ id: 'optik', query: 'Optik' }, { id: 'linsen', query: 'Linsen' }], maxResults: 2 };
    const plain = await searchContentMany(args);
    assert.deepEqual(plain.results['optik']!.results.map(r => r.nodeId), ['a-o1', 'm-x'], 'the premise: both queries show it');
    assert.equal(plain.results['linsen']!.results[0]!.nodeId, 'm-x');

    const answer = await searchContentMany({ ...args, distinct: true });
    assert.equal(answer.distinctApplied, true);
    assert.deepEqual(answer.results['linsen']!.results.map(r => r.nodeId), ['m-x', 'l2']);
    assert.deepEqual(answer.results['optik']!.results.map(r => r.nodeId), ['a-o1', 'z-o3'], 'refilled, no new request');
    assert.equal(answer.results['optik']!.movedToOtherQueries, 1);
    assert.equal(answer.results['linsen']!.movedToOtherQueries, undefined);
    assert.equal(mock.searches.length, 4 * MANY_VARIANTS_MAX, 'two calls, no request for the refill');
  } finally { mock.restore(); }
});

test('distinct: a reference and its original are one material, and so are two records of one URL', async () => {
  const original = makeNode('orig', 'Linsen', { 'cclom:general_keyword': ['Optik'] });
  const reference = { ...makeNode('ref', 'Linsen', { 'cclom:general_keyword': ['Optik'] }), originalId: 'orig' };
  const copyA = makeNode('c1', 'Prisma', { 'ccm:wwwurl': ['https://example.org/p'], 'cclom:general_keyword': ['Optik'] });
  const copyB = makeNode('c2', 'Prisma', { 'ccm:wwwurl': ['https://example.org/p'] });
  const mock = installManyMock(fullTextOnly({
    optik: { nodes: [reference, copyA] },
    linsen: { nodes: [original] },
    prisma: { nodes: [copyB] },
  }));
  try {
    const answer = await searchContentMany({
      queries: [{ id: 'optik', query: 'Optik' }, { id: 'linsen', query: 'Linsen' }, { id: 'prisma', query: 'Prisma' }],
      maxResults: 3, distinct: true,
    });
    assert.deepEqual(answer.results['optik']!.results, []);
    assert.equal(answer.results['optik']!.movedToOtherQueries, 2);
    assert.deepEqual(answer.results['linsen']!.results.map(r => r.nodeId), ['orig']);
    assert.deepEqual(answer.results['prisma']!.results.map(r => r.nodeId), ['c2']);
  } finally { mock.restore(); }
});

test('distinct: an equal fit goes to the earlier query', async () => {
  const same = makeNode('s', 'Optik Linsen');
  const mock = installManyMock(fullTextOnly({ optik: { nodes: [same] }, linsen: { nodes: [same] } }));
  try {
    const answer = await searchContentMany({
      queries: [{ id: 'first', query: 'Optik' }, { id: 'second', query: 'Linsen' }], maxResults: 2, distinct: true,
    });
    assert.equal(answer.results['first']!.count, 1);
    assert.equal(answer.results['second']!.count, 0);
    assert.equal(answer.results['second']!.movedToOtherQueries, 1);
  } finally { mock.restore(); }
});

test('a licence is matched EXACTLY and the pass is disclosed; the window is wider for it', async () => {
  const mock = installManyMock(fullTextOnly({ optik: { nodes: [
    makeNode('by', 'Optik', { 'ccm:commonlicense_key': ['CC_BY'] }),
    makeNode('nd', 'Optik heute', { 'ccm:commonlicense_key': ['CC_BY_ND'] }),
    makeNode('nc', 'Optik morgen', { 'ccm:commonlicense_key': ['CC_BY_NC_ND'] }),
  ] } }));
  try {
    const answer = await searchContentMany({ queries: [{ id: 'a', query: 'Optik' }], shared: { license: 'CC BY' }, maxResults: 3 });
    assert.deepEqual(answer.results['a']!.results.map(r => r.nodeId), ['by']);
    assert.deepEqual(answer.results['a']!.licenseFilter, { checked: 3, kept: 1 });
    assert.ok(mock.searches.every(s => s.criteria.some(c => c.property === 'ccm:commonlicense_key' && c.values[0] === 'CC_BY')));
    assert.deepEqual([...new Set(mock.searches.map(s => s.maxItems))], [MANY_LICENSE_POOL]);
    // No facet request for an exact total — this tool reports none.
    assert.equal(mock.searches.length, MANY_VARIANTS_MAX);
  } finally { mock.restore(); }
});

test('more: set while the window was full, absent when it was the last', async () => {
  const many = Array.from({ length: MANY_POOL }, (_, i) => makeNode(`n${String(i).padStart(2, '0')}`, `Optik ${i}`));
  const mock = installManyMock(fullTextOnly({ optik: { nodes: many }, linsen: { nodes: linsen } }));
  try {
    const answer = await searchContentMany({ queries: [{ id: 'a', query: 'Optik' }, { id: 'b', query: 'Linsen' }], maxResults: 2 });
    assert.equal(answer.results['a']!.more, true);
    assert.equal(answer.results['b']!.more, undefined, 'two hits, both shown, every variant short of its window');
  } finally { mock.restore(); }
});

test('input that cannot be searched is named before anything is asked', () => {
  assert.match(inputProblem({ queries: [{ id: 'a', query: 'x' }, { id: 'a', query: 'y' }] }) ?? '', /„a“/);
  assert.match(inputProblem({ queries: [{ id: 'a', query: 'x' }], shared: { license: 'OER' } }) ?? '', /search_wlo_content/);
  assert.match(inputProblem({ queries: [{ id: 'a', query: 'x', filters: { license: 'oer' } }] }) ?? '', /search_wlo_content/);
  assert.equal(inputProblem({ queries: [{ id: 'a', query: 'x' }, { id: 'b', query: 'x' }], shared: { license: 'CC BY' } }), null);
});

test('a caller that hung up stops the work: the call ends as a hang-up, queued requests are never sent', async () => {
  const repository = gate();
  const mock = installManyMock(() => ({ until: repository.closed }));
  const client = new AbortController();
  try {
    const queries = Array.from({ length: 8 }, (_, i) => ({ id: `q${i}`, query: `Thema${i} Begriff${i}` }));
    const pending = runWithRequestSignal(client.signal, () => searchContentMany({ queries, maxResults: 3, timers: manualTimers().timers }));
    // The pool is full and the rest is queued: THEN the caller hangs up.
    await until(() => mock.searches.length === batchCeiling(), 'the first wave is open');
    client.abort(new ClientGoneError());
    await assert.rejects(pending, err => isClientGone(err));
    // The first wave answers now and frees every slot: nothing may take one.
    repository.open();
    for (let turn = 0; turn < 50; turn++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(mock.searches.length, batchCeiling(), 'only what was already open');
  } finally { repository.open(); mock.restore(); }
});
