/**
 * auth/credential.ts – WHICH identity the server calls edu-sharing with.
 *
 * The server resolves a credential per request along a chain:
 *
 *   1. the individual user — an `Authorization: Basic` header the AI host
 *      sends from its connector settings; the model never sees it
 *   2. a service account from the environment — one identity for everyone
 *   3. nothing → anonymous, exactly today's behaviour
 *
 * HTTP Basic, not Bearer: edu-sharing's own OpenAPI declares exactly
 * `basicAuth` and `cookieAuth` as its security schemes, and probing (P0,
 * 2026-07-30) confirmed a Bearer header is ignored rather than honoured.
 *
 * The credential is read in ONE place (`wloFetch`) and bounded by one rule:
 * it travels only to the configured repository. See `auth/identity.ts` for why
 * a configured credential must also be VERIFIED — wrong credentials do not
 * fail, they silently answer as guest.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { decodeAccessToken, type AuthKeys } from './access-token.js';
import type { AccessRegistry } from './access-registry.js';

/** The authority name edu-sharing reports for an unauthenticated caller. */
export const ANONYMOUS_AUTHORITY = 'esguest';

export interface WloCredential {
  /** Ready-to-send `Authorization` header value. */
  header: string;
  /** Human-readable identity for logs and the status tool — never the secret. */
  label: string;
  source: 'service' | 'user';
}

/**
 * Build the service credential from raw env values, or null when it is not
 * configured. Both halves are required: sending Basic with an empty password
 * would not fail loudly, it would downgrade to guest — a configuration mistake
 * that looks exactly like "auth is off".
 */
export function resolveServiceCredential(env: { user?: string; password?: string }): WloCredential | null {
  const user = (env.user ?? '').trim();
  const password = (env.password ?? '').trim();
  if (!user || !password) return null;
  return {
    header: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
    label: user,
    source: 'service',
  };
}

/**
 * Turn an incoming `Authorization` header into this request's credential.
 *
 * This is how an individual WLO user logs in: they configure their own
 * credentials once in their AI host's connector settings, the host sends the
 * header with every request, and the model never sees it. Nothing is stored
 * here — the header lives for the duration of one request.
 *
 * Two schemes, and the difference matters. **Basic** is taken as-is. **Bearer**
 * is accepted only as a `wlo2.` access block, which is DECODED here into a
 * Basic credential — the Bearer itself never leaves this server. That preserves
 * the older rule rather than breaking it: edu-sharing ignores a Bearer header
 * rather than rejecting it (probed 2026-07-30), so forwarding one would produce
 * a request that looks authenticated and silently is not. Anything else under
 * either scheme is refused.
 *
 * Both halves must be non-empty, the same rule `resolveServiceCredential`
 * applies: a half-filled login is not an identity. A connector whose password
 * field stayed empty would otherwise resolve to `mode: 'user'`, get the write
 * tools registered, and then fail every single call with 401.
 */
export function credentialFromHeader(raw: string | undefined): WloCredential | null {
  const value = (raw ?? '').trim();
  const bearer = /^Bearer\s+(\S+)$/i.exec(value);
  if (bearer) return credentialFromAccessBlock(bearer[1]!);
  const m = /^Basic\s+(\S+)$/i.exec(value);
  if (!m) return null;
  let decoded = '';
  try {
    decoded = Buffer.from(m[1], 'base64').toString('utf8');
  } catch {
    return null;
  }
  const sep = decoded.indexOf(':');
  if (sep <= 0 || sep === decoded.length - 1) return null; // user AND password
  return { header: value, label: decoded.slice(0, sep), source: 'user' };
}

/**
 * Key material plus the allow-list, or null when per-user access blocks are not
 * configured. Module-level like `serviceCredential` below and for the same
 * reason: it is decided once at startup and read on every request, and
 * threading it through `credentialFromHeader` would change a signature four
 * call sites and a dozen tests depend on.
 */
export interface AccessSupport {
  keys: AuthKeys;
  registry: AccessRegistry;
}

let accessSupport: AccessSupport | null = null;

/** Install (or clear) access-block support. Called once at startup, and by tests. */
export function setAccessSupport(support: AccessSupport | null): void {
  accessSupport = support;
}

/**
 * The installed support, or null when the feature is off. Read by the `/auth/*`
 * endpoints so there is ONE answer to "are access blocks enabled" — a second
 * copy of that state would let the pages offer what the header path refuses.
 */
export function currentAccessSupport(): AccessSupport | null {
  return accessSupport;
}

/**
 * Turn a `wlo2.` block into the credential it carries.
 *
 * Two gates, both required: the block must decrypt under a key we hold, and its
 * id must still be on the allow-list. The second is what revocation acts on —
 * without it the list would be decoration, since a decodable block would
 * authenticate forever.
 */
