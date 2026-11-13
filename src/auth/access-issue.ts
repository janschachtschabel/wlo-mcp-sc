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
import { logAccount } from '../log-privacy.js';

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
  const { payload, account } = verified;

  // The id is listed for another name: a block reusing someone's listed id under
  // a login of its own. It could never be used (`credentialFromAccessBlock`
  // binds id and name), so answering "issued" would hand out a dead access.
  // The answer does tell a signed-in caller that the id exists — accepted: ids
  // are 128 random bits, and before this check the same call answered "issued".
  const listedFor = deps.support.registry.labelOf(payload.jti);
  if (listedFor !== undefined && listedFor !== payload.u) {
    log.warn('access block refused — its id is listed for another name', { label: logAccount(payload.u) });
    return { ok: false, status: 400, error: 'Dieser Zugangsblock kann nicht verwendet werden. Bitte einen neuen erzeugen.' };
  }

  // Already listed: the same access, confirmed — and NOT rewritten. `add`
  // replaces the whole entry, so writing again would drop an expiry the entry
  // carries (a widget block re-issued through `/auth/issue` or an AI-host
  // consent would become permanent; review 2026-11-07).
  if (deps.support.registry.has(payload.jti, now)) {
    // An entry from before the account name was recorded learns it now —
    // otherwise "revoke all" typed in another spelling keeps missing it. Only
    // the account is added; the entry is not rewritten.
    await deps.support.registry.noteAccount(payload.jti, account);
    log.info('access block issued again — already listed, entry kept', { label: logAccount(payload.u) });
    return { ok: true, label: payload.u, jti: payload.jti };
  }

  // Past this point WLO has accepted `u`, so the stored label is a real user
  // name and goes in unaltered — it is the name the block is bound to. The cap
  // and revocation-by-account go by `acct`, the account WLO CONFIRMED: one
  // login has several accepted spellings (measured 2026-11-12), and by label
  // alone each spelling was an account of its own (audit S-2).
  //
  // `iat` is OURS, not `payload.iat`: an operator pruning or auditing the list
  // needs a timestamp this server stands behind.
  const iat = Math.floor(now / 1000);
  await deps.support.registry.add({
    jti: payload.jti,
    label: payload.u,
    iat,
    acct: account,
    ...(ttlSeconds !== undefined ? { exp: iat + ttlSeconds } : {}),
  });
  log.info('access block issued', { label: logAccount(payload.u) });
  return { ok: true, label: payload.u, jti: payload.jti };
}
