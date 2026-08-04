/**
 * wlo-node-text.ts – reading a node's TEXT, as opposed to its metadata.
 *
 * Split out of `wlo-node.ts` when that file passed 300 lines. The endpoints here
 * share concerns the metadata endpoints do not have: they are slow enough to
 * need their own timeout budget, they answer with a body that may be arbitrarily
 * large, and they must therefore be read under a byte cap with the UTF-8 care
 * that a byte-boundary cut demands.
 *
 * Two different sources, deliberately separate: `/textContent` is what the
 * repository EXTRACTED and indexed, while `eduservlet/download` hands back the
 * uploaded file verbatim — the right source for an uploaded Markdown "skill".
 */

import { BASE_URL, WLO_REPOSITORY_URL } from './wlo-config.js';
import { wloFetch } from './wlo-fetch.js';
import { readJson } from './read-json.js';
import { TRUNCATION_MARKER } from './text-cap.js';


/** Anonymous binary-download URL for a node's uploaded file (works without auth). */
function buildDownloadUrl(nodeId: string): string {
  return `${WLO_REPOSITORY_URL}/eduservlet/download?nodeId=${encodeURIComponent(nodeId)}`;
}

/**
 * GET /node/v1/nodes/-home-/{nodeId}/textContent
 * Returns the stored full-text content of a node (web page text, PDF extract, etc.).
 *
 * @param timeoutMs optional override. This endpoint is slow — median 4.6 s,
 *   maximum 9.2 s across a 32-record live sample (2026-07-28) — which the
 *   default 10 s budget would cut off, losing a text that exists. Callers whose
 *   purpose IS the full text pass the larger `WLO_TEXT_TIMEOUT_MS`.
 */
export async function getNodeTextContent(
  nodeId: string,
  timeoutMs?: number,
): Promise<string | null> {
  return (await readNodeTextContent(nodeId, timeoutMs)).text;
}

/**
 * Same read, but reporting the HTTP status alongside the text.
 *
 * "Nothing stored" and "you may not read this" are different answers with
 * different remedies, and the plain accessor above collapses both to null.
 * Live-verified 2026-07-28: 4 of 9 edu-sharing-hosted binaries answer 403 here
 * AND on their download URL — no converter can help with those, only rights can.
 */
export async function readNodeTextContent(
  nodeId: string,
  timeoutMs?: number,
): Promise<{ text: string | null; status: number }> {
  const url = `${BASE_URL}/node/v1/nodes/-home-/${encodeURIComponent(nodeId)}/textContent`;
  const res = await wloFetch(url, {
    headers: { Accept: 'application/json' },
    ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
  });
  if (!res.ok) return { text: null, status: res.status };
  const data = await readJson<{ content?: string; text?: string }>(res, 'readNodeTextContent');
  return { text: data?.content ?? data?.text ?? null, status: res.status };
}

/**
 * Fetch a node's uploaded file as raw text via its anonymous `downloadUrl`
 * (`eduservlet/download`). Unlike `getNodeTextContent` (extracted/indexed text),
 * this returns the file verbatim — the right source for an uploaded Markdown
 * "skill". Returns null on a non-OK response.
 */
/** Byte cap for anonymous file downloads — bounds memory and model-context use. */
const DOWNLOAD_TEXT_CAP_BYTES = 64 * 1024;
const DOWNLOAD_TRUNCATION_MARKER = TRUNCATION_MARKER;

export async function getNodeDownloadText(
  nodeId: string,
  maxBytes: number = DOWNLOAD_TEXT_CAP_BYTES,
): Promise<string | null> {
  const res = await wloFetch(buildDownloadUrl(nodeId), {
    headers: { Accept: 'text/markdown, text/plain, */*' },
  });
  if (!res.ok) return null;

  // Bounded read: stop after maxBytes and cancel the stream, so a large uploaded
  // file cannot exhaust server memory or flood the model context window. Falls
  // back to a capped full read when the body stream is unavailable.
  if (!res.body) {
    const buf = Buffer.from(await res.text(), 'utf-8');
    if (buf.length <= maxBytes) return buf.toString('utf-8');
    return decodeTruncated(buf.subarray(0, maxBytes)) + DOWNLOAD_TRUNCATION_MARKER;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (received + value.length > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - received));
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    received += value.length;
  }
  const buf = Buffer.concat(chunks.map(c => Buffer.from(c)));
  return truncated
    ? decodeTruncated(buf) + DOWNLOAD_TRUNCATION_MARKER
    : buf.toString('utf-8');
}

/**
 * Decode a buffer that was cut at an arbitrary BYTE offset. The cut can land
 * inside a multi-byte sequence — common in German text — which decodes to a
 * trailing U+FFFD; drop it so the truncation marker follows clean text. Only
 * used on the truncated path, so a replacement character that is genuinely part
 * of the source is never removed.
 */
function decodeTruncated(buf: Buffer): string {
  const s = buf.toString('utf-8');
  return s.endsWith('�') ? s.slice(0, -1) : s;
}
