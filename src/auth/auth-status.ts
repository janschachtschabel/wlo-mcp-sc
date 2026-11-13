/**
 * auth/auth-status.ts – what a login status says (plan 2026-11-07, S4).
 *
 * ONE payload for the MCP tool `wlo_auth_status` and the cheap HTTP endpoint
 * `GET /auth/status`, so the two can never disagree about a login. Pure: the
 * caller resolves the credential and asks the repository (`checkIdentity`).
 *
 * `expiresAt` is the allow-list's own expiry (R1, `RegistryEntry.exp`) and
 * appears only where one exists — ticket blocks and a widget's OAuth blocks. A
 * pasted block has none. It is when THIS server stops accepting the block; a
 * ticket block can die earlier, with the edu-sharing session, whose end this
 * server cannot see (measured 2026-08-13: 404/500, no warning before).
 */

import { currentAccessSupport, runWithCredential, type WloCredential } from './credential.js';
import { checkIdentity, type WloIdentity } from './identity.js';
import { sanitizeText } from '../text-sanitize.js';

export type CredentialKind = 'none' | 'basic' | 'access-block' | 'ticket' | 'service';

export interface AuthStatus {
  /** `anonymous` = public data only; `service` = one shared account for everyone. */
  mode: 'anonymous' | 'service' | 'user';
  /** Whether the repository actually recognises us as that identity. */
  authenticated: boolean;
  /** Configured identity (never the secret); absent in anonymous mode and for the shared service account. */
  configuredAs?: string;
  /** What edu-sharing reports back — `esguest` when we are nobody; `null` for the shared service account (not named). */
  authority: string | null;
  displayName?: string;
  /** How the identity reached this server. */
  credential: CredentialKind;
  /**
   * Whether the repository ANSWERED the identity question. `unreachable` = no
   * verdict on the login (outage, overload, timeout) — so `authenticated:
   * false` with `upstream: 'ok'` is a refusal, and with `'unreachable'` it is
   * not (chatbot team feedback 2026-11-07, B2). Same words as `/ready`.
   */
  upstream: 'ok' | 'unreachable';
  /** When this server stops accepting the block (ISO), if it ever does. */
  expiresAt?: string;
}

/** Which kind of credential this is — a block carries an access id, a ticket block the ticket scheme. */
export function credentialKind(cred: WloCredential | null): CredentialKind {
  if (!cred) return 'none';
  if (cred.source === 'service') return 'service';
  if (!cred.jti) return 'basic';
  return /^EDU-TICKET\s/i.test(cred.header) ? 'ticket' : 'access-block';
}

export function authStatusPayload(cred: WloCredential | null, identity: WloIdentity, expiresAtS?: number): AuthStatus {
  // In per-user mode the label is caller-supplied (everything before the colon
  // in their Basic header), so it is foreign text in model-facing output and
  // gets the same treatment as a publisher title. A name of nothing but control
  // characters sanitizes to "", and empty quotes would read like a bug.
  const label = cred ? (sanitizeText(cred.label) || 'ohne lesbaren Namen') : '';
  // The service account is reported as a MODE. Whoever asks without a login of
  // their own is answered for it, so its user name, authority and display name
  // went to every anonymous caller — half of a login nobody needs to be handed
  // (audit 2026-11-12, S-7). A person asking about their OWN login gets it all.
  const shared = cred?.source === 'service';
  return {
    mode: cred ? cred.source : 'anonymous',
    authenticated: identity.authenticated,
    ...(cred && !shared ? { configuredAs: label } : {}),
    authority: shared ? null : identity.authority,
    ...(identity.displayName && !shared ? { displayName: identity.displayName } : {}),
    credential: credentialKind(cred),
    upstream: identity.unreachable ? 'unreachable' : 'ok',
    ...(expiresAtS !== undefined ? { expiresAt: new Date(expiresAtS * 1000).toISOString() } : {}),
  };
}

/**
 * Ask the repository who `cred` is and answer the status payload. The ONE place
 * a login status is read — the MCP tool and `GET /auth/status` both call it
 * (the authority-check guard in `tests/shared-rule-discipline.test.ts` names
 * this module, not its callers).
 */
export async function readAuthStatus(cred: WloCredential | null): Promise<AuthStatus> {
  const identity = cred ? await runWithCredential(cred, () => checkIdentity()) : await checkIdentity();
  const exp = cred?.jti ? currentAccessSupport()?.registry.expiresAt(cred.jti) : undefined;
  return authStatusPayload(cred, identity, exp);
}