function credentialFromAccessBlock(raw: string): WloCredential | null {
  if (!accessSupport) return null;
  const payload = decodeAccessToken(raw, accessSupport.keys);
  if (!payload) return null;
  if (!accessSupport.registry.has(payload.jti)) return null;
  return {
    header: `Basic ${Buffer.from(`${payload.u}:${payload.secret}`).toString('base64')}`,
    label: payload.u,
    source: 'user',
  };
}

/**
 * The caller PRESENTED an `Authorization` header and we cannot use it.
 *
 * Not the same situation as sending none, and the difference decides what an
 * entry point may do next: "nothing presented" falls back to the service
 * account, "presented and refused" must not — that caller asked to act as
 * themselves, and silently lending them a shared identity gives them rights
 * they never asked for and attributes their changes to nobody.
 */
export function isUnusableAuthorization(raw: string | undefined): boolean {
  return (raw ?? '').trim().length > 0 && credentialFromHeader(raw) === null;
}

/**
 * The narrower case: a **Bearer** was presented and we could not open it —
 * forged, revoked, or encrypted for a key we do not hold.
 *
 * Separate from `isUnusableAuthorization` because the two lead somewhere
 * different. A Bearer we cannot use is OUR token failing, and the honest answer
 * is `401` with the pointer to where a new one is issued (see
 * `oauth-metadata.ts`). A `Basic` header we cannot parse is a WLO login the
 * caller got wrong; sending them into an authorization flow would answer a
 * question they did not ask, so that one keeps degrading to anonymous.
 */
export function isUnusableBearer(raw: string | undefined): boolean {
  const value = (raw ?? '').trim();
  return /^Bearer\s/i.test(value) && credentialFromHeader(value) === null;
}

/**
 * True when sending a credential to this repository would put it on the wire in
 * the clear. HTTP Basic is base64, not encryption, so `http://` exposes the
 * password to anyone on the path — and nothing in the response would reveal it.
 *
 * Loopback is exempt: a local edu-sharing over http is the ordinary development
 * setup, and a warning that fires there trains the operator to ignore the one
 * that matters. An unparseable URL counts as insecure — unknown is not safe.
 *
 * Takes the URL as an argument rather than reading the resolved config so this
 * module stays free of a `wlo-config` import (which imports this one).
 */
export function isInsecureCredentialTransport(repositoryUrl: string): boolean {
  let url: URL;
  try { url = new URL(repositoryUrl); } catch { return true; }
  if (url.protocol === 'https:') return false;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  return !(host === 'localhost' || host === '127.0.0.1' || host === '::1');
}

let serviceCredential: WloCredential | null = resolveServiceCredential({
  user: process.env['WLO_SERVICE_USER'],
  password: process.env['WLO_SERVICE_PASSWORD'],
});

/**
 * Per-request credential store. One HTTP endpoint serves every user, so the
 * individual identity CANNOT live in a module variable — two concurrent
 * requests would overwrite each other's rights. AsyncLocalStorage scopes it to
 * the request that carried it (`node:async_hooks`, no dependency).
 *
 * A store of `null` is NOT the same as no store: it means "this call is
 * explicitly anonymous" and stops the service-account fallback below. That
 * distinction is what keeps the public REST surface public.
 */
const perRequest = new AsyncLocalStorage<WloCredential | null>();

/** Run `fn` with this request's credential in scope. */
export function runWithCredential<T>(cred: WloCredential, fn: () => T): T {
  return perRequest.run(cred, fn);
}

/**
 * Run `fn` with NO credential, whatever the environment configures.
 *
 * For surfaces that are open to the internet without any authentication — the
 * public REST layer and the launcher. Without this they would inherit the
 * service account, and everything that account can see beyond public would be
 * readable by anyone, with no login and no audit trail. The elevated rights
 * belong to the MCP endpoint, which is where a client presents an identity.
 */
export function runAnonymous<T>(fn: () => T): T {
  return perRequest.run(null, fn);
}

/**
 * The credential for the current call, walking the chain:
 * per-request user → service account → none (anonymous).
 */
export function currentCredential(): WloCredential | null {
  const scoped = perRequest.getStore();
  // `undefined` = no scope was opened (fall back to the service account);
  // `null` = an explicitly anonymous scope, which must NOT fall back.
  return scoped !== undefined ? scoped : serviceCredential;
}

/**
 * The configured service account, ignoring any scope currently in effect.
 *
 * For an entry point that must ELEVATE deliberately: the internet-facing HTTP
 * surface runs anonymous by default, so the MCP endpoint resolves the chain
 * itself instead of relying on a fallback that would also apply to any surface
 * added later.
 */
export function configuredServiceCredential(): WloCredential | null {
  return serviceCredential;
}

/** Test seam — production code sets the credential from the environment only. */
export function setServiceCredentialForTest(c: WloCredential | null): void {
  serviceCredential = c;
}
