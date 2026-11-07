/**
 * rest/upload-route.ts – MA-2: `POST /api/uploads`, one file into an upload slot.
 *
 * Server-to-server: the chatbot streams each file of a batch here, then files it with the batch tool
 * (MA-4) by the returned `ref`. Not part of the public read-only REST layer (`routes.ts`): it is
 * POST, authenticated and holds the bytes in memory (`upload-slot.ts`).
 *
 *  - Body: the raw bytes, `Content-Type: application/octet-stream` — no multipart, so no parser and
 *    no new dependency; the client's file name travels URL-encoded in `X-Upload-Name` and is used
 *    only to tell markdown from plain text (never stored, never logged, never echoed).
 *  - A **personal** WLO credential (access block or Basic) that the repository CONFIRMS is required
 *    (`verifiedSlotIdentity`, cached 10 min); none, the anonymous token, the service account or an
 *    unconfirmed login → 403. The identity is a hash of the account name.
 *  - 429 `too_many_logins` when the distinct-login limiter refuses — bucketed like `POST /mcp`
 *    (`abuseBucketKey`): a block per access id, Basic per address. The chatbot is one address for all
 *    its users, so with Basic `AUTH_CREDENTIAL_LIMIT` must fit the number of people; with blocks it
 *    does not matter. 403 for an unconfirmed login.
 *  - 413 by `Content-Length` before reading, or when the stream passes the limit; 415 unknown type;
 *    429 too many open slots; a body slower than `timeoutMs` (`UPLOAD_REQUEST_TIMEOUT_MS`, below the
 *    server-wide 30 s) → 408. Every refusal answers with `Connection: close`, and the request is only
 *    torn down after the answer went out — a destroyed socket would reach the client as a network
 *    error, not as 413/408.
 *  - 201 `{ref, sha256, size, mimeType, ext}`.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import { credentialFromHeader } from '../auth/credential.js';
import { parseRequestUrl } from '../request-url.js';
import { verifiedSlotIdentity, type UploadSlots } from '../services/write/upload-slot.js';
import { resolvePositiveInt } from '../wlo-config.js';
import { DRAIN_FACTOR } from '../read-body.js';
import type { DistinctValueLimiter } from '../rate-limit.js';

export const UPLOAD_PATH = '/api/uploads';

/** `UPLOAD_REQUEST_TIMEOUT_MS` (default 25 s, at most 28 s): below the server-wide `requestTimeout`
 *  (30 s, `http.ts`), so this path answers before it fires. */
export function uploadTimeoutMs(): number {
  return Math.min(resolvePositiveInt(process.env['UPLOAD_REQUEST_TIMEOUT_MS'], 25_000,
    'UPLOAD_REQUEST_TIMEOUT_MS'), 28_000);
}

export interface UploadRouteDeps {
  slots: UploadSlots;
  /** Client key (TRUST_PROXY already applied) and the distinct-login limiter of `/auth*`. */
  ip: string;
  authAbuseLimiter: DistinctValueLimiter;
  /** Deadline for the whole body — only this path; the server-wide 30 s still bound it. */
  timeoutMs: number;
}

const STATUS: Record<string, number> = {
  too_large: 413, unsupported_type: 415, too_many: 429, failed: 500, timeout: 408,
};

function send(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** A refusal: answer first with ``Connection: close``, tear the request down only afterwards. */
function refuse(req: IncomingMessage, res: ServerResponse, status: number, body: Record<string, unknown>): void {
  if (!res.headersSent) res.setHeader('Connection', 'close');
  res.once('finish', () => setTimeout(() => req.destroy(), 1000).unref());
  req.resume();
  send(res, status, body);
}

function clientName(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  try {
    return decodeURIComponent(value ?? '').slice(0, 200);
  } catch {
    return '';
  }
}

/** Handle the request if it is ours (`true`), else leave it untouched (`false`). */
export async function handleUploadRequest(
  req: IncomingMessage, res: ServerResponse, deps: UploadRouteDeps,
): Promise<boolean> {
  if (parseRequestUrl(req.url)?.pathname !== UPLOAD_PATH) return false;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    send(res, 405, { error: 'method_not_allowed' });
    return true;
  }
  const wer = await verifiedSlotIdentity(credentialFromHeader(req.headers['authorization']),
    { ip: deps.ip, authAbuseLimiter: deps.authAbuseLimiter });
  if ('refused' in wer) {
    if (wer.refused === 'limited') refuse(req, res, 429, { error: 'too_many_logins' });
    else refuse(req, res, 403, { error: 'login_required' });
    return true;
  }
  const identity = wer.identity;
  const type = String(req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
  if (type !== 'application/octet-stream') {
    refuse(req, res, 415, { error: 'octet_stream_required' });
    return true;
  }
  const laenge = req.headers['content-length'];
  const declared = laenge === undefined ? undefined : Number(laenge);
  if (declared !== undefined && (!Number.isFinite(declared) || declared > deps.slots.maxBytes)) {
    // Inside the drain window the body is read to its end first, so the client sees the 413.
    if (Number.isFinite(declared) && declared <= deps.slots.maxBytes * DRAIN_FACTOR) {
      await new Promise<void>((done) => { req.once('end', done); req.once('close', done); req.resume(); });
    }
    refuse(req, res, 413, { error: 'too_large' });
    return true;
  }
  // The deadline answers 408 itself (the body keeps draining) — never a silently destroyed socket.
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    refuse(req, res, STATUS['timeout']!, { error: 'timeout' });
  }, deps.timeoutMs);
  try {
    const result = await deps.slots.put(identity, req, clientName(req.headers['x-upload-name']), declared);
    if (result.ok && timedOut) {
      // The answer (408) is out, the ref reached nobody: drop the slot (finding 9).
      deps.slots.take(result.slot.ref, identity);
    } else if (result.ok) {
      const { ref, sha256, size, type: kind } = result.slot;
      send(res, 201, { ref, sha256, size, mimeType: kind.mimeType, ext: kind.ext });
    } else {
      refuse(req, res, STATUS[result.code] ?? 500, { error: result.code });
    }
  } finally {
    clearTimeout(timer);
  }
  return true;
}
