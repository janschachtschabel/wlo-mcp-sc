/**
 * services/write/collections.ts – creating and curating collections.
 *
 * A collection (`ccm:map`) holds REFERENCES to material, not the material. That
 * distinction runs through this whole module and is the reason two of its five
 * functions exist separately:
 *
 *   removeFromCollection → takes an item OUT of one collection
 *   deleting the node    → destroys the material for everyone, everywhere
 *
 * They differ by one path segment (`/collection/v1/collections/…/references/{n}`
 * versus `/node/v1/nodes/…/{n}`), which is exactly the kind of difference a
 * conversation can blur. Deleting material is deliberately NOT in this file.
 *
 * Each function answers a `MutationOutcome`: the call's own result AND what the
 * record showed afterwards. A `200` from these endpoints is not evidence — the
 * collection route is measured to discard `cm:description` while answering one,
 * and the mechanism that discards a write when the caller lacks the right is
 * not endpoint-specific. So every function here reads back before it reports.
 */

import { BASE_URL, WLO_REPOSITORY_URL } from '../../wlo-config.js';
import { wloFetch, HEADERS } from '../../wlo-fetch.js';
import { readJson } from '../../read-json.js';
import { log } from '../../logger.js';
import { sanitizeText } from '../../text-sanitize.js';
import { getNodeMetadata, getCollectionContents } from '../../wlo-node.js';
import { getNodeCollections } from '../node-collections.js';
import { failureDetail, updateNodeMetadata } from './nodes.js';
import { confirmDeleted, type MutationOutcome } from './verify.js';
import { toRepositoryPath, type PreparedRequest, type PrepareOutcome } from './prepared-request.js';

/** Where a top-level collection is created. Sub-collections name their parent. */
const ROOT = '-root-';

/**
 * `EDITORIAL` is the curated kind — what WLO's portals and topic pages are.
 * `EDITORIAL_GROUP` also exists but carries group membership semantics we do
 * not manage, so it is not offered.
 */
const COLLECTION_TYPE = 'EDITORIAL';

export interface CollectionFields {
  title: string;
  description?: string;
}

export type CreateCollectionOutcome =
  | {
      status: 'created';
      nodeId: string;
      /**
       * What the record showed afterwards. Never `failed` — by this point the
       * collection exists, and only what it contains is in question.
       */
      check: MutationOutcome;
    }
  | { status: 'failed'; detail: string };

function collectionPath(collection: string, suffix = ''): string {
  return `${BASE_URL}/collection/v1/collections/-home-/${encodeURIComponent(collection)}${suffix}`;
}

/**
 * The body both create and rename send.
 *
 * Three things here are measured against staging, and each of them was found by
 * a 500 rather than by reading the API:
 *
 *   - the top-level `title` is MANDATORY. The endpoint derives the node name
 *     from it; without it the call fails with `cmNameReadableName is null`.
 *     `properties['cm:title']` alone is not enough, however plausible it looks.
 *   - `ref.id` is mandatory on the update, even though the id is already in the
 *     path. The DTO is read, not the URL.
 *   - `cm:description` is NOT accepted here. The call answers 200 and stores
 *     nothing, so the description travels separately — see `writeDescription`.
 */
function collectionBody(fields: CollectionFields, collection?: string): string {
  const body: Record<string, unknown> = {
    title: fields.title,
    properties: { 'cm:title': [fields.title] },
    collection: { type: COLLECTION_TYPE },
  };
  if (collection) body['ref'] = { id: collection, repo: '-home-' };
  return JSON.stringify(body);
}

/**
 * Write a collection's description through the node route.
 *
 * Measured: the collection endpoint discards `cm:description` while answering
 * 200 — one more instance of the silent drop this whole pipeline exists for.
 * The node metadata endpoint stores it.
 */
async function writeDescription(collection: string, description: string | undefined): Promise<string | null> {
  if (!description) return null;
  const { statuses } = await updateNodeMetadata(collection, { 'cm:description': [description] }, { commit: false });
  const failed = statuses.find(s => !s.ok);
  return failed ? (failed.detail ?? 'unbekannter Fehler') : null;
}

