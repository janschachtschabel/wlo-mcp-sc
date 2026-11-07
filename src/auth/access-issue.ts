/**
 * auth/access-issue.ts – turning an access block into a listed access.
 *
 * Two callers: `/auth/issue` (the paste route) and `/oauth/authorize`, which
 * performs exactly this step before it mints a code.
 *
 * The check that makes an issued access mean something — decode, bound the
 * guessing, and read the reported AUTHORITY rather than the status code — lives
 * in `access-verify.ts`, shared with revocation-by-account. What remains here is
 * only what issuance adds: the registry entry.
 */

import { decodeAccessToken } from './access-token.js';
import { verifyBlockLogin, type LoginFailure, type VerifyDeps } from './access-verify.js';
import { log } from '../logger.js';
import { sanitizeText } from '../text-sanitize.js';

export type IssueOutcome =
  | { ok: true; label: string; jti: string }
  | LoginFailure;

export type IssueDeps = VerifyDeps;

/**
 * How far a block's own `iat` may lie from our clock at issuance (review
 * 2026-11-07). Both pages and the consent screen mint a block in the browser
 * moments before issuing it, so a real one is minutes old; a day absorbs a
 * wrong device clock. What it closes: a block that once had an entry — an
 * expired widget block whose record (`EXPIRED_KEPT_S`) is gone, or a stolen
 * one — cannot be listed anew, and in particular not WITHOUT its expiry.
 */
export const ISSUE_MAX_SKEW_S = 24 * 60 * 60;

/** Refusals that need no login check: the block itself says it must not be listed. */
function refuseBeforeLogin(token: string, deps: IssueDeps, nowS: number): IssueOutcome | null {
  const payload = decodeAccessToken(token, deps.support.keys);
  if (!payload) return null; // the canonical "invalid block" answer comes from verifyBlockLogin
  if (Math.abs(payload.iat - nowS) > ISSUE_MAX_SKEW_S) {
    return { ok: false, status: 400,
      error: 'Dieser Zugangsblock ist zu alt, oder die Uhr dieses Geräts geht falsch. Bitte einen neuen Block holen.' };
  }
  // Known but no longer listed = expired, and kept as a record exactly so this
  // answer can be given: re-issuing would list it again, without its expiry.
  if (deps.support.registry.known(payload.jti) && !deps.support.registry.has(payload.jti, nowS * 1000)) {
    return { ok: false, status: 400, error: 'Dieser Zugang ist abgelaufen. Bitte neu anmelden.' };
  }
  return null;
}

/**
 * Verify the login inside an access block and enter its id in the allow-list.
 *
 * @param token  The `wlo2.…` block as presented by the caller.
 * @param now    Milliseconds since the epoch; the stored `iat` comes from here
 *               rather than from the block, whose timestamp is whatever the
 *               issuing browser's clock said.
 * @param ttlSeconds  When given, the entry expires that long after `now`
 *               (R1, an embedded widget's login); omitted, it never does.
 * @returns      The listed access, or the status and German text to answer with.
 *               A registry write that fails throws — the caller's error boundary
 *               turns that into a 500 rather than a half-granted access.
 */
export async function issueAccessBlock(
  token: string,
  deps: IssueDeps,
  now: number,
  ttlSeconds?: number,
): Promise<IssueOutcome> {
  const early = refuseBeforeLogin(token, deps, Math.floor(now / 1000));
  if (early) return early;
  const verified = await verifyBlockLogin(token, deps, now, 'issuance');
  if (!verified.ok) return verified;
  const { payload } = verified;

  // Already listed: the same access, confirmed — and NOT rewritten. `add`
  // replaces the whole entry, so writing again would drop an expiry the entry
  // carries (a widget block re-issued through `/auth/issue` or an AI-host
  // consent would become permanent; review 2026-11-07).
  if (deps.support.registry.has(payload.jti, now)) {
    log.info('access block issued again — already listed, entry kept', { label: sanitizeText(payload.u) });
    return { ok: true, label: payload.u, jti: payload.jti };
  }

  // Past this point WLO has accepted `u`, so the stored label is a real user
  // name and goes in unaltered — the registry groups its per-account cap by it,
  // and a capped label could fold two accounts into one bucket. It is also what
  // revocation-by-account matches on.
  //
  // `iat` is OURS, not `payload.iat`: an operator pruning or auditing the list
  // needs a timestamp this server stands behind.
  const iat = Math.floor(now / 1000);
  await deps.support.registry.add({
    jti: payload.jti,
    label: payload.u,
    iat,
    ...(ttlSeconds !== undefined ? { exp: iat + ttlSeconds } : {}),
  });
  log.info('access block issued', { label: sanitizeText(payload.u) });
  return { ok: true, label: payload.u, jti: payload.jti };
}
