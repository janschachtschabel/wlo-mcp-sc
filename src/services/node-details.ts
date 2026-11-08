/**
 * services/node-details.ts – load the detail view of several nodes at once.
 *
 * Moved out of `tools/node-details.ts` (2026-11-06) when `get_node_details`
 * learned `nodeIds` (BOERDi wishlist item 8): two tools answer "the details of
 * these ids", and the caps and the failure rule must be ONE — a second copy is
 * where the full-text bound quietly disappears.
 */

import { readNodeMetadata, type WloNode } from '../wlo-api.js';
import { NOT_EXTRACTED_NOTE, isStoredText, readStoredText } from './content-text.js';
import { formatNode } from '../formatter.js';
import { accessInfo } from '../node-access.js';
import { qualityInfo } from '../node-quality.js';
import { getParentCollections } from './node-collections.js';
import { capText } from '../text-cap.js';
import { mapPool } from '../concurrency.js';
import { failureCode } from './failure-code.js';

/** Full-text cap per node in a bulk answer — the JSON/machine length. */
export const TEXT_CONTENT_CAP = 4000;

/**
 * How many nodes of a bulk call may have their full text fetched.
 *
 * `/textContent` is the slow endpoint (median 4.6 s, max 9.2 s measured — see
 * `wlo-node-text.ts`), so 50 ids at pool width 10 is five waves: ~23 s at the
 * median and ~46 s at the maximum, spent before a single line reaches the
 * caller. The remaining ids are NAMED in the response rather than silently left
 * textless.
 *
 * The cap is about that WAIT, not about a server-side limit. This comment used
 * to say the batch "can outlast the server's own 30 s request timeout"; measured
 * 2026-08-17, `httpServer.requestTimeout` bounds RECEIVING a request and not the
 * work on it — a handler answering after 35 s delivers its response — which is
 * also why this server's SSE streams survive. What gives up is the client, on a
 * budget we cannot see.
 */
export const TEXT_ENRICH_MAX = 20;

export interface NodeDetailOptions {
  includeTextContent?: boolean;
  includeParents?: boolean;
  includeAccessInfo?: boolean;
  includeQualityInfo?: boolean;
}

/**
 * Why an id could not be read — E6's codes, so a caller can tell a deleted record
 * from one the login may not see (review R-C, 2026-11-06).
 */
export type MissingCode = 'not_found' | 'forbidden' | 'timeout' | 'upstream_busy' | 'upstream_error';

/** An HTTP status of a failed node read, as the code both detail answers use. */
export function codeOfStatus(status: number): MissingCode {
  if (status === 404) return 'not_found';
  if (status === 401 || status === 403) return 'forbidden';
  if (status === 429 || status === 503) return 'upstream_busy';
  return 'upstream_error';
}

export interface NodeDetailBatch {
  /** The requested ids, empty ones dropped and duplicates once, in order. */
  ids: string[];
  /** One entry per id that resolved, in request order. */
  results: Map<string, Record<string, unknown>>;
  /** Ids that could not be read (deleted, refused, network). */
  failed: string[];
  /** The same ids with the reason, in the same order. */
  failures: Array<{ id: string; code: MissingCode }>;
  /** Ids whose full text was NOT fetched because of {@link TEXT_ENRICH_MAX}. */
  textSkipped: string[];
}

/**
 * Read every id, enrich on request, and name what failed instead of failing the
 * call — one bad id does not ruin the batch.
 */
export async function loadNodeDetails(nodeIds: string[], opts: NodeDetailOptions = {}): Promise<NodeDetailBatch> {
  const ids = Array.from(new Set(nodeIds.filter(Boolean)));
  // Bounded concurrency (not raw Promise.allSettled) so a 50-id batch does
  // not open 50 simultaneous upstream sockets. mapPool nulls a failed slot.
  const metas = await mapPool(ids, 10, async (id): Promise<{ node: WloNode } | { code: MissingCode }> => {
    try {
      const { node, status } = await readNodeMetadata(id);
      return node ? { node } : { code: codeOfStatus(status) };
    } catch (err) {
      return { code: failureCode(err) };
    }
  });
  const results = new Map<string, Record<string, unknown>>();
  const failed: string[] = [];
  const failures: NodeDetailBatch['failures'] = [];
  const resolvedIds: string[] = [];
  // Kept so the parent lookup can pick the right endpoint per node kind
  // without loading each node a second time.
  const loaded = new Map<string, WloNode>();
  ids.forEach((id, i) => {
    const meta = metas[i];
    const node = meta && 'node' in meta ? meta.node : null;
    if (node) {
      results.set(id, { ...formatNode(node) });
      // Here rather than in the enrichment block below: those cost an
      // upstream call each, this is a projection of properties already in
      // hand (`getNodeMetadata` reads `-all-`).
      if (opts.includeAccessInfo) results.get(id)!['accessInfo'] = accessInfo(node.properties ?? {});
      if (opts.includeQualityInfo) results.get(id)!['qualityInfo'] = qualityInfo(node.properties ?? {});
      resolvedIds.push(id);
      loaded.set(id, node);
    } else {
      failed.push(id);
      failures.push({ id, code: meta && 'code' in meta ? meta.code : 'upstream_error' });
    }
  });

  // Optional per-node enrichment — opt-in, so callers that only want
  // metadata pay zero extra round-trips. Bounded concurrency (matches
  // topic-pages) keeps a 50-node batch from hammering the repository.
  // The full text additionally has a COUNT bound, because concurrency
  // alone does not bound wall-clock (see TEXT_ENRICH_MAX for what that
  // costs the caller). Skipped ids are named, not dropped.
  const textIds = opts.includeTextContent ? resolvedIds.slice(0, TEXT_ENRICH_MAX) : [];
  const textSkipped = opts.includeTextContent ? resolvedIds.slice(TEXT_ENRICH_MAX) : [];
  if (opts.includeTextContent || opts.includeParents) {
    const withText = new Set(textIds);
    await mapPool(resolvedIds, 10, async (id) => {
      if (withText.has(id)) {
        // Never throws: a timeout must not take the parents (same callback) with it.
        const read = await readStoredText(id);
        const text = isStoredText(read.text) ? read.text : null;
        const result = results.get(id)!;
        result['textContent'] = text ? capText(text, TEXT_CONTENT_CAP).text : '';
        // The same three answers the single-node path gives: a failed read, a
        // file the repository gained no text from, or simply nothing stored.
        if (!text && read.status !== 200) {
          result['textContentError'] = `Der Volltext konnte nicht gelesen werden (HTTP ${read.status}).`;
        } else if (!text && Number(result['fileSize'] ?? 0) > 0) {
          result['textContentNote'] = NOT_EXTRACTED_NOTE;
        }
      }
      if (opts.includeParents) {
        const node = loaded.get(id);
        const outcome = node
          ? await getParentCollections(node, id)
          : ({ status: 'unknown', detail: 'Knoten nicht geladen' } as const);
        results.get(id)!['parents'] = outcome.status === 'ok' ? outcome.collections : [];
        if (outcome.status === 'unknown') results.get(id)!['parentsError'] = outcome.detail;
      }
      return null;
    });
  }

  return { ids, results, failed, failures, textSkipped };
}
