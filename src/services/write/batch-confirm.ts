/**
 * batch-confirm.ts – MA-3: one approval for a whole batch of files, redeemed index by index.
 *
 * The single-write confirm (`confirm.ts`) binds one token to one change set and is spent at once. A
 * batch of 36 files cannot be approved 36 times, and must not be approved as "whatever comes next":
 *
 *  - `wlo_prepare_file_batch` builds the PLAN (target, folder name, layout, every entry with title,
 *    sha256, size, type and the derived file name), shows it, and `mint`s one token for exactly that
 *    plan. The server keeps the plan; a later call can only name an index of it, never widen it — and
 *    the manifest (`vorgang.json`) is built by the server from this plan and the results.
 *  - `wlo_store_batch_file` `redeem`s (token, owner, index): the same owner only (`mismatch`), each
 *    index once (`already`, with the earlier result — a retry must not file twice), within 30 minutes
 *    (`expired`, checked first). The list order is part of the approval (`batchFingerprint`).
 *  - Per batch the server keeps the folder promise (one folder, also for parallel first files) and
 *    whether the manifest was filed; both go with the batch.
 *
 * The OWNER is a hash of the credential HEADER (not just the account name): a stranger presenting
 * `Basic victim:wrong` gets another owner and cannot displace the victim's batches.
 *
 * In memory, one server instance (like `confirm.ts`). Logs carry no titles.
 */

import { createHash, randomBytes } from 'node:crypto';

import type { BatchRole } from './batch-manifest.js';

export interface BatchEntry {
  index: number;
  title: string;
  sha256: string;
  size: number;
  ext: string;
  /** `cm:name` the record will get (derived from the title, shown in the preview). */
  fileName: string;
  /** Structure document or content (W4) — part of the approval like every other field. */
  role: BatchRole;
}

export interface BatchPlan {
  target: 'home';
  folderName: string;
  layout: 'folder' | 'flat';
  entries: BatchEntry[];
}

export interface StoreResult {
  status: 'stored' | 'dropped' | 'unverified' | 'failed';
  nodeId?: string;
  detail?: string;
}

export type Redeem =
  | { outcome: 'ok'; plan: BatchPlan; entry: BatchEntry }
  | { outcome: 'already'; result: StoreResult }
  | { outcome: 'unknown' | 'expired' | 'mismatch' };

export type FolderChoice =
  | { ok: true; parent: string; denied: boolean }
  | { ok: false; detail: string };

interface Pending {
  owner: string;
  plan: BatchPlan;
  expires: number;
  results: Map<number, StoreResult>;
  /** Indices handed out but not yet recorded — a parallel second call is `already` too. */
  inFlight: Set<number>;
  folder?: Promise<FolderChoice>;
  /**
   * The manifest: not claimed, being filed, or the result of filing it. Three
   * states, not a flag — a claim whose filing was aborted must answer "open" to
   * the next call, never "already filed" (review R-A, 2026-11-06).
   */
  manifest: 'none' | 'inFlight' | StoreResult;
}

export const BATCH_TTL_MS = 30 * 60 * 1000;
/** Batches held at once across ALL owners — the owner is a header hash, so the per-owner cap alone
 *  bounds memory only as far as the per-address login limiter does. Oldest out. */
const MAX_TOTAL_BATCHES = 500;
const MANIFEST_IN_FLIGHT: StoreResult = { status: 'unverified', detail: 'vorgang.json wird gerade abgelegt.' };

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort()
      .map((k) => [k, stable((value as Record<string, unknown>)[k])]));
  }
  return value;
}

/** Fingerprint of a plan — stable against field order, NOT against the order of the list. */
export function batchFingerprint(plan: BatchPlan): string {
  return createHash('sha256').update(JSON.stringify(stable(plan))).digest('hex');
}

/** The owner key of a credential: its header, hashed (see the module head). */
export function batchOwner(cred: { header: string; source: string } | null): string | null {
  if (!cred || cred.source !== 'user') return null;
  return createHash('sha256').update(`batch:${cred.header}`).digest('hex');
}

export class BatchConfirmations {
  private readonly pending = new Map<string, Pending>();
  private readonly clock: () => number;
  private readonly maxPerOwner: number;
  private readonly maxTotal: number;

