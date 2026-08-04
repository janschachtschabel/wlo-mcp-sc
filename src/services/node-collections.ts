/**
 * services/node-collections.ts – which collections carry this material?
 *
 * The reverse of everything else in this server: collections → content is the
 * normal direction (search, drilldown, topic pages), and this is the one path
 * that runs the other way.
 *
 * **The trap it exists to handle.** When material is filed into a collection,
 * edu-sharing creates a REFERENCE node with its own id; the original stays put.
 * Collection listings hand out those reference ids. The usage endpoint only
 * knows the original — and given a reference it answers `200` with an empty
 * array rather than an error. So the id is resolved to the original FIRST,
 * always. A "try it, resolve on empty" fallback was considered and rejected: an
 * empty array is a legitimate answer ("in no collection"), and treating it as
 * "probably a reference" would make the normal case slow and the empty case
 * ambiguous.
 *
 * Measured 2026-08-01 against production, anonymously — the reference answered
 * with 0 entries, the original with 2.
 */

import { BASE_URL } from '../wlo-config.js';
import { wloFetch } from '../wlo-fetch.js';
import { readJson } from '../read-json.js';
import type { WloNode } from '../wlo-types.js';
import { readNodeMetadata, readNodeParents } from '../wlo-node.js';
import { formatNode, type FormattedNode } from '../formatter.js';
import { log } from '../logger.js';

/** Why the list is empty, when it is. Mirrors the full-text tool's convention. */
export type NodeCollectionsReason = 'not_in_any_collection';

export interface NodeCollectionsResult {
  /** The ORIGINAL node id the lookup ran against. */
  nodeId: string;
  /** What the caller passed in — different when it was a reference. */
  requestedNodeId: string;
  wasReference: boolean;
  title: string;
  collections: FormattedNode[];
  /** Present only when `collections` is empty. */
  reason?: NodeCollectionsReason;
}

/** One entry of `GET /usage/v1/usages/node/{id}/collections` (a bare array). */
interface CollectionUsage {
  collectionUsageType?: string;
  collection?: WloNode;
}

/** The id the usage endpoint knows: a reference points at its original. */
function originalIdOf(node: WloNode, fallback: string): string {
  return node.originalId ?? node.properties?.['ccm:original']?.[0] ?? fallback;
}

/**
 * The ACTIVE collection usages of an ORIGINAL node id.
 *
 * Throws on an upstream failure rather than degrading to an empty list: "we
 * could not find out" must not reach the user as "it is in no collection".
 */
async function fetchUsageCollections(originalId: string): Promise<FormattedNode[]> {
  const url = `${BASE_URL}/usage/v1/usages/node/${encodeURIComponent(originalId)}/collections`;
  const res = await wloFetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(
      `Die Sammlungen zu diesem Material konnten nicht ermittelt werden (HTTP ${res.status}).`,
    );
  }
  const usages = await readJson<CollectionUsage[]>(res, 'fetchUsageCollections');
  if (usages === null) {
    throw new Error(
      'Die Sammlungen zu diesem Material konnten nicht ermittelt werden — das Repository hat ' +
        'keine verwertbare Antwort geliefert.',
    );
  }
  return (Array.isArray(usages) ? usages : [])
    .filter(u => u.collectionUsageType === 'ACTIVE')
    .map(u => u.collection)
    .filter((c): c is WloNode => Boolean(c))
    .map(formatNode);
}

/**
 * The collections a material is filed in, or null when the node does not exist.
 *
 * `null` versus an empty list is the distinction that matters for the answer a
 * person gets: "there is no such record" and "this record is in no collection"
 * are different statements. The usage endpoint alone cannot tell them apart —
 * it answers `500` for an unknown id on both production and staging (measured)
 * — but resolving the node first can, because that fails with `404`.
 *
 * @returns the result, or `null` for a `404` — the only status that means the
 *   record is absent.
 * @throws when the node or its usages could not be read at all (401/403/5xx, or
 *   an unparseable body). Callers must not turn that into a statement.
 */
export async function getNodeCollections(nodeId: string): Promise<NodeCollectionsResult | null> {
  // `null` is reserved for the ONE status that supports "there is no such
  // record". A refused or failed metadata read throws instead, exactly as the
  // usage read below does: both callers already treat a throw as "could not
  // verify", and the alternative — folding 403 into null — turns a rights
  // problem into the claim that the material does not exist.
  const { node, status } = await readNodeMetadata(nodeId);
  if (!node) {
    if (status === 404) return null;
    throw new Error(
      `Das Material „${nodeId}“ war nicht lesbar (HTTP ${status || 'keine verwertbare Antwort'}); `
        + 'ob es existiert, sagt das nicht.',
    );
  }

  const original = originalIdOf(node, nodeId);
  const collections = await fetchUsageCollections(original);

  const result: NodeCollectionsResult = {
    nodeId: original,
    requestedNodeId: nodeId,
    wasReference: original !== nodeId,
    title: formatNode(node).title,
    collections,
  };
  if (collections.length === 0) result.reason = 'not_in_any_collection';

  log.info('node collections resolved', {
    requested: nodeId, original, wasReference: result.wasReference, count: collections.length,
  });
  return result;
}

/** One containing collection, in the shape the node-detail tools report. */
export interface ParentCollection {
  nodeId: string;
  title: string;
}

export type ParentCollectionsOutcome =
  | { status: 'ok'; collections: ParentCollection[] }
  /** The lookup failed. Neither "in none" nor a list may be claimed. */
  | { status: 'unknown'; detail: string };

/**
 * The collections a node sits in — from whichever endpoint actually knows.
 *
 * This exists because the two node kinds answer through different endpoints and
 * only one of them fails loudly:
 *
 *   collection (`ccm:map`) → `/parents` carries its ancestor chain
 *   material   (`ccm:io`)  → `/parents` answers 200 with an EMPTY list, always
 *
 * Reading `/parents` for a material therefore produced "in no collection" for a
 * record that was in several — a false statement, not a missing one, and the
 * kind a model repeats to a user with confidence. The containing collections of
 * a material live behind `/usage/v1`.
 *
 * Takes the already-loaded node so the caller does not pay for a second read.
 */
export async function getParentCollections(
  node: WloNode,
  nodeId: string,
): Promise<ParentCollectionsOutcome> {
  const isCollection = formatNode(node).nodeType === 'collection';

  if (isCollection) {
    // `ok` is read, not inferred from emptiness: /parents degrades to [] on a
    // refused or unparseable read, and "in no collection" is a claim about the
    // record that a failed read may not make. See readNodeParents.
    const { ok, nodes: parents, status } = await readNodeParents(nodeId);
    if (!ok) {
      return {
        status: 'unknown',
        detail: `Die Eltern-Sammlungen konnten nicht gelesen werden (HTTP ${status}).`,
      };
    }
    return {
      status: 'ok',
      collections: parents.map(p => ({
        nodeId: p.ref?.id ?? '',
        title: p.properties?.['cclom:title']?.[0] ?? p.properties?.['cm:name']?.[0] ?? p.name ?? '',
      })),
    };
  }

  try {
    const collections = await fetchUsageCollections(originalIdOf(node, nodeId));
    return { status: 'ok', collections: collections.map(c => ({ nodeId: c.nodeId, title: c.title })) };
  } catch (err) {
    return { status: 'unknown', detail: err instanceof Error ? err.message : String(err) };
  }
}
