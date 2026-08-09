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

import { verifyBlockLogin, type VerifyDeps } from './access-verify.js';
import { log } from '../logger.js';
import { sanitizeText } from '../text-sanitize.js';

/**
 * How many accesses went. Deliberately no `label`: the only caller is a page on
 * which the person just typed that name, so echoing it back adds nothing and
 * would put caller-supplied text in a response for no reason.
 */
export type RevokeAllOutcome =
  | { ok: true; revoked: number }
  | { ok: false; status: 400 | 429; error: string };

export type RevokeAllDeps = VerifyDeps;

/**
 * Verify the login inside a block, then strike every access listed for that
 * account.
 *
 * Matching is by exact label — see `access-registry.ts` for why case is not
 * folded. A registry write that fails throws rather than reporting a revocation
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
  const { payload } = verified;

  const revoked = await deps.support.registry.removeByLabel(payload.u);
  log.info('all access blocks revoked for an account', {
    label: sanitizeText(payload.u),
    revoked,
  });
  return { ok: true, revoked };
}
