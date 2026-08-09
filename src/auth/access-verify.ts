/**
 * auth/access-verify.ts – proving that a block carries a login that works.
 *
 * Extracted from `access-issue.ts` when revocation-by-account needed the
 * identical step. Moved rather than copied, deliberately: this is the one rule a
 * second copy would forget, and forgetting it has a different cost on each side.
 *
 * **At this API a 200 is not proof of a login.** `/iam/v1/people/-home-/-me-`
 * answers 200 with the guest authority when no credential is attached (measured,
 * P0). So the check reads the reported AUTHORITY, never the status code. On the
 * issuance side, trusting `res.ok` lists accesses for logins that do not work
 * and the holder discovers it days later as "the tools return nothing". On the
 * revocation side it is worse: the public key is published so browsers can
 * encrypt, so ANYONE can build a block naming any user — without this check, a
 * guessed username would end a stranger's accesses.
 *
 * The order is also load-bearing: the distinct-login limiter runs AFTER decoding
 * (so only logins we would really try upstream count) and BEFORE the upstream
 * call (so a guesser never reaches WLO).
 *
 * German error text: these strings reach a person on the access pages.
 */

import { decodeAccessToken, type AccessPayload } from './access-token.js';
import {
  runWithCredential,
  type AccessSupport,
  type WloCredential,
} from './credential.js';
import { checkIdentity } from './identity.js';
import { log } from '../logger.js';
import type { DistinctValueLimiter } from '../rate-limit.js';
import { sanitizeText } from '../text-sanitize.js';

/** Everything both callers need from a verified block. */
export type VerifyOutcome =
  | { ok: true; payload: AccessPayload }
  | { ok: false; status: 400 | 429; error: string };

export interface VerifyDeps {
  /** Client key for the distinct-login limiter (already resolved via TRUST_PROXY). */
  ip: string;
  /** Distinct logins per address — the guessing guard. */
  authAbuseLimiter: DistinctValueLimiter;
  support: AccessSupport;
}

/** Does this login actually work? The authority decides, not the status code. */
async function loginWorks(credential: WloCredential): Promise<boolean> {
  const identity = await runWithCredential(credential, () => checkIdentity());
  return identity.authenticated;
}

/**
 * Open a block and prove the login inside it against the repository.
 *
 * @param token   The `wlo2.…` block as presented by the caller.
 * @param purpose What the caller is about to do — appears in the log line only.
 * @param now     Milliseconds since the epoch; the limiter window comes from
 *                here rather than from the block, whose timestamp is whatever
 *                the issuing browser's clock said.
 */
export async function verifyBlockLogin(
  token: string,
  deps: VerifyDeps,
  now: number,
  purpose: 'issuance' | 'revocation',
): Promise<VerifyOutcome> {
  const payload = decodeAccessToken(token, deps.support.keys);
  if (!payload) {
    // No detail about WHY: a wrong key, a tampered block and a foreign one must
    // look identical from outside.
    return {
      ok: false,
      status: 400,
      error: 'Dieser Zugangsblock ist ungültig oder gehört nicht zu diesem Server.',
    };
  }

  const credential: WloCredential = {
    header: `Basic ${Buffer.from(`${payload.u}:${payload.secret}`).toString('base64')}`,
    label: payload.u,
    source: 'user',
  };

  if (deps.authAbuseLimiter.check(deps.ip, credential.header, now)) {
    log.warn('too many distinct logins offered', { ip: deps.ip, purpose });
    return { ok: false, status: 429, error: 'Zu viele verschiedene Anmeldungen von dieser Adresse.' };
  }

  if (!(await loginWorks(credential))) {
    log.info('access request refused — credentials not accepted', {
      label: sanitizeText(payload.u),
      purpose,
    });
    return {
      ok: false,
      status: 400,
      error: 'Diese Zugangsdaten hat WLO nicht akzeptiert. Bitte Benutzername und Passwort prüfen.',
    };
  }

  return { ok: true, payload };
}
