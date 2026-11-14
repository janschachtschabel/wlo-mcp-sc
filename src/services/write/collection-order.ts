/**
 * services/write/collection-order.ts – set the order of a collection's
 * sub-collections or of its contents (chatbot team, S1, 2026-11-14).
 *
 * Measured on staging (`npm run measure:order`, `npm run measure:moves`), and
 * each of these is a rule here:
 *
 * - `POST …/order` writes a position on every child it NAMES and leaves the
 *   others as they are — an incomplete list ends in two children on one
 *   position (chatbot team's measurement). So a list must name ALL children of
 *   its kind, and one that does not is refused before any key.
 * - For CONTENTS the endpoint takes the id of the REFERENCE; the original's id
 *   answers 400. A caller holds either (search hands out originals, a
 *   collection listing references), so both are accepted and resolved here.
 * - Sub-collections and contents share one position space but are listed
 *   apart, so a list of ONE kind is complete in itself. A mixed list is refused:
 *   which of the two listings it was meant to order is not ours to guess.
 * - A set order is only visible when the listing is asked with the sort
 *   parameter (`ORDER_POSITION_PROPERTY`). The read-back asks that way.
 */

import { BASE_URL } from '../../wlo-config.js';
import { wloFetch, HEADERS } from '../../wlo-fetch.js';
import { ORDER_POSITION_PROPERTY, getChildCollectionsResult } from '../../wlo-node.js';
import { collectionTitleFromProperties } from '../../node-match.js';
import { listMembers } from './collections.js';
import { sanitizeText } from '../../text-sanitize.js';
import { log } from '../../logger.js';
import { failureDetail } from './nodes.js';
import type { MutationOutcome } from './verify.js';

/** Children of one kind a collection may hold for its order to be set here — beyond it the list cannot be checked for completeness. */
export const ORDER_MAX = 500;
const PAGE = 100;
const PROPS = ['cm:title', 'cclom:title', 'cm:name', ORDER_POSITION_PROPERTY];

export type OrderKind = 'collections' | 'contents';

export interface OrderChild {
  /** What `/order` takes: the node id of a sub-collection, the REFERENCE id of a content. */
  id: string;
  /** For a content: the material it stands for, where that is another node (absent for a record filed directly). */
  materialId?: string;
  title: string;
  hasPosition: boolean;
}

export type Orderable =
  | { ok: true; collections: OrderChild[]; contents: OrderChild[] }
  | { ok: false; reason: 'unread' | 'too_many'; kind: OrderKind };

/** One kind's children in STORED order, whole — or why that could not be had. */
export async function listOrderChildren(collectionId: string, kind: OrderKind): Promise<OrderChild[] | 'unread' | 'too_many'> {
  if (kind === 'contents') {
    // Which id is the reference's and which the material's is decided in ONE place.
    const members = await listMembers(collectionId, { max: ORDER_MAX, stored: true });
    return typeof members === 'string' ? members : members.map(m => ({
      id: m.referenceId, ...(m.materialId !== m.referenceId ? { materialId: m.materialId } : {}), title: m.title, hasPosition: m.hasPosition,
    }));
  }
  const out: OrderChild[] = [];
  for (let skip = 0; skip <= ORDER_MAX; skip += PAGE) {
    const res = await getChildCollectionsResult(collectionId, PAGE, skip, PROPS, { stored: true });
    if (!res.reachable) return 'unread';
    for (const node of res.nodes) {
      const id = node.ref?.id;
      if (!id) continue;
      out.push({
        id, title: sanitizeText(collectionTitleFromProperties(node.properties) || id),
        hasPosition: node.properties?.[ORDER_POSITION_PROPERTY]?.[0] !== undefined,
      });
    }
    if (out.length > ORDER_MAX) return 'too_many';
    if (res.nodes.length < PAGE) return out;
  }
  return 'too_many';
}

/** Both listings, in stored order. */
export async function readOrderable(collectionId: string): Promise<Orderable> {
  const [collections, contents] = await Promise.all([listOrderChildren(collectionId, 'collections'), listOrderChildren(collectionId, 'contents')]);
  if (typeof collections === 'string') return { ok: false, reason: collections, kind: 'collections' };
  if (typeof contents === 'string') return { ok: false, reason: contents, kind: 'contents' };
  return { ok: true, collections, contents };
}

export type OrderPlan =
  | { ok: true; kind: OrderKind; /** In the new order, as SENT. */ children: OrderChild[]; before: OrderChild[] }
  | { ok: false; code: 'invalid_input' | 'no_change'; reasons: string[]; missing?: string[]; unknown?: string[] };

const NAMES_SHOWN = 10;

