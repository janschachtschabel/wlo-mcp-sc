/**
 * The registry cache holds what a children listing answered — and a listing
 * answers differently for the service account, for nobody, and for a person.
 * An entry is therefore kept per scope of rights, and a personal login's answer
 * is kept for nobody.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CACHE_MAX_ENTRIES,
  cachedRegistriesFor,
  cacheSize,
  ensureRegistries,
  ensureRegistryFor,
  lookupCachedRegistry,
  queueCollections,
  queueLength,
  runCacheTick,
  stopSkillRegistryCache,
} from '../src/services/skill-registry-cache.js';
import { REGISTRY_CONTENT_TYPE_URI } from '../src/services/skill-catalogue.js';
import {
  configuredServiceCredential,
  runAnonymous,
  runWithCredential,
  setServiceCredentialForTest,
  type WloCredential,
} from '../src/auth/credential.js';
import type { FormattedNode } from '../src/formatter.js';

import { installFetchMock, makeNode, type MockResult } from './fetchMock.js';

const SERVICE: WloCredential = { header: 'Basic c2VydmljZTp4', label: 'service', source: 'service' };
const PERSON: WloCredential = { header: 'Basic cGVyc29uOng=', label: 'person', source: 'user' };

const SKILL = '00000001-0000-4000-8000-000000000000';
const REGISTRY_MD = `::: ki-skill\n[Fragen](https://repo.example/edu-sharing/components/render/${SKILL})\n:::`;

function registryChild() {
  return {
    ...makeNode('reg-1', 'Registry', { 'cm:name': ['SKILL_REGISTRY.md'], 'ccm:oeh_extendedType': [REGISTRY_CONTENT_TYPE_URI] }),
    mimetype: 'text/x-web-markdown',
    mediatype: 'file-markdown',
  };
}

/**
 * A repository whose listing depends on WHO asks: a caller presenting an
 * `Authorization` header sees the registry document, anybody else an empty
 * collection. Records which header each listing was asked with.
 */
function rightsMock() {
  const listedAs: (string | undefined)[] = [];
  const mock = installFetchMock((url, init): MockResult => {
    const auth = new Headers(init?.headers).get('authorization') ?? undefined;
    if (url.includes('/children')) {
      listedAs.push(auth);
      const nodes = auth ? [registryChild()] : [];
      return { json: { nodes, pagination: { total: nodes.length, from: 0, count: nodes.length } } };
    }
    if (url.includes('/eduservlet/download')) return { text: REGISTRY_MD };
    return { json: {} };
  });
  return { mock, listedAs };
}

const collection = (id: string): FormattedNode => ({ nodeId: id, nodeType: 'collection', title: id } as FormattedNode);

async function withService<T>(fn: () => Promise<T>): Promise<T> {
  const before = configuredServiceCredential();
  setServiceCredentialForTest(SERVICE);
  stopSkillRegistryCache();
  try { return await fn(); } finally {
    stopSkillRegistryCache();
    setServiceCredentialForTest(before);
  }
}

test('what the service account read is not served to an anonymous caller', () => withService(async () => {
  const { mock, listedAs } = rightsMock();
  try {
    const asService = await runWithCredential(SERVICE, () => ensureRegistryFor('coll-1'));
    assert.equal(asService.registry?.nodeId, 'reg-1');

    const asNobody = await runAnonymous(() => ensureRegistryFor('coll-1'));
    assert.equal(asNobody.registry, null, 'the anonymous caller gets the anonymous listing');
    assert.equal(asNobody.answered, true);
    assert.equal(listedAs.length, 2, 'a second listing, with the caller\'s own rights');
    assert.equal(listedAs[1], undefined);

    assert.equal(runAnonymous(() => cachedRegistriesFor(['coll-1'])).size, 0);
    assert.equal(runWithCredential(SERVICE, () => cachedRegistriesFor(['coll-1'])).size, 1);
    assert.equal(runAnonymous(() => lookupCachedRegistry('coll-1'))?.registry, null);
  } finally { mock.restore(); }
}));

test('what an anonymous caller read does not answer for the service account', () => withService(async () => {
  const { mock, listedAs } = rightsMock();
  try {
    const nodes = [collection('coll-1')];
    const answered = await runAnonymous(() => ensureRegistries(nodes));
    assert.ok(answered.has('coll-1'));
    assert.equal(nodes[0]!.skillRegistry, undefined, '"none there" — for nobody');

    const again = [collection('coll-1')];
    await runWithCredential(SERVICE, () => ensureRegistries(again));
    assert.equal(again[0]!.skillRegistry?.nodeId, 'reg-1', 'the service account is not told "none there"');
    assert.equal(listedAs.length, 2);
  } finally { mock.restore(); }
}));

