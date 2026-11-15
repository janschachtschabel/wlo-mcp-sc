/**
 * tools-find-by-url.test.ts – is there already a record for this address?
 * (BOERDi wishlist item 2, 2026-11-06).
 *
 * The fake repository answers the part of staging's behaviour that matters
 * here (measured 2026-11-06): a `ccm:wwwurl` criterion is case-insensitive, and
 * a trailing slash or a `utm_` parameter on the query does NOT find the stored
 * clean address — so the tool must ask for the cleaned spelling itself. (Staging
 * also returns prefix neighbours; the tool compares every hit, which the
 * "another page of the same site" case covers.)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assertRejectsWithoutUpstream, connectedClient, installFetchMock, type MockResult } from './fetchMock.js';

const STORED = [
  { id: 'rec-1', url: 'https://example.org/optik', title: 'Optik' },
  { id: 'rec-2', url: 'https://example.org/optik', title: 'Optik (Kopie)' },
  { id: 'rec-3', url: 'https://example.org/linsen/', title: 'Linsen' },
  // A neighbour: staging returns a longer address sharing the prefix (measured
  // with `…-teil-2`). It must never be reported as a match.
  { id: 'rec-4', url: 'https://example.org/optik-teil-2', title: 'Optik, Teil 2' },
];

interface Match { nodeId: string; title: string; wwwurl: string; match: 'exact' | 'normalized'; inCollections?: number | null }
interface Entry { url: string; normalized?: string; matches: Match[]; error?: { code: string; message: string } }

function repository(extra?: (url: string, init?: RequestInit) => MockResult | undefined) {
  return installFetchMock((url, init) => {
    const special = extra?.(url, init);
    if (special) return special;
    if (url.includes('/ngsearch')) {
      const asked = String(JSON.parse(String(init?.body ?? '{}')).criteria?.[0]?.values?.[0] ?? '').toLowerCase();
      const nodes = STORED.filter(r => r.url.toLowerCase().startsWith(asked)).map(r => ({
        ref: { id: r.id, repo: '-home-' }, properties: { 'ccm:wwwurl': [r.url], 'cclom:title': [r.title] },
      }));
      return { json: { nodes, pagination: { total: nodes.length, from: 0, count: nodes.length } } };
    }
    return { status: 404, json: {} };
  });
}

async function find(args: Record<string, unknown>, extra?: Parameters<typeof repository>[0]) {
  const mock = repository(extra);
  const c = await connectedClient();
  try {
    const r = await c.callTool({ name: 'find_content_by_url', arguments: args });
    assert.notEqual(r.isError, true, JSON.stringify(r.content));
    return { results: (r.structuredContent as { results: Entry[] }).results, calls: mock.calls };
  } finally { await c.close(); mock.restore(); }
}

test('the exact address is found — every record that carries it, and no neighbour', async () => {
  const { results } = await find({ urls: ['https://example.org/optik'] });
  assert.deepEqual(results[0]!.matches.map(m => [m.nodeId, m.match]), [['rec-1', 'exact'], ['rec-2', 'exact']]);
});

test('tracking parameters, fragment and trailing slash are cleaned — and the hit says it was', async () => {
  const { results } = await find({ urls: ['https://EXAMPLE.org/optik/?utm_source=x&fbclid=1#oben'] });
  assert.equal(results[0]!.normalized, 'https://example.org/optik');
  assert.deepEqual(results[0]!.matches.map(m => m.match), ['normalized', 'normalized'],
    'not a sure duplicate: the caller asks before treating it as one');
});

test('a stored trailing slash is found from the clean spelling', async () => {
  const { results } = await find({ urls: ['https://example.org/linsen'] });
  assert.deepEqual(results[0]!.matches.map(m => [m.nodeId, m.match]), [['rec-3', 'normalized']]);
});

test('another page of the same site is not a match', async () => {
  const { results } = await find({ urls: ['https://example.org/optik-2'] });
  assert.deepEqual(results[0]!.matches, []);
});

test('an unusable address fails on its own entry, not the call', async () => {
  const { results, calls } = await find({ urls: ['ftp://example.org/x', 'kein link', 'https://example.org/optik'] });
  assert.equal(results[0]!.error?.code, 'invalid_url');
  assert.equal(results[1]!.error?.code, 'invalid_url');
  assert.equal(results[2]!.matches.length, 2);
  assert.ok(!calls.some(c => String(c.init?.body ?? '').includes('ftp://')), 'no search for an address that is not http(s)');
});

test('an upstream failure is reported per entry', async () => {
  const { results } = await find(
    { urls: ['https://broken.example/x', 'https://example.org/optik'] },
    (url, init) => (url.includes('/ngsearch') && String(init?.body ?? '').includes('broken.example')
      ? { status: 500, json: {} } : undefined),
  );
  assert.equal(results[0]!.error?.code, 'upstream_error');
  assert.equal(results[1]!.matches.length, 2);
});

test('a busy repository is reported per entry as upstream_busy, not as broken', async () => {
  const { results } = await find(
    { urls: ['https://busy.example/x'] },
    (url, init) => (url.includes('/ngsearch') && String(init?.body ?? '').includes('busy.example')
      ? { status: 503, json: {} } : undefined),
  );
  assert.equal(results[0]!.error?.code, 'upstream_busy');
});

test('collections are counted only on request — each costs a usage read', async () => {
  const off = await find({ urls: ['https://example.org/linsen'] });
  assert.ok(!off.calls.some(c => c.url.includes('/usage/')), 'default: no usage read');
  assert.equal('inCollections' in off.results[0]!.matches[0]!, false);

  const on = await find({ urls: ['https://example.org/linsen'], includeCollections: true }, url => {
    if (url.includes('rec-3/metadata')) return { json: { node: { ref: { id: 'rec-3', repo: '-home-' }, properties: { 'cclom:title': ['Linsen'] } } } };
    if (url.includes('/usage/v1/usages/node/rec-3/collections')) {
      return { json: [{ collectionUsageType: 'ACTIVE', collection: { ref: { id: 'c1' }, properties: {} } }, { collectionUsageType: 'ACTIVE', collection: { ref: { id: 'c2' }, properties: {} } }] };
    }
    return undefined;
  });
  assert.equal(on.results[0]!.matches[0]!.inCollections, 2);
});

test('at most twenty addresses per call, enforced by the schema', async () => {
  const c = await connectedClient();
  try {
    await assertRejectsWithoutUpstream(c, 'find_content_by_url',
      { urls: Array.from({ length: 21 }, (_, i) => `https://example.org/${i}`) }, '21 addresses');
  } finally { await c.close(); }
});

test('collection counts run bounded, not all at once', async () => {
  // Twenty copies of one address: without a bound that is forty usage and
  // metadata reads in flight for a single entry.
  const copies = Array.from({ length: 20 }, (_, i) => ({ id: `copy-${i}`, url: 'https://example.org/viel', title: 'Viel' }));
  STORED.push(...copies);
  const real = globalThis.fetch;
  let inFlight = 0; let peak = 0;
  try {
    const { results } = await find({ urls: ['https://example.org/viel'], includeCollections: true }, url => {
      if (url.includes('/usage/') || /copy-\d+\/metadata/.test(url)) {
        inFlight++; peak = Math.max(peak, inFlight);
        queueMicrotask(() => { inFlight--; });
      }
      return undefined;
    });
    assert.equal(results[0]!.matches.length, 20);
    assert.ok(peak <= 8, `at most a bounded pool in flight, saw ${peak}`);
  } finally {
    STORED.splice(STORED.length - copies.length, copies.length);
    globalThis.fetch = real;
  }
});
