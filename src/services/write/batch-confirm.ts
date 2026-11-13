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

import { isOutcomeOpen } from './timeouts.js';
import { keyedDigest } from '../../keyed-digest.js';
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
  /** With `failed`: something MAY exist all the same (a 5xx, an answer without an id). */
  open?: true;
}

export type Redeem =
  | { outcome: 'ok'; plan: BatchPlan; entry: BatchEntry }
  | { outcome: 'already'; result: StoreResult }
  | { outcome: 'unknown' | 'expired' | 'mismatch' };

export type FolderChoice =
  | { ok: true; parent: string; denied: boolean }
  | { ok: false; detail: string; open?: true };

interface Pending {
  owner: string;
  plan: BatchPlan;
  expires: number;
  results: Map<number, StoreResult>;
  /** Indices handed out but not yet recorded — a parallel second call is `already` too. */
  inFlight: Set<number>;
  folder?: Promise<FolderChoice>;
  /** The folder creation ended open: this batch files nothing more (see `folder`). */
  folderOpen?: true;
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
const FOLDER_OPEN_NOTE = 'Ob der Ordner angelegt wurde, ist offen — für diesen Stapel wird kein zweiter angelegt. '
  + 'Bitte im persönlichen Bereich nachsehen und den Stapel neu vorbereiten.';
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
  // Keyed (`keyed-digest.ts`): a bare hash of the header is a password hash, and this one is held for the batch's lifetime.
  return keyedDigest(`batch:${cred.header}`);
}

/** Every batch in the way of a new one is being filed — `scope` says whose limit it is. */
export class TooManyBatches extends Error {
  constructor(readonly scope: 'owner' | 'server') {
    super(`too many batches under way (${scope})`);
    this.name = 'TooManyBatches';
  }
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

  /**
   * Room is made only from batches nobody has STARTED. A sixth preparation used
   * to push out the owner's oldest batch whatever its state — mid-filing, its
   * next file then answered `batch_unknown` over a half-filed folder (audit
   * 2026-11-12, K-13). When every batch in the way is under way, the new one is
   * refused instead (`TooManyBatches`): finish one, or let it run out.
   */
  mint(owner: string, plan: BatchPlan): string {
    this.sweep();
    // Under way: something of it was filed or is being filed, and its manifest —
    // the last step — is not in yet. A FINISHED batch is history, not work.
    const finished = (p: Pending) => typeof p.manifest === 'object';
    // A batch whose folder creation ended OPEN cannot be continued (see
    // `folder`): it is no work in progress either, and must not hold a place.
    const started = (p: Pending) => !finished(p) && !p.folderOpen
      && (p.results.size > 0 || p.inFlight.size > 0 || Boolean(p.folder) || p.manifest === 'inFlight');
    // Map iteration is insertion order: the oldest idle batch goes first.
    // DECIDED before anything is deleted: a preparation that is refused must
    // leave every batch where it was — the owner's idle ones included.
    const idleToEvict = (inTheWay: Array<[string, Pending]>, limit: number, gone: Set<string>): string[] | null => {
      const left = inTheWay.filter(([token]) => !gone.has(token));
      const need = left.length - limit + 1;
      if (need <= 0) return [];
      const idle = left.filter(([, p]) => !started(p)).slice(0, need).map(([token]) => token);
      return idle.length === need ? idle : null;
    };
    const all = [...this.pending];
    const own = idleToEvict(all.filter(([, p]) => p.owner === owner), this.maxPerOwner, new Set());
    if (!own) throw new TooManyBatches('owner');
    const any = idleToEvict(all, this.maxTotal, new Set(own));
    if (!any) throw new TooManyBatches('server');
    for (const token of [...own, ...any]) this.pending.delete(token);
    const token = `${randomBytes(18).toString('base64url')}.${batchFingerprint(plan).slice(0, 12)}`;
    this.pending.set(token, { owner, plan: structuredClone(plan), expires: this.clock() + BATCH_TTL_MS,
      results: new Map(), inFlight: new Set(), manifest: 'none' });
    return token;
  }

  /** Test seam: forget every batch. */
  resetForTest(): void {
    this.pending.clear();
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

  /**
   * The batch's folder choice: made once (also for parallel first files). A
   * REFUSED attempt is forgotten so the next file tries again. An OPEN one — a
   * 5xx, an answer without an id, no answer at all — is KEPT: the folder may
   * exist, and trying again made a second one (`renameIfExists`), with the
   * batch's files split between the two (K-13). The batch then stays without a
   * folder; the person looks and prepares it anew.
   */
  folder(token: string, make: () => Promise<FolderChoice>): Promise<FolderChoice> {
    const p = this.pending.get(token);
    if (!p) return make();
    if (!p.folder) {
      p.folder = make().then((choice) => {
        if (!choice.ok && !choice.open) delete p.folder;
        if (choice.ok || !choice.open) return choice;
        p.folderOpen = true;
        return { ...choice, detail: `${choice.detail} ${FOLDER_OPEN_NOTE}` };
      }, (err: unknown): FolderChoice => {
        if (isOutcomeOpen(err)) {
          p.folderOpen = true;
          return { ok: false, open: true, detail: `Vom Repository kam keine Antwort. ${FOLDER_OPEN_NOTE}` };
        }
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
