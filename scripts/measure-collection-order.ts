/**
 * measure-collection-order.ts – in which order a repository lists the
 * sub-collections of a collection, and what `POST …/order` changes about it
 * (`npm run measure:order`).
 *
 * It REPORTS and keeps nothing: one throwaway collection with children in the
 * caller's own area, deleted again; one that stays is named. Staging only —
 * the same guard as the live tests.
 *
 * Asked of BOTH listings, because this server reads sub-collections through
 * the node endpoint (`/node/v1/…/children?filter=folders`) while the
 * collection endpoint (`/collection/v1/…/children/collections`) is the one the
 * order was first measured on (chatbot team, 2026-11-14).
 */

import { BASE_URL } from '../src/wlo-config.js';
import { wloFetch } from '../src/wlo-fetch.js';
import { createCollection, deleteCollection } from '../src/services/write/collections.js';
import { requireLiveTarget } from '../tests/live/guard.js';

const STAMP = `zqord${Date.now().toString(36)}`;
const POSITION = 'ccm:collection_ordered_position';
const SORTED = `sortProperties=${encodeURIComponent(POSITION)}&sortAscending=true`;

interface Listed { ref?: { id?: string }; title?: string; properties?: Record<string, string[]> }

async function getJson(url: string): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await wloFetch(url, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) as Record<string, unknown> }; } catch { return { status: res.status, body: null }; }
}

const names = new Map<string, string>();
function show(list: Listed[] | undefined): string {
  return (list ?? []).map(n => {
    const id = n.ref?.id ?? '?';
    const pos = n.properties?.[POSITION]?.[0];
    return `${names.get(id) ?? n.title ?? id.slice(0, 8)}${pos !== undefined ? `@${pos}` : ''}`;
  }).join(', ') || '(none)';
}

async function nodeListing(parent: string, query = ''): Promise<string> {
  const { status, body } = await getJson(`${BASE_URL}/node/v1/nodes/-home-/${parent}/children?filter=folders&maxItems=50&propertyFilter=-all-${query ? `&${query}` : ''}`);
  return `HTTP ${status}: ${show(body?.['nodes'] as Listed[] | undefined)}`;
}
async function collectionListing(parent: string, query = ''): Promise<string> {
  const { status, body } = await getJson(`${BASE_URL}/collection/v1/collections/-home-/${parent}/children/collections?scope=MY&maxItems=50&propertyFilter=-all-${query ? `&${query}` : ''}`);
  return `HTTP ${status}: ${show(body?.['collections'] as Listed[] | undefined)}`;
}
async function both(label: string, parent: string): Promise<void> {
  console.log(`\n${label}`);
  console.log(`  node       plain : ${await nodeListing(parent)}`);
  console.log(`  node       sorted: ${await nodeListing(parent, SORTED)}`);
  console.log(`  collection plain : ${await collectionListing(parent)}`);
  console.log(`  collection sorted: ${await collectionListing(parent, SORTED)}`);
}

async function setOrder(parent: string, ids: string[]): Promise<string> {
  const res = await wloFetch(`${BASE_URL}/collection/v1/collections/-home-/${parent}/order`, {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(ids),
  });
  return `HTTP ${res.status} ${(await res.text()).slice(0, 160)}`;
}

async function make(parent: string | null, title: string): Promise<string> {
  const made = await createCollection(parent, { title: `${title} ${STAMP}` });
  if (made.status !== 'created') throw new Error(`create ${title}: ${made.detail}`);
  names.set(made.nodeId, title);
  return made.nodeId;
}

requireLiveTarget();
console.log(`stamp ${STAMP}`);
let root: string | undefined;
try {
  root = await make(null, 'ROOT');
  // Created one after the other, in an order that is neither alphabetical nor reversed.
  const c = await make(root, 'C');
  const a = await make(root, 'A');
  const b = await make(root, 'B');
  await both('1. after creating C, A, B — no order set', root);

  console.log(`\n2. POST order [B, C, A]: ${await setOrder(root, [b, c, a])}`);
  await both('   listings after it', root);

  const d = await make(root, 'D');
  await both('3. a fourth child D created AFTER the order was set (it has no position)', root);

  console.log(`\n4. POST order [D, A, B, C]: ${await setOrder(root, [d, a, b, c])}`);
  await both('   listings after it', root);

  const meta = await getJson(`${BASE_URL}/collection/v1/collections/-home-/${root}`);
  const col = (meta.body?.['collection'] as { collection?: Record<string, unknown> } | undefined)?.collection;
  console.log(`\n5. parent after ordering: orderMode=${JSON.stringify(col?.['orderMode'])} orderAscending=${JSON.stringify(col?.['orderAscending'])}`);
} finally {
  if (root) {
    const gone = await deleteCollection(root).catch((err: unknown) => ({ status: 'failed', detail: String(err) }));
    console.log(`\ncleanup: ${JSON.stringify(gone)}`);
    if (gone.status !== 'ok') console.error(`NOT DELETED: ${root}`);
  }
}
