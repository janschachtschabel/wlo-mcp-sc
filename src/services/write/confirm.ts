/**
 * services/write/confirm.ts – two-step confirmation for every mutation.
 *
 * A write tool called without a token performs no write: it returns the
 * rendered diff plus a token. Only a second call carrying that token proceeds.
 *
 * The token is bound to a hash of the ChangeSet, and that binding is the point.
 * A token that merely said "the user agreed to something" would be exactly the
 * lever a prompt injection needs — get an innocuous edit approved, then send a
 * different one with the approved token. Here a token authorises one change to
 * one node, once.
 *
 * State is per-process and in memory. That is sufficient because a token's life
 * is one conversation turn; a restart loses pending previews, and the user
 * simply previews again. Nothing is persisted, so nothing leaks.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import type { ChangeSet } from './change-set.js';
import { currentCredential } from '../../auth/credential.js';
import { lookupReplayInCall, markRedeemed } from './confirm-replay.js';
import { budgetOf, poolShare, type StoreBudget, type TrustPool } from './store-budget.js';

// Its home is `store-budget.ts` now, beside the rule it is one case of; callers keep importing it from here.
export { accountBudget } from './store-budget.js';

/** How long a preview stays valid. Long enough to read, short enough to matter. */
export const TOKEN_TTL_MS = 10 * 60 * 1000;

/**
 * Upper bound on pending previews. Each entry is tiny, but the map is fed by an
 * internet-facing endpoint, so it needs a ceiling that does not depend on
 * callers behaving. Oldest first — a token nobody used is the one to drop.
 *
 * The TOTAL of two pools (`store-budget.ts`, `poolShare`): a preview needs no
 * proven login, so counted in one pool, twenty invented names × fifty previews
 * evicted the oldest key of everybody (review 2026-11-14).
 */
export const MAX_PENDING = 1000;

/**
 * Upper bound on pending previews per IDENTITY. The global bound evicts the
 * oldest token of anyone, so one account issuing a thousand previews pushed out
 * every other person's pending confirmation (audit 2026-11-05). Past this
 * number an identity makes room from its OWN oldest previews.
 */
export const MAX_PENDING_PER_IDENTITY = 50;
/** The shared service account is many visitors at once: half the store, never all of it. */
export const MAX_PENDING_SHARED_IDENTITY = 500;

/**
 * `replay`: the key was already redeemed by a call with the same identity and
 * arguments (plan 2026-11-07, S3) — the caller answers with that call's result
 * (`confirm-replay.ts`) instead of `unknown`.
 */
export type ConfirmOutcome = 'ok' | 'unknown' | 'expired' | 'mismatch' | 'replay';

interface Pending {
  hash: string;
  expiresAt: number;
  /** Who may redeem it (`currentIdentity`). */
  identity: string;
  /** Whose share of the store it counts against (`budgetIdentity`). */
  budget: string;
  /** Which half of the store it lives in — and the only half it may be evicted FOR. */
  pool: TrustPool;
}

/**
 * Who is previewing or confirming. Part of the fingerprint, because a token
 * approves one change FOR ONE PERSON: without it, someone else replaying the
 * token with the identical change set would write under their own rights on
 * somebody else's approval (audit 2026-11-05). An access block is identified by
 * its id, anything else by source and name — the shared service account is one
 * identity by construction, which is exactly the attribution problem
 * `WLO_ALLOW_SERVICE_WRITES` already names.
 */
export function currentIdentity(): string {
  const cred = currentCredential();
  if (!cred) return 'anonymous';
  return cred.jti ? `jti:${cred.jti}` : `${cred.source}:${cred.label}`;
}

/**
 * The account a credential stands for where it NAMES the confirmed one
 * (`acct`), else the name as typed. One login has several accepted spellings
 * (measured 2026-11-12), and a cap per spelling is no cap per person. A
 * credential without the field (`Basic`, an entry listed before the account
 * was recorded) behaves exactly as before.
 */
