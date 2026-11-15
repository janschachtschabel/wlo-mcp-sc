/**
 * auth/session-exchange.ts – a repository session becomes an access block.
 *
 * The embedding this serves: the server (or just this one path) is mounted on
 * the repository's host below `/edu-sharing`, so the browser of a person signed
 * in there sends the session cookie along. The widget posts to
 * `/auth/session`, gets an ordinary `wlo2.` block back and uses it like any
 * other — on this host or, handed to its own backend, from anywhere. Nobody
 * types a password a second time, and the page needs no ticket to hand over.
 * The path on the repository's host may also belong to a trusted backend that
 * forwards the exchange here (`ForwarderBudget`, its own budget).
 *
 * Off unless the operator switches it on (`WLO_SESSION_EXCHANGE`): a server
 * that is not mounted there never sees the cookie, and one that is should say
 * so on purpose.
 *
 * The sibling of `ticket-exchange.ts`, with the same reasoning for wrapping (a
 * block is useless except against this server; a raw session id is a live
 * login) and the same rules reused where they live — `proveLogin` reads the
 * AUTHORITY, never the status. What differs is measured, not chosen
 * (`upstream-auth.ts`): the cookie travels alone and with `DisableGuest`.
 *
 * Not in the distinct-credential limiter's spirit, but through it anyway: a
 * session id is server-made randomness, nothing to guess — yet the exchange is
 * reachable from a browser, and an unbounded supply of repository calls per
 * address is what that limiter bounds. It runs on the ticket budget.
 */

import { SESSION_BLOCK_TTL_S } from './access-registry.js';
import { encodeAccessToken } from './access-token.js';
import { proveLogin, unreachableFailure, type LoginFailure, type VerifyDeps } from './access-verify.js';
import type { WloCredential } from './credential.js';
import { isSessionCookieString, sessionCredentialHeader, sessionJti } from './upstream-auth.js';
import { log } from '../logger.js';
import { logAccount } from '../log-privacy.js';

export { sessionCookiesFrom } from './upstream-auth.js';

export type SessionExchangeOutcome =
  | { ok: true; block: string; authority: string; displayName?: string }
  | LoginFailure;

const REFUSED = 'Diese WLO-Sitzung ist nicht (mehr) angemeldet.';


/**
 * Prove a session against the repository and issue the block that carries it.
 *
 * @param session What `sessionCookiesFrom` read from the request. Never logged.
 */
export async function exchangeSession(
  session: { sessionId: string; cookie: string },
  deps: VerifyDeps & {
    /** The guard's bucket when it is not the address: a trusted forwarder's (`ForwarderBudget`). Never logged. */
    bucket?: string;
  },
  now: number,
): Promise<SessionExchangeOutcome> {
  if (!isSessionCookieString(session.cookie)) return { ok: false, status: 400, error: REFUSED };

  const credential: WloCredential = { header: sessionCredentialHeader(session.cookie), label: 'edu-session', source: 'user' };
  const proof = await proveLogin(credential, deps, now, 'session-exchange');
  if (!proof.ok) {
    if (proof.reason === 'limited') {
      return { ok: false, status: 429, error: 'Zu viele verschiedene Anmeldungen von dieser Adresse.' };
    }
    // An outage is no verdict on the session (as for a ticket).
    if (proof.reason === 'unreachable') {
      log.warn('session exchange not checked — repository unreachable');
      return unreachableFailure();
    }
    log.info('session exchange refused — the repository names no signed-in person');
    return { ok: false, status: 400, error: REFUSED };
  }
  const identity = proof.identity;
  if (!identity.authority) return { ok: false, status: 400, error: REFUSED };

  const jti = sessionJti(session.sessionId);
  // A block belongs to ONE listing of its id (chatbot team, 2026-11-15). The id
  // is derived from the session, so after a revocation or after the twelve
  // hours the next exchange lists the SAME id again — and every block of the
  // earlier listing would have worked again with it: one taken in the first
  // hour, or the one a person just revoked in another tab. The block therefore
  // carries the listing's `iat`, and the decoder compares it
  // (`credentialFromAccessBlock`). While the id stays listed, a reload gets a
  // block of the same listing; a new listing gets a new instant, to the
  // millisecond, so a revocation and a re-exchange in the same second differ.
  //
  // The same session id under ANOTHER person (not measured whether the
  // repository keeps a session id across a change of login) is a new listing too.
  //
  // Decided inside the registry's serialised write (`listUnlessListed`): two
  // tabs exchanging at once must not both start a listing, or the first one's
  // block is dead on arrival. Listed with the twelve-hour end of every block
  // that appeared because somebody opened a page (see `ticket-exchange.ts`).
  const iatNow = now / 1000;
  const listed = await deps.support.registry.listUnlessListed({
    jti, label: identity.authority, iat: iatNow, exp: iatNow + SESSION_BLOCK_TTL_S, k: 'ticket', sess: true,
    ...(identity.account ? { acct: identity.account } : {}),
  }, now);
  const block = encodeAccessToken(
    { v: 2, jti, u: identity.authority, secret: session.cookie, iat: listed.iat, k: 'session' },
    deps.support.keys.publicKeyPem,
  );
  log.info('session exchanged for an access block', { label: logAccount(identity.authority) });
  return {
    ok: true, block, authority: identity.authority,
    ...(identity.displayName ? { displayName: identity.displayName } : {}),
  };
}
