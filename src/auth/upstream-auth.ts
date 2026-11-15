/**
 * auth/upstream-auth.ts – how a credential is put on a call to the repository.
 *
 * ONE place, because two rules hang on it and both were measured
 * (`scripts/session-disableguest-probe.mjs`, staging, 2026-11-15):
 *
 *  1. A session cookie and an `Authorization` header never travel together.
 *     edu-sharing looks at the session first; the md-editor's production code
 *     documents that the combination also loses the CSRF exemption a header
 *     alone has.
 *  2. A session cookie always travels with `DisableGuest: true`. Without it an
 *     unknown or ended session answers `200` as the guest — a search then reads
 *     as "less found", never as "signed out". With it the answer is `401`.
 *
 * Every other credential (`Basic`, `EDU-TICKET`) is the `Authorization` value
 * as it stands.
 */

/** Internal scheme of a session credential. Never sent: `applyUpstreamAuth` turns it into a cookie. */
export const SESSION_SCHEME = 'EDU-SESSION';

/** One cookie value we are willing to forward: printable, no separator, no quote, no space. */
const COOKIE_VALUE = /^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]{1,512}$/;

/** The session id itself: what Tomcat issues is 32 hex characters; a route suffix (`.node1`) is allowed for. */
const SESSION_ID = /^[A-Za-z0-9._-]{16,128}$/;

/** The two cookies of a repository session: the session, and the balancer's binding to the node that holds it. */
const SESSION_COOKIE = 'JSESSIONID';
const BALANCER_COOKIE = 'INGRESSCOOKIE';

/**
 * The cookies of a repository session out of a `Cookie` header — these two and
 * nothing else; the host carries unrelated cookies that are nobody's business
 * upstream. `null` without a usable session id.
 *
 * The balancer cookie is taken along when it is there: the session lives on
 * ONE repository node, and on staging it authenticated without the binding
 * only because there may be a single node (measured 2026-08-12).
 */
export function sessionCookiesFrom(header: string | string[] | undefined): { sessionId: string; cookie: string } | null {
  if (typeof header !== 'string') return null;
  const found = new Map<string, string>();
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    if (name !== SESSION_COOKIE && name !== BALANCER_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    // Two DIFFERENT session ids: refuse. A sibling subdomain can set a cookie of
    // this name with a longer path, which a browser sends first — "the first one
    // wins" would let that page choose whose session the widget works with.
    if (name === SESSION_COOKIE && found.has(name) && found.get(name) !== value) return null;
    // The balancer cookie carries no identity; its first occurrence is taken.
    if (!found.has(name)) found.set(name, value);
  }
  const sessionId = found.get(SESSION_COOKIE);
  if (!sessionId || !SESSION_ID.test(sessionId)) return null;
  const balancer = found.get(BALANCER_COOKIE);
  const cookie = `${SESSION_COOKIE}=${sessionId}` + (balancer && COOKIE_VALUE.test(balancer) ? `; ${BALANCER_COOKIE}=${balancer}` : '');
  return { sessionId, cookie };
}

/** Is this the cookie string `sessionCookiesFrom` builds? A block's content is its holder's to write, so it is checked again. */
export function isSessionCookieString(value: string): boolean {
  return sessionCookiesFrom(value)?.cookie === value;
}

/** The credential header of a session: our scheme and the cookie string. */
export function sessionCredentialHeader(cookie: string): string {
  return `${SESSION_SCHEME} ${cookie}`;
}

/** Whether a credential header is a session. */
export function isSessionCredential(credentialHeader: string): boolean {
  return credentialHeader.startsWith(`${SESSION_SCHEME} `);
}

/**
 * Put a credential on the headers of a call to the REPOSITORY. The caller has
 * checked the host; this decides the wire form and keeps the two forms apart.
 *
 * `wlo-fetch.ts` does not call this when a call brings an `Authorization` of
 * its own (the login probe of ANOTHER credential): that call is about the
 * header it carries, not about the login in scope. Nothing sets one today
 * while a session is in scope.
 */
export function applyUpstreamAuth(headers: Headers, credentialHeader: string): void {
  if (isSessionCredential(credentialHeader)) {
    headers.delete('Authorization');
    headers.set('Cookie', credentialHeader.slice(SESSION_SCHEME.length + 1));
    headers.set('DisableGuest', 'true');
    return;
  }
  headers.set('Authorization', credentialHeader);
}
