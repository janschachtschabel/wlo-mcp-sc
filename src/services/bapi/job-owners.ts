/**
 * services/bapi/job-owners.ts – which person started which b-api job through
 * this server.
 *
 * Measured 2026-11-18 (`tests/live/bapi-flows.test.ts`): through the
 * repository's b-api proxy every person carries the repository's ONE API key,
 * and the b-api keeps jobs per key — another person read a job, report
 * included, by its id alone. So "a foreign job is 404" does not hold on this
 * route, and this server holds the ownership itself: `wlo_flow_status` and
 * `wlo_cancel_flow` ask the b-api only about jobs the caller's account started
 * here; everything else is `unknown_job`.
 *
 * In memory only (the access registry stays the only runtime disk writer), so a
 * restart forgets it — the tools say so. Bounded: 30 days like the b-api keeps
 * a job, at most `PER_OWNER` per account (the oldest makes room) and `TOTAL`
 * in all. The owner is the account (`accountOf`: the confirmed account of a
 * block, else the login name), lower-cased: one person with two blocks, or a
 * login typed in another case, is one owner. Known limit: a person whose
 * password login names the account differently than her block (an e-mail form,
 * say) is two owners, and her job reads `unknown_job` under the other login.
 *
 * Why a login NAME may stand for the owner: the b-api call itself carries
 * `DisableGuest`, and the proxy answers a wrong password and no login alike with
 * 401 (measured 2026-11-18) — a borrowed name with a wrong password reads nothing.
 */

import { currentCredential } from '../../auth/credential.js';
import { accountOf } from '../write/confirm.js';

const RETENTION_MS = 30 * 24 * 3600 * 1000;
const PER_OWNER = 500;
const TOTAL = 20_000;

/** jobId → owner and expiry; insertion order is age order. */
const owners = new Map<string, { owner: string; expiresAt: number }>();

/** The caller's account as an owner key, or null when no person is in scope. */
function ownerInScope(): string | null {
  const cred = currentCredential();
  return cred?.source === 'user' ? accountOf(cred).trim().toLowerCase() : null;
}

function prune(now: number): void {
  for (const [jobId, e] of owners) if (e.expiresAt <= now) owners.delete(jobId);
}

/** Note that the person in scope started `jobId`. */
export function recordJobOwner(jobId: string, now: number = Date.now()): void {
  const owner = ownerInScope();
  if (!owner) return;
  prune(now);
  owners.delete(jobId);
  const mine = [...owners].filter(([, e]) => e.owner === owner);
  if (mine.length >= PER_OWNER) owners.delete(mine[0]![0]);
  if (owners.size >= TOTAL) owners.delete(owners.keys().next().value!);
  owners.set(jobId, { owner, expiresAt: now + RETENTION_MS });
}

/** Did the person in scope start `jobId` through this server (and is the note still kept)? */
export function ownsJob(jobId: string, now: number = Date.now()): boolean {
  const owner = ownerInScope();
  const e = owners.get(jobId);
  return Boolean(owner && e && e.owner === owner && e.expiresAt > now);
}

export function clearJobOwnersForTest(): void {
  owners.clear();
}
