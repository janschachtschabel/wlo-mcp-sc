/**
 * What a PERSONAL login's own registry lookups answered is kept for that
 * identity alone, for a minute — and three things follow from it:
 *
 *  - a forced lookup that answers "none now" is the answer, and the anonymous
 *    scope's older catalogue is not lent in its place;
 *  - a signed-in caller does not pay the children listing again for every
 *    collection WITHOUT a registry, which is most of them;
 *  - a refusal (401/403) is an answer for the scope that got it: remembered,
 *    settling nothing, and never read again on every tick.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PERSONAL_MEMO_MAX,
  cacheSize,
  ensureRegistries,
  ensureRegistryFor,
  lookupCachedRegistry,
  queueCollections,
  queueLength,
  runCacheTick,
  stopSkillRegistryCache,
} from '../src/services/skill-registry-cache.js';
import { searchAll } from '../src/services/search.js';
import { SHORT_CACHE_MS } from '../src/short-cache.js';
import { REGISTRY_CONTENT_TYPE_URI } from '../src/services/skill-catalogue.js';
import { runAnonymous, runWithCredential, type WloCredential } from '../src/auth/credential.js';
import type { FormattedNode } from '../src/formatter.js';

import { connectedClient, installFetchMock, makeNode, toolText, type MockResult } from './fetchMock.js';

const PERSON: WloCredential = { header: 'Basic cGVyc29uOng=', label: 'person', source: 'user' };
const OTHER: WloCredential = { header: 'Basic b3RoZXI6eA==', label: 'other', source: 'user' };

const SKILL = '00000001-0000-4000-8000-000000000000';
const REGISTRY_MD = `::: ki-skill\n[Fragen](https://repo.example/edu-sharing/components/render/${SKILL})\n:::`;

function registryChild() {
  return {
    ...makeNode('reg-1', 'Registry', { 'cm:name': ['SKILL_REGISTRY.md'], 'ccm:oeh_extendedType': [REGISTRY_CONTENT_TYPE_URI] }),
    mimetype: 'text/x-web-markdown',
    mediatype: 'file-markdown',
  };
}

const collection = (id: string): FormattedNode => ({ nodeId: id, nodeType: 'collection', title: id } as FormattedNode);
const collectionNode = (id: string, title: string) => ({ ...makeNode(id, title), type: 'ccm:map', isDirectory: true });

/**
 * A repository one can change mid-test: whether the collection holds a registry
 * and with which status its listing answers. Counts the listings, and who asked.
 */
function repo(state: { registry: boolean; status?: number }) {
  const listedAs: (string | undefined)[] = [];
  const mock = installFetchMock((url, init): MockResult => {
    if (url.includes('/collections')) return { json: { nodes: [collectionNode('coll-1', 'Sammlung Optik')] } };
    if (url.includes('/ngsearch')) return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
    if (url.includes('/children')) {
      if (url.includes('/coll-')) listedAs.push(new Headers(init?.headers).get('authorization') ?? undefined);
      else return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
      if (state.status) return { status: state.status, json: {} };
      const nodes = state.registry ? [registryChild()] : [];
      return { json: { nodes, pagination: { total: nodes.length, from: 0, count: nodes.length } } };
    }
    if (url.includes('/eduservlet/download')) return { text: REGISTRY_MD };
    return { json: {} };
  });
  return { mock, listedAs };
}

async function fresh<T>(fn: () => Promise<T>): Promise<T> {
  stopSkillRegistryCache();
  try { return await fn(); } finally { stopSkillRegistryCache(); }
}

// ── Finding 1: a forced "none now" is not papered over with a lent catalogue ──

test('a forced lookup by a personal login that answers "none" leaves no catalogue — the anonymous one is not lent back', () => fresh(async () => {
  const state = { registry: true };
  const { mock } = repo(state);
  try {
    await runAnonymous(() => ensureRegistryFor('coll-1'));
    assert.equal(runAnonymous(() => lookupCachedRegistry('coll-1'))?.registry?.nodeId, 'reg-1', 'the anonymous positive is held');

    state.registry = false;                    // the registry was removed
    const nodes = [collection('coll-1')];
    const answered = await runWithCredential(PERSON, () => ensureRegistries(nodes, { force: true }));
    assert.equal(nodes[0]!.skillRegistry, undefined, 'the state NOW, not the remembered one');
    assert.ok(answered.has('coll-1'), 'and the question counts as answered');

    // The ordinary pass right after it must not bring the old one back either.
    const again = [collection('coll-1')];
    const second = await runWithCredential(PERSON, () => ensureRegistries(again));
    assert.equal(again[0]!.skillRegistry, undefined);
    assert.ok(second.has('coll-1'));
  } finally { mock.restore(); }
}));

