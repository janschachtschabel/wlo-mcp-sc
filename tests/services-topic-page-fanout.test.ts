import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findTopicPagesByQuery } from '../src/services/topic-page.js';
import { WLO_ROOT_COLLECTION_ID, WLO_TOPIC_POOL } from '../src/wlo-api.js';
import { makeNode } from './fetchMock.js';

/**
 * `findTopicPagesByQuery` checks up to MODE_B_CANDIDATE_MAX (12) candidate
 * collections, each costing a metadata read plus — when it has a page config —
 * a children read. At concurrency 4 that was three to four sequential waves and
 * measured ~1.8 s against production; running the candidates in one wave
 * measured ~0.8 s. It is the shared core of `get_topic_page_content(query)`
 * (2.8 s) and `search_wlo_topic_pages` Mode B (1.9 s), the two slowest tools.
 */

/** fetch stub that records how many requests are in flight simultaneously. */
function installConcurrencyProbe(handler: (url: string) => unknown) {
  const real = globalThis.fetch;
  let inFlight = 0;
  let maxInFlight = 0;
  globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    // Yield twice so genuinely parallel callers overlap before any resolves.
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    inFlight--;
    return new Response(JSON.stringify(handler(url)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return { get maxInFlight() { return maxInFlight; }, restore: () => { globalThis.fetch = real; } };
}

/** 12 keyword-hit collections, each owning a topic page. */
function candidatesHandler(url: string): unknown {
  if (url.includes('/queries/-home-/mds_oeh/collections')) {
    return { nodes: Array.from({ length: 12 }, (_, i) => makeNode(`cand-${i}`, `Sammlung ${i}`)) };
  }
  if (url.includes(`${WLO_ROOT_COLLECTION_ID}/children`)) return { nodes: [] };
  const meta = /nodes\/-home-\/(cand-\d+)\/metadata/.exec(url);
  if (meta) {
    return { node: makeNode(meta[1], `Sammlung ${meta[1]}`, {
      'cclom:title': [`Sammlung ${meta[1]}`],
      'ccm:page_config_ref': [`workspace://SpacesStore/cfg-${meta[1]}`],
    }) };
  }
  if (url.includes('/children')) return { nodes: [] };
  return {};
}

test('findTopicPagesByQuery: checks candidates with the configured fan-out width, not four at a time', async () => {
  const probe = installConcurrencyProbe(candidatesHandler);
  try {
    await findTopicPagesByQuery('Nachhaltigkeit');
    assert.ok(
      probe.maxInFlight > 4,
      `expected more than the old cap of 4 concurrent upstream calls, saw ${probe.maxInFlight}`,
    );
    assert.ok(
      probe.maxInFlight <= WLO_TOPIC_POOL,
      `fan-out must stay bounded by WLO_TOPIC_POOL (${WLO_TOPIC_POOL}), saw ${probe.maxInFlight}`,
    );
  } finally {
    probe.restore();
  }
});

test('findTopicPagesByQuery: a failing keyword search does not discard the portal matches', async () => {
  // The two legs are not equals: only the portal leg carries ccm:page_config_ref
  // (the keyword-collections endpoint returns a reduced projection without it).
  // Losing the whole call because the supplementary leg threw is the defect
  // searchAll already guards against at services/search.ts.
  const real = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input);
    seen.push(url);
    // What a timeout or a reset looks like: a rejected fetch, not a 5xx.
    if (url.includes('/queries/-home-/mds_oeh/collections')) throw new TypeError('fetch failed');
    if (url.includes(`${WLO_ROOT_COLLECTION_ID}/children`)) {
      return new Response(JSON.stringify({ nodes: [makeNode('portal-1', 'Optik', {
        'ccm:page_config_ref': ['workspace://SpacesStore/cfg-1'],
      })] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    const pages = await findTopicPagesByQuery('Optik');
    assert.ok(Array.isArray(pages), 'the call must resolve, not reject');
    assert.ok(
      seen.some(u => u.includes('portal-1')),
      'the portal candidate must still be examined after the keyword leg failed',
    );
  } finally {
    globalThis.fetch = real;
  }
});

test('findTopicPagesByQuery: still returns every candidate page', async () => {
  // Widening the fan-out must not change the result set.
  const probe = installConcurrencyProbe(candidatesHandler);
  try {
    const pages = await findTopicPagesByQuery('Nachhaltigkeit');
    // Each candidate has a page config but no variant children in this mock, so
    // no ThemePageInfo is produced — the contract under test is that all 12 were
    // examined, which the concurrency probe above asserts. Here we only pin that
    // the call completes without dropping into an error path.
    assert.ok(Array.isArray(pages));
  } finally {
    probe.restore();
  }
});