/**
 * Read the collection back and check that the fields are in it.
 *
 * Title and description travel on different routes, so they can land
 * independently — the report names which one is missing, because "nicht
 * vollständig gespeichert" tells a curator nothing they can act on.
 */
async function confirmCollection(collection: string, fields: CollectionFields): Promise<MutationOutcome> {
  const node = await getNodeMetadata(collection);
  if (!node) {
    return {
      status: 'unverified',
      detail: `Die Sammlung „${collection}“ war zur Kontrolle nicht lesbar.`,
    };
  }
  const missing: string[] = [];
  const storedTitle = node.properties?.['cm:title']?.[0]?.trim() ?? '';
  if (storedTitle !== fields.title.trim()) {
    missing.push(`Titel (im Datensatz steht „${sanitizeText(storedTitle)}“)`);
  }
  if (fields.description) {
    const storedDescription = node.properties?.['cm:description']?.[0]?.trim() ?? '';
    if (storedDescription !== fields.description.trim()) missing.push('Beschreibung');
  }
  if (missing.length === 0) return { status: 'ok' };
  return { status: 'not_visible', detail: `Nicht im Datensatz angekommen: ${missing.join(', ')}.` };
}

/**
 * Write the description, then check both fields in ONE read.
 *
 * Shared by create and rename: after the collection endpoint has been called,
 * the two do exactly the same thing, and the wording of what landed must not
 * drift between them.
 */
async function finishCollection(collection: string, fields: CollectionFields): Promise<MutationOutcome> {
  const failure = await writeDescription(collection, fields.description);
  const check = await confirmCollection(collection, fields);
  if (check.status === 'ok' || !failure) return check;
  // The read-back says something is missing and the description write already
  // said why — carrying the upstream reason spares a second round of guessing.
  const detail = `${check.detail} Die Beschreibung wurde dabei abgelehnt: ${failure}`;
  return check.status === 'not_visible'
    ? { status: 'not_visible', detail }
    : { status: 'unverified', detail };
}

/**
 * Is the material in the collection (or out of it)?
 *
 * Goes through `getNodeCollections` rather than a collection listing because
 * that is the path whose behaviour is measured: filing material creates a
 * REFERENCE with its own id, and the usage endpoint only knows the original —
 * given a reference it answers `200` with an empty array. `getNodeCollections`
 * resolves the original first, so the check cannot mistake a reference id for
 * "in no collection".
 */
async function confirmReference(
  collection: string,
  nodeId: string,
  expected: 'present' | 'absent',
): Promise<MutationOutcome> {
  let listed;
  try {
    listed = await getNodeCollections(nodeId);
  } catch (err) {
    return { status: 'unverified', detail: err instanceof Error ? err.message : String(err) };
  }
  if (!listed) {
    return { status: 'unverified', detail: `Das Material „${nodeId}“ war zur Kontrolle nicht lesbar.` };
  }
  const present = listed.collections.some(c => c.nodeId === collection);
  if (present === (expected === 'present')) return { status: 'ok' };
  return {
    status: 'not_visible',
    detail: expected === 'present'
      ? 'Das Material wird noch nicht als Teil der Sammlung geführt.'
      : 'Das Material wird weiterhin als Teil der Sammlung geführt.',
  };
}

/**
 * Create a collection. `parent` null puts it at the top level.
 */
export async function createCollection(
  parent: string | null,
  fields: CollectionFields,
): Promise<CreateCollectionOutcome> {
  const res = await wloFetch(collectionPath(parent ?? ROOT, '/children'), {
    method: 'POST',
    headers: HEADERS,
    body: collectionBody(fields),
  });
  if (!res.ok) return { status: 'failed', detail: await failureDetail(res) };

  // An unparseable body takes the same route as one carrying no id: the POST was
  // accepted, so something may exist — reporting a plain failure would invite a
  // retry and a second collection.
  const created = await readJson<{ collection?: { ref?: { id?: string } } }>(res, 'createCollection');
  const nodeId = created?.collection?.ref?.id;
  if (!nodeId) {
    return {
      status: 'failed',
      detail: 'Das Repository hat die Sammlung angelegt, aber keine verwertbare Antwort mit ID zurückgegeben. ' +
        'Bitte im Repository nachsehen, bevor der Vorgang wiederholt wird.',
    };
  }
  log.info('collection created', { nodeId, parent: parent ?? ROOT });

  // The collection exists either way; whatever did not land is reported beside
  // it, not turned into a failed create — that would suggest nothing exists and
  // invite a second collection.
  return { status: 'created', nodeId, check: await finishCollection(nodeId, fields) };
}

