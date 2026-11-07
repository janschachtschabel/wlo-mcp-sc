/**
 * upload-slot.ts – MA-2: a short-lived place for ONE uploaded file, owned by one identity.
 *
 * The chatbot streams each file of a batch to `POST /api/uploads` (`rest/upload-route.ts`) before the
 * batch tool files it into the person's personal area (MA-4). Rules:
 *
 *  - **In memory, never on disk:** the server stores nothing at rest (the access registry is the only
 *    runtime disk writer — `tests/shared-rule-discipline.test.ts`). The bytes are collected while they
 *    are hashed; past `maxBytes` the stream is cut off (`too_large`) and nothing is kept.
 *  - **Type from the bytes** (MA-1, `file-types.ts`): head + ZIP central directory; unknown →
 *    `unsupported_type`. The client's name only tells markdown from plain text.
 *  - **One owner, one take:** the ref is an opaque random id; `take(ref, identity)` succeeds only for
 *    the identity that put it, and only once.
 *  - **Short-lived:** 30 minutes (`ttlMs`); `sweep` drops what expired.
 *  - **Capped** per identity (`maxPerIdentity`, 20) AND in total (`maxTotal`, `maxTotalBytes`, default
 *    128 MB — well below the container's 512 MB): uploads in flight count at their declared length
 *    (else `maxBytes`). The route admits only VERIFIED identities (`verifiedSlotIdentity`).
 *  - A body over the limit is no longer collected but DRAINED (not destroyed), so the route can still
 *    answer 413; a request that dies early (`close` before `end`) releases its reservation.
 *
 * One server instance only (documented in README / STATUS, like the confirm tokens). Logs never carry
 * file names.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';

import { log } from '../../logger.js';
import { DRAIN_FACTOR } from '../../read-body.js';
import { proveLogin } from '../../auth/access-verify.js';
import { abuseBucketKey, type WloCredential } from '../../auth/credential.js';
import type { DistinctValueLimiter } from '../../rate-limit.js';
import { resolvePositiveInt } from '../../wlo-config.js';
import { isEnabledFlag } from './credential-gate.js';
import { detectUploadType, type UploadType } from './file-types.js';
import { zipEntryNames } from './zip-entries.js';

export interface Slot {
  ref: string;
  identity: string;
  data: Buffer;
  sha256: string;
  size: number;
  type: UploadType;
  expires: number;
}

export type PutResult =
  | { ok: true; slot: Slot }
  | { ok: false; code: 'too_large' | 'unsupported_type' | 'too_many' | 'failed' };

export interface SlotOptions {
  maxBytes?: number;
  maxPerIdentity?: number;
  maxTotal?: number;
  maxTotalBytes?: number;
  ttlMs?: number;
  clock?: () => number;
}

class TooLarge extends Error {}

export class UploadSlots {
  readonly maxBytes: number;
  private readonly maxPerIdentity: number;
  private readonly maxTotal: number;
  private readonly maxTotalBytes: number;
  private readonly ttlMs: number;
  private readonly clock: () => number;
  private readonly slots = new Map<string, Slot>();
  /** Per identity: the bytes reserved by uploads in flight (one entry per upload). */
  private readonly reserved = new Map<string, number[]>();

  constructor(o: SlotOptions = {}) {
    this.maxBytes = o.maxBytes ?? 50 * 1024 * 1024;
    this.maxPerIdentity = o.maxPerIdentity ?? 20;
    this.maxTotal = o.maxTotal ?? 100;
    this.maxTotalBytes = o.maxTotalBytes ?? 128 * 1024 * 1024;
    this.ttlMs = o.ttlMs ?? 30 * 60 * 1000;
    this.clock = o.clock ?? Date.now;
  }

  /** Open slots plus uploads in flight. */
  get open(): number {
    let n = this.slots.size;
    for (const r of this.reserved.values()) n += r.length;
    return n;
  }

  private openOf(identity: string): number {
    let n = this.reserved.get(identity)?.length ?? 0;
    for (const s of this.slots.values()) if (s.identity === identity) n++;
    return n;
  }

  private bytesHeld(): number {
    let bytes = 0;
    for (const r of this.reserved.values()) for (const b of r) bytes += b;
    for (const s of this.slots.values()) bytes += s.size;
    return bytes;
  }

  /** ``declared``: the Content-Length, when the client sent one (reserved instead of ``maxBytes``). */
  async put(identity: string, body: Readable, clientName: string, declared?: number): Promise<PutResult> {
    this.sweep();
    const reserve = declared !== undefined && declared >= 0 ? Math.min(declared, this.maxBytes) : this.maxBytes;
    if (this.openOf(identity) >= this.maxPerIdentity || this.open >= this.maxTotal
        || this.bytesHeld() + reserve > this.maxTotalBytes) {
      body.resume();
      return { ok: false, code: 'too_many' };
    }
    const eigene = this.reserved.get(identity) ?? [];
    eigene.push(reserve);
    this.reserved.set(identity, eigene);
    try {
      const { data, sha256 } = await this.collect(body, declared);
      const entries = data.subarray(0, 4).toString('latin1') === 'PK\u0003\u0004'
        ? zipEntryNames(data) : [];
      const type = detectUploadType(data, entries, clientName);
      if (!type) return { ok: false, code: 'unsupported_type' };
      const slot: Slot = { ref: randomBytes(18).toString('base64url'), identity, data, sha256,
        size: data.length, type, expires: this.clock() + this.ttlMs };
      this.slots.set(slot.ref, slot);
      return { ok: true, slot };
    } catch (e) {
      if (e instanceof TooLarge) return { ok: false, code: 'too_large' };
      log.warn('upload slot: body failed', { err: (e as Error).name });
      return { ok: false, code: 'failed' };
    } finally {
      const rest = this.reserved.get(identity) ?? [];
      rest.splice(rest.indexOf(reserve), 1);
      if (rest.length) this.reserved.set(identity, rest); else this.reserved.delete(identity);
    }
  }

  private collect(body: Readable, declared?: number): Promise<{ data: Buffer; sha256: string }> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      // A known length is allocated once: no chunk list plus a second copy at the end (finding 3).
      const fixed = declared !== undefined && declared >= 0 && declared <= this.maxBytes
        ? Buffer.allocUnsafe(declared) : null;
      const chunks: Buffer[] = [];
      let size = 0;
      let done = false;
      /** Past the limit: nothing kept, the rest only DRAINED until the end (up to DRAIN_FACTOR x the
       *  limit, like ``read-body.ts``), so the client has finished sending when the 413 goes out —
       *  answering mid-stream ends in a reset on the client, not in a 413 (finding 1). */
      let drained = -1;
      const fail = (e: Error) => {
        if (done) return;
        done = true;
        chunks.length = 0;
        body.resume();
        reject(e);
      };
      body.on('data', (chunk: Buffer) => {
        if (done) return;
        if (drained >= 0) {
          drained += chunk.length;
          if (drained > this.maxBytes * DRAIN_FACTOR) fail(new TooLarge());
          return;
        }
        if (size + chunk.length > (fixed ? fixed.length : this.maxBytes)) {
          chunks.length = 0;
          drained = size + chunk.length;
          return;
        }
        hash.update(chunk);
        if (fixed) chunk.copy(fixed, size); else chunks.push(chunk);
        size += chunk.length;
      });
      body.on('error', (e) => fail(e));
      // ``close`` before ``end``: the request died (finding 6 — not the deprecated ``aborted``).
      body.on('close', () => { if (!body.readableEnded) fail(new Error('aborted')); });
      body.on('end', () => {
        if (done) return;
        if (drained >= 0) { fail(new TooLarge()); return; }
        done = true;
        if (fixed && size !== fixed.length) {
          reject(new Error('short body'));
          return;
        }
        resolve({ data: fixed ?? Buffer.concat(chunks, size), sha256: hash.digest('hex') });
      });
    });
  }

  /** The slot, if this identity owns it and it has not expired — removed from the table (once). */
  take(ref: string, identity: string): Slot | null {
    const slot = this.slots.get(ref);
    if (!slot || slot.identity !== identity) return null;
    this.slots.delete(ref);
    return slot.expires > this.clock() ? slot : null;
  }

  sweep(): void {
    const now = this.clock();
    for (const [ref, slot] of this.slots) {
      if (slot.expires <= now) this.slots.delete(ref);
    }
  }
}


