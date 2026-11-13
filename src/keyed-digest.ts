/**
 * keyed-digest.ts – how a credential is remembered: never as a bare hash.
 *
 * Several places keep a login in memory for a while only to RECOGNISE it again
 * (the distinct-login limiter, the upload route's verified and refused logins,
 * the status cache). A plain SHA-256 of `Basic user:pass` there is a password
 * hash: whoever reads the heap can run a dictionary against it offline. Keyed
 * with a secret that exists only in this process, the digest is useless outside
 * it — and nothing needs it to mean anything across a restart.
 *
 * ONE secret and one function, because three places had each solved this alone
 * and two of them had not (audit 2026-11-12, S-10).
 */

import { createHmac, randomBytes } from 'node:crypto';

const PROCESS_SECRET = randomBytes(32);

/** HMAC-SHA-256 of `value` under the per-process secret, hex. Stable until the process ends. */
export function keyedDigest(value: string): string {
  return createHmac('sha256', PROCESS_SECRET).update(value).digest('hex');
}
