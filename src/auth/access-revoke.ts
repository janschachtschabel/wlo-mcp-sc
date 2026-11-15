/**
 * auth/access-revoke.ts – ending every access of one WLO account.
 *
 * Why this exists beside `/auth/revoke`, which takes a block: over OAuth the
 * block travels to the CLIENT and is never shown to the person. `remove(jti)`
 * needs an id that only exists inside the block, so the people most likely to
 * want a revocation — someone who connected an AI host and later removed it —
 * had no way to reach one, and the operator editing the registry file was the
 * only remaining path. Found in use on 2026-08-06, not in review.
 *
 * The password is the proof of ownership here, where possession of the block is
 * the proof on the other route. That difference is the whole reason the upstream
 * check in `access-verify.ts` may never be skipped on this path: our public key
 * is published, so anyone can build a block naming any user, and a removal that
 * trusted the name in the block would be a denial of service against a stranger.
 */

import { verifyBlockLogin, type LoginFailure, type VerifyDeps } from './access-verify.js';
import { log } from '../logger.js';
import { logAccount } from '../log-privacy.js';

/**
 * How many accesses went. Deliberately no `label`: the only caller is a page on
 * which the person just typed that name, so echoing it back adds nothing and
 * would put caller-supplied text in a response for no reason.
 */
export type RevokeAllOutcome =
  | { ok: true; revoked: number }
  | LoginFailure;

export type RevokeAllDeps = VerifyDeps;

/**
 * Verify the login inside a block, then strike every access listed for that
 * account.
 *
 * Matching is by the CONFIRMED account, exactly — plus, for entries listed
 * before the account was recorded, the spelling typed now. See
 * `access-registry.ts` for why case is not folded. A registry write that fails throws rather than reporting a revocation
 * that never reached the file; the caller's error boundary turns that into a
 * 500, because telling someone whose account is compromised that the door is
 * shut, while the next restart reopens it, is the worse answer.
 */
export async function revokeAllForBlock(
  token: string,
  deps: RevokeAllDeps,
  now: number,
): Promise<RevokeAllOutcome> {
  const verified = await verifyBlockLogin(token, deps, now, 'revocation');
  if (!verified.ok) return verified;
  const { payload, account } = verified;

  // By the CONFIRMED account, so every spelling of the login goes (audit S-2) —
  // and by the spelling typed now, for entries listed before the account name
  // was recorded.
  const revoked = await deps.support.registry.removeByLabel(account, payload.u);
  log.info('all access blocks revoked for an account', {
    label: logAccount(payload.u),
    revoked,
  });
  return { ok: true, revoked };
}
