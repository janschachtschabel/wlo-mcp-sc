/**
 * auth/oauth-codes.ts – authorization codes, and the only state OAuth keeps.
 *
 * A code is a one-time bearer: whoever presents it at `/oauth/token` receives
 * the access block that was minted with it. So the store is deliberately small
 * and short-lived — a minute of life, one use, a bound on how many can be
 * outstanding — and it lives in memory only. Losing it on restart costs a user
 * one retry of a login they are in the middle of; persisting it would put
 * credentials-in-a-wrapper on disk, which is exactly the vault the design
 * rejected.
 *
 * Two details that are not cosmetic:
 *
 * - **Codes are stored under their SHA-256.** The record is the interesting
 *   half; the code itself is the key. Hashing means a heap dump, a log of the
 *   map, or a debugger session hands out records but no usable code.
 * - **The block stays a ciphertext here.** We hold the private key and could
 *   open it — we do not. Nothing between `/oauth/authorize` and `/oauth/token`
 *   needs the password, so nothing in this path ever sees it. That is the
 *   difference from a credential store, and it is the reason this module has no
 *   import from `access-token.ts`.
 *
 * `now` is a parameter rather than `Date.now()` inside the module, so expiry is
 * testable by arithmetic instead of by waiting.
 */

import { createHash, randomBytes } from 'node:crypto';

export interface CodeRecord {
  /** The `client_id` the code was issued to — re-checked at the token endpoint. */
  clientId: string;
  /** The redirect target presented at authorization — re-checked at exchange. */
  redirectUri: string;
  /** PKCE `code_challenge` (S256). The verifier is checked against it later. */
  challenge: string;
  /** The `wlo2.…` access block — a ciphertext we pass on without opening. */
  block: string;
  /** WLO user name, for the log line at exchange. */
  label: string;
  /** Absolute expiry, computed at mint time. */
  expiresAt: number;
}

/** One minute: a client redirects and exchanges immediately, or not at all. */
export const CODE_TTL_MS = 60_000;

/**
 * How many codes may be outstanding at once.
 *
 * A bound is required, not optional: `/oauth/authorize` can be reached by anyone
 * with a working WLO login, and an unbounded map is a way to exhaust the
 * process's memory. A thousand covers far more simultaneous logins than this
 * deployment will ever see within one TTL window.
 */
export const MAX_CODES = 1_000;

export interface CodeStore {
  /** Issue a code for this record and return it. The record is kept by hash. */
  mint(record: Omit<CodeRecord, 'expiresAt'>, now: number): string;
  /** Redeem a code. Always removes it first — a used code is used either way. */
  consume(code: string, now: number): CodeRecord | null;
  /** How many codes are outstanding (for the bound, and for tests). */
  size(): number;
}

const PREFIX = 'mcp_ac_';
const CODE_BYTES = 32;

const keyOf = (code: string): string => createHash('sha256').update(code).digest('hex');

export function createCodeStore(ttlMs: number = CODE_TTL_MS, max: number = MAX_CODES): CodeStore {
  // Insertion-ordered, which is what makes "evict the oldest" a first-key lookup.
  const codes = new Map<string, CodeRecord>();

  const sweep = (now: number): void => {
    for (const [key, record] of codes) {
      if (record.expiresAt <= now) codes.delete(key);
    }
  };

  return {
    mint(record, now) {
      sweep(now);
      // Sweeping usually suffices; the eviction below covers the case where a
      // burst arrives faster than the TTL expires anything.
      while (codes.size >= max) {
        const oldest = codes.keys().next();
        if (oldest.done) break;
        codes.delete(oldest.value);
      }
      const code = PREFIX + randomBytes(CODE_BYTES).toString('base64url');
      codes.set(keyOf(code), { ...record, expiresAt: now + ttlMs });
      return code;
    },

    consume(code, now) {
      const key = keyOf(code);
      const record = codes.get(key);
      // Removed before it is judged: an expired or otherwise unusable code must
      // not stay behind to be tried again.
      codes.delete(key);
      if (!record || record.expiresAt <= now) return null;
      return record;
    },

    size() {
      return codes.size;
    },
  };
}