test('searchAll: forced lookup under a personal login — no stale catalogue, registryChecked true', () => fresh(async () => {
  const state = { registry: true };
  const { mock } = repo(state);
  try {
    const before = await runAnonymous(() => searchAll({ query: 'optik', include: ['collections'] }));
    assert.equal(before.collections.results[0]?.skillRegistry?.nodeId, 'reg-1');

    state.registry = false;
    const env = await runWithCredential(PERSON, () => searchAll({ query: 'optik', include: ['collections'], includeSkillRegistry: true }));
    assert.equal(env.collections.results[0]?.nodeId, 'coll-1');
    assert.equal(env.collections.results[0]?.skillRegistry, undefined);
    assert.equal(env.collections.registryChecked, true);
  } finally { mock.restore(); }
}));

test('search_wlo_collections: forced lookup under a personal login — no stale catalogue, no "nicht geprüft"', () => fresh(async () => {
  const state = { registry: true };
  const { mock } = repo(state);
  try {
    await runAnonymous(() => ensureRegistryFor('coll-1'));
    state.registry = false;
    const client = await connectedClient();
    try {
      const text = await runWithCredential(PERSON, async () => toolText(await client.callTool({
        name: 'search_wlo_collections', arguments: { query: 'optik', includeSkillRegistry: true },
      })));
      assert.ok(text.includes('Sammlung Optik'), text);
      assert.ok(!text.includes('reg-1'), `the removed registry is not shown — got ${JSON.stringify(text)}`);
      assert.ok(!text.includes('nicht geprüft'), 'the lookup answered');
    } finally { await client.close(); }
  } finally { mock.restore(); }
}));

test('a forced lookup that FAILED still attaches nothing remembered and claims nothing', () => fresh(async () => {
  const state: { registry: boolean; status?: number } = { registry: true };
  const { mock } = repo(state);
  try {
    await runAnonymous(() => ensureRegistryFor('coll-1'));
    state.status = 503;
    for (const run of [runAnonymous, (fn: () => Promise<Set<string>>) => runWithCredential(PERSON, fn)]) {
      const nodes = [collection('coll-1')];
      const answered = await run(() => ensureRegistries(nodes, { force: true }));
      assert.equal(nodes[0]!.skillRegistry, undefined);
      assert.equal(answered.has('coll-1'), false);
    }
  } finally { mock.restore(); }
}));

// ── Finding 2: a memo per identity ──────────────────────────────────────────

test('the same identity asks about a collection WITHOUT a registry once per minute, not once per request', () => fresh(async () => {
  const { mock, listedAs } = repo({ registry: false });
  try {
    const first = [collection('coll-1')];
    assert.ok((await runWithCredential(PERSON, () => ensureRegistries(first))).has('coll-1'));
    assert.equal(listedAs.length, 1);

    const second = [collection('coll-1')];
    const answered = await runWithCredential(PERSON, () => ensureRegistries(second));
    assert.ok(answered.has('coll-1'), 'answered from the identity\'s own memo');
    assert.equal(second[0]!.skillRegistry, undefined);
    const one = await runWithCredential(PERSON, () => ensureRegistryFor('coll-1'));
    assert.deepEqual({ registry: one.registry, answered: one.answered }, { registry: null, answered: true });
    assert.equal(listedAs.length, 1, 'no second listing within the minute');
    assert.equal(cacheSize(), 0, 'and nothing of it entered a shared scope');
  } finally { mock.restore(); }
}));

test('another identity — and an anonymous caller — do not see what one person\'s lookup answered', () => fresh(async () => {
  const { mock, listedAs } = repo({ registry: true });
  try {
    const mine = await runWithCredential(PERSON, () => ensureRegistryFor('coll-1'));
    assert.equal(mine.registry?.nodeId, 'reg-1');
    assert.equal(runWithCredential(PERSON, () => lookupCachedRegistry('coll-1'))?.registry?.nodeId, 'reg-1');

    assert.equal(runWithCredential(OTHER, () => lookupCachedRegistry('coll-1')), undefined);
    assert.equal(runAnonymous(() => lookupCachedRegistry('coll-1')), undefined);
    await runWithCredential(OTHER, () => ensureRegistryFor('coll-1'));
    assert.deepEqual(listedAs, [PERSON.header, OTHER.header], 'the other identity reads with its own rights');
  } finally { mock.restore(); }
}));

test('the memo expires after its minute', (t) => fresh(async () => {
  const { mock, listedAs } = repo({ registry: false });
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  try {
    await runWithCredential(PERSON, () => ensureRegistryFor('coll-1'));
    t.mock.timers.tick(SHORT_CACHE_MS - 1);
    await runWithCredential(PERSON, () => ensureRegistryFor('coll-1'));
    assert.equal(listedAs.length, 1, 'still held just before the minute is over');
    t.mock.timers.tick(2);
    await runWithCredential(PERSON, () => ensureRegistryFor('coll-1'));
    assert.equal(listedAs.length, 2, 'asked again after it');
  } finally { t.mock.timers.reset(); mock.restore(); }
}));

