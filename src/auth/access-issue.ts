/**
 * auth/access-issue.ts – turning an access block into a listed access.
 *
 * Extracted from `rest/auth-pages.ts` when a second caller appeared: OAuth's
 * `/oauth/authorize` performs exactly this step before it mints a code. It was
 * moved rather than copied deliberately — the rule this function exists for is
 * the one a second copy would forget.
 *
 * **At this API a 200 is not proof of a login.** `/iam/v1/people/-home-/-me-`
 * answers 200 with the guest authority when no credential is attached, and an
 * anonymous read of `-userhome-/children` answers 200 as well (measured, P0).
 * So the check reads the reported AUTHORITY, never the status code. Trusting
 * `res.ok` would list accesses for logins that do not work, and the holder would
 * discover it days later as "the tools return nothing".
 *
 * The order is also load-bearing: the distinct-login limiter runs AFTER decoding
 * (so only logins we would really try upstream count) and BEFORE the upstream
 * call (so a guesser never reaches WLO).
 *
 * German error text: these strings reach a person on the access page.
 */

import { decodeAccessToken } from './access-token.js';
import {
  runWithCredential,
  type AccessSupport,
  type WloCredential,
} from './credential.js';
import { checkIdentity } from './identity.js';
import { log } from '../logger.js';
import type { DistinctValueLimiter } from '../rate-limit.js';
import { sanitizeText } from '../text-sanitize.js';

export type IssueOutcome =
  | { ok: true; label: string; jti: string }
  | { ok: false; status: 400 | 429; error: string };

export interface IssueDeps {
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
 * Verify the login inside an access block and enter its id in the allow-list.
 *
 * @param token  The `wlo2.…` block as presented by the caller.
 * @param now    Milliseconds since the epoch; the limiter window and the stored
 *               `iat` both come from here rather than from the block, whose
 *               timestamp is whatever the issuing browser's clock said.
 * @returns      The listed access, or the status and German text to answer with.
 *               A registry write that fails throws — the caller's error boundary
 *               turns that into a 500 rather than a half-granted access.
 */
export async function issueAccessBlock(
  token: string,
  deps: IssueDeps,
  now: number,
): Promise<IssueOutcome> {
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
    log.warn('too many distinct logins offered for issuance', { ip: deps.ip });
    return { ok: false, status: 429, error: 'Zu viele verschiedene Anmeldungen von dieser Adresse.' };
  }

  if (!(await loginWorks(credential))) {
    log.info('issuance refused — credentials not accepted', { label: sanitizeText(payload.u) });
    return {
      ok: false,
      status: 400,
      error: 'Diese Zugangsdaten hat WLO nicht akzeptiert. Bitte Benutzername und Passwort prüfen.',
    };
  }

  // Past this point WLO has accepted `u`, so the stored label is a real user
  // name and goes in unaltered — the registry groups its per-account cap by it,
  // and a capped label could fold two accounts into one bucket.
  //
  // `iat` is OURS, not `payload.iat`: an operator pruning or auditing the list
  // needs a timestamp this server stands behind.
  await deps.support.registry.add({
    jti: payload.jti,
    label: payload.u,
    iat: Math.floor(now / 1000),
  });
  log.info('access block issued', { label: sanitizeText(payload.u) });
  return { ok: true, label: payload.u, jti: payload.jti };
}