// CONTRACT CHANGED 2026-11-14: "kept for nobody" became "kept for nobody
// ELSE". A personal login's own answers are held for that identity for a
// minute (`personalMemo`) — every signed-in request paid the listing again for
// each collection without a registry. What did not change is asserted here:
// nothing of it enters a SHARED scope. The memo itself is tested in
// `skill-registry-cache-personal.test.ts`.
test('a read under a personal login is answered, and kept for nobody else', () => withService(async () => {
  const { mock, listedAs } = rightsMock();
  try {
    const mine = await runWithCredential(PERSON, () => ensureRegistryFor('coll-1'));
    assert.equal(mine.registry?.nodeId, 'reg-1');
    assert.equal(cacheSize(), 0, 'nothing enters a shared scope');

    const nodes = [collection('coll-2')];
    await runWithCredential(PERSON, () => ensureRegistries(nodes));
    assert.equal(nodes[0]!.skillRegistry?.nodeId, 'reg-1');
    assert.equal(cacheSize(), 0);

    await runWithCredential(PERSON, () => ensureRegistryFor('coll-1'));
    assert.equal(listedAs.filter(a => a === PERSON.header).length, 2, 'the person\'s second question is answered from its own memo');
    assert.equal(runWithCredential(PERSON, () => lookupCachedRegistry('coll-1'))?.registry?.nodeId, 'reg-1');
    assert.equal(runAnonymous(() => lookupCachedRegistry('coll-1')), undefined, 'an anonymous caller sees none of it');
    assert.equal(runWithCredential(SERVICE, () => lookupCachedRegistry('coll-1')), undefined, 'nor does the service account');
    assert.equal(cacheSize(), 0, 'still nothing a personal login read is held in a shared scope');
  } finally { mock.restore(); }
}));

/** A repository where EVERYBODY sees the registry — the public case. */
function publicMock() {
  const listedAs: (string | undefined)[] = [];
  const mock = installFetchMock((url, init): MockResult => {
    if (url.includes('/children')) {
      listedAs.push(new Headers(init?.headers).get('authorization') ?? undefined);
      return { json: { nodes: [registryChild()], pagination: { total: 1, from: 0, count: 1 } } };
    }
    if (url.includes('/eduservlet/download')) return { text: REGISTRY_MD };
    return { json: {} };
  });
  return { mock, listedAs };
}

test('a personal login is served what an ANONYMOUS reader found — without a listing of its own', () => withService(async () => {
  const { mock, listedAs } = publicMock();
  try {
    await runAnonymous(() => ensureRegistryFor('coll-1'));
    assert.equal(listedAs.length, 1);

    // Whatever nobody-in-particular may read, a signed-in person may read too.
    const mine = await runWithCredential(PERSON, () => ensureRegistryFor('coll-1'));
    assert.equal(mine.registry?.nodeId, 'reg-1');
    assert.equal(mine.answered, true);
    const nodes = [collection('coll-1')];
    const answered = await runWithCredential(PERSON, () => ensureRegistries(nodes));
    assert.equal(nodes[0]!.skillRegistry?.nodeId, 'reg-1');
    assert.ok(answered.has('coll-1'));
    assert.equal(runWithCredential(PERSON, () => cachedRegistriesFor(['coll-1'])).get('coll-1')?.nodeId, 'reg-1');
    assert.equal(listedAs.length, 1, 'no further listing was needed');
  } finally { mock.restore(); }
}));

test('an anonymous "none there" is NOT an answer for a personal login, which may see more', () => withService(async () => {
  const { mock, listedAs } = rightsMock();
  try {
    const asNobody = await runAnonymous(() => ensureRegistryFor('coll-1'));
    assert.equal(asNobody.registry, null);
    assert.equal(asNobody.answered, true);

    assert.equal(runWithCredential(PERSON, () => lookupCachedRegistry('coll-1')), undefined);
    const nodes = [collection('coll-1')];
    const answered = await runWithCredential(PERSON, () => ensureRegistries(nodes));
    assert.equal(nodes[0]!.skillRegistry?.nodeId, 'reg-1', 'the person\'s own listing answers');
    assert.ok(answered.has('coll-1'));
    assert.equal(listedAs.at(-1), PERSON.header);
    assert.equal(runAnonymous(() => lookupCachedRegistry('coll-1'))?.registry, null, 'and the anonymous entry is untouched');
    // The service account's entries are never lent to a person either way.
    await runWithCredential(SERVICE, () => ensureRegistryFor('coll-2'));
    assert.equal(runWithCredential(PERSON, () => cachedRegistriesFor(['coll-2'])).size, 0);
  } finally { mock.restore(); }
}));