export function accountOf(cred: { label: string; acct?: string }): string {
  return cred.acct || cred.label;
}

/**
 * Whose BUDGET a pending preview counts against: the confirmed account where
 * the credential names one, else `currentIdentity`. Kept apart from the
 * identity a key is BOUND to on purpose — that one stays the credential the
 * approval was given under; this one only decides whose oldest preview makes
 * room (audit 2026-11-14, W14).
 *
 * The confirmed account has a namespace of its OWN (`acct:`), which no other
 * credential can produce: `currentIdentity` answers `jti:`, `user:`, `service:`
 * or `anonymous`. Keyed `user:<acct>` it was the very string a `Basic` header
 * with that name typed gets — and `Basic` is never proven before a preview, so
 * fifty previews under `Basic maria:anything` evicted every pending key of the
 * person whose confirmed account is `maria` (review 2026-11-14).
 *
 * The same review, one step on: a typed name shared the budget of the REAL
 * `Basic` user of that name too. So for an unproven credential the key is no
 * longer `currentIdentity` but name plus a keyed digest of the whole header —
 * decided in `store-budget.ts`, for previews, plans and batches alike.
 */
export function budgetIdentity(): string {
  return currentBudget().key;
}

/** Budget key AND trust pool of the credential in scope (`store-budget.ts`). */
export function currentBudget(): StoreBudget {
  return budgetOf(currentCredential());
}

const pending = new Map<string, Pending>();

/** Previews waiting for their confirmation right now — for a metric. Reads only. */
export function confirmStoreSize(): number {
  return pending.size;
}

/**
 * Expired tokens, kept as a bare id for an hour so they answer `expired` and not
 * `unknown` (chatbot feedback 2026-11-07): `prune` drops every expired entry on
 * the next mint, by ANY caller, so the promised `confirm_expired` was almost
 * never reachable. Only the id and its own expiry are kept — no fingerprint, no
 * identity — and the set is bounded like `pending`.
 */
const expired = new Map<string, number>();
const TOMBSTONE_MS = 60 * 60 * 1000;
const MAX_TOMBSTONES = 2000;

function bury(token: string, now: number): void {
  expired.set(token, now + TOMBSTONE_MS);
  while (expired.size > MAX_TOMBSTONES) {
    const oldest = expired.keys().next();
    if (oldest.done) break;
    expired.delete(oldest.value);
  }
}

/**
 * A stable fingerprint of what is about to happen. Fields are sorted, so the
 * order the caller happened to name them in does not change the identity of the
 * change; everything else that distinguishes one write from another — the node,
 * the kind, whether it deletes, each old and new value — is inside the hash.
 * So is whether a change ADDS or replaces: both can end in the same list, but
 * the previews read differently, and the key belongs to the one that was shown.
 */