test('the memo is bounded over ALL identities — the oldest answer goes', () => fresh(async () => {
  const { mock, listedAs } = repo({ registry: false });
  try {
    await runWithCredential(PERSON, () => ensureRegistryFor('coll-first'));
    for (let i = 0; i < PERSONAL_MEMO_MAX; i += 10) {
      const nodes = Array.from({ length: 10 }, (_, k) => collection(`coll-${i + k}`));
      await runWithCredential(OTHER, () => ensureRegistries(nodes));
    }
    assert.equal(runWithCredential(PERSON, () => lookupCachedRegistry('coll-first')), undefined, 'dropped at the bound');
    assert.ok(runWithCredential(OTHER, () => lookupCachedRegistry(`coll-${PERSONAL_MEMO_MAX - 1}`)), 'the newest is held');
    assert.equal(listedAs.length, PERSONAL_MEMO_MAX + 1);
  } finally { mock.restore(); }
}));

test('only an ANSWER is kept — a listing that failed is asked again', () => fresh(async () => {
  const state: { registry: boolean; status?: number } = { registry: false, status: 503 };
  const { mock, listedAs } = repo(state);
  try {
    const first = await runWithCredential(PERSON, () => ensureRegistryFor('coll-1'));
    assert.equal(first.answered, false);
    assert.equal(runWithCredential(PERSON, () => lookupCachedRegistry('coll-1')), undefined);
    await runWithCredential(PERSON, () => ensureRegistryFor('coll-1'));
    assert.equal(listedAs.length, 2);
  } finally { mock.restore(); }
}));

test('a forced lookup replaces the identity\'s memo entry', () => fresh(async () => {
  const state = { registry: false };
  const { mock } = repo(state);
  try {
    await runWithCredential(PERSON, () => ensureRegistryFor('coll-1'));
    state.registry = true;                     // a registry was filed
    const nodes = [collection('coll-1')];
    await runWithCredential(PERSON, () => ensureRegistries(nodes, { force: true }));
    assert.equal(nodes[0]!.skillRegistry?.nodeId, 'reg-1');
    assert.equal(runWithCredential(PERSON, () => lookupCachedRegistry('coll-1'))?.registry?.nodeId, 'reg-1');
  } finally { mock.restore(); }
}));

// ── Finding 3: a refusal is an answer for the scope that got it ─────────────

for (const status of [401, 403]) {
  test(`an anonymous lookup answered ${status} is remembered — not read again on every tick, and settles nothing`, () => fresh(async () => {
    const { mock, listedAs } = repo({ registry: false, status });
    try {
      runAnonymous(() => queueCollections(['coll-1']));
      const report = await runCacheTick();
      assert.equal(listedAs.length, 1);
      assert.equal(report.failed, 0, 'a refusal is not an outage');
      assert.equal(report.inconclusive, 1);
      assert.equal(queueLength(), 0, 'and it is not queued again');

      await runCacheTick();
      await runCacheTick();
      assert.equal(listedAs.length, 1, 'no further listing on the following ticks');

      // The caller keeps its "nicht geprüft": the refusal says nothing about absence.
      const nodes = [collection('coll-1')];
      const answered = await runAnonymous(() => ensureRegistries(nodes));
      assert.equal(answered.has('coll-1'), false);
      assert.equal((await runAnonymous(() => ensureRegistryFor('coll-1'))).answered, false);
      assert.equal(listedAs.length, 1, 'held, so the request path does not re-read it either');
    } finally { mock.restore(); }
  }));
}

test('an anonymous refusal is never lent to a personal login — its own listing answers', () => fresh(async () => {
  const state: { registry: boolean; status?: number } = { registry: true, status: 403 };
  const { mock, listedAs } = repo(state);
  try {
    runWithCredential(PERSON, () => queueCollections(['coll-1']));
    await runCacheTick();                      // read as nobody: refused
    assert.equal(runWithCredential(PERSON, () => lookupCachedRegistry('coll-1')), undefined);

    delete state.status;                       // the person may read it
    const mine = await runWithCredential(PERSON, () => ensureRegistryFor('coll-1'));
    assert.equal(mine.registry?.nodeId, 'reg-1');
    assert.equal(listedAs.at(-1), PERSON.header);
    assert.equal(queueLength(), 0, 'and the refused anonymous lookup is not queued once more');
  } finally { mock.restore(); }
}));

test('a refused entry expires with the ordinary TTL and is then asked once more', () => fresh(async () => {
  const { mock, listedAs } = repo({ registry: false, status: 403 });
  try {
    runAnonymous(() => queueCollections(['coll-1']));
    await runCacheTick();
    await runCacheTick({ now: Date.now() + 365 * 24 * 3600_000 });
    assert.equal(listedAs.length, 2);
  } finally { mock.restore(); }
}));

test('a 5xx stays an outage: nothing remembered, queued again', () => fresh(async () => {
  const { mock, listedAs } = repo({ registry: false, status: 503 });
  try {
    runAnonymous(() => queueCollections(['coll-1']));
    const report = await runCacheTick();
    assert.equal(report.failed, 1);
    assert.equal(queueLength(), 1);
    await runCacheTick();
    assert.equal(listedAs.length, 2);
  } finally { mock.restore(); }
}));
