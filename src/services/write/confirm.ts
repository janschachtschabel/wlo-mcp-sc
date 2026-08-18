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

/** How long a preview stays valid. Long enough to read, short enough to matter. */
export const TOKEN_TTL_MS = 10 * 60 * 1000;

/**
 * Upper bound on pending previews. Each entry is tiny, but the map is fed by an
 * internet-facing endpoint, so it needs a ceiling that does not depend on
 * callers behaving. Oldest first — a token nobody used is the one to drop.
 */
const MAX_PENDING = 1000;

export type ConfirmOutcome = 'ok' | 'unknown' | 'expired' | 'mismatch';

interface Pending {
  hash: string;
  expiresAt: number;
}

const pending = new Map<string, Pending>();

/**
 * A stable fingerprint of what is about to happen. Fields are sorted, so the
 * order the caller happened to name them in does not change the identity of the
 * change; everything else that distinguishes one write from another — the node,
 * the kind, whether it deletes, each old and new value — is inside the hash.
 */
function fingerprint(cs: ChangeSet): string {
  const canonical = JSON.stringify({
    nodeId: cs.nodeId,
    kind: cs.kind,
    destructive: cs.destructive,
    title: cs.title,
    action: cs.action ?? null,
    // Which reference the caller was looking at is part of what they approved:
    // the same record can be referenced from several collections, and a preview
    // that named no redirection at all approved an edit to the node as named.
    redirectedFrom: cs.redirectedFrom ?? null,
    changes: [...cs.changes]
      .sort((a, b) => a.property.localeCompare(b.property))
      .map(c => [c.property, c.before, c.after, c.route]),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

function prune(now: number): void {
  for (const [token, entry] of pending) {
    if (entry.expiresAt <= now) pending.delete(token);
  }
  while (pending.size >= MAX_PENDING) {
    const oldest = pending.keys().next();
    if (oldest.done) break;
    pending.delete(oldest.value);
  }
}

/** Issue a single-use token for this exact change. */
export function mintToken(cs: ChangeSet, now: number = Date.now()): string {
  prune(now);
  const token = randomBytes(18).toString('base64url');
  pending.set(token, { hash: fingerprint(cs), expiresAt: now + TOKEN_TTL_MS });
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
  if (!entry) return 'unknown';
  pending.delete(token);
  if (entry.expiresAt <= now) return 'expired';
  return sameHash(entry.hash, fingerprint(cs)) ? 'ok' : 'mismatch';
}

/** Constant-time comparison — the hashes are equal-length hex digests. */
function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}