/** Change a collection's title and description. */
export async function renameCollection(
  collection: string,
  fields: CollectionFields,
): Promise<MutationOutcome> {
  const res = await wloFetch(collectionPath(collection), {
    method: 'PUT',
    headers: HEADERS,
    body: collectionBody(fields, collection),
  });
  if (!res.ok) return { status: 'failed', detail: await failureDetail(res) };
  return await finishCollection(collection, fields);
}

/** Where a collection's reference to one material lives. */
function referencePath(collection: string, nodeId: string): string {
  return collectionPath(collection, `/references/${encodeURIComponent(nodeId)}`);
}

/**
 * The filing request as data, for someone else to send.
 *
 * The embedded case (E2): a repository page performs the write with the
 * visitor's own session, so it needs to be told which call to make. It is
 * deliberately built from the same `referencePath` the executing function uses
 * — the endpoint knowledge measured here must not gain a second copy in a
 * browser bundle, where it would drift silently.
 */
export function addToCollectionRequest(collection: string, nodeId: string): PreparedRequest {
  return {
    method: 'PUT',
    path: toRepositoryPath(referencePath(collection, nodeId), WLO_REPOSITORY_URL),
  };
}

/**
 * Put existing material into a collection.
 *
 * PUT with NO body — the node is named in the path. Sending one is at best
 * ignored and at worst rejected.
 */
export async function addToCollection(collection: string, nodeId: string): Promise<MutationOutcome> {
  const res = await wloFetch(
    referencePath(collection, nodeId),
    { method: 'PUT', headers: { Accept: 'application/json' } },
  );
  if (!res.ok) return { status: 'failed', detail: await failureDetail(res) };
  log.info('content added to collection', { collection, nodeId });
  return await confirmReference(collection, nodeId, 'present');
}

/** One page of a collection's child listing. Large enough that one call usually suffices. */
const REFERENCE_PAGE = 100;

/**
 * How far into a collection the reference lookup will page before giving up.
 * A bound is needed because the listing is caller-driven; when it is reached the
 * answer is "we did not find out", never "it is not in there".
 */
const REFERENCE_SCAN_MAX = 500;

type ReferenceLookup =
  | { status: 'found'; referenceId: string }
  /** The listing was read in full and holds no reference for this material. */
  | { status: 'absent' }
  | { status: 'unknown'; detail: string };

/**
 * Find the REFERENCE node a collection holds for a material.
 *
 * Measured against staging 2026-08-03, and the reason this function exists:
 * `DELETE …/references/{originalId}` answers `200` and removes NOTHING — the
 * reference node was still readable 15 s later and `/usage/v1` still listed the
 * collection. The same call with the REFERENCE id removed it, and the usage
 * endpoint reflected that immediately. The `PUT` that files material takes the
 * ORIGINAL id, so the two directions genuinely need different ids; that
 * asymmetry is invisible in the API and cost this tool its entire function.
 *
 * The listing comes from `/node/v1/nodes/{collection}/children` rather than the
 * collection API's own `children/references`, which is index-backed: measured,
 * it answered `200` with zero rows for a reference that demonstrably existed.
 *
 * Accepts either id from the caller: search hands out originals, a collection
 * listing hands out references, and both reach a curator.
 */
async function findReference(collection: string, nodeId: string): Promise<ReferenceLookup> {
  let scanned = 0;
  for (;;) {
    let page;
    try {
      page = await getCollectionContents(collection, 'files', REFERENCE_PAGE, scanned, ['ccm:original']);
    } catch (err) {
      return {
        status: 'unknown',
        detail: `Der Inhalt der Sammlung „${sanitizeText(collection)}“ war nicht lesbar `
          + `(${err instanceof Error ? err.message : String(err)}).`,
      };
    }

    for (const node of page.nodes) {
      const referenceId = node.ref?.id ?? '';
      const originalId = node.originalId ?? node.properties?.['ccm:original']?.[0] ?? '';
      if (!referenceId) continue;
      if (referenceId === nodeId || originalId === nodeId) return { status: 'found', referenceId };
    }

    scanned += page.nodes.length;
    if (page.nodes.length === 0 || scanned >= (page.pagination.total || scanned)) return { status: 'absent' };
    if (scanned >= REFERENCE_SCAN_MAX) {
      return {
        status: 'unknown',
        detail: `Die Sammlung enthält mehr als ${REFERENCE_SCAN_MAX} Einträge; in den ersten `
          + `${REFERENCE_SCAN_MAX} kommt dieses Material nicht vor. Ob es weiter hinten liegt, ist offen.`,
      };
    }
  }
}

