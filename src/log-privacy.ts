/**
 * log-privacy.ts – what the log says about a PERSON: their address, their
 * account name, what they searched for.
 *
 * By default none of the three is written in the clear (user decision
 * 2026-11-13: no combination of address, user name and search term in the
 * log). Each becomes a short pseudonym — a keyed digest under a secret that
 * exists only in this process (`keyed-digest.ts`). That keeps what the lines
 * are FOR: "the same address again", "the same account again", "the same
 * search failed three times" stay visible within one run of the server, while
 * the value cannot be read back, looked up in a table of likely values, or
 * matched against another run or another system.
 *
 * `LOG_PERSONAL_DATA=plain` writes the values as they are — for an operator
 * who has to block an address or follow one report, and has the legal ground
 * to keep them. It is a decision about the log only: nothing in the server
 * reads these values back. Limiter buckets, the allow-list and the caches use
 * the real values in memory either way.
 *
 * One module, because the rule is only as good as its last call site: a log
 * line that names a person goes through here, and
 * `tests/shared-rule-discipline.test.ts` fails one that does not.
 */

import { keyedDigest } from './keyed-digest.js';
import { sanitizeText } from './text-sanitize.js';

const plain = (): boolean => process.env['LOG_PERSONAL_DATA']?.trim().toLowerCase() === 'plain';

/** Twelve hex characters: enough to tell values apart in one log, too few to be an identifier anywhere else. */
const pseudonym = (kind: string, value: string): string => `~${keyedDigest(`log:${kind}:${value}`).slice(0, 12)}`;

/** A client address. */
export function logAddress(ip: string): string {
  return plain() ? ip : pseudonym('ip', ip);
}

/**
 * A WLO account name. Sanitized when written in the clear — it is foreign text.
 * Compared case-insensitively like a search term: edu-sharing accepts a login in
 * several spellings (measured 2026-11-12), and one account is one pseudonym.
 */
export function logAccount(name: string): string {
  return plain() ? sanitizeText(name) : pseudonym('account', name.trim().toLowerCase());
}

/** A search term. Compared case-insensitively, so one search is one pseudonym however it was typed. */
export function logTerm(term: string): string {
  return plain() ? sanitizeText(term) : pseudonym('term', term.trim().toLowerCase());
}
