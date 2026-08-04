/**
 * auth/identity.ts – ask edu-sharing who the server currently is.
 *
 * Necessary because a rejected credential is not visible from the answers alone.
 * Measured against production 2026-07-31:
 *
 *   - no credential at all  → `200`, authority `esguest`, public content
 *   - wrong credentials     → `401`, here and on the search endpoints alike
 *
 * So a mistyped password does NOT quietly downgrade to public data: it breaks
 * every upstream call. Before this check existed that surfaced as "0 results"
 * everywhere with no error at all — a configuration fault dressed as a fact
 * about the world. (A 2026-07-30 note recorded `200`/guest for wrong
 * credentials; re-measured against production it is `401`. Superseded.)
 *
 * `/rest/iam/v1/people/-home-/-me-` is the endpoint that reports it: it returns
 * `person.authorityName`, which is `esguest` for anyone not logged in.
 */

import { BASE_URL, WLO_REPOSITORY_URL } from '../wlo-config.js';
import { wloFetch } from '../wlo-fetch.js';
import { readJson } from '../read-json.js';
import { ANONYMOUS_AUTHORITY, currentCredential, isInsecureCredentialTransport } from './credential.js';
import { log } from '../logger.js';
import { sanitizeText } from '../text-sanitize.js';

export interface WloIdentity {
  /** True only when edu-sharing reports an authority other than the guest one. */
  authenticated: boolean;
  /** The reported authority, or null when the repository could not be asked. */
  authority: string | null;
  /** Display name when the profile carries one. */
  displayName?: string;
}

/**
 * Resolve the identity the current credential yields. Never throws: an
 * unreachable repository is reported as "not authenticated, authority
 * unknown", which is the honest answer — claiming authentication we cannot
 * confirm is exactly the failure this guards against.
 */
export async function checkIdentity(): Promise<WloIdentity> {
  try {
    const res = await wloFetch(`${BASE_URL}/iam/v1/people/-home-/-me-`);
    if (!res.ok) return { authenticated: false, authority: null };
    // Through `readJson` like every other upstream body: a proxy maintenance
    // page answers 200 with HTML, and parsing it directly surfaced as
    // "identity check failed: Unexpected token <" instead of naming the call
    // and its status. `null` lands on the same answer as an unreadable
    // authority below — not authenticated, authority unknown.
    const data = await readJson<{
      person?: { authorityName?: string; profile?: { firstName?: string; lastName?: string } };
    }>(res, 'checkIdentity');
    // Sanitized at the boundary: the authority name and the profile name are
    // the LOGGED-IN PERSON's own fields, editable by them, and they flow into
    // model-facing text. Cleaning them here means no consumer has to remember.
    const authority = data?.person?.authorityName ? sanitizeText(data.person.authorityName) : null;
    if (!authority) return { authenticated: false, authority: null };
    const p = data?.person?.profile;
    const displayName = sanitizeText([p?.firstName, p?.lastName].filter(Boolean).join(' '));
    return {
      authenticated: authority !== ANONYMOUS_AUTHORITY,
      authority,
      ...(displayName ? { displayName } : {}),
    };
  } catch (err) {
    log.warn('identity check failed', { error: err instanceof Error ? err.message : String(err) });
    return { authenticated: false, authority: null };
  }
}

/**
 * Boot-time check of the CONFIGURED service account, logged for the operator.
 *
 * Exists because a wrong password is invisible: edu-sharing answers 200 as
 * guest rather than rejecting it, so the deployment quietly serves anonymous
 * results while looking configured. One probe at startup turns that into a log
 * line someone can act on.
 *
 * Deliberately silent and network-free when nothing is configured — the
 * default anonymous deployment must not pay for a feature it does not use.
 * Never throws: an unreachable repository at boot is a warning, not a crash.
 *
 * The repository URL is a parameter (defaulting to the resolved config) so the
 * transport rule can be exercised without the environment, the way
 * `resolveWriteMode` and `resolveCreateParent` are.
 */
export async function verifyConfiguredCredential(repositoryUrl: string = WLO_REPOSITORY_URL): Promise<{
  checked: boolean;
  ok: boolean;
  authority: string | null;
}> {
  // Checked BEFORE the "nothing configured" exit: the warning belongs to the
  // transport, not to the service account. Per-user mode needs no service
  // account at all, so gating this on one would leave the deployment where
  // every user's own password travels in the clear as the only one never told.
  // Loopback stays exempt (see isInsecureCredentialTransport), which is what
  // keeps the ordinary http dev setup quiet.
  if (isInsecureCredentialTransport(repositoryUrl)) {
    log.warn(
      'repository URL is not https — any credential is sent in the clear, the configured service account and ' +
      'every login a user presents alike. HTTP Basic is base64, not encryption. Use https for ' +
      'WLO_REPOSITORY_URL, or run without credentials.',
      { repository: repositoryUrl },
    );
  }

  const cred = currentCredential();
  if (!cred) return { checked: false, ok: false, authority: null };

  const id = await checkIdentity();
  if (id.authenticated) {
    log.info('repository credential verified', { configuredAs: cred.label, authority: id.authority });
  } else {
    log.warn(
      'repository credential is configured but NOT accepted — every upstream call will fail with 401 and the ' +
      'server can answer nothing at all, not even public content. Remove the credentials to run anonymously, ' +
      'or fix WLO_SERVICE_USER/WLO_SERVICE_PASSWORD. A "#" in an unquoted password truncates it silently.',
      { configuredAs: cred.label, authority: id.authority ?? 'rejected or repository unreachable' },
    );
  }
  return { checked: true, ok: id.authenticated, authority: id.authority };
}
