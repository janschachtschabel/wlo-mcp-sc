import { test } from 'node:test';
import assert from 'node:assert/strict';

import { searchAll } from '../src/services/search.js';
import { searchAllEnvelopeSchema } from '../src/apps/outputSchemas.js';
import { REGISTRY_CONTENT_TYPE_URI } from '../src/services/skill-catalogue.js';
import { queueCollections, queueLength, runCacheTick, stopSkillRegistryCache } from '../src/services/skill-registry-cache.js';
import { installFetchMock, makeNode } from './fetchMock.js';

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const SKILL_A = uuid(1);
const SKILL_B = uuid(2);

const REGISTRY_MD =
  `::: ki-skill\n[Fragen generieren](https://repo.example/edu-sharing/components/render/${SKILL_A})\n:::\n\n`
  + `::: ki-skill\n[Korrigieren](https://repo.example/edu-sharing/components/render/${SKILL_B})\n:::`;

function registryDoc(id = 'reg-1') {
  return {
    ...makeNode(id, 'Skill Registry Optik', {
      'cm:name': ['SKILL_REGISTRY.md'],
      'ccm:oeh_extendedType': [REGISTRY_CONTENT_TYPE_URI],
    }),
    mimetype: 'text/x-web-markdown',
    mediatype: 'file-markdown',
  };
}

/**
 * A real `ccm:map`. `makeNode` builds a `ccm:io`, which formats as CONTENT —
 * so a fixture built from it silently tested a material wearing a collection's
 * name, and every rule keyed on `nodeType` was untested.
 */
function collectionNode(id: string, title: string, props: Record<string, string[]> = {}) {
  return { ...makeNode(id, title, props), type: 'ccm:map', isDirectory: true };
}

function topicPageNode(id: string, title: string) {
  return collectionNode(id, title, { 'ccm:page_config_ref': ['workspace://SpacesStore/cfg-' + id] });
}

/**
 * A collection search whose one collection carries a registry. Counts the calls
 * the enrichment makes, per kind — the cost is part of the contract, so it is
 * asserted rather than assumed.
 *
 * `children` counts only listings of the ENRICHED collection. `searchAll` calls
 * `/children` once on its own account — the topic-page leg lists the root
 * portals — so a blanket count would measure that too and say nothing about
 * what this enrichment costs.
 */
function searchMock(opts: {
  withRegistry?: boolean;
  childrenStatus?: number;
  /** Serve a registry from the TOPIC PAGE's children too (id `reg-tp`). */
  withTopicPageRegistry?: boolean;
  /** Fail the topic page's children listing alone. */
  tpChildrenStatus?: number;
} = {}) {
  const counts = { children: 0, download: 0, metadata: 0 };
  const mock = installFetchMock((url) => {
    if (url.includes('/collections')) {
      return { json: { nodes: [collectionNode('coll-1', 'Sammlung Optik'), topicPageNode('tp-1', 'Themenseite Optik')] } };
    }
    if (url.includes('/ngsearch')) {
      return { json: { nodes: [makeNode('c-1', 'Arbeitsblatt')], pagination: { total: 1, from: 0, count: 1 } } };
    }
    if (url.includes('/children')) {
      if (url.includes('/tp-1/children')) {
        if (opts.tpChildrenStatus) return { status: opts.tpChildrenStatus, json: {} };
        const nodes = opts.withTopicPageRegistry ? [registryDoc('reg-tp')] : [];
        return { json: { nodes, pagination: { total: nodes.length, from: 0, count: nodes.length } } };
      }
      if (!url.includes('/coll-1/children')) return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
      counts.children++;
      if (opts.childrenStatus) return { status: opts.childrenStatus, json: {} };
      return { json: {
        nodes: opts.withRegistry === false ? [makeNode('pdf', 'Arbeitsblatt')] : [registryDoc()],
        pagination: { total: 1, from: 0, count: 1 },
      } };
    }
    if (url.includes('/eduservlet/download')) { counts.download++; return { text: REGISTRY_MD }; }
    if (url.includes('/metadata')) { counts.metadata++; return { json: { node: makeNode(SKILL_A, 'Fragen generieren', {}) } }; }
    return { json: {} };
  });
  return { mock, counts };
}