  constructor(o: { clock?: () => number; maxPerOwner?: number; maxTotal?: number } = {}) {
    this.clock = o.clock ?? Date.now;
    this.maxPerOwner = o.maxPerOwner ?? 5;
    this.maxTotal = o.maxTotal ?? MAX_TOTAL_BATCHES;
  }

  private sweep(): void {
    const now = this.clock();
    for (const [token, p] of this.pending) if (p.expires <= now) this.pending.delete(token);
  }

  mint(owner: string, plan: BatchPlan): string {
    this.sweep();
    const eigene = [...this.pending].filter(([, p]) => p.owner === owner);
    // Map iteration is insertion order: the oldest batch of this owner goes first.
    for (const [token] of eigene.slice(0, Math.max(0, eigene.length - this.maxPerOwner + 1))) {
      this.pending.delete(token);
    }
    while (this.pending.size >= this.maxTotal) {
      const oldest = this.pending.keys().next();
      if (oldest.done) break;
      this.pending.delete(oldest.value);
    }
    const token = `${randomBytes(18).toString('base64url')}.${batchFingerprint(plan).slice(0, 12)}`;
    this.pending.set(token, { owner, plan: structuredClone(plan), expires: this.clock() + BATCH_TTL_MS,
      results: new Map(), inFlight: new Set(), manifest: 'none' });
    return token;
  }

  private live(token: string, owner: string): Pending | 'unknown' | 'expired' | 'mismatch' {
    const p = this.pending.get(token);
    if (!p) return 'unknown';
    if (p.expires <= this.clock()) {
      this.pending.delete(token);
      return 'expired';
    }
    return p.owner === owner ? p : 'mismatch';
  }

  redeem(token: string, owner: string, index: number): Redeem {
    const p = this.live(token, owner);
    if (typeof p === 'string') return { outcome: p };
    const entry = p.plan.entries.find((e) => e.index === index);
    if (!entry) return { outcome: 'unknown' };
    const earlier = p.results.get(index);
    if (earlier) return { outcome: 'already', result: earlier };
    if (p.inFlight.has(index)) return { outcome: 'already', result: { status: 'unverified',
      detail: 'Diese Datei wird gerade abgelegt.' } };
    p.inFlight.add(index);
    return { outcome: 'ok', plan: p.plan, entry };
  }

  record(token: string, index: number, result: StoreResult): void {
    const p = this.pending.get(token);
    if (!p) return;
    p.inFlight.delete(index);
    p.results.set(index, result);
  }

  /** Give an index back without a result — nothing was created, it may be redeemed again. */
  abandon(token: string, index: number): void {
    this.pending.get(token)?.inFlight.delete(index);
  }

  /** The batch's folder choice: made once (also for parallel first files); a failed attempt is
   *  forgotten so the next file tries again. */
  folder(token: string, make: () => Promise<FolderChoice>): Promise<FolderChoice> {
    const p = this.pending.get(token);
    if (!p) return make();
    if (!p.folder) {
      p.folder = make().then((choice) => {
        if (!choice.ok) delete p.folder;
        return choice;
      }, (err: unknown) => {
        delete p.folder;
        throw err;
      });
    }
    return p.folder;
  }

  /**
   * Plan and results for the manifest, or — when it was claimed before — what is
   * KNOWN about it: in flight, or the recorded result (like `redeem`'s `already`).
   */
  claimManifest(token: string, owner: string): { plan: BatchPlan; results: Map<number, StoreResult> } |
    { already: StoreResult } | 'unknown' | 'expired' | 'mismatch' {
    const p = this.live(token, owner);
    if (typeof p === 'string') return p;
    if (p.manifest === 'inFlight') return { already: MANIFEST_IN_FLIGHT };
    if (p.manifest !== 'none') return { already: p.manifest };
    p.manifest = 'inFlight';
    return { plan: p.plan, results: p.results };
  }

  /** What filing the manifest ended in. A recorded result is never filed again. */
  recordManifest(token: string, result: StoreResult): void {
    const p = this.pending.get(token);
    if (p) p.manifest = result;
  }

  /** Nothing was created: the manifest may be claimed again. */
  releaseManifest(token: string): void {
    const p = this.pending.get(token);
    if (p) p.manifest = 'none';
  }
}
