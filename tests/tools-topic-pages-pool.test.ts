import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock, makeNode } from './fetchMock.js';

/**
 * Mode C fetches MORE page variants than it returns, because variants of one
 * Themenseite merge into a single entry. The old pool was
 * `Math.max(50, maxResults * 5)` — a caller asking for 5 results paid for 50
 * variants and ~8 s (client latency report 2026-07-27). The live data averages
 * 1.10 variants per page (108 variants / 98 pages, measured 2026-07-27), so
 * `maxResults * 2` covers the merge with headroom; the previous, larger pool
 * remains as a one-shot top-up.
 */

function variantNode(i: number, parent: string) {
  return makeNode(`var-${i}`, `PAGE_VARIANT_${i}`, {
    'cm:name': [`PAGE_VARIANT_${i}`],
    'ccm:page_variant_profiling_target_group': ['teacher'],
    'virtual:primaryparent_nodeid': [`workspace://SpacesStore/${parent}`],
  });
}

/** The owner hop: cfg folder → its primary parent → that collection's metadata. */
function ownerLookup(url: string, cfg: string, coll: string, title: string) {
  if (url.includes(`${cfg}/metadata`)) {
    return { json: { node: makeNode(cfg, 'Config', {
      'virtual:primaryparent_nodeid': [`workspace://SpacesStore/${coll}`],
    }) } };
  }
  if (url.includes(`${coll}/metadata`)) {
    return { json: { node: makeNode(coll, title, {
      'cclom:title': [title],
      'ccm:page_config_ref': [`workspace://SpacesStore/${cfg}`],
    }) } };
  }
  return null;
}

/** maxItems of every page_variant search, in order. */
function poolSizes(calls: Array<{ url: string }>): number[] {
  return calls
    .filter(c => c.url.includes('/queries/-home-/mds_oeh/page_variant'))
    .map(c => Number(new URL(c.url).searchParams.get('maxItems')));
}

/** Each variant gets its own parent/collection → merge never collapses them. */
function installDistinctOwnersMock(available: number) {
  return installFetchMock((url) => {
    if (url.includes('/queries/-home-/mds_oeh/page_variant')) {
      const want = Number(new URL(url).searchParams.get('maxItems'));
      const n = Math.min(want, available);
      return { json: { nodes: Array.from({ length: n }, (_, i) => variantNode(i, `cfg-${i}`)) } };
    }
    const m = /(cfg|coll)-(\d+)\/metadata/.exec(url);
    if (m) {
      const hit = ownerLookup(url, `cfg-${m[2]}`, `coll-${m[2]}`, `Sammlung ${String(m[2]).padStart(3, '0')}`);
      if (hit) return hit;
    }
    return { json: {} };
  });
}

test('Mode C: pool is maxResults*2, not a floor of 50', async () => {
  const mock = installDistinctOwnersMock(200);
  const client = await connectedClient();
  try {
    await client.callTool({ name: 'search_wlo_topic_pages', arguments: { maxResults: 20, outputFormat: 'json' } });
    assert.deepEqual(poolSizes(mock.calls), [40]);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('Mode C: a frugal caller no longer pays the 50-variant floor', async () => {
  const mock = installDistinctOwnersMock(200);
  const client = await connectedClient();
  try {
    await client.callTool({ name: 'search_wlo_topic_pages', arguments: { maxResults: 5, outputFormat: 'json' } });
    assert.deepEqual(poolSizes(mock.calls), [10]);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('Mode C: a tiny maxResults still gets a workable minimum pool', async () => {
  const mock = installDistinctOwnersMock(200);
  const client = await connectedClient();
  try {
    await client.callTool({ name: 'search_wlo_topic_pages', arguments: { maxResults: 1, outputFormat: 'json' } });
    assert.deepEqual(poolSizes(mock.calls), [10]);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('Mode C: tops up ONCE when the first pool merges short of maxResults', async () => {
  // Every variant of the first pool belongs to the SAME Themenseite, so the
  // merge yields one entry for five requested → one larger retry, never a loop.
  const mock = installFetchMock((url) => {
    if (url.includes('/queries/-home-/mds_oeh/page_variant')) {
      const want = Number(new URL(url).searchParams.get('maxItems'));
      // First pool (10): all siblings of one page. Top-up (50): distinct pages.
      const nodes = want <= 10
        ? Array.from({ length: want }, (_, i) => variantNode(i, 'cfg-same'))
        : Array.from({ length: want }, (_, i) => variantNode(i, `cfg-${i}`));
      return { json: { nodes } };
    }
    const same = ownerLookup(url, 'cfg-same', 'coll-same', 'Eine Sammlung');
    if (same) return same;
    const m = /(cfg|coll)-(\d+)\/metadata/.exec(url);
    if (m) {
      const hit = ownerLookup(url, `cfg-${m[2]}`, `coll-${m[2]}`, `Sammlung ${String(m[2]).padStart(3, '0')}`);
      if (hit) return hit;
    }
    return { json: {} };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'search_wlo_topic_pages', arguments: { maxResults: 5, outputFormat: 'json' } });
    assert.deepEqual(poolSizes(mock.calls), [10, 50], 'exactly one top-up, at the previous pool size');
    const parsed = JSON.parse((result.content as Array<{ text: string }>)[0]?.text ?? '');
    assert.equal(parsed.total, 5, 'the top-up fills the requested result count');
  } finally {
    await client.close();
    mock.restore();
  }
});

test('Mode C: no top-up when upstream returned fewer variants than requested', async () => {
  // Upstream is exhausted — a second, larger request cannot add anything.
  const mock = installFetchMock((url) => {
    if (url.includes('/queries/-home-/mds_oeh/page_variant')) {
      return { json: { nodes: [variantNode(0, 'cfg-same'), variantNode(1, 'cfg-same')] } };
    }
    return ownerLookup(url, 'cfg-same', 'coll-same', 'Eine Sammlung') ?? { json: {} };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'search_wlo_topic_pages', arguments: { maxResults: 5, outputFormat: 'json' } });
    assert.deepEqual(poolSizes(mock.calls), [10], 'no pointless second request');
    const parsed = JSON.parse((result.content as Array<{ text: string }>)[0]?.text ?? '');
    assert.equal(parsed.total, 1);
  } finally {
    await client.close();
    mock.restore();
  }
});
