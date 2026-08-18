/**
 * services/write/verify.ts – believe the repository's data, not its status code.
 *
 * Step 6 of the write pipeline, and the one that cannot be skipped. edu-sharing
 * answers `200` in three measured situations where the value never lands: the
 * MDS filters the property out, the node lacks the Alfresco aspect that carries
 * it, and the caller lacks the write right. None of the three is visible in the
 * write response, so the only honest way to report a result is to read the node
 * back and compare.
 *
 * The three outcomes are kept apart because the advice differs:
 *   stored  — the value is in the record.
 *   dropped — the record still holds what it held. Something discarded it.
 *   changed — the record holds a third value: the repository derived or
 *             normalised it. Not a failure, but not what was asked for either.
 */

import { BASE_URL } from '../../wlo-config.js';
import { wloFetch } from '../../wlo-fetch.js';
import { getNodeMetadata } from '../../wlo-node.js';
import { log } from '../../logger.js';
import type { ChangeSet } from './change-set.js';

export type FieldOutcome = 'stored' | 'dropped' | 'changed';

/**
 * The result of reading back a mutation that changes no PROPERTY — creating a
 * collection, renaming it, filing a reference, deleting a record. `verifyWrite`
 * compares values; these four change something a value comparison cannot see,
 * so each names its own check and they all answer in this shape.
 *
 * The three non-ok cases are kept apart because they permit different sentences:
 * `failed` means nothing happened, `not_visible` means the call was taken and
 * the record does not show it, `unverified` means we do not know.
 */
export type MutationOutcome =
  | { status: 'ok' }
  | { status: 'failed'; detail: string }
  | { status: 'not_visible'; detail: string }
  | { status: 'unverified'; detail: string };

/**
 * Is the node gone?
 *
 * Answers on the HTTP status rather than through `getNodeMetadata`, which folds
 * every non-OK response into `null`. After a deletion that fold is exactly the
 * wrong shape: a 500 would read as "no longer there" and confirm a deletion the
 * repository may not have performed.
 */
export async function confirmDeleted(nodeId: string): Promise<MutationOutcome> {
  const url = `${BASE_URL}/node/v1/nodes/-home-/${encodeURIComponent(nodeId)}/metadata?propertyFilter=cm:name`;
  let res: Response;
  try {
    res = await wloFetch(url, { headers: { Accept: 'application/json' } });
  } catch (err) {
    // The check itself failed — a timeout or a dropped socket. This runs AFTER a
    // DELETE the repository accepted, so letting the throw escape would surface
    // as "could not be deleted" over a record that is very likely gone. Unknown
    // is its own answer, and the type has a case for it.
    return {
      status: 'unverified',
      detail: `Die Kontrolle, ob „${nodeId}“ wirklich verschwunden ist, war nicht möglich ` +
        `(${err instanceof Error ? err.message : String(err)}).`,
    };
  }
  if (res.status === 404) return { status: 'ok' };
  if (res.ok) {
    return { status: 'not_visible', detail: `Der Eintrag „${nodeId}“ ist im Repository weiterhin lesbar.` };
  }
  return {
    status: 'unverified',
    detail: `Die Kontrolle, ob „${nodeId}“ wirklich verschwunden ist, war nicht möglich (HTTP ${res.status}).`,
  };
}

export interface VerifyResult {
  outcomes: Record<string, FieldOutcome>;
  /** True only when every field of the change set is `stored`. */
  allStored: boolean;
}

function sameValues(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Re-read the node and classify every field of the change set.
 *
 * Throws when the node cannot be read: a write whose result is unknown must not
 * be reported as either success or failure, and a caller that gets a value back
 * would have no way to tell the difference.
 *
 * The node comes from the change set and is not a parameter of its own. It used
 * to be one, and every caller passed exactly what `cs.nodeId` already held — a
 * second way to name the node with no second thing to say. Once writes can be
 * redirected from a reference to the original (`resolveWriteTarget`), that
 * parameter is the place where a check would silently be run against the node
 * the caller NAMED rather than the one that was written, which is precisely the
 * false success this whole step exists to prevent.
 */
export async function verifyWrite(cs: ChangeSet): Promise<VerifyResult> {
  if (cs.changes.length === 0) return { outcomes: {}, allStored: true };

  const nodeId = cs.nodeId;
  const node = await getNodeMetadata(nodeId);
  if (!node) {
    throw new Error(
      `Die Änderung an „${nodeId}“ konnte nicht überprüft werden — der Datensatz war zur Kontrolle nicht lesbar. ` +
        'Ob sie gespeichert wurde, ist damit offen; bitte den Datensatz direkt ansehen.',
    );
  }

  const current = node.properties ?? {};
  const outcomes: Record<string, FieldOutcome> = {};

  for (const change of cs.changes) {
    const now = current[change.property] ?? [];
    const after = change.after ?? [];
    const before = change.before ?? [];
    if (sameValues(now, after)) {
      outcomes[change.property] = 'stored';
    } else if (sameValues(now, before)) {
      outcomes[change.property] = 'dropped';
    } else {
      outcomes[change.property] = 'changed';
    }
  }

  const dropped = Object.entries(outcomes).filter(([, o]) => o === 'dropped').map(([p]) => p);
  if (dropped.length > 0) {
    // The signal that an MDS or aspect assumption was wrong. Property names
    // only — the values belong to the record, not to the log.
    log.warn('write silently discarded by the repository', { nodeId, properties: dropped });
  }

  return {
    outcomes,
    allStored: Object.values(outcomes).every(o => o === 'stored'),
  };
}