/** `WLO_BATCH_UPLOAD_ENABLED` — the batch upload (route + tools) is off unless switched on. Read per
 *  call so the switch is testable; the operator sets it once. */
export function batchUploadEnabled(): boolean {
  return isEnabledFlag(process.env['WLO_BATCH_UPLOAD_ENABLED']);
}

/** `UPLOAD_MAX_TOTAL_BYTES` (default 128 MB, at most 384 MB — the container holds 512 MB). */
export function uploadMaxTotalBytes(): number {
  const wert = resolvePositiveInt(process.env['UPLOAD_MAX_TOTAL_BYTES'], 128 * 1024 * 1024,
    'UPLOAD_MAX_TOTAL_BYTES');
  return Math.min(wert, 384 * 1024 * 1024);
}

/** `UPLOAD_MAX_BYTES` (default 50 MB, at most 100 MB): the largest single file a slot takes. */
export function uploadMaxBytes(): number {
  const wert = resolvePositiveInt(process.env['UPLOAD_MAX_BYTES'], 50 * 1024 * 1024, 'UPLOAD_MAX_BYTES');
  return Math.min(wert, 100 * 1024 * 1024);
}

let shared: UploadSlots | null = null;

/** The one table of this server instance — the route puts, the batch tool (MA-4) takes. */
export function sharedUploadSlots(): UploadSlots {
  if (!shared) {
    shared = new UploadSlots({ maxBytes: uploadMaxBytes(), maxTotalBytes: uploadMaxTotalBytes() });
    // Expired files leave memory even when no further upload comes (finding 7).
    setInterval(() => shared?.sweep(), 60_000).unref();
  }
  return shared;
}