test('what a personal login asks about is queued for an ANONYMOUS lookup, and the tick warms it', () => withService(async () => {
  const { mock, listedAs } = publicMock();
  try {
    // Twelve cold collections: ten are read live, two are past the bound.
    const nodes = Array.from({ length: 12 }, (_, i) => collection(`coll-${i}`));
    const answered = await runWithCredential(PERSON, () => ensureRegistries(nodes));
    assert.equal(answered.size, 10);
    assert.equal(cacheSize(), 0, 'nothing the person read is stored');
    assert.equal(queueLength(), 12, 'all of them wait for the anonymous lookup');

    listedAs.length = 0;
    await runCacheTick();
    assert.equal(listedAs.length, 12);
    assert.ok(listedAs.every(a => a === undefined), 'the tick reads them as nobody, never with the person\'s or the service\'s rights');

    listedAs.length = 0;
    const again = Array.from({ length: 12 }, (_, i) => collection(`coll-${i}`));
    const second = await runWithCredential(PERSON, () => ensureRegistries(again));
    assert.equal(second.size, 12, 'the collections past the tenth are answered now');
    assert.equal(listedAs.length, 0, 'and the signed-in search pays nothing');

    // The broad overviews never go upstream — they queue as well.
    stopSkillRegistryCache();
    assert.equal(runWithCredential(PERSON, () => cachedRegistriesFor(['coll-x'])).size, 0);
    assert.equal(queueLength(), 1);
    await runCacheTick();
    assert.equal(runWithCredential(PERSON, () => cachedRegistriesFor(['coll-x'])).get('coll-x')?.nodeId, 'reg-1');
  } finally { mock.restore(); }
}));

test('a single collection a personal login asked about is queued even though its own read answered', () => withService(async () => {
  const { mock } = publicMock();
  try {
    await runWithCredential(PERSON, () => ensureRegistryFor('coll-1'));
    assert.equal(cacheSize(), 0);
    assert.equal(queueLength(), 1);
  } finally { mock.restore(); }
}));

test('a queued key whose scope can no longer be entered is dropped, not re-queued forever', () => withService(async () => {
  const { mock, listedAs } = publicMock();
  try {
    runWithCredential(SERVICE, () => queueCollections(['coll-1']));
    setServiceCredentialForTest(null);            // the account is gone
    const report = await runCacheTick();
    assert.equal(listedAs.length, 0, 'never answered with other rights');
    assert.equal(queueLength(), 0, 'and not carried into the next tick');
    assert.equal(report.failed, 0);
  } finally { mock.restore(); }
}));

test('each scope has its own share of the queue and of the entries', () => withService(async () => {
  const { mock } = publicMock();
  try {
    // One service answer first — the OLDEST entry of all.
    await runWithCredential(SERVICE, () => ensureRegistryFor('svc-1'));

    runAnonymous(() => queueCollections(Array.from({ length: 600 }, (_, i) => `anon-${i}`)));
    assert.equal(queueLength(), 500, 'the anonymous share is full');
    runWithCredential(SERVICE, () => queueCollections(['svc-2']));
    assert.equal(queueLength(), 501, 'the service scope is not starved by it');

    const tick = await runCacheTick();
    assert.ok(runWithCredential(SERVICE, () => lookupCachedRegistry('svc-2')), 'and is not made to wait behind 500 anonymous ids');
    assert.ok(tick.resolved > 1);

    const rounds = Math.ceil(CACHE_MAX_ENTRIES / 50) + 2;
    for (let round = 0; round < rounds; round++) {
      runAnonymous(() => queueCollections(Array.from({ length: 50 }, (_, i) => `fill-${round}-${i}`)));
      await runCacheTick();
    }
    assert.ok(runWithCredential(SERVICE, () => lookupCachedRegistry('svc-1')), 'anonymous traffic did not evict the service answer');
    assert.equal(cacheSize(), CACHE_MAX_ENTRIES + 2, 'the anonymous share stops at its own bound');
  } finally { mock.restore(); }
}));

test('the tick resolves each queued collection with the rights of the scope that queued it', () => withService(async () => {
  const { mock, listedAs } = rightsMock();
  try {
    runAnonymous(() => queueCollections(['coll-1']));
    runWithCredential(SERVICE, () => queueCollections(['coll-1']));
    runWithCredential(PERSON, () => queueCollections(['coll-9']));
    assert.equal(queueLength(), 3, 'one per scope; a personal login queues for the anonymous one');

    const report = await runCacheTick();
    assert.equal(report.resolved, 3);
    assert.deepEqual([...listedAs].map(String).sort(), [SERVICE.header, 'undefined', 'undefined'].sort());
    assert.equal(runAnonymous(() => lookupCachedRegistry('coll-1'))?.registry, null);
    assert.equal(runWithCredential(SERVICE, () => lookupCachedRegistry('coll-1'))?.registry?.nodeId, 'reg-1');
  } finally { mock.restore(); }
}));