/** Match the caller's list against what the collection holds. Pure. */
export function planOrder(have: { collections: OrderChild[]; contents: OrderChild[] }, order: string[]): OrderPlan {
  const ids = order.map(id => id.trim());
  const twice = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (twice.length) return { ok: false, code: 'invalid_input', reasons: [`Doppelt genannt: ${twice.map(sanitizeText).join(', ')}.`] };

  const byCollection = new Map(have.collections.map(c => [c.id, c]));
  const byContent = new Map<string, OrderChild>();
  // One material filed twice is two entries with one material id: that id names neither.
  const twiceFiled = new Set<string>();
  for (const c of have.contents) {
    byContent.set(c.id, c);
    if (!c.materialId) continue;
    if (byContent.has(c.materialId)) twiceFiled.add(c.materialId);
    byContent.set(c.materialId, c);
  }
  const unclear = ids.filter(id => twiceFiled.has(id));
  if (unclear.length) {
    return { ok: false, code: 'invalid_input', reasons: [`${unclear.map(sanitizeText).join(', ')}: dieses Material liegt mehrfach in der Sammlung — `
      + `bitte die Kennungen der Verweise nennen (${have.contents.filter(c => c.materialId && unclear.includes(c.materialId)).map(c => c.id).join(', ')}).`] };
  }
  const asCollections = ids.filter(id => byCollection.has(id));
  const asContents = ids.filter(id => byContent.has(id));
  const unknown = ids.filter(id => !byCollection.has(id) && !byContent.has(id));
  if (unknown.length) {
    return { ok: false, code: 'invalid_input', unknown, reasons: [`Nicht in dieser Sammlung: ${unknown.slice(0, NAMES_SHOWN).map(sanitizeText).join(', ')}`
      + `${unknown.length > NAMES_SHOWN ? ` und ${unknown.length - NAMES_SHOWN} weitere` : ''}.`] };
  }
  if (asCollections.length && asContents.length) {
    return { ok: false, code: 'invalid_input', reasons: ['Die Liste mischt Untersammlungen und Inhalte. Beide werden getrennt gelistet — '
      + 'bitte je Aufruf nur eine Art nennen.'] };
  }
  const kind: OrderKind = asCollections.length ? 'collections' : 'contents';
  const all = kind === 'collections' ? have.collections : have.contents;
  const children = ids.map(id => (kind === 'collections' ? byCollection.get(id)! : byContent.get(id)!));
  // The same content named by both of its ids.
  if (new Set(children.map(c => c.id)).size !== children.length) {
    return { ok: false, code: 'invalid_input', reasons: ['Ein Inhalt ist zweimal genannt (einmal als Verweis, einmal als Original).'] };
  }
  const named = new Set(children.map(c => c.id));
  const missing = all.filter(c => !named.has(c.id));
  if (missing.length) {
    return { ok: false, code: 'invalid_input', missing: missing.map(c => c.id), reasons: [
      `Die Liste muss ALLE ${all.length} ${kind === 'collections' ? 'Untersammlungen' : 'Inhalte'} nennen — sonst stehen danach zwei auf `
      + `demselben Platz. Es fehlen ${missing.length}: ${missing.slice(0, NAMES_SHOWN).map(c => `„${c.title}“ (${c.id})`).join(', ')}`
      + `${missing.length > NAMES_SHOWN ? ` und ${missing.length - NAMES_SHOWN} weitere` : ''}.`] };
  }
  // Already so, AND explicitly: an order that only happens to equal the order of creation is still worth setting.
  if (all.every((c, i) => c.id === children[i]!.id) && all.every(c => c.hasPosition)) {
    return { ok: false, code: 'no_change', reasons: ['Die Reihenfolge steht bereits genau so — es wurde nichts geändert.'] };
  }
  return { ok: true, kind, children, before: all };
}

/** Send the order and read it back from the sorted listing. */
export async function setCollectionOrder(collectionId: string, kind: OrderKind, ids: string[]): Promise<MutationOutcome> {
  const res = await wloFetch(`${BASE_URL}/collection/v1/collections/-home-/${encodeURIComponent(collectionId)}/order`, {
    method: 'POST', headers: HEADERS, body: JSON.stringify(ids),
  });
  if (!res.ok) return { status: 'failed', detail: await failureDetail(res), httpStatus: res.status };
  log.info('collection order set', { collection: collectionId, kind, count: ids.length });

  const now = await listOrderChildren(collectionId, kind);
  if (typeof now === 'string') return { status: 'unverified', detail: 'Die Reihenfolge ließ sich danach nicht lesen.' };
  const stored = now.map(c => c.id);
  return stored.length === ids.length && stored.every((id, i) => id === ids[i])
    ? { status: 'ok' }
    : { status: 'not_visible', detail: 'Die Liste der Sammlung zeigt danach eine andere Reihenfolge.' };
}