/** Whose slot / batch this is: a hash of the PERSONAL account name, or null (none, the anonymous
 *  token, the service account). The route and the batch tools derive it the same way. */
export function slotIdentity(cred: { label: string; source: string } | null): string | null {
  if (!cred || cred.source !== 'user') return null;
  return createHash('sha256').update(`user:${cred.label}`).digest('hex');
}


/** Verified personal identities, briefly cached (header hash → identity, expiry). */
const verified = new Map<string, { identity: string; until: number }>();
const VERIFY_TTL_MS = 10 * 60 * 1000;
const MAX_VERIFIED = 1000;

/**
 * The slot identity of an upload — only for a credential the repository CONFIRMS as a person
 * (review MA-1/MA-2, finding 2): a Basic `x:y` is otherwise just a name, and a stranger could fill a
 * known person's slots or mint identities. Goes through the shared `proveLogin` (distinct-login
 * limiter per `abuseBucketKey` BEFORE the upstream call, authority decides — `auth/access-verify.ts`), cached
 * for 10 minutes per header.
 */
export async function verifiedSlotIdentity(
  cred: WloCredential | null, deps: { ip: string; authAbuseLimiter: DistinctValueLimiter },
  now: number = Date.now(),
): Promise<{ identity: string } | { refused: 'login' | 'limited' }> {
  const identity = slotIdentity(cred);
  if (!cred || !identity) return { refused: 'login' };
  const key = createHash('sha256').update(cred.header).digest('hex');
  const hit = verified.get(key);
  if (hit && hit.until > now) return { identity: hit.identity };
  // Bucketed like `POST /mcp` (`abuseBucketKey`): a block per access id, Basic per address. Keyed by
  // address alone, the eleventh signed-in person behind one chatbot backend got 429 — the relay-client
  // defect the MCP path was fixed for on 2026-08-12. Only a REGISTERED access id reaches this line
  // (`credentialFromAccessBlock` checks the allow-list), so a minted id buys no fresh budget.
  const proof = await proveLogin(cred, { ...deps, bucket: abuseBucketKey(cred, deps.ip) }, now, 'upload');
  // ``limited``: too many distinct secrets in this bucket (a block's access id, or the address for
  // Basic) — a 429, not "log in": logging in again would not help (review MA-3/MA-4, finding 4).
  if (!proof.ok) return { refused: proof.reason === 'limited' ? 'limited' : 'login' };
  if (verified.size >= MAX_VERIFIED) verified.clear();
  verified.set(key, { identity, until: now + VERIFY_TTL_MS });
  return { identity };
}
