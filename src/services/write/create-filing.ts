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

import { collectionTitleFromProperties } from '../../node-match.js';
import { isCollectionNode } from '../../node-kind.js';
import { getNodeMetadata } from '../../wlo-api.js';
import { getNodeCollections } from '../node-collections.js';
import { addToCollection } from './collections.js';
import { isOutcomeOpen } from './timeouts.js';

export interface FilingTarget {
  nodeId: string;
  title: string;
  /**
   * The caller may READ this collection and not WRITE it (`access` on its DTO,
   * measured 2026-11-14): a filing would answer 403, a proposal 200. Absent
   * where the DTO does not say — then nothing is assumed.
   */
  readOnly?: true;
}

export type FilingCode = 'forbidden' | 'not_found' | 'timeout' | 'not_visible' | 'upstream_busy' | 'upstream_error';

export interface FilingOutcome {
  nodeId: string;
  status: 'added' | 'already' | 'failed' | 'unverified';
  code?: FilingCode;
}

/**
 * The collection as the preview names it — or why it cannot be one. Checked
 * BEFORE the preview: a material id passed as the collection would otherwise
 * create a record and then fail to file it, a partial result nobody needed.
 * A collection is told by its aspect, not by `ccm:map` — crawler, workspace and
 * page-config folders are maps too (`node-kind.ts`, measured 2026-11-12).
 */
export async function readFilingTarget(
  collectionId: string,
): Promise<{ ok: true; target: FilingTarget } | { ok: false; reason: 'not_found' | 'not_a_collection' }> {
  const node = await getNodeMetadata(collectionId);
  if (!node) return { ok: false, reason: 'not_found' };
  if (!isCollectionNode(node)) return { ok: false, reason: 'not_a_collection' };
  const p = node.properties ?? {};
  return {
    ok: true,
    target: {
      nodeId: collectionId, title: collectionTitleFromProperties(p) || collectionId,
      ...(Array.isArray(node.access) && !node.access.includes('Write') ? { readOnly: true as const } : {}),
    },
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
      case 'failed': return outcome.httpStatus === 409
        // Measured 2026-11-14: the same filing again answers 409 and makes no second reference.
        ? { ...base, status: 'already' }
        : {
        ...base,
        status: 'failed',
        code: outcome.httpStatus === 403 || outcome.httpStatus === 401 ? 'forbidden'
          : outcome.httpStatus === 404 ? 'not_found'
            : outcome.httpStatus === 429 || outcome.httpStatus === 503 ? 'upstream_busy' : 'upstream_error',
      };
    }
  } catch (err) {
    // An abort hits the RESPONSE, not the work: the filing may well have
    // happened, so it is reported as open, never as failed.
    return isOutcomeOpen(err)
      ? { ...base, status: 'unverified', code: 'timeout' }
      : { ...base, status: 'failed', code: 'upstream_error' };
  }
}