test('the catalogue is in the answer — first contact pays for it, once', async () => {
  stopSkillRegistryCache();
  const { mock, counts } = searchMock();
  try {
    const first = await searchAll({ query: 'optik' });

    // CONTRACT CHANGED 2026-08-11. This test used to pin the opposite —
    // "nothing is looked up unless asked" — because the lookup cost ~1.0–1.4 s
    // per search (measured 2026-08-10). The decision now is that the answer must
    // CARRY the catalogue: cache first, children listing for what it lacks. The
    // cost is unchanged but paid once, pooled across the collections of one
    // request, and never again until the entry expires.
    assert.equal(first.collections.results[0]?.skillRegistry?.nodeId, 'reg-1');
    assert.equal(counts.children, 1, 'first contact reads the listing');

    const second = await searchAll({ query: 'optik' });
    assert.equal(second.collections.results[0]?.skillRegistry?.nodeId, 'reg-1');
    assert.equal(counts.children, 1, 'and every search after it is free');
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});

test('searchAll attaches the registry catalogue to a collection that has one', async () => {
  const { mock } = searchMock();
  try {
    const env = await searchAll({ query: 'optik', includeSkillRegistry: true });
    const coll = env.collections.results[0];

    assert.equal(coll?.skillRegistry?.nodeId, 'reg-1');
    assert.equal(coll?.skillRegistry?.title, 'Skill Registry Optik');
    assert.deepEqual(coll?.skillRegistry?.entries.map(e => e.nodeId), [SKILL_A, SKILL_B]);
    assert.deepEqual(coll?.skillRegistry?.entries.map(e => e.title), ['Fragen generieren', 'Korrigieren']);
  } finally {
    mock.restore();
  }
});

test('the enrichment costs exactly two upstream calls per collection', async () => {
  const { mock, counts } = searchMock();
  try {
    await searchAll({ query: 'optik', includeSkillRegistry: true });

    // Both buckets are enriched since 2026-08-19; the topic page here simply
    // holds no registry, so its listing answers empty and costs no download.
    // The whole point of the cheap tier: title and nodeId come out of the
    // `:::` block, so no skill record is read at all, however many the
    // registry declares.
    assert.equal(counts.children, 1, 'one children listing for the one collection');
    assert.equal(counts.download, 1, 'one registry document read');
    assert.equal(counts.metadata, 0, 'no skill head is fetched during a search');
  } finally {
    mock.restore();
  }
});

test('a collection without a registry carries no field — and the question counts as settled', async () => {
  stopSkillRegistryCache();
  const { mock } = searchMock({ withRegistry: false });
  try {
    const env = await searchAll({ query: 'optik' });
    assert.equal(env.collections.results[0]?.skillRegistry, undefined, 'there is none to show');
    assert.equal(env.collections.registryChecked, true, 'but it WAS looked up');
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});

test('a failing registry lookup costs the field, never the search', async () => {
  stopSkillRegistryCache();
  const { mock } = searchMock({ childrenStatus: 503 });
  try {
    const env = await searchAll({ query: 'optik' });

    assert.equal(env.collections.results.length, 1, 'the search still answers');
    assert.equal(env.content.results.length, 1);
    assert.equal(env.collections.results[0]?.skillRegistry, undefined);
    assert.equal(env.collections.registryChecked, undefined, 'and claims nothing about it');
  } finally {
    mock.restore();
  }
});

test('the union of both buckets shares ONE live-fallback budget', async () => {
  // The claim lives in three comments and the changelog; this is the assertion
  // they hang on. The numbers are the point: 8 per bucket is UNDER the cap of
  // 10, the union of 16 is OVER it — so one shared call spends 10 listings
  // while two per-bucket calls would spend 16. A 5+5 fixture could not tell
  // the two apart, and every other test in this file stays green either way.
  stopSkillRegistryCache();
  let listings = 0;
  const colls = Array.from({ length: 8 }, (_, i) => collectionNode(`cap-c-${i}`, `Optik Sammlung ${i}`));
  const tps = Array.from({ length: 8 }, (_, i) => topicPageNode(`cap-t-${i}`, `Optik Themenseite ${i}`));
  const mock = installFetchMock((url) => {
    if (url.includes('/collections')) return { json: { nodes: [...colls, ...tps] } };
    if (url.includes('/ngsearch')) return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
    if (url.includes('/children')) {
      // Only the fixture's own collections: searchAll lists the root portals on
      // its own account, and a blanket counter would measure that too.
      if (url.includes('cap-')) listings++;
      return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
    }
    return { json: {} };
  });
  try {
    await searchAll({ query: 'optik', maxCollections: 8 });
    assert.equal(listings, 10, 'LIVE_FALLBACK_MAX is shared by the union, not granted per bucket');
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});

test('a topic page carries the catalogue of the collection it is', async () => {
  // REWRITTEN 2026-08-19 — until then this test pinned the opposite ("topic-page
  // results are not enriched"), as the only test in this file with no reason
  // given, and the reason turned out not to exist: a Themenseite IS a `ccm:map`
  // that happens to carry a page layout, and the live Optik collection holds
  // three approved skills. Leaving the bucket out meant the ONE hit a search
  // returned for "Optik" named none of them, while the plain-collection bucket
  // named all of theirs (found live, 2026-08-19).
  stopSkillRegistryCache();
  const { mock } = searchMock({ withTopicPageRegistry: true });
  try {
    const env = await searchAll({ query: 'optik', includeSkillRegistry: true });
    assert.equal(env.topicPages.results.length, 1);
    assert.equal(env.topicPages.results[0]?.skillRegistry?.nodeId, 'reg-tp');
    assert.deepEqual(env.topicPages.results[0]?.skillRegistry?.entries.map(e => e.nodeId),
      [SKILL_A, SKILL_B]);
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});

test('each bucket reports its own registryChecked', async () => {
  // The union shares ONE ensureRegistries call (and so the live-fallback cap),
  // but each bucket reconciles its own ledger. A count cannot: 4 answered ids
  // are not "2 of 2 collections", and the mixed search is the NORMAL search —
  // a count-based union would print the catalogue with "nicht geprüft" beside it.
  stopSkillRegistryCache();
  const { mock } = searchMock({ withTopicPageRegistry: true });
  try {
    const env = await searchAll({ query: 'optik' });
    assert.equal(env.collections.registryChecked, true);
    assert.equal(env.topicPages.registryChecked, true);
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});

test('a failing topic-page listing is disclosed for that bucket alone', async () => {
  stopSkillRegistryCache();
  const { mock } = searchMock({ tpChildrenStatus: 503 });
  try {
    const env = await searchAll({ query: 'optik' });
    assert.equal(env.collections.registryChecked, true, 'the collection bucket answered');
    assert.equal(env.topicPages.registryChecked, undefined, 'the topic-page bucket claims nothing');
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});

test('a topic-pages-only search settles the question too', async () => {
  stopSkillRegistryCache();
  const { mock } = searchMock({ withTopicPageRegistry: true });
  try {
    const env = await searchAll({ query: 'optik', include: ['topicPages'] });
    assert.equal(env.collections.results.length, 0);
    assert.equal(env.collections.registryChecked, undefined, 'an empty bucket claims nothing');
    assert.equal(env.topicPages.results[0]?.skillRegistry?.nodeId, 'reg-tp');
    assert.equal(env.topicPages.registryChecked, true);
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});

test('the topic-page disclosure survives the output schema', async () => {
  // zod strips undeclared keys: without the schema entry the new fields reach
  // the TEXT and silently vanish from structuredContent, with nothing failing
  // anywhere — the exact trap CLAUDE.md documents for skillRegistry itself.
  stopSkillRegistryCache();
  const { mock } = searchMock({ withTopicPageRegistry: true });
  try {
    const env = await searchAll({ query: 'optik' });
    const parsed = searchAllEnvelopeSchema.parse(env);
    assert.equal(parsed.topicPages.registryChecked, true);
    assert.equal(parsed.topicPages.results[0]?.skillRegistry?.nodeId, 'reg-tp');
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});

test('an explicit false only declines the FORCED pass', async () => {
  stopSkillRegistryCache();
  const { mock, counts } = searchMock();
  try {
    const env = await searchAll({ query: 'optik', includeSkillRegistry: false });

    // `false` means "do not FORCE a fresh lookup" — it never meant, and now
    // clearly does not mean, "leave the catalogue out". The cache-or-fallback
    // path runs regardless, because the answer is supposed to carry it.
    assert.equal(env.collections.results[0]?.skillRegistry?.nodeId, 'reg-1');
    assert.equal(counts.children, 1, 'resolved through the fallback, not the forced pass');
  } finally {
    mock.restore();
  }
});

test('a collections-only search still enriches; a content-only search makes no lookup', async () => {
  const { mock, counts } = searchMock();
  try {
    await searchAll({ query: 'optik', include: ['content'], includeSkillRegistry: true });
    assert.equal(counts.children, 0, 'no collections in the answer, nothing to enrich');
  } finally {
    mock.restore();
  }

  const second = searchMock();
  try {
    const env = await searchAll({ query: 'optik', include: ['collections'], includeSkillRegistry: true });
    assert.equal(env.collections.results[0]?.skillRegistry?.nodeId, 'reg-1');
    assert.equal(second.counts.children, 1);
  } finally {
    second.mock.restore();
  }
});

test('registryChecked means the children listing answered — live or remembered', async () => {
  stopSkillRegistryCache();
  const { mock, counts } = searchMock();
  try {
    const first = await searchAll({ query: 'optik' });
    const second = await searchAll({ query: 'optik' });

    // The flag says the question is SETTLED, not how. A live fallback and a
    // remembered answer rest on the same children listing; only the second one
    // is free. What it must never be is true when nothing was read — that case
    // is covered by the failing-lookup test above.
    assert.equal(first.collections.registryChecked, true, 'resolved live on first contact');
    assert.equal(second.collections.registryChecked, true, 'and from memory after that');
    assert.equal(counts.children, 1, 'one listing served both');
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});
test('the cache answers a search for free, and reports it as checked', async () => {
  const { mock, counts } = searchMock();
  try {
    // Warm the one collection the search will return, through the children
    // listing — the same path the live lookup uses.
    queueCollections(['coll-1']);
    await runCacheTick();
    const warmCalls = counts.children;

    const env = await searchAll({ query: 'optik' });

    assert.equal(env.collections.results[0]?.skillRegistry?.nodeId, 'reg-1',
      'the catalogue rides along without being asked for');
    assert.equal(counts.children, warmCalls, 'and the search paid nothing for it');
    assert.equal(env.collections.registryChecked, true,
      'a cache hit rests on the children listing, so the question IS answered');
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});

test('the fallback is the only thing that fills a cold cache — the corpus is not consulted', async () => {
  stopSkillRegistryCache();
  const { mock, counts } = searchMock();
  try {
    await searchAll({ query: 'optik' });

    // No `ngsearch` for the skill corpus happens here: that is the WARMUP's job,
    // started by the transports. A request resolves what it needs through the
    // authoritative listing and nothing else.
    assert.equal(counts.children, 1);
    assert.equal(counts.download, 1, 'the registry document, once');
    assert.equal(queueLength(), 0, 'resolved, so nothing is left waiting');
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});
