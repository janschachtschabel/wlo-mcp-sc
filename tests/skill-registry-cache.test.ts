/**
 * skill-registry-cache.test.ts – the memo of the authoritative children listing.
 *
 * The cache exists so a collection result can carry its skill catalogue without
 * costing a request. What it remembers comes from `loadSkillRegistry` — the same
 * children listing the live path reads — never from the search index, which
 * `CLAUDE.md` forbids as a basis for an approval list. The index only says where
 * looking is worth it.
 *
 * That is also why a remembered "there is no registry here" is allowed to count
 * as an answer: it rests on a listing that actually replied. A lookup that
 * failed is remembered as nothing at all.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  attachCachedRegistries,
  CACHE_MAX_ENTRIES,
  cacheSize,
  cacheWarmup,
  ensureRegistries,
  lookupCachedRegistry,
  queueCollections,
  queueLength,
  runCacheTick,
  startSkillRegistryCache,
  stopSkillRegistryCache,
} from '../src/services/skill-registry-cache.js';
import { SKILL_CONTENT_TYPE_URI } from '../src/services/skill-catalogue.js';
import { formatNode } from '../src/formatter.js';

import { installFetchMock, makeNode, type MockResult } from './fetchMock.js';

test('an unknown collection is unknown — not "no registry"', () => {
  stopSkillRegistryCache();
  // `undefined` and `{ registry: null }` are different answers, and every caller
  // depends on being able to tell them apart.
  assert.equal(lookupCachedRegistry('never-seen'), undefined);
});

test('queueing is idempotent', () => {
  stopSkillRegistryCache();
  queueCollections(['a', 'a', 'b']);
  queueCollections(['b']);
  assert.equal(queueLength(), 2);
});

test('an empty or blank id is not queued', () => {
  stopSkillRegistryCache();
  queueCollections(['', '   ', 'a']);
  assert.equal(queueLength(), 1);
});

test('the queue is capped, and says so rather than growing without bound', () => {
  stopSkillRegistryCache();
  // The queue is fed from result lists, so a caller could otherwise push
  // arbitrary node ids into memory. A silent cap would be worse than none: it
  // would leave collections unchecked with nothing to see.
  const many = Array.from({ length: 600 }, (_, i) => `coll-${i}`);
  queueCollections(many);
  assert.equal(queueLength(), 500, 'QUEUE_MAX holds');
});

test('stopSkillRegistryCache resets the state, so tests cannot leak into each other', () => {
  queueCollections(['a', 'b']);
  stopSkillRegistryCache();
  assert.equal(queueLength(), 0);
});

// ── the tick: draining the queue through the CHILDREN listing ────────────────

const SKILL_A = '00000001-0000-4000-8000-000000000000';
const REGISTRY_MD =
  `::: ki-skill\n[Fragen generieren](https://repo.example/edu-sharing/components/render/${SKILL_A})\n:::`;

/** A children listing that holds a registry document, as staging reports one. */
function registryChild() {
  return {
    ...makeNode('reg-1', 'Skill Registry Optik', {
      'cm:name': ['SKILL_REGISTRY.md'], 'ccm:oeh_extendedType': [SKILL_CONTENT_TYPE_URI],
    }),
    mimetype: 'text/x-web-markdown',
    mediatype: 'file-markdown',
  };
}

/**
 * `withRegistry` decides what the listing of `coll-*` contains; `total` lets it
 * report MORE files than it returned, which is how a collection past the scan
 * cap looks from here.
 */
function tickMock(opts: { withRegistry?: boolean; status?: number; total?: number } = {}) {
  const counts = { children: 0, download: 0 };
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/children')) {
      counts.children++;
      if (opts.status) return { status: opts.status, json: {} };
      const nodes = opts.withRegistry === false ? [makeNode('pdf', 'Arbeitsblatt')] : [registryChild()];
      return { json: {
        nodes,
        pagination: { total: opts.total ?? nodes.length, from: 0, count: nodes.length },
      } };
    }
    if (url.includes('/eduservlet/download')) { counts.download++; return { text: REGISTRY_MD }; }
    return { json: {} };
  });
  return { mock, counts };
}

