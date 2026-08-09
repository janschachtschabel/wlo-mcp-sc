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

import { verifyBlockLogin, type VerifyDeps } from './access-verify.js';
import { log } from '../logger.js';
import { sanitizeText } from '../text-sanitize.js';

export type IssueOutcome =
  | { ok: true; label: string; jti: string }
  | { ok: false; status: 400 | 429; error: string };

export type IssueDeps = VerifyDeps;

/**
 * Verify the login inside an access block and enter its id in the allow-list.
 *
 * @param token  The `wlo2.…` block as presented by the caller.
 * @param now    Milliseconds since the epoch; the stored `iat` comes from here
 *               rather than from the block, whose timestamp is whatever the
 *               issuing browser's clock said.
 * @returns      The listed access, or the status and German text to answer with.
 *               A registry write that fails throws — the caller's error boundary
 *               turns that into a 500 rather than a half-granted access.
 */
export async function issueAccessBlock(
  token: string,
  deps: IssueDeps,
  now: number,
): Promise<IssueOutcome> {
  const verified = await verifyBlockLogin(token, deps, now, 'issuance');
  if (!verified.ok) return verified;
  const { payload } = verified;

  // Past this point WLO has accepted `u`, so the stored label is a real user
  // name and goes in unaltered — the registry groups its per-account cap by it,
  // and a capped label could fold two accounts into one bucket. It is also what
  // revocation-by-account matches on.
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
