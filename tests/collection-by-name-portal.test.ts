/**
 * A subject portal named by its title. Neither collection index returns the
 * portals (measured 2026-07-17 for the keyword index; the chatbot team met it
 * through `collection: "Physik"`, which answered `ambiguous_collection` with
 * "Physikalische Konstanten" among the candidates and the portal itself
 * missing). A portal is a collection like any other, so a title that EXACTLY
 * equals a portal's must find it — from the portal listing, which is where
 * portals are.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock, makeNode, type MockResult } from './fetchMock.js';
import { resolveCollectionByName } from '../src/services/collection-by-name.js';
import { resolveVocab } from '../src/vocabs.js';
import { WLO_ROOT_COLLECTION_ID } from '../src/wlo-config.js';

const MDS = '/mds_oeh/collections';
const NAME = '/collection/v1/collections/-home-/search';
const PHYSIK = resolveVocab('Physik', 'discipline')!;

interface Coll { id: string; title: string; taxon?: string }
const node = (c: Coll) => ({
  ...makeNode(c.id, c.title, { 'cm:title': [c.title], 'cclom:title': [c.title], ...(c.taxon ? { 'ccm:taxonid': [c.taxon] } : {}) }),
  type: 'ccm:map', aspects: ['ccm:collection'],
});

const PORTALS: Coll[] = [
  { id: 'portal-physik', title: 'Physik', taxon: PHYSIK },
  { id: 'portal-chemie', title: 'Chemie' },
];
/** What the indexes answer for "Physik": everything but the portal. */
const INDEXED: Coll[] = [
  { id: 'c-konst', title: 'Physikalische Konstanten', taxon: PHYSIK },
  { id: 'c-gesch', title: 'Geschichte der Physik', taxon: PHYSIK },
];

function repository(opts: { indexed?: Coll[]; portals?: Coll[]; portalStatus?: number } = {}) {
  const indexed = opts.indexed ?? INDEXED;
  const portals = opts.portals ?? PORTALS;
  const all = new Map([...indexed, ...portals].map(c => [c.id, c] as const));
  return installFetchMock((url): MockResult => {
    if (url.includes(MDS)) return { json: { nodes: indexed.map(node) } };
    if (url.includes(NAME)) return { json: { collections: [] } };
    const id = /\/nodes\/-home-\/([^/?]+)\//.exec(url)?.[1] ?? '';
    if (url.includes('/children')) {
      if (id !== WLO_ROOT_COLLECTION_ID) return { json: { nodes: [] } };
      return opts.portalStatus ? { status: opts.portalStatus, json: {} } : { json: { nodes: portals.map(node) } };
    }
    if (url.includes('/parents')) {
      const self = all.get(id) ?? { id, title: id };
      return { json: { nodes: [node(self), node({ id: WLO_ROOT_COLLECTION_ID, title: 'Portale' })] } };
    }
    if (url.includes('/metadata')) return all.has(id) ? { json: { node: node(all.get(id)!) } } : { status: 404, json: {} };
    return { json: {} };
  });
}

test('a title equal to a subject portal resolves to the portal the indexes do not return', async () => {
  const mock = repository();
  try {
    const res = await resolveCollectionByName('Physik');
    assert.equal(res.ok, true);
    assert.equal(res.ok && res.collection.nodeId, 'portal-physik');
    assert.equal(res.ok && res.collection.matched, undefined, 'an exact match, not a loose one');
  } finally { mock.restore(); }
});

test('only an EQUAL title: a portal is not taken for a word it merely contains', async () => {
  const mock = repository();
  try {
    const res = await resolveCollectionByName('Phys');
    assert.equal(res.ok, false);
    assert.equal(!res.ok && res.reason, 'none');
    assert.ok(!res.ok && !res.candidates.some(c => c.nodeId === 'portal-physik'), 'the portal is no search hit for another word');
  } finally { mock.restore(); }
});

test('a portal and a deeper namesake are two candidates', async () => {
  const mock = repository({ indexed: [...INDEXED, { id: 'c-physik', title: 'Physik' }] });
  try {
    const res = await resolveCollectionByName('Physik');
    assert.equal(res.ok, false);
    assert.equal(!res.ok && res.reason, 'several');
    assert.deepEqual(!res.ok && res.candidates.slice(0, 2).map(c => c.nodeId).sort(), ['c-physik', 'portal-physik']);
  } finally { mock.restore(); }
});

test('the subject decides between them as between any namesakes', async () => {
  // The deeper one carries no subject, the portal carries the one asked for.
  const mock = repository({ indexed: [...INDEXED, { id: 'c-physik', title: 'Physik' }] });
  try {
    const res = await resolveCollectionByName('Physik', 'Physik');
    assert.equal(res.ok && res.collection.nodeId, 'portal-physik');
    assert.deepEqual(res.ok && res.collection.alsoFound?.map(c => c.nodeId), ['c-physik']);
  } finally { mock.restore(); }
});

test('a portal the index DOES return is one candidate, not two', async () => {
  const mock = repository({ indexed: [...INDEXED, PORTALS[0]!] });
  try {
    const res = await resolveCollectionByName('Physik');
    assert.equal(res.ok && res.collection.nodeId, 'portal-physik');
  } finally { mock.restore(); }
});

test('a portal listing that did not answer: an equal title found elsewhere is not called the only one', async () => {
  const mock = repository({ indexed: [{ id: 'c-optik', title: 'Optik' }], portalStatus: 503 });
  try {
    const res = await resolveCollectionByName('Optik');
    assert.equal(res.ok, false);
    assert.equal(!res.ok && res.reason, 'unverified');
    // Named for what it was: the portal list, not a search (`unreachable`).
    assert.equal(!res.ok && res.portalsUnread, true);
    assert.equal(!res.ok && res.incomplete, true);
    assert.equal(!res.ok && res.unreachable, undefined);
  } finally { mock.restore(); }
});

test('the portal listing is read once for several names', async () => {
  const mock = repository();
  try {
    await resolveCollectionByName('Physik');
    await resolveCollectionByName('Chemie');
    const listings = mock.calls.filter(c => c.url.includes(`/${WLO_ROOT_COLLECTION_ID}/children`));
    assert.equal(listings.length, 1);
  } finally { mock.restore(); }
});

test('list_collection_tree with collection="Physik" runs on the portal', async () => {
  const mock = repository();
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'list_collection_tree', arguments: { collection: 'Physik', depth: 1 } });
    assert.notEqual(result.isError, true);
    const structured = result.structuredContent as { root: { nodeId: string }; resolvedCollection?: { nodeId: string } };
    assert.equal(structured.root.nodeId, 'portal-physik');
    assert.equal(structured.resolvedCollection?.nodeId, 'portal-physik');
  } finally { await client.close(); mock.restore(); }
});