function fingerprint(cs: ChangeSet, identity: string): string {
  const canonical = JSON.stringify({
    identity,
    nodeId: cs.nodeId,
    kind: cs.kind,
    destructive: cs.destructive,
    title: cs.title,
    action: cs.action ?? null,
    // Which reference the caller was looking at is part of what they approved:
    // the same record can be referenced from several collections, and a preview
    // that named no redirection at all approved an edit to the node as named.
    redirectedFrom: cs.redirectedFrom ?? null,
    addTo: cs.addTo ?? null,
    items: cs.items ?? null,
    changes: [...cs.changes]
      .sort((a, b) => a.property.localeCompare(b.property))
      .map(c => [c.property, c.before, c.after, c.route, c.mode ?? null]),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

function prune(now: number, { key: budget, pool }: StoreBudget): void {
  for (const [token, entry] of pending) {
    if (entry.expiresAt <= now) { pending.delete(token); bury(token, now); }
  }
  for (const [token, until] of expired) if (until <= now) expired.delete(token);
  // Insertion order is age order, so the first matching entries are the oldest.
  // The per-identity cap is a cap per PERSON. The shared service account is
  // every visitor at once (`WLO_ALLOW_SERVICE_WRITES`), so fifty previews there
  // were fifty for everybody together and each new one evicted a stranger's
  // (audit 2026-11-12, S-12). It gets a share of its own — half of everything —
  // rather than none: without any, one visitor of a service-write deployment
  // could fill the store and push out every PERSON's pending key.
  const cap = budget.startsWith('service:') ? MAX_PENDING_SHARED_IDENTITY : MAX_PENDING_PER_IDENTITY;
  const own = [...pending].filter(([, entry]) => entry.budget === budget);
  for (let i = 0; i <= own.length - cap; i++) pending.delete(own[i]![0]);
  // Room in the caller's POOL, never in the store as a whole: whoever fills the
  // unproven half with invented names evicts among the unproven, and a key
  // minted under a confirmed account is out of their reach (`store-budget.ts`).
  // Within the pool the minter pays first, with its OWN oldest key: the service
  // identity's cap is as large as its whole pool, so below that cap its next
  // key would otherwise cost a PERSON theirs — the very thing its own share
  // exists to prevent (S-12).
  const inPool = [...pending].filter(([, entry]) => entry.pool === pool);
  for (let over = inPool.length - poolShare(MAX_PENDING, pool) + 1; over > 0; over--) {
    const at = Math.max(0, inPool.findIndex(([, entry]) => entry.budget === budget));
    const [victim] = inPool.splice(at, 1);
    if (!victim) break;
    pending.delete(victim[0]);
  }
}

/** Issue a single-use token for this exact change. */
export function mintToken(cs: ChangeSet, now: number = Date.now()): string {
  const identity = currentIdentity();
  const budget = currentBudget();
  prune(now, budget);
  const token = randomBytes(18).toString('base64url');
  pending.set(token, {
    hash: fingerprint(cs, identity), expiresAt: now + TOKEN_TTL_MS, identity, budget: budget.key, pool: budget.pool,
  });
  return token;
}

/**
 * Redeem a token for the change it was minted for.
 *
 * The token is consumed on every attempt BY ITS OWNER, `mismatch` included: a
 * caller must not be able to keep trying different changes against one
 * approval. A mismatch means the plan is no longer what the user saw — the
 * right answer is a fresh preview, not a retry.
 */
export function consumeToken(token: string, cs: ChangeSet, now: number = Date.now()): ConfirmOutcome {
  const entry = pending.get(token);
  if (!entry) {
    // Redeemed already — by this identity with these arguments: the first call's
    // answer stands (or is still being made). Checked here as well as at the
    // tool seam, because two calls sent at once both pass the seam before
    // either redeems.
    if (lookupReplayInCall(token, currentIdentity(), now).kind !== 'none') return 'replay';
    // Answers for as long as it is kept, whoever asks. It used to answer ONCE —
    // and a tombstone carries no identity, so anybody presenting the key took
    // the owner's "expired" (nothing was written) and left them "unknown"
    // (look first). Bounded by its hour and by `MAX_TOMBSTONES` either way.
    const until = expired.get(token);
    if (until === undefined || until <= now) return 'unknown';
    return 'expired';
  }
  const identity = currentIdentity();
  // Somebody ELSE presenting the key does not use it up: it stays its owner's.
  // Before, any caller who had seen a key could burn it (S-12). Trying changes
  // against it gains them nothing — the identity is part of every fingerprint.
  if (entry.identity !== identity) return 'mismatch';
  pending.delete(token);
  // Buried like an entry `prune` drops, so the NEXT presentation answers
  // `expired` too. Without it the first answer was "expired — nothing was
  // written" and the second "unknown — look first", for the same key.
  if (entry.expiresAt <= now) { bury(token, now); return 'expired'; }
  if (!sameHash(entry.hash, fingerprint(cs, identity))) return 'mismatch';
  markRedeemed(token, identity, now);
  return 'ok';
}

/** Constant-time comparison — the hashes are equal-length hex digests. */
function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}
