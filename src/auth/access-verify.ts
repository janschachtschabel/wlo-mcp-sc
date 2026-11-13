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
  addressBucket,
  runWithCredential,
  type AccessSupport,
  type WloCredential,
} from './credential.js';
import { checkIdentity, type WloIdentity } from './identity.js';
import { log } from '../logger.js';
import type { DistinctValueLimiter } from '../rate-limit.js';
import { sanitizeText } from '../text-sanitize.js';

/**
 * How every login-checking path fails: 400 refused, 429 the guessing guard,
 * 503 the repository gave no answer — which is no verdict on the login, so it
 * must not read as "wrong password" (review of the chatbot feedback B2,
 * 2026-11-07: an outage during a widget's ticket exchange looked like an
 * invalid ticket).
 */
export type LoginFailure = { ok: false; status: 400 | 429 | 503; error: string };

/** The one outage answer, so the four paths that prove a login say it alike. */
export function unreachableFailure(): LoginFailure {
  return {
    ok: false,
    status: 503,
    error: 'WLO ist gerade nicht erreichbar, die Anmeldung ließ sich nicht prüfen. Bitte in einigen Sekunden erneut versuchen.',
  };
}

/** Everything both callers need from a verified block. */
export type VerifyOutcome =
  | {
    ok: true;
    payload: AccessPayload;
    /** The account the repository confirmed for this login — may differ from `payload.u` in spelling. */
    account: string;
  }
  | LoginFailure;

export interface VerifyDeps {
  /** Client key for the distinct-login limiter (already resolved via TRUST_PROXY). */
  ip: string;
  /** Distinct logins per address — the guessing guard. */
  authAbuseLimiter: DistinctValueLimiter;
  support: AccessSupport;
}

/**
 * What proving a login can end in. `limited` never reached the repository;
 * `unreachable` reached for it and got no answer (`WloIdentity.unreachable`).
 */
export type LoginProof =
  | { ok: true; identity: WloIdentity }
  | { ok: false; reason: 'limited' | 'refused' | 'unreachable' };

/**
 * Bound the guessing, then prove ONE credential against the repository.
 *
 * The shared core under everything on this server that checks a credential —
 * block issuance, revocation-by-account, the ticket exchange. Two rules live
 * here and nowhere else: the distinct-login limiter runs BEFORE the upstream
 * call (a guesser never reaches WLO), and what decides is the reported
 * AUTHORITY, never the status code (`checkIdentity` — a 200 with the guest
 * authority is not a login, measured in P0). Callers translate the two
 * failure reasons into their own wording; the identity travels back so the
 * one caller that needs it (the ticket exchange labels its block with it)
 * does not have to ask twice.
 */
export async function proveLogin(
  credential: WloCredential,
  deps: Pick<VerifyDeps, 'ip' | 'authAbuseLimiter'> & {
    /**
     * The limiter bucket, when it is not the address. Only `upload` passes one
     * (`abuseBucketKey`, the rule `POST /mcp` follows): a chatbot backend is
     * ONE address for all its users. Issuance must stay per address — its
     * blocks are minted fresh, so a per-`jti` bucket there would be a new
     * budget per guess. Never logged: for a block it IS the access id.
     */
    bucket?: string;
  },
  now: number,
  purpose: 'issuance' | 'revocation' | 'ticket-exchange' | 'upload',
): Promise<LoginProof> {
  // One bucket per address across `/mcp`, `/auth/status` and this path: the
  // bare address here and `ip:<address>` there were two buckets in one limiter,
  // i.e. twice the documented budget (audit 2026-11-12, S-6).
  // The ADDRESS unless the caller names a bucket — never derived from the
  // credential here: a caller passing one that carries a `jti` would silently
  // count per id, which for freshly minted blocks is a new budget per guess.
  if (deps.authAbuseLimiter.check(deps.bucket ?? addressBucket(deps.ip), credential.header, now)) {
    log.warn('too many distinct logins offered', { ip: deps.ip, purpose });
    return { ok: false, reason: 'limited' };
  }
  const identity = await runWithCredential(credential, () => checkIdentity());
  if (identity.authenticated) return { ok: true, identity };
  return { ok: false, reason: identity.unreachable ? 'unreachable' : 'refused' };
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

  const proof = await proveLogin(credential, deps, now, purpose);
  if (!proof.ok) {
    if (proof.reason === 'limited') {
      return { ok: false, status: 429, error: 'Zu viele verschiedene Anmeldungen von dieser Adresse.' };
    }
    if (proof.reason === 'unreachable') {
      log.warn('access request not checked — repository unreachable', { purpose });
      return unreachableFailure();
    }
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

  // The CONFIRMED account travels with the payload: listing and revocation go
  // by it, not by the spelling that was typed (audit 2026-11-12, S-2).
  // `?? payload.u` is for the type only: an authenticated identity has an account.
  return { ok: true, payload, account: proof.identity.account ?? payload.u };
}
