/**
 * services/write/content-upload.ts – putting bytes on a record, then proving it.
 *
 * The second half of the file-carrying create path: `content-source.ts` decides
 * WHAT is uploaded, this module performs the upload and reads the record back.
 *
 * The request shape is measured, not inferred — `wlo-content-files`, validated
 * 2026-05-08 against production and staging, plus staging's `openapi.json` read
 * 2026-08-06:
 *
 *   POST /node/v1/nodes/-home-/{id}/content?mimetype=…&versionComment=…
 *   multipart/form-data, field `file`
 *
 * `mimetype` is a REQUIRED query parameter there — it is not read off the
 * multipart part — and `Content-Type` must be left to `fetch`, which appends the
 * boundary. Setting it by hand yields a body no server can parse.
 *
 * The single-call variant (`POST …/children/_content`, metadata and bytes in one
 * request) exists in the spec and has never been run. The two-call path is the
 * measured one, and a measured path beats a tidier unmeasured one.
 *
 * **Why the read-back is not optional.** edu-sharing discards writes and answers
 * `200` — the rule this whole pipeline is built around. Here there is finally a
 * cheap signal: a `ccm:io` without binary content reports `size` and
 * `downloadUrl` as null, and both are set once bytes arrive.
 */

import { BASE_URL } from '../../wlo-config.js';
import { wloFetch } from '../../wlo-fetch.js';
import { getNodeMetadata } from '../../wlo-node.js';
import { log } from '../../logger.js';
import { failureDetail } from './nodes.js';
import type { UploadFile } from './content-source.js';
import type { WloNode } from '../../wlo-types.js';

/** Shown in the record's version history as the reason this version exists. */
const UPLOAD_VERSION_COMMENT = 'Inhalt über den WLO-MCP-Server hochgeladen';

export type UploadOutcome =
  /** The record reports exactly the bytes that were sent. */
  | { status: 'stored'; size: number }
  /**
   * The upload was accepted and the record does not show it: no content at all,
   * or — `holds` — still the file it held before, of that many bytes.
   */
  | { status: 'dropped'; holds?: number }
  /** The upload was accepted and what the record shows does not settle whether it landed. */
  | { status: 'unverified'; detail: string }
  /** `httpStatus`: a 4xx wrote nothing, a 5xx is no verdict (`wroteNothing`). */
  | { status: 'failed'; detail: string; httpStatus: number };

/** What a record says about the content it carries — the two values a replacement is judged by. */
export interface ContentState { size: number | null; hash: string }

/** Does this node report binary content? `size` arrives as a number OR a string. */
function storedSize(size: unknown): number | null {
  const n = typeof size === 'string' ? Number(size) : size;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

/** The content state of a node as read — for a caller that holds the record from BEFORE a replacement. */
export function contentStateOf(node: Pick<WloNode, 'size' | 'content'>): ContentState {
  return { size: storedSize(node.size), hash: String(node.content?.hash ?? '') };
}

/**
 * Judge an accepted upload by what the record shows afterwards.
 *
 * "The record has a size" proves a FIRST upload and nothing about a
 * replacement — it had one before (audit 2026-11-14, W1). What is compared is
 * the byte count: measured, the record's size is the uploaded byte count
 * (tests/live/reference-write, 2026-08-16). `content.hash` is used only to tell
 * "changed" from "unchanged": what it is a hash OF is not measured, so it is
 * never compared with a digest of ours.
 */
function judge(sent: number, now: ContentState, before: ContentState | undefined): UploadOutcome {
  if (now.size === null) return { status: 'dropped' };
  const hashUnchanged = Boolean(before?.hash) && now.hash === before!.hash;
  if (now.size === sent) {
    // The one case the size cannot decide: the old file had the same length.
    // Only a hash on BOTH sides that differs proves a change — a missing one
    // is no evidence, and fell through to `stored` (review 2026-11-14).
    const hashChanged = Boolean(before?.hash) && Boolean(now.hash) && now.hash !== before!.hash;
    if (before?.size === sent && !hashChanged) {
      return { status: 'unverified', detail: hashUnchanged
        ? 'Der Datensatz zeigt dieselbe Größe und dieselbe Prüfsumme wie vor dem Hochladen — '
          + 'ob die neue Datei angekommen ist (oder inhaltsgleich war), lässt sich daran nicht ablesen.'
        : 'Der Datensatz zeigt dieselbe Größe wie vor dem Hochladen und keine Prüfsumme, an der sich eine Änderung ablesen ließe — '
          + 'ob die neue Datei angekommen ist, ist offen.' };
    }
    return { status: 'stored', size: now.size };
  }
  // Still what it held: same size, and no hash that says otherwise.
  if (before && before.size === now.size && (hashUnchanged || !before.hash || !now.hash)) {
    return { status: 'dropped', holds: now.size };
  }
  return { status: 'unverified', detail: `Der Datensatz zeigt danach ${now.size} Bytes, gesendet wurden ${sent}.` };
}

/**
 * Attach `file` to an existing `ccm:io`, then read the record back.
 *
 * Never throws for an upstream refusal — the caller has just created a node and
 * needs to report its id either way. A thrown error (a timeout, an unreachable
 * repository) still propagates, because "the answer did not arrive" is not the
 * same as "the repository said no" and the caller distinguishes them.
 *
 * `before`: what the record held before a REPLACEMENT, from the read the caller
 * already made. Without it only "the size is what was sent" can be checked.
 */
export async function uploadContent(
  nodeId: string, file: UploadFile, timeoutMs?: number, before?: ContentState,
): Promise<UploadOutcome> {
  const form = new FormData();
  // Copied into a plain `Uint8Array`: a `Buffer` may be backed by a
  // `SharedArrayBuffer`, which `BlobPart` does not accept. The copy is bounded
  // by MAX_FILE_BYTES and costs nothing at that size.
  form.append('file', new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }), file.fileName);

  const params = new URLSearchParams({
    mimetype: file.mimeType,
    versionComment: UPLOAD_VERSION_COMMENT,
  });
  const res = await wloFetch(
    `${BASE_URL}/node/v1/nodes/-home-/${encodeURIComponent(nodeId)}/content?${params}`,
    // Only `Accept`: `fetch` must set `Content-Type` itself so the multipart
    // boundary matches the body it builds.
    { method: 'POST', headers: { Accept: 'application/json' }, body: form,
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}) },
  );
  if (!res.ok) return { status: 'failed', detail: await failureDetail(res), httpStatus: res.status };

  const node = await getNodeMetadata(nodeId);
  if (!node) {
    return {
      status: 'unverified',
      detail: `Der Datensatz „${nodeId}" war nach dem Hochladen nicht lesbar.`,
    };
  }
  const outcome = judge(file.bytes.length, contentStateOf(node), before);
  if (outcome.status === 'stored') log.info('content uploaded', { nodeId, mimeType: file.mimeType, size: outcome.size });
  else log.warn('content upload not confirmed on the record', { nodeId, mimeType: file.mimeType, outcome: outcome.status });
  return outcome;
}
