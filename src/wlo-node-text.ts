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
import { log } from './logger.js';


/** Download URL for a node's uploaded file. Needs no login for a PUBLIC record; no login opens a private one (403, measured). */
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
 * The most of a `/textContent` answer that is read. The answer is ONE JSON
 * value holding the whole text, and its size is the uploader's choice: a 50 MB
 * text file answered 52 428 837 characters (staging, 2026-11-13), all of it
 * taken into memory — as bytes and again as a string — for tools whose largest
 * answer is 200 000 characters. Past the bound the read stops and `cut` says
 * so; what was read is still the beginning of the text.
 */
export const TEXT_CONTENT_MAX_BYTES = 4 * 1024 * 1024;

/**
 * The text out of a JSON answer that was cut mid-string: `{"text":"…` or
 * `{"content":"…` without its end. Any other shape is no answer (null) — a
 * guess at what a foreign body means is worse than none. The cut may sit inside
 * an escape (`\u00e`), so the tail is shortened until the string parses.
 *
 * `whole` is set when only the END of the document fell past the bound (the
 * closing brace, a newline): the text itself is complete then, and calling it
 * cut would make a caller refuse or caveat a text that lacks nothing.
 */
function textFromCutJson(raw: string): { text: string; whole: boolean } | null {
  const head = /^\s*\{\s*"(?:text|content)"\s*:\s*"/.exec(raw);
  if (!head) return null;
  for (const tail of ['', '}']) {
    try {
      const doc = JSON.parse(raw + tail) as { text?: unknown; content?: unknown };
      const text = doc.content ?? doc.text;
      if (typeof text === 'string') return { text, whole: true };
    } catch { /* really cut */ }
  }
  const inner = raw.slice(head[0].length);
  for (let drop = 0; drop <= 6 && drop <= inner.length; drop++) {
    try {
      const text: unknown = JSON.parse(`"${inner.slice(0, inner.length - drop)}"`);
      if (typeof text === 'string') return { text, whole: false };
    } catch { /* one character shorter */ }
  }
  return null;
}

/**
 * Read a body up to `maxBytes`, then stop and cancel the stream. A response
 * WITHOUT a body stream (204/205 with real fetch — empty) is read in full and
 * cut afterwards; that branch bounds the result, not the read.
 */
async function readBounded(res: Response, maxBytes: number): Promise<{ bytes: Buffer; truncated: boolean }> {
  if (!res.body) {
    const buf = Buffer.from(await res.text(), 'utf-8');
    return buf.length <= maxBytes ? { bytes: buf, truncated: false } : { bytes: buf.subarray(0, maxBytes), truncated: true };
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
  return { bytes: Buffer.concat(chunks), truncated };
}

/**
 * Same read, but reporting the HTTP status alongside the text.
 *
 * "Nothing stored" and "you may not read this" are different answers with
 * different remedies, and the plain accessor above collapses both to null.
 * Live-verified 2026-07-28: 4 of 9 edu-sharing-hosted binaries answer 403 here
 * AND on their download URL — no converter can help with those, only rights can.
 *
 * `none` is set when the repository ANSWERED that there is no text —
 * `{"text":null}`, what it says for a file it extracts nothing from (Markdown,
 * an image; measured 2026-11-13). A body that names neither field is a
 * different thing: no answer at all.
 */
export async function readNodeTextContent(
  nodeId: string,
  timeoutMs?: number,
): Promise<{ text: string | null; status: number; none?: true; cut?: true }> {
  const url = `${BASE_URL}/node/v1/nodes/-home-/${encodeURIComponent(nodeId)}/textContent`;
  const res = await wloFetch(url, {
    headers: { Accept: 'application/json' },
    ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
  });
  if (!res.ok) return { text: null, status: res.status };
  const body = await readBounded(res, TEXT_CONTENT_MAX_BYTES);
  if (body.truncated) {
    const read = textFromCutJson(decodeTruncated(body.bytes));
    if (read?.whole) return { text: read.text, status: res.status };
    log.warn('stored text larger than the bound — read cut', { nodeId, maxBytes: TEXT_CONTENT_MAX_BYTES, decoded: read !== null });
    return read === null ? { text: null, status: res.status } : { text: read.text, status: res.status, cut: true };
  }
  const data = await readJson<{ content?: string; text?: string }>(new Response(new Uint8Array(body.bytes)), 'readNodeTextContent');
  const text = data?.content ?? data?.text ?? null;
  const none = text === null && data !== null && ('text' in data || 'content' in data);
  return { text, status: res.status, ...(none ? { none: true as const } : {}) };
}

/**
 * Fetch a node's uploaded file as raw text via its `downloadUrl`
 * (`eduservlet/download`), reading at most `maxBytes`. Unlike
 * `getNodeTextContent` (extracted/indexed text) this is the file verbatim — the
 * right source for an uploaded Markdown "skill". `null` on a non-OK response.
 *
 * It says WHETHER it was cut instead of marking the text: its one caller treats
 * a cut instruction as worse than none and refuses the whole thing
 * (`readSkillText`). `text` is what was read up to the bound. (A marker-appending
 * wrapper with a 64-KiB default existed until 2026-11-12; nothing used it.)
 */
export async function readNodeDownload(
  nodeId: string,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean } | null> {
  const res = await wloFetch(buildDownloadUrl(nodeId), {
    headers: { Accept: 'text/markdown, text/plain, */*' },
  });
  if (!res.ok) return null;

  // Bounded read, so a large uploaded file cannot exhaust server memory or
  // flood the model context window.
  const { bytes, truncated } = await readBounded(res, maxBytes);
  return truncated
    ? { text: decodeTruncated(bytes), truncated: true }
    : { text: bytes.toString('utf-8'), truncated: false };
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