/**
 * Why a removal cannot name a reference — worded once, for both routes.
 *
 * The executing path and the prepared one reach this together, and they are
 * answers to the same question about the same collection. Two wordings would
 * read as two different findings.
 */
function noReference(found: { status: 'absent' } | { status: 'unknown'; detail: string }, nodeId: string): string {
  return found.status === 'unknown'
    ? found.detail
    : `Das Material „${sanitizeText(nodeId)}“ ist nicht in dieser Sammlung enthalten — es wurde nichts geändert.`;
}

/**
 * The removal request as data, for someone else to send.
 *
 * Unlike filing (see {@link addToCollectionRequest}) this cannot be built from
 * the arguments: the endpoint takes the REFERENCE id and the caller names the
 * material. The lookup therefore runs HERE, under our identity — which is the
 * whole argument for preparing rather than publishing a recipe. A page building
 * this request itself would send `DELETE …/references/{originalId}`, and that
 * call is measured to answer 200 while removing nothing (see
 * {@link findReference}).
 */
export async function removeFromCollectionRequest(
  collection: string,
  nodeId: string,
): Promise<PrepareOutcome> {
  const found = await findReference(collection, nodeId);
  if (found.status !== 'found') return { status: 'refused', detail: noReference(found, nodeId) };
  return {
    status: 'ready',
    request: {
      method: 'DELETE',
      path: toRepositoryPath(referencePath(collection, found.referenceId), WLO_REPOSITORY_URL),
    },
  };
}

/**
 * Take material out of a collection.
 *
 * This removes the REFERENCE. The material itself is untouched and stays in
 * every other collection it appears in.
 *
 * The reference is resolved first — see {@link findReference} for the measured
 * reason — and the read-back then asks whether that same reference is gone.
 */
export async function removeFromCollection(collection: string, nodeId: string): Promise<MutationOutcome> {
  const found = await findReference(collection, nodeId);
  if (found.status !== 'found') {
    return {
      status: found.status === 'unknown' ? 'unverified' : 'failed',
      detail: noReference(found, nodeId),
    };
  }

  const res = await wloFetch(
    referencePath(collection, found.referenceId),
    { method: 'DELETE', headers: { Accept: 'application/json' } },
  );
  if (!res.ok) return { status: 'failed', detail: await failureDetail(res) };
  log.info('content removed from collection', { collection, nodeId, referenceId: found.referenceId });

  // Checked on the REFERENCE node, not through `/usage/v1` like the add above.
  // Measured against staging 2026-08-03: once a reference is deleted, the usage
  // endpoint answers `500` ("Node does not exist") for that material — it keeps
  // a row pointing at the reference it can no longer resolve. A material that
  // was never filed answers `200` with zero rows, and the endpoint recovers the
  // moment the material is filed again, so the failure is specific to the one
  // state this check exists to observe. Every successful removal would report
  // `unverified`. The reference's own 404 is the direct evidence anyway.
  const gone = await confirmDeleted(found.referenceId);
  if (gone.status === 'not_visible') {
    return { status: 'not_visible', detail: 'Das Material wird weiterhin als Teil der Sammlung geführt.' };
  }
  return gone;
}

/**
 * Delete a collection.
 *
 * The material it referenced survives — a collection owns references, not
 * content. Its sub-collections do not.
 */
export async function deleteCollection(collection: string): Promise<MutationOutcome> {
  const res = await wloFetch(collectionPath(collection), {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return { status: 'failed', detail: await failureDetail(res) };
  log.warn('collection deleted', { collection });
  return await confirmDeleted(collection);
}
