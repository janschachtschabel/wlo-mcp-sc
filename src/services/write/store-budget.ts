/**
 * services/write/store-budget.ts – whose share of a bounded write store an entry
 * counts against, and whose entries may be dropped to make room for it.
 *
 * The write side keeps three things in memory between two calls: confirmation
 * keys (`confirm.ts`), approved plans (`plan-runner.ts`) and prepared batches
 * (`batch-confirm.ts`). Each is bounded, and a bound means that somebody's entry
 * goes when room is needed. Whose — that is decided HERE, once, for all three.
 *
 * Two rules, and both exist because a `Basic` login is never proven before a
 * preview: the header is taken as it comes, and a preview may cost no upstream
 * call at all. Anyone who can reach `/mcp` can therefore mint entries under any
 * name they care to type (review 2026-11-14).
 *
 * 1. **The budget of an unproven credential is the WHOLE credential.** Keyed by
 *    the typed name alone, `Basic maria:anything` shared the fifty previews and
 *    the five plans of the real `Basic maria:…` — fifty previews evicted hers,
 *    five plans refused her sixth. Name plus a keyed digest of the header: the
 *    same name with another password is somebody else.
 * 2. **Room is made within ONE trust pool.** Rule 1 alone would be worse than
 *    none — rotating the password now mints a fresh budget each time, and the
 *    store's GLOBAL bound evicted the oldest entry of anyone. So every store is
 *    two pools with a fixed share each: PROVEN (an account the repository
 *    confirmed, a block on the allow-list, the operator's service account) and
 *    UNPROVEN (everything else). An entry is counted in its pool, and only that
 *    pool's entries make room for it. Inventing names or rotating passwords
 *    fills and evicts among the unproven; the shares add up to the store's old
 *    total, so memory is bounded exactly as before.
 *
 * This is about caps and eviction ONLY. Who may redeem a key or continue a plan
 * is `currentIdentity` (`confirm.ts`) and is not touched: making that depend on
 * the password would be a change of what an approval is bound to.
 */

import type { WloCredential } from '../../auth/credential.js';
import { keyedDigest } from '../../keyed-digest.js';

/** Which half of a store an entry lives in. */
export type TrustPool = 'proven' | 'unproven';

export interface StoreBudget {
  /** Whose per-identity cap the entry counts against. Never logged or returned: for a block it is the access id. */
  key: string;
  pool: TrustPool;
}

/**
 * The share of a store the UNPROVEN pool gets. Half: enough that honest `Basic`
 * users are not crowded by each other, and the other half is what no stranger
 * can reach. The proven pool gets the rest (`poolShare`), so the two always add
 * up to the store's total.
 */
export const UNPROVEN_POOL_FRACTION = 0.5;

/** How many entries of a store holding `total` belong to `pool`. */
export function poolShare(total: number, pool: TrustPool): number {
  const unproven = Math.floor(total * UNPROVEN_POOL_FRACTION);
  return pool === 'unproven' ? unproven : total - unproven;
}

/**
 * The budget key of a CONFIRMED account, or null where the credential names
 * none. The one spelling: previews, plans and upload slots all count a proven
 * person here, and a second spelling is how the namespaces drift back together.
 */
export function accountBudget(cred: { acct?: string } | null): string | null {
  return cred?.acct ? `acct:${cred.acct}` : null;
}

/**
 * Budget key and pool of a credential.
 *
 * - `acct:<account>` — the allow-list recorded the account the repository
 *   confirmed. Proven, and one budget for every block and spelling of a person.
 * - `jti:<id>` — a block listed before accounts were recorded. It is on the
 *   allow-list, which only a proven login gets onto, and the id is bound to one
 *   name there (`credentialFromAccessBlock`): proven as a BLOCK. Keyed by the
 *   listed id, never by the name it carries — that name is the string an
 *   unproven `Basic` header can type.
 * - `service:<name>` — the operator's own account, verified at start. Proven;
 *   `confirm.ts` gives it a larger cap and makes it pay for its own room.
 * - `user:<name>:<digest>` — a `Basic` header. Unproven. The digest is keyed
 *   (`keyed-digest.ts`): a bare hash of the header is a password hash, and this
 *   one is held as long as the entry.
 * - `anonymous` — no credential at all (the write gate refuses it anyway).
 *
 * The prefixes keep the namespaces apart: nothing typed into a `Basic` header
 * leaves `user:`.
 */
export function budgetOf(cred: Pick<WloCredential, 'header' | 'label' | 'source' | 'jti' | 'acct'> | null): StoreBudget {
  if (!cred) return { key: 'anonymous', pool: 'unproven' };
  const account = accountBudget(cred);
  if (account) return { key: account, pool: 'proven' };
  if (cred.jti) return { key: `jti:${cred.jti}`, pool: 'proven' };
  if (cred.source === 'service') return { key: `service:${cred.label}`, pool: 'proven' };
  return { key: `user:${cred.label}:${keyedDigest(`budget:${cred.header}`)}`, pool: 'unproven' };
}
