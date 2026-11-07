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

/** How long a preview stays valid. Long enough to read, short enough to matter. */
export const TOKEN_TTL_MS = 10 * 60 * 1000;

/**
 * Upper bound on pending previews. Each entry is tiny, but the map is fed by an
 * internet-facing endpoint, so it needs a ceiling that does not depend on
 * callers behaving. Oldest first — a token nobody used is the one to drop.
 */
const MAX_PENDING = 1000;

/**
 * Upper bound on pending previews per IDENTITY. The global bound evicts the
 * oldest token of anyone, so one account issuing a thousand previews pushed out
 * every other person's pending confirmation (audit 2026-11-05). Past this
 * number an identity makes room from its OWN oldest previews.
 */
export const MAX_PENDING_PER_IDENTITY = 50;

/**
 * `replay`: the key was already redeemed by a call with the same identity and
 * arguments (plan 2026-11-07, S3) — the caller answers with that call's result
 * (`confirm-replay.ts`) instead of `unknown`.
 */
export type ConfirmOutcome = 'ok' | 'unknown' | 'expired' | 'mismatch' | 'replay';

interface Pending {
  hash: string;
  expiresAt: number;
  identity: string;
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

const pending = new Map<string, Pending>();

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
      .map(c => [c.property, c.before, c.after, c.route]),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

function prune(now: number, identity: string): void {
  for (const [token, entry] of pending) {
    if (entry.expiresAt <= now) { pending.delete(token); bury(token, now); }
  }
  for (const [token, until] of expired) if (until <= now) expired.delete(token);
  // Insertion order is age order, so the first matching entries are the oldest.
  const own = [...pending].filter(([, entry]) => entry.identity === identity);
  for (let i = 0; i <= own.length - MAX_PENDING_PER_IDENTITY; i++) pending.delete(own[i]![0]);
  while (pending.size >= MAX_PENDING) {
    const oldest = pending.keys().next();
    if (oldest.done) break;
    pending.delete(oldest.value);
  }
}

/** Issue a single-use token for this exact change. */
export function mintToken(cs: ChangeSet, now: number = Date.now()): string {
  const identity = currentIdentity();
  prune(now, identity);
  const token = randomBytes(18).toString('base64url');
  pending.set(token, { hash: fingerprint(cs, identity), expiresAt: now + TOKEN_TTL_MS, identity });
  return token;
}

/**
 * Redeem a token for the change it was minted for.
 *
 * The token is consumed on every recognised attempt, `mismatch` included: a
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
    // Answers once, like the token it stands for.
    const until = expired.get(token);
    if (until === undefined || until <= now) return 'unknown';
    expired.delete(token);
    return 'expired';
  }
  pending.delete(token);
  if (entry.expiresAt <= now) return 'expired';
  const identity = currentIdentity();
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
