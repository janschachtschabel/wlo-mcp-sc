/**
 * services/node-details.ts – load the detail view of several nodes at once.
 *
 * Moved out of `tools/node-details.ts` (2026-11-06) when `get_node_details`
 * learned `nodeIds` (BOERDi wishlist item 8): two tools answer "the details of
 * these ids", and the caps and the failure rule must be ONE — a second copy is
 * where the full-text bound quietly disappears.
 */

import { WLO_REPOSITORY_URL, readNodeMetadata, type WloNode } from '../wlo-api.js';
import { NOT_EXTRACTED_NOTE, fileTextFor, isStoredText, readStoredText, storedTextAnswered } from './content-text.js';
import { formatNode, type FormattedNode } from '../formatter.js';
import { accessInfo } from '../node-access.js';
import { qualityInfo } from '../node-quality.js';
import { getParentCollections, type ParentCollectionsOutcome } from './node-collections.js';
import { ensureRegistries } from './skill-registry-cache.js';
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
 * The stored full text of one node as the fields a detail answer carries — ONE
 * rule for the single-node and the many-node path, which each had a copy of it
 * (audit 2026-11-12, A-1). Three different answers, never one empty string:
 * the text (capped); a read that FAILED (`textContentError`); a file the
 * repository gained no text from (`textContentNote`); and plain `''` for
 * nothing stored. Never throws: a timeout must not take a sibling enrichment
 * with it.
 */
export async function storedTextFields(nodeId: string, file: StoredFile): Promise<Record<string, string>> {
  return (await readStoredTextAnswer(nodeId, file)).fields;
}

/** What the file fallback needs to know about the record (`fileTextFor`). */
export interface StoredFile { fileSize?: number; mimeType?: string; linked: boolean }

/**
 * The same, read off a formatted node. Its `url` is the linked address
 * (`ccm:wwwurl`) or, for a file, the repository's own content URL — so a
 * record is LINKED when the address leads anywhere else.
 */
export function storedFileOf(n: { fileSize?: unknown; mimeType?: unknown; url?: unknown }): StoredFile {
  const url = typeof n.url === 'string' ? n.url : '';
  return {
    fileSize: Number(n.fileSize ?? 0), mimeType: String(n.mimeType ?? ''),
    linked: url !== '' && !url.startsWith(WLO_REPOSITORY_URL),
  };
}

/**
 * The same read with its raw outcome beside the fields: the Markdown rendering
 * of the single-node tool prints the text at its own (larger) cap and names the
 * HTTP status in a sentence.
 */
export async function readStoredTextAnswer(
  nodeId: string, file: StoredFile,
): Promise<{ text: string | null; status: number; fields: Record<string, string> }> {
  const read = await readStoredText(nodeId);
  const answered = storedTextAnswered(read);
  // Blank or binary debris is no text — the rule `get_wlo_content_text` applies,
  // and so does its way out for a file that IS text (a public Markdown file).
  const text = isStoredText(read.text) ? read.text
    : answered ? (await fileTextFor(nodeId, file))?.text ?? null : null;
  // A 200 that names no text field is no answer about the record either.
  const fields: Record<string, string> = text ? { textContent: capText(text, TEXT_CONTENT_CAP).text }
    : !answered ? { textContent: '', textContentError: read.status === 200
      ? 'Der Volltext konnte nicht gelesen werden (die Antwort des Repositorys nennt keinen Text).'
      : `Der Volltext konnte nicht gelesen werden (HTTP ${read.status}).` }
      : Number(file.fileSize ?? 0) > 0 ? { textContent: '', textContentNote: NOT_EXTRACTED_NOTE } : { textContent: '' };
  return { text, status: read.status, fields };
}

/** One record, read, with what was asked for beside it — or the status that says why not. */
export type SingleNodeDetail =
  | { found: false; status: number }
  | {
      found: true;
      node: WloNode;
      formatted: FormattedNode;
      /** The stored text and how its read ended; a neutral value when it was not asked for. */
      textRead: { text: string | null; status: number; fields: Record<string, string> };
      parentOutcome: ParentCollectionsOutcome;
    };

/**
 * Read one record for `get_node_details`. The reads live here and the rendering
 * in the tool: its handler did both in two hundred lines (audit 2026-11-12,
 * A-1/A-5), and a tool module holds a schema and a rendering, never the loading.
 */
export async function loadSingleNodeDetail(
  nodeId: string, opts: { includeTextContent?: boolean; includeParents?: boolean } = {},
): Promise<SingleNodeDetail> {
  const { node, status } = await readNodeMetadata(nodeId);
  if (!node) return { found: false, status };

  const formatted = formatNode(node);
  // A collection's approved skills belong to the record being detailed, so
  // they are attached to it rather than added beside it: both output
  // formats and the widget then carry them without a second rule. A no-op
  // for a material — `ensureRegistries` skips anything that is not a
  // collection.
  await ensureRegistries([formatted]);

  // The text read reports its status: "nothing stored" and "we could not read
  // it" are different answers, and only the first is a statement about the
  // material.
  const textRead = opts.includeTextContent
    ? await readStoredTextAnswer(nodeId, storedFileOf(formatted))
    : { text: null, status: 200, fields: {} };
  // Not `/parents`: that endpoint carries ancestors for a collection and
  // an empty list for a material, so it answered "in no collection" for
  // records that were in several. See `getParentCollections`.
  const parentOutcome: ParentCollectionsOutcome = opts.includeParents
    ? await getParentCollections(node, nodeId)
    : { status: 'ok', collections: [] };
  return { found: true, node, formatted, textRead, parentOutcome };
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
        const result = results.get(id)!;
        Object.assign(result, await storedTextFields(id, storedFileOf(result)));
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
