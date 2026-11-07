/**
 * services/write/create-filing.ts – file a record in a collection as part of
 * the confirmation that creates it (BOERDi wishlist item 4, 2026-11-06).
 *
 * The step itself is `addToCollection`, the same call `wlo_add_to_collection`
 * makes, with its read-back. What this module adds is the OUTCOME a caller can
 * act on: `added`, `failed` with a code, or `unverified` — and, for a filing
 * that is not possible, the statement that the record stays. A filing that fails
 * after the create is a partial result, never a reason to undo the record.
 */

import { getNodeMetadata } from '../../wlo-api.js';
import { getNodeCollections } from '../node-collections.js';
import { addToCollection } from './collections.js';
import { isUpstreamTimeout } from './timeouts.js';

export interface FilingTarget {
  nodeId: string;
  title: string;
}

export type FilingCode = 'forbidden' | 'not_found' | 'timeout' | 'not_visible' | 'upstream_error';

export interface FilingOutcome {
  nodeId: string;
  status: 'added' | 'already' | 'failed' | 'unverified';
  code?: FilingCode;
}

/**
 * The collection as the preview names it — or why it cannot be one. Checked
 * BEFORE the preview: a material id passed as the collection would otherwise
 * create a record and then fail to file it, a partial result nobody needed.
 * `ccm:map` is necessary, not sufficient (crawler folders are maps too); the
 * filing's own read-back catches the rest.
 */
export async function readFilingTarget(
  collectionId: string,
): Promise<{ ok: true; target: FilingTarget } | { ok: false; reason: 'not_found' | 'not_a_collection' }> {
  const node = await getNodeMetadata(collectionId);
  if (!node) return { ok: false, reason: 'not_found' };
  if (node.type !== 'ccm:map') return { ok: false, reason: 'not_a_collection' };
  const p = node.properties ?? {};
  return {
    ok: true,
    target: { nodeId: collectionId, title: p['cclom:title']?.[0] ?? p['cm:title']?.[0] ?? p['cm:name']?.[0] ?? collectionId },
  };
}

/**
 * Is the record already in this collection? `null` when that could not be found
 * out — the caller then files anyway rather than claiming either answer.
 */
export async function isAlreadyFiled(nodeId: string, collectionId: string): Promise<boolean | null> {
  try {
    const listed = await getNodeCollections(nodeId);
    return listed ? listed.collections.some(c => c.nodeId === collectionId) : null;
  } catch {
    return null;
  }
}

/** File `nodeId` in the collection and report what is now true. Never throws. */
export async function fileRecord(nodeId: string, target: FilingTarget): Promise<FilingOutcome> {
  const base = { nodeId: target.nodeId };
  try {
    const outcome = await addToCollection(target.nodeId, nodeId);
    switch (outcome.status) {
      case 'ok': return { ...base, status: 'added' };
      case 'not_visible': return { ...base, status: 'unverified', code: 'not_visible' };
      case 'unverified': return { ...base, status: 'unverified', code: 'upstream_error' };
      case 'failed': return {
        ...base,
        status: 'failed',
        code: outcome.httpStatus === 403 || outcome.httpStatus === 401 ? 'forbidden'
          : outcome.httpStatus === 404 ? 'not_found' : 'upstream_error',
      };
    }
  } catch (err) {
    // An abort hits the RESPONSE, not the work: the filing may well have
    // happened, so it is reported as open, never as failed.
    return isUpstreamTimeout(err)
      ? { ...base, status: 'unverified', code: 'timeout' }
      : { ...base, status: 'failed', code: 'upstream_error' };
  }
}
