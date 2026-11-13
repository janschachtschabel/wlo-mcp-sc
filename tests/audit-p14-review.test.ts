/**
 * audit-p14-review.test.ts – what the review of audit package 14 found, one
 * test per finding. Each of them was invisible to the tests written with the
 * change: the cache was tested for what it kept, not for whom; the parallel
 * walk for order, not for failure; the batch cap for refusing, not for what a
 * refusal leaves behind.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runAnonymous, runWithCredential, type WloCredential } from '../src/auth/credential.js';
import { renderMarkdown } from '../src/apps/widgets/shared/markdown.js';
import { routeRestRequest } from '../src/rest/routes.js';
import { collectRecursiveContents } from '../src/services/collection-traversal.js';
import { searchAll } from '../src/services/search.js';
import { describeEntries } from '../src/services/skill-registry.js';
import { runCacheTick, stopSkillRegistryCache, queueCollections, cacheSize } from '../src/services/skill-registry-cache.js';
import { pickBestSkillResult } from '../src/services/skills.js';
import { BatchConfirmations, TooManyBatches, type BatchPlan } from '../src/services/write/batch-confirm.js';
import { summarizeManifest } from '../src/services/write/batch-manifest.js';
import { searchTopicPageCollectionsResult } from '../src/topic-page-api.js';
import { installFetchMock, makeNode, type MockResult } from './fetchMock.js';

const MARIA: WloCredential = { header: 'Basic bWFyaWE6eA==', label: 'maria', source: 'user' };
const authOf = (init?: RequestInit) => new Headers((init?.headers ?? {}) as HeadersInit).get('authorization');

// ── 1: a remembered read is served only to who could have made it ───────────

test('a description read with a PERSON\'s rights is not served to an anonymous caller', async () => {
  // The skill is not public: readable with a login, 403 without.
  const mock = installFetchMock((url, init): MockResult => {
    if (!url.includes('/s-private/')) return { status: 404, json: {} };
    return authOf(init)
      ? { json: { node: { ref: { id: 's-private' }, properties: { 'cclom:general_description': ['Nur für Angemeldete.'] } } } }
      : { status: 403, json: {} };
  });
  try {
    const entries = [{ nodeId: 's-private', title: 'Intern' }];
    const own = await runWithCredential(MARIA, () => describeEntries(entries));
    assert.equal(own.described.length, 1);
    const anonymous = await runAnonymous(() => describeEntries(entries));
    assert.deepEqual([anonymous.described.length, anonymous.unreadable.length], [0, 1],
      'somebody else\'s read must not describe a skill this caller cannot read');
  } finally { mock.restore(); }
});

test('the portal list read with a person\'s rights is not the public one', async () => {
  const portal = (id: string, title: string) => makeNode(id, title, { 'ccm:page_config_ref': ['workspace://SpacesStore/cfg'] });
  const mock = installFetchMock((url, init): MockResult => {
    if (!url.includes('/children')) return { json: {} };
    const nodes = authOf(init) ? [portal('p-intern', 'Physik intern'), portal('p-1', 'Physik')] : [portal('p-1', 'Physik')];
    return { json: { nodes, pagination: { total: nodes.length, from: 0, count: nodes.length } } };
  });
  try {
    assert.equal((await runWithCredential(MARIA, () => searchTopicPageCollectionsResult('Physik'))).nodes.length, 2);
    assert.equal((await runAnonymous(() => searchTopicPageCollectionsResult('Physik'))).nodes.length, 1);
    const before = mock.calls.length;
    await runAnonymous(() => searchTopicPageCollectionsResult('Physik'));
    assert.equal(mock.calls.length, before, 'the ANONYMOUS list is shared among anonymous callers');
    await runWithCredential(MARIA, () => searchTopicPageCollectionsResult('Physik'));
    assert.equal(mock.calls.length, before + 1, 'a personal login reads for itself, every time');
    // The shared SERVICE account sees what its rights show — kept apart from the anonymous list.
    const SERVICE: WloCredential = { header: 'Basic c2VydmljZTp4', label: 'dienst', source: 'service' };
    assert.equal((await runWithCredential(SERVICE, () => searchTopicPageCollectionsResult('Physik'))).nodes.length, 2);
    assert.equal((await runAnonymous(() => searchTopicPageCollectionsResult('Physik'))).nodes.length, 1);
  } finally { mock.restore(); }
});

// ── 2: the manifest summary's size does not follow the title cap ─────────────

test('two hundred entries with 200-character titles still fit the property that holds the summary', () => {
  const title = 'x'.repeat(200);
  const inhalte = Array.from({ length: 200 }, (_, index) => ({ index, titel: title, nodeId: 'a'.repeat(36), stand: 'stored' }));
  const summary = summarizeManifest({ ordner: 'o'.repeat(120), layout: 'folder', inhalte });
  assert.ok(JSON.stringify(summary).length < 53_950, `summary is ${JSON.stringify(summary).length} characters`);
  assert.ok(summary.inhalte[0]!.titel.length <= 121);
  assert.equal(summarizeManifest({ ordner: 'o', layout: 'flat', inhalte: [{ index: 0, titel: 'Kurz', stand: 'stored' }] }).inhalte[0]!.titel, 'Kurz');
});

// ── 3: a read the serial walk never made cannot fail the call ───────────────

test('a failing collection PAST the one that filled the page does not fail the walk', async () => {
  const mock = installFetchMock((url): MockResult => {
    const u = new URL(url);
    const id = decodeURIComponent(u.pathname.match(/-home-\/([^/]+)\/children/)?.[1] ?? '');
    const folders = u.searchParams.get('filter') === 'folders';
    if (id === 's3') return { status: 500, json: {} };
    const nodes = folders
      ? (id === 'root' ? ['s0', 's1', 's2', 's3'].map(s => ({ ref: { id: s }, properties: {} })) : [])
      : (id === 'root' ? [] : [{ ref: { id: `f-${id}` }, properties: { 'cclom:title': ['x'] } }]);
    return { json: { nodes, pagination: { total: nodes.length, from: 0, count: nodes.length } } };
  });
  try {
    const out = await collectRecursiveContents('root', 2, new Set(), undefined);
    assert.deepEqual(out.nodes.map(n => n.nodeId), ['f-s0', 'f-s1']);
    // Reached, it still fails — exactly as the serial walk did.
    await assert.rejects(collectRecursiveContents('root', 10, new Set(), undefined));
  } finally { mock.restore(); }
});

// ── 4: the other callers of the Wikipedia read, and the one-tool finder ─────

test('/api/wikipedia answers 503 for an outage and 404 only for "no article"', async () => {
  let mock = installFetchMock(() => ({ status: 503, json: {} }));
  try {
    const r = await routeRestRequest('GET', '/api/wikipedia?q=Optik');
    assert.equal(r!.status, 503);
  } finally { mock.restore(); }
  mock = installFetchMock((url) => (url.includes('/w/api.php') ? { json: ['x', [], [], []] } : { status: 404, json: {} }));
  try {
    assert.equal((await routeRestRequest('GET', '/api/wikipedia?q=zzzz'))!.status, 404);
  } finally { mock.restore(); }
});

test('searchAll says when the Wikipedia it was asked for did not answer', async () => {
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('wikipedia.org')) return { status: 503, json: {} };
    return { json: { nodes: [], collections: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
  try {
    const out = await searchAll({ query: 'Optik', include: ['content'], includeWikipedia: true });
    assert.equal(out.wikipedia, undefined);
    assert.equal(out.wikipediaUnreachable, true);
    const without = await searchAll({ query: 'Optik', include: ['content'] });
    assert.equal('wikipediaUnreachable' in without, false, 'not asked for, nothing said');
  } finally { mock.restore(); }
});

test('nothing picked over a collection read in part is reported as incomplete — not as "no skill"', async () => {
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('filter=folders')) return { json: { nodes: [] } };
    if (url.includes('filter=files')) return { json: { nodes: [], pagination: { total: 120, from: 0, count: 0 } } };
    return { json: {} };
  });
  try {
    assert.deepEqual(await pickBestSkillResult({ collectionId: 'skills-root', query: 'Stunde planen' }), { picked: null, incomplete: true });
  } finally { mock.restore(); }
});

// ── 5 + 6: batches ───────────────────────────────────────────────────────────

const PLAN: BatchPlan = {
  target: 'home', folderName: 'Physik 7', layout: 'folder',
  entries: [{ index: 0, title: 'Mechanik', sha256: 'a'.repeat(64), size: 10, ext: 'pdf', fileName: 'mechanik.pdf', role: 'content' }],
};

test('a preparation refused at the SERVER bound evicts nothing — not even the owner\'s idle batches', () => {
  const bc = new BatchConfirmations({ clock: () => 1_000_000, maxPerOwner: 2, maxTotal: 3 });
  const running = bc.mint('b', PLAN);
  bc.redeem(running, 'b', 0);
  const alsoRunning = bc.mint('c', PLAN);
  bc.redeem(alsoRunning, 'c', 0);
  const idleA = bc.mint('a', PLAN);        // the store is full: 3 of 3, one idle (a's own)
  const secondA = bc.mint('a', PLAN);      // makes room from a's idle one — allowed
  assert.equal(bc.redeem(idleA, 'a', 0).outcome, 'unknown');
  bc.redeem(secondA, 'a', 0);              // now all three are under way
  assert.throws(() => bc.mint('d', PLAN), (err: unknown) => err instanceof TooManyBatches && err.scope === 'server');
  for (const [token, owner] of [[running, 'b'], [alsoRunning, 'c'], [secondA, 'a']] as const) {
    assert.notEqual(bc.redeem(token, owner, 0).outcome, 'unknown', 'a refused preparation left this one alone');
  }
});

test('a batch whose folder creation ended OPEN holds no place — it cannot be continued anyway', async () => {
  const bc = new BatchConfirmations({ clock: () => 1_000_000, maxPerOwner: 1 });
  const dead = bc.mint('a', PLAN);
  await bc.folder(dead, async () => ({ ok: false as const, open: true as const, detail: 'HTTP 502.' }));
  assert.doesNotThrow(() => bc.mint('a', PLAN), 'the dead batch made room for the next');
});

// ── 8: markdown ──────────────────────────────────────────────────────────────

test('a code span inside a link TARGET does not end up inside the href', () => {
  const html = renderMarkdown('[a](http://x/`y`)');
  assert.doesNotMatch(html, /href="[^"]*<code>/, html);
});

test('a long run of opening brackets is answered at once', () => {
  const startedAt = Date.now();
  renderMarkdown('['.repeat(60_000));
  assert.ok(Date.now() - startedAt < 1500, `took ${Date.now() - startedAt} ms`);
});

// ── 10: a stopped cache is not refilled ──────────────────────────────────────

test('a tick in flight when the cache is stopped writes nothing into the new one', async () => {
  stopSkillRegistryCache();
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  const real = globalThis.fetch;
  globalThis.fetch = (async () => {
    await gate;
    return new Response(JSON.stringify({ nodes: [], pagination: { total: 0, from: 0, count: 0 } }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    queueCollections(['coll-stale']);
    const tick = runCacheTick();
    stopSkillRegistryCache();
    // While the old tick is still out: a tick asked for now must be a NEW one.
    // Joined to the old promise it would drain nothing of the new cache's queue.
    const next = runCacheTick();
    assert.notEqual(next, tick);
    release();
    await Promise.all([tick, next]);
    assert.equal(cacheSize(), 0, 'what the old tick learned belongs to a cache that is gone');
  } finally {
    globalThis.fetch = real;
    stopSkillRegistryCache();
  }
});
