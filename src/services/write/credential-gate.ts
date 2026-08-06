/**
 * services/write/credential-gate.ts – may this call change data?
 *
 * The credential chain (`auth/credential.ts`) answers WHO is calling. This
 * answers whether that identity is allowed to write, and it is deliberately
 * stricter than "is authenticated":
 *
 *   - anonymous            → never. The public surface stays read-only.
 *   - an individual login  → always. The change is attributable to a person.
 *   - the service account  → only when the operator sets
 *     `WLO_ALLOW_SERVICE_WRITES`. Everyone shares that identity, so an edit
 *     made under it names nobody — the repository's history would record
 *     "wlo-mcp" for a change some unknown caller asked for. Read access under a
 *     shared account is ordinary; write access is a decision.
 *
 * Used twice per tool, on purpose: once at registration, so a write tool does
 * not appear in `tools/list` at all when the mode is `none`, and once at call
 * time, because a host may serve a cached tool list from an earlier, more
 * privileged session.
 */

import { currentCredential, type WloCredential } from '../../auth/credential.js';

export type WriteMode = 'user' | 'service' | 'none';

/**
 * Read an env flag as a boolean. Only affirmative spellings count — a flag that
 * gates writes must not be switched on by the string `"false"`, which is what a
 * loose truthiness check on a non-empty string would do.
 */
export function isEnabledFlag(raw: string | undefined): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * The write mode for a given identity. Pure, so the whole matrix is testable
 * without touching the environment.
 */
export function resolveWriteMode(cred: WloCredential | null, allowServiceWrites: boolean): WriteMode {
  if (!cred) return 'none';
  if (cred.source === 'user') return 'user';
  return allowServiceWrites ? 'service' : 'none';
}

/**
 * Whether the operator has enabled writes under the shared service account.
 * Resolved at import like every other env value in this codebase.
 */
export const ALLOW_SERVICE_WRITES: boolean = isEnabledFlag(process.env['WLO_ALLOW_SERVICE_WRITES']);

/** The write mode of the call currently in scope. */
export function writeMode(): WriteMode {
  return resolveWriteMode(currentCredential(), ALLOW_SERVICE_WRITES);
}

/**
 * Why the current call may not write, in user-facing German — or null when it
 * may. Returned rather than thrown because the same verdict is needed in two
 * shapes: as the tool's refusal reply (which also carries the OAuth challenge,
 * see `tools/curation-shared.ts`) and as the in-handler backstop below.
 *
 * The message says what to do about it, because whoever asked for the change
 * reads it.
 */
export function writeRefusal(): string | null {
  if (writeMode() !== 'none') return null;
  if (currentCredential()?.source === 'service') {
    return 'Änderungen sind für das gemeinsame Dienstkonto gesperrt, weil sie niemandem zuzuordnen wären. ' +
      'Bitte mit den eigenen WLO-Zugangsdaten anmelden — oder die Betreiberin setzt WLO_ALLOW_SERVICE_WRITES.';
  }
  // Named both ways round on purpose: over HTTP the client shows a login card
  // (the challenge beside this text triggers it), while a local stdio client has
  // no such flow and needs its connector settings filled in instead.
  return 'Zum Ändern von Inhalten ist eine Anmeldung mit einem eigenen WLO-Konto nötig. ' +
    'Bitte anmelden — oder die eigenen WLO-Zugangsdaten in den Verbindungseinstellungen hinterlegen — ' +
    'und den Vorgang danach wiederholen.';
}

/** Throw unless the current call may write. */
export function requireWrite(): void {
  const reason = writeRefusal();
  if (reason) throw new Error(reason);
}
