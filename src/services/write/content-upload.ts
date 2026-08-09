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

/** Shown in the record's version history as the reason this version exists. */
const UPLOAD_VERSION_COMMENT = 'Inhalt über den WLO-MCP-Server hochgeladen';

export type UploadOutcome =
  /** The record reports binary content afterwards. */
  | { status: 'stored'; size: number }
  /** The upload was accepted and the record still shows no content. */
  | { status: 'dropped' }
  /** The upload was accepted and the record could not be re-read. */
  | { status: 'unverified'; detail: string }
  | { status: 'failed'; detail: string };

/** Does this node report binary content? `size` arrives as a number OR a string. */
function storedSize(size: unknown): number | null {
  const n = typeof size === 'string' ? Number(size) : size;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Attach `file` to an existing `ccm:io`, then read the record back.
 *
 * Never throws for an upstream refusal — the caller has just created a node and
 * needs to report its id either way. A thrown error (a timeout, an unreachable
 * repository) still propagates, because "the answer did not arrive" is not the
 * same as "the repository said no" and the caller distinguishes them.
 */
export async function uploadContent(nodeId: string, file: UploadFile): Promise<UploadOutcome> {
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
    { method: 'POST', headers: { Accept: 'application/json' }, body: form },
  );
  if (!res.ok) return { status: 'failed', detail: await failureDetail(res) };

  const node = await getNodeMetadata(nodeId);
  if (!node) {
    return {
      status: 'unverified',
      detail: `Der Datensatz „${nodeId}" war nach dem Hochladen nicht lesbar.`,
    };
  }
  const size = storedSize(node.size);
  if (size === null) {
    log.warn('content upload not visible on the record', { nodeId, mimeType: file.mimeType });
    return { status: 'dropped' };
  }
  log.info('content uploaded', { nodeId, mimeType: file.mimeType, size });
  return { status: 'stored', size };
}