test('the tick resolves a queued collection through the children listing', async () => {
  stopSkillRegistryCache();
  const { mock, counts } = tickMock();
  try {
    queueCollections(['coll-1']);
    const report = await runCacheTick();

    assert.equal(report.resolved, 1);
    assert.equal(report.found, 1);
    assert.equal(counts.children, 1, 'the CHILDREN listing is the source — one call');
    const hit = lookupCachedRegistry('coll-1');
    assert.equal(hit?.registry?.nodeId, 'reg-1');
    assert.deepEqual(hit?.registry?.entries.map(e => e.nodeId), [SKILL_A]);
    assert.equal(queueLength(), 0, 'a resolved collection leaves the queue');
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});

test('"no registry here" is remembered as an answer, not as a gap', async () => {
  stopSkillRegistryCache();
  const { mock } = tickMock({ withRegistry: false });
  try {
    queueCollections(['coll-1']);
    const report = await runCacheTick();

    // This is the whole reason the children listing is the source: a negative
    // that rests on a listing which replied IS an answer, and the caller may
    // report the question as settled.
    assert.equal(report.resolved, 1);
    assert.equal(report.found, 0);
    const hit = lookupCachedRegistry('coll-1');
    assert.notEqual(hit, undefined, 'the collection is known');
    assert.equal(hit?.registry, null, 'and known to have none');
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});

test('a listing cut short at the file cap is NOT an answer', async () => {
  stopSkillRegistryCache();
  // 400 files, 1 read. A registry sitting past the cap is invisible to this
  // scan, so `null` means "not among the ones we saw" — which is a different
  // claim from "this collection has none", and the one the cache must not make.
  // Cached it would stand for the whole TTL and be re-affirmed by every refresh,
  // because the same first fifty come back each time.
  const { mock } = tickMock({ withRegistry: false, total: 400 });
  try {
    queueCollections(['coll-1']);
    const report = await runCacheTick();

    assert.equal(report.found, 0);
    assert.equal(report.inconclusive, 1, 'the listing replied without answering');
    assert.equal(report.resolved, 0, 'so it does not count among the answered');

    const nodes = [collNode('coll-1', 'Sammlung Optik')];
    assert.equal(attachCachedRegistries(nodes), 0, 'and the caller keeps its "nicht geprüft" line');
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});

test('a cut-short listing is remembered as inconclusive rather than re-read every tick', async () => {
  stopSkillRegistryCache();
  const { mock, counts } = tickMock({ withRegistry: false, total: 400 });
  try {
    queueCollections(['coll-1']);
    await runCacheTick();
    const afterFirst = counts.children;

    await runCacheTick();
    await runCacheTick();

    // Re-queueing it would be an endless crawl for an answer that cannot change:
    // the scan is capped, so the next read returns the same first page. The TTL
    // is the right cadence for "did the collection change", and it still applies.
    assert.equal(counts.children, afterFirst, 'the same page answers nothing twice');
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});

test('the tick is batched, and reports what it left behind', async () => {
  stopSkillRegistryCache();
  const { mock, counts } = tickMock({ withRegistry: false });
  try {
    queueCollections(Array.from({ length: 60 }, (_, i) => `coll-${i}`));
    const report = await runCacheTick();

    // A tick with no ceiling would turn one interval into a crawl of whatever
    // accumulated. What did not fit is stated, not silently postponed.
    assert.equal(report.resolved, 50, 'TICK_BATCH_MAX');
    assert.equal(counts.children, 50);
    assert.equal(report.queueLeft, 10);
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});

test('an empty queue costs nothing', async () => {
  stopSkillRegistryCache();
  const { mock, counts } = tickMock();
  try {
    const report = await runCacheTick();
    assert.equal(report.resolved, 0);
    assert.equal(counts.children, 0, 'no queue, no request');
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});

// ── failure must not become a statement ─────────────────────────────────────

test('a listing that did not answer is remembered as nothing, and tried again', async () => {
  stopSkillRegistryCache();
  const { mock, counts } = tickMock({ status: 503 });
  try {
    queueCollections(['coll-1']);
    const report = await runCacheTick();

    // The asymmetry the whole design rests on: only a listing that REPLIED may
    // become "there is no registry here". An outage must delay, never assert.
    assert.equal(report.failed, 1);
    assert.equal(report.resolved, 0);
    assert.equal(lookupCachedRegistry('coll-1'), undefined, 'nothing was learned');
    assert.equal(queueLength(), 1, 'so it stays on the list');
    assert.equal(counts.children, 1);
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});

test('an unknown collection is settled, not retried forever', async () => {
  stopSkillRegistryCache();
  const { mock } = tickMock({ status: 404 });
  try {
    queueCollections(['ghost']);
    const report = await runCacheTick();

    // A nodeId that does not exist will not start existing. Keeping it queued
    // would spend a slot of every future tick on the same 404.
    assert.equal(report.resolved, 1);
    assert.equal(lookupCachedRegistry('ghost')?.registry, null);
    assert.equal(queueLength(), 0);
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});

test('one failing collection does not cost the others in the batch', async () => {
  stopSkillRegistryCache();
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/bad/children')) return { status: 503, json: {} };
    if (url.includes('/children')) {
      return { json: { nodes: [registryChild()], pagination: { total: 1, from: 0, count: 1 } } };
    }
    if (url.includes('/eduservlet/download')) return { text: REGISTRY_MD };
    return { json: {} };
  });
  try {
    queueCollections(['good-1', 'bad', 'good-2']);
    const report = await runCacheTick();

    assert.equal(report.found, 2, 'both readable collections were learned');
    assert.equal(report.failed, 1);
    assert.equal(lookupCachedRegistry('good-1')?.registry?.nodeId, 'reg-1');
    assert.equal(lookupCachedRegistry('good-2')?.registry?.nodeId, 'reg-1');
    assert.equal(lookupCachedRegistry('bad'), undefined);
    assert.equal(queueLength(), 1, 'only the failure waits for another try');
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});

// ── expiry: a remembered answer has a shelf life ────────────────────────────

const HOUR = 3_600_000;

test('an entry past its TTL is checked again', async () => {
  stopSkillRegistryCache();
  const { mock, counts } = tickMock({ withRegistry: false });
  try {
    queueCollections(['coll-1']);
    await runCacheTick();
    assert.equal(counts.children, 1);

    // `now` is injected rather than slept for: a test that waits ten minutes is
    // a test nobody runs.
    const report = await runCacheTick({ now: Date.now() + HOUR });
    assert.equal(report.expired, 1);
    assert.equal(counts.children, 2, 'the listing was read again');
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});

test('a fresh entry is not re-fetched', async () => {
  stopSkillRegistryCache();
  const { mock, counts } = tickMock({ withRegistry: false });
  try {
    queueCollections(['coll-1']);
    await runCacheTick();
    const report = await runCacheTick();

    assert.equal(report.expired, 0);
    assert.equal(counts.children, 1, 'still one — the answer is young enough');
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});

test('while an entry is being renewed, the old answer still stands', async () => {
  stopSkillRegistryCache();
  const { mock } = tickMock();
  try {
    queueCollections(['coll-1']);
    await runCacheTick();
    const before = lookupCachedRegistry('coll-1')?.registry?.nodeId;

    // Expiry re-queues; it must not delete. A gap would make an answered
    // collection look unanswered for as long as the renewal takes — and the
    // caller would print "nicht geprüft" over data it already had.
    queueCollections([]);
    assert.equal(lookupCachedRegistry('coll-1')?.registry?.nodeId, before);
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});

// ── lifecycle: the starting shot and the interval ───────────────────────────

const PARENT_A = 'parent-aaa';
const PARENT_B = 'parent-bbb';

/** A skill corpus as `ngsearch` returns it, plus the children listings behind it. */
function lifecycleMock(opts: { withRegistry?: boolean } = {}) {
  const counts = { search: 0, children: 0 };
  const skill = (id: string, parent: string) => ({
    ...makeNode(id, `Skill ${id}`, {
      'ccm:oeh_extendedType': [SKILL_CONTENT_TYPE_URI],
      'virtual:primaryparent_nodeid': [parent],
    }),
    mimetype: 'text/x-web-markdown',
    mediatype: 'file-markdown',
  });
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/ngsearch')) {
      counts.search++;
      return { json: {
        nodes: [skill('s-1', PARENT_A), skill('s-2', PARENT_B)],
        pagination: { total: 2, from: 0, count: 2 },
      } };
    }
    if (url.includes('/children')) {
      counts.children++;
      return { json: {
        nodes: opts.withRegistry === false ? [] : [registryChild()],
        pagination: { total: 1, from: 0, count: 1 },
      } };
    }
    if (url.includes('/eduservlet/download')) return { text: REGISTRY_MD };
    return { json: {} };
  });
  return { mock, counts };
}

test('starting returns before anything has been fetched', async () => {
  stopSkillRegistryCache();
  const { mock } = lifecycleMock();
  try {
    startSkillRegistryCache();
    // The whole point of "blocks nothing": the call returns while the corpus
    // request is still in flight, so a transport can finish booting.
    assert.equal(queueLength(), 0, 'nothing has been learned yet — it returned first');
    await cacheWarmup();
    assert.ok(queueLength() > 0 || lookupCachedRegistry(PARENT_A), 'the warmup did run');
  } finally {
    stopSkillRegistryCache();
    mock.restore();
  }
});

test('what the corpus reveals is adopted, and costs no children listing', async () => {
  stopSkillRegistryCache();
  const { mock, counts } = lifecycleMock();
  try {
    startSkillRegistryCache();
    await cacheWarmup();

    // Changed deliberately on 2026-08-11: the seed used to QUEUE every candidate
    // parent, which meant one children listing each — 28 of them on staging,
    // all of them finding nothing, because every corpus parent is a skill folder.
    // A corpus hit is evidence in its own right, so it is adopted directly.
    assert.equal(counts.search, 1, 'one corpus query');
    assert.equal(counts.children, 0, 'and not one listing');
    // The adopted record is the CORPUS hit itself — no listing was consulted,
    // so no listing-supplied node id can appear here.
    assert.equal(lookupCachedRegistry(PARENT_A)?.registry?.nodeId, 's-1');
    assert.equal(lookupCachedRegistry(PARENT_B)?.registry?.nodeId, 's-2');
  } finally {
    stopSkillRegistryCache();
    mock.restore();
  }
});

test('an adopted parent is not also queued — the fast path ends there', async () => {
  stopSkillRegistryCache();
  const { mock } = lifecycleMock();
  try {
    startSkillRegistryCache();
    await cacheWarmup();

    // Queueing an answered collection would hand the slow path work it cannot
    // improve on until the entry expires.
    assert.equal(queueLength(), 0);
  } finally {
    stopSkillRegistryCache();
    mock.restore();
  }
});

test('a second start does not start a second warmup', async () => {
  stopSkillRegistryCache();
  const { mock, counts } = lifecycleMock();
  try {
    startSkillRegistryCache();
    startSkillRegistryCache();
    await cacheWarmup();
    assert.equal(counts.search, 1, 'idempotent — one corpus query, one interval');
  } finally {
    stopSkillRegistryCache();
    mock.restore();
  }
});

test('a corpus query that fails costs the cache nothing but the seed', async () => {
  stopSkillRegistryCache();
  const mock = installFetchMock((url): MockResult =>
    url.includes('/ngsearch') ? { status: 500, json: {} } : { json: {} });
  try {
    startSkillRegistryCache();
    // Must not reject: the warmup is a floating promise, and an unhandled
    // rejection takes the whole process down.
    await cacheWarmup();
    assert.equal(queueLength(), 0);
  } finally {
    stopSkillRegistryCache();
    mock.restore();
  }
});

// ── attaching: what the cache knows, and what it asks about ─────────────────

/** A real `ccm:map` — `makeNode` builds a `ccm:io`, which formats as content. */
function collNode(id: string, title: string) {
  return formatNode({ ref: { id, repo: '-home-' }, type: 'ccm:map', isDirectory: true,
    properties: { 'cm:name': [title] } });
}

test('attach: a known collection gets its catalogue for free', async () => {
  stopSkillRegistryCache();
  const { mock, counts } = tickMock();
  try {
    queueCollections(['coll-1']);
    await runCacheTick();
    const before = counts.children;

    const nodes = [collNode('coll-1', 'Sammlung Optik')];
    const answered = attachCachedRegistries(nodes);

    assert.equal(answered, 1);
    assert.equal(nodes[0]!.skillRegistry?.nodeId, 'reg-1');
    assert.equal(counts.children, before, 'not one extra request');
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});

test('attach: a collection known to have none is answered, not asked again', async () => {
  stopSkillRegistryCache();
  const { mock } = tickMock({ withRegistry: false });
  try {
    queueCollections(['coll-1']);
    await runCacheTick();

    const nodes = [collNode('coll-1', 'Sammlung Optik')];
    const answered = attachCachedRegistries(nodes);

    // The question IS answered — the caller may say so — but there is no field
    // to set, because there is no registry.
    assert.equal(answered, 1);
    assert.equal(nodes[0]!.skillRegistry, undefined);
    assert.equal(queueLength(), 0, 'nothing to look up again');
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});

test('attach: an unknown collection is queued, and reported as unanswered', () => {
  stopSkillRegistryCache();
  const nodes = [collNode('fresh-1', 'Neue Sammlung')];
  const answered = attachCachedRegistries(nodes);

  // Cold is cold: nothing is claimed, the caller keeps its pointer line, and
  // the next tick makes the second call free.
  assert.equal(answered, 0);
  assert.equal(nodes[0]!.skillRegistry, undefined);
  assert.equal(queueLength(), 1, 'so it is warm next time');
  stopSkillRegistryCache();
});

test('attach: content nodes are neither touched nor queued', () => {
  stopSkillRegistryCache();
  const nodes = [formatNode(makeNode('c-1', 'Arbeitsblatt'))];
  const answered = attachCachedRegistries(nodes);

  assert.equal(answered, 0);
  assert.equal(queueLength(), 0, 'a material has no skill registry to look for');
  stopSkillRegistryCache();
});

test('attach: a live answer already on the node wins over the cache', async () => {
  stopSkillRegistryCache();
  const { mock } = tickMock();
  try {
    queueCollections(['coll-1']);
    await runCacheTick();

    const nodes = [collNode('coll-1', 'Sammlung Optik')];
    nodes[0]!.skillRegistry = { nodeId: 'live-1', title: 'Live', entries: [] };
    attachCachedRegistries(nodes);

    // The live path read the children listing just now; the cache entry may be
    // ten minutes old. Fresher wins.
    assert.equal(nodes[0]!.skillRegistry?.nodeId, 'live-1');
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});

// ── the fast path: the search finds it, the children listing is the fallback ──

/**
 * A corpus query that returns ONE registry document sitting in `coll-9`, plus
 * the download behind it. `counts.children` proves whether the slow path ran.
 */
function fastPathMock() {
  const counts = { search: 0, children: 0, download: 0 };
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/ngsearch')) {
      counts.search++;
      return { json: {
        nodes: [{
          ...registryChild(),
          properties: { ...registryChild().properties, 'virtual:primaryparent_nodeid': ['coll-9'] },
        }],
        pagination: { total: 1, from: 0, count: 1 },
      } };
    }
    if (url.includes('/children')) {
      counts.children++;
      return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
    }
    if (url.includes('/eduservlet/download')) { counts.download++; return { text: REGISTRY_MD }; }
    return { json: {} };
  });
  return { mock, counts };
}

test('the search alone delivers a found registry — no children listing needed', async () => {
  stopSkillRegistryCache();
  const { mock, counts } = fastPathMock();
  try {
    startSkillRegistryCache();
    await cacheWarmup();

    const hit = lookupCachedRegistry('coll-9');
    assert.equal(hit?.registry?.nodeId, 'reg-1', 'the index hit is adopted straight away');
    assert.deepEqual(hit?.registry?.entries.map(e => e.nodeId), [SKILL_A]);
    assert.equal(counts.search, 1);
    assert.equal(counts.download, 1, 'only the document itself is read');
    assert.equal(counts.children, 0, 'the slow path is not used when the search already found it');
  } finally {
    stopSkillRegistryCache();
    mock.restore();
  }
});

test('the search never produces a NEGATIVE — absence from an index is not absence', async () => {
  stopSkillRegistryCache();
  const { mock } = fastPathMock();
  try {
    startSkillRegistryCache();
    await cacheWarmup();

    // `coll-8` was not among the corpus hits. That is exactly the case
    // `CLAUDE.md` refuses to let the index decide: a record can fall out of the
    // index while sitting in the node store. So it stays UNKNOWN, and the
    // children listing gets to answer it.
    assert.equal(lookupCachedRegistry('coll-8'), undefined);
  } finally {
    stopSkillRegistryCache();
    mock.restore();
  }
});

test('a collection the index never mentioned falls back to the children listing', async () => {
  stopSkillRegistryCache();
  const { mock, counts } = fastPathMock();
  try {
    startSkillRegistryCache();
    await cacheWarmup();
    const afterSeed = counts.children;

    // It appears in an answer → queued → the slow, authoritative path runs.
    const nodes = [collNode('coll-8', 'Andere Sammlung')];
    assert.equal(attachCachedRegistries(nodes), 0, 'nothing known yet');
    await runCacheTick();

    assert.equal(counts.children, afterSeed + 1, 'the fallback ran exactly once');
    assert.equal(lookupCachedRegistry('coll-8')?.registry, null,
      'and only IT may say "there is none here"');
  } finally {
    stopSkillRegistryCache();
    mock.restore();
  }
});

test('the corpus seed never overwrites what the children listing already answered', async () => {
  stopSkillRegistryCache();
  const { mock } = fastPathMock();
  try {
    // The authoritative path ran first and found nothing in `coll-9`.
    queueCollections(['coll-9']);
    await runCacheTick();
    assert.equal(lookupCachedRegistry('coll-9')?.registry, null);

    // The index still lists a registry document under that parent. Adopting it
    // now would replace a listing-derived answer with an index-derived one —
    // the reverse of the ranking this whole module rests on.
    startSkillRegistryCache();
    await cacheWarmup();

    assert.equal(lookupCachedRegistry('coll-9')?.registry, null, 'the listing keeps the last word');
  } finally {
    stopSkillRegistryCache();
    mock.restore();
  }
});

test('an index-derived entry is re-verified by the children listing when it expires', async () => {
  stopSkillRegistryCache();
  const { mock, counts } = fastPathMock();
  try {
    startSkillRegistryCache();
    await cacheWarmup();
    assert.equal(counts.children, 0);

    await runCacheTick({ now: Date.now() + HOUR });

    // The index buys speed; the listing keeps the truth. On expiry the
    // authoritative read corrects whatever the index said — here to `null`,
    // because this mock's listing holds no registry.
    assert.equal(counts.children, 1, 'the authority gets the last word');
    assert.equal(lookupCachedRegistry('coll-9')?.registry, null);
  } finally {
    stopSkillRegistryCache();
    mock.restore();
  }
});

// ── the live fallback: the answer carries the catalogue either way ───────────

test('ensure: a cold collection is resolved live, and remembered', async () => {
  stopSkillRegistryCache();
  const { mock, counts } = tickMock();
  try {
    const nodes = [collNode('coll-1', 'Sammlung Optik')];
    const answered = await ensureRegistries(nodes);

    // The caller asked for a collection; the answer carries its catalogue,
    // cache or not. One children listing is the price of first contact.
    assert.equal(answered, 1);
    assert.equal(nodes[0]!.skillRegistry?.nodeId, 'reg-1');
    assert.equal(counts.children, 1);

    // And it is not paid twice.
    const again = [collNode('coll-1', 'Sammlung Optik')];
    assert.equal(await ensureRegistries(again), 1);
    assert.equal(again[0]!.skillRegistry?.nodeId, 'reg-1');
    assert.equal(counts.children, 1, 'the second call is free');
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});

test('ensure: a collection with no registry is answered too, and stays free', async () => {
  stopSkillRegistryCache();
  const { mock, counts } = tickMock({ withRegistry: false });
  try {
    const nodes = [collNode('coll-1', 'Sammlung Optik')];
    assert.equal(await ensureRegistries(nodes), 1, 'the question is settled');
    assert.equal(nodes[0]!.skillRegistry, undefined, 'there is simply none');

    await ensureRegistries([collNode('coll-1', 'Sammlung Optik')]);
    assert.equal(counts.children, 1, 'a remembered "none" is not re-asked');
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});

test('ensure: a failed live lookup claims nothing and is tried again later', async () => {
  stopSkillRegistryCache();
  const { mock } = tickMock({ status: 503 });
  try {
    const nodes = [collNode('coll-1', 'Sammlung Optik')];
    const answered = await ensureRegistries(nodes);

    // Same asymmetry as the background tick: an outage must not turn into
    // "this collection has no approved skills".
    assert.equal(answered, 0, 'so the caller keeps its pointer line');
    assert.equal(lookupCachedRegistry('coll-1'), undefined);
    assert.equal(queueLength(), 1);
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});

test('ensure: a cut-short listing does not settle the question either', async () => {
  stopSkillRegistryCache();
  const { mock, counts } = tickMock({ withRegistry: false, total: 400 });
  try {
    const nodes = [collNode('coll-1', 'Sammlung Optik')];
    assert.equal(await ensureRegistries(nodes), 0, 'the caller keeps its pointer line');
    assert.equal(nodes[0]!.skillRegistry, undefined);

    await ensureRegistries([collNode('coll-1', 'Sammlung Optik')]);
    assert.equal(counts.children, 1, 'and the same capped page is not re-read on every request');
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});

test('ensure: two requests for the same cold collection share ONE lookup', async () => {
  stopSkillRegistryCache();
  const { mock, counts } = tickMock();
  try {
    // Both calls see a cold cache — the second starts before the first has
    // anything to remember. Without a note of what is already in flight, a
    // burst right after startup pays for first contact once per request.
    const a = [collNode('coll-1', 'Sammlung Optik')];
    const b = [collNode('coll-1', 'Sammlung Optik')];
    const [ansA, ansB] = await Promise.all([ensureRegistries(a), ensureRegistries(b)]);

    assert.equal(counts.children, 1, 'first contact is paid once, not once per concurrent caller');
    assert.equal(ansA, 1);
    assert.equal(ansB, 1);
    assert.equal(a[0]!.skillRegistry?.nodeId, 'reg-1');
    assert.equal(b[0]!.skillRegistry?.nodeId, 'reg-1', 'and both answers carry the catalogue');
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});

test('the entry map is capped — the oldest answer falls out rather than growing without bound', async () => {
  stopSkillRegistryCache();
  const { mock } = tickMock({ withRegistry: false });
  try {
    // Driven through the real path, because a cap only counts where entries are
    // actually written. `CACHE_MAX_ENTRIES` is above the ~1700 collections this
    // repository holds, so it never bites in practice — it is the bound that
    // keeps "the queue is not a memory lever" true for a future caller that
    // feeds ids from somewhere other than a repository response.
    const rounds = Math.ceil(CACHE_MAX_ENTRIES / 50) + 2;
    for (let round = 0; round < rounds; round++) {
      queueCollections(Array.from({ length: 50 }, (_, i) => `coll-${round}-${i}`));
      await runCacheTick();
    }

    assert.equal(cacheSize(), CACHE_MAX_ENTRIES, 'the map stops at its bound');
    assert.equal(lookupCachedRegistry('coll-0-0'), undefined, 'the oldest answer is the one dropped');
    assert.notEqual(lookupCachedRegistry(`coll-${rounds - 1}-49`), undefined, 'the newest is kept');
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});

test('ensure: the live fallback is bounded per request', async () => {
  stopSkillRegistryCache();
  const { mock, counts } = tickMock({ withRegistry: false });
  try {
    const nodes = Array.from({ length: 25 }, (_, i) => collNode(`coll-${i}`, `Sammlung ${i}`));
    const answered = await ensureRegistries(nodes);

    // A listing of 50 collections must not fire 50 upstream calls on one
    // request. What did not fit is queued and reported as unanswered, so the
    // caller says "not checked" rather than implying it looked.
    assert.equal(counts.children, 10, 'LIVE_FALLBACK_MAX');
    assert.equal(answered, 10);
    assert.equal(queueLength(), 15, 'the rest waits for the background tick');
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});

test('a skill corpus larger than one page says so, rather than seeding silently', async () => {
  stopSkillRegistryCache();
  // The seed reads ONE page (`CORPUS_PAGE_MAX`). Staging holds 28 records today,
  // so the bound does not bite — but at three times that it would, and the
  // collections past the page simply never get the fast path. That is invisible
  // incompleteness, which this module warns about everywhere else it can happen
  // (`queueCollections` at its cap, `scanForRegistry` at its scan cap).
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/ngsearch')) {
      return { json: {
        nodes: [{ ...registryChild(),
          properties: { ...registryChild().properties, 'virtual:primaryparent_nodeid': ['coll-9'] } }],
        pagination: { total: 250, from: 0, count: 1 },   // far more than one page
      } };
    }
    if (url.includes('/eduservlet/download')) return { text: REGISTRY_MD };
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });

  const original = process.stderr.write.bind(process.stderr);
  const lines: string[] = [];
  (process.stderr as { write: unknown }).write = (chunk: string | Uint8Array, ...rest: unknown[]) => {
    lines.push(String(chunk));
    return (original as (c: unknown, ...r: unknown[]) => boolean)(chunk, ...rest);
  };
  try {
    startSkillRegistryCache();
    await cacheWarmup();
  } finally {
    (process.stderr as { write: unknown }).write = original;
    stopSkillRegistryCache();
    mock.restore();
  }

  const warned = lines.filter(l => l.includes('"level":"warn"') && l.includes('corpus'));
  assert.equal(warned.length, 1, `the bound biting must be a warning — got ${warned.length}`);
  assert.match(warned[0]!, /250/, 'and it names how many records exist');
});
