/**
 * auth/oauth-metadata.ts – what this server publishes about its own OAuth
 * surface, and where it says that surface lives.
 *
 * Two documents, both public and both free of anything secret:
 *   - RFC 8414 authorization-server metadata → `/.well-known/oauth-authorization-server`
 *   - RFC 9728 protected-resource metadata   → `/.well-known/oauth-protected-resource`
 *
 * The ISSUER is the security-relevant part. It is the origin a client sends its
 * user's browser to and fetches a token from, so whoever decides it decides
 * where a login happens. Derived from the `Host` header it would be the CALLER,
 * and a forged header would point somebody's client at a login page we do not
 * own. `WLO_PUBLIC_BASE_URL` is therefore the source; the header is consulted
 * only under `TRUST_PROXY`, the same condition under which this server already
 * believes `X-Forwarded-For` (see `rate-limit.ts`).
 *
 * Pure: no HTTP, no filesystem, no `process.env`. The entry point reads the
 * environment and passes it in — the rule `access-setup.ts` documents, for the
 * reason it documents there.
 */

/** The one scope. It mirrors whatever the WLO account itself may do. */
const SCOPES = ['wlo'];

export interface IssuerEnv {
  /** `WLO_PUBLIC_BASE_URL` — the authoritative answer when set. */
  configured?: string;
  /** The request's `Host` header. Caller-supplied; only used with `trustProxy`. */
  host?: string;
  /** `X-Forwarded-Proto`; node:http yields an array when it arrives twice. */
  forwardedProto?: string | string[];
  trustProxy: boolean;
}

/**
 * A `Host` value that is a host and nothing else: a registered name, an IPv4
 * literal, or a bracketed IPv6 one, each with an optional port.
 *
 * Deliberately stricter than what `new URL()` would swallow. `evil@mcp.example`
 * and `mcp.example/pfad` both parse and both yield the right origin, so nothing
 * would break — but a `Host` shaped like that means something upstream is wrong
 * or hostile, and answering `null` (OAuth off) is the safer reading of it.
 */
const HOST = /^(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(?::\d{1,5})?$/;

/** First entry of a repeated or comma-joined header — the hop facing the client. */
function firstValue(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] ?? '' : raw ?? '';
  return (value.split(',')[0] ?? '').trim().toLowerCase();
}

/**
 * The public origin of this deployment, or `null` when it cannot be established
 * — which switches the whole OAuth surface off rather than guessing.
 *
 * A configured value that will not parse yields `null` too, instead of falling
 * back to the header. The fallback would be the worst of both: the operator
 * believes they pinned the origin, and the caller picks it anyway.
 */
export function resolveIssuer(env: IssuerEnv): string | null {
  const configured = (env.configured ?? '').trim();
  if (configured) return originOf(configured);
  if (!env.trustProxy) return null;

  const host = env.host ?? '';
  if (!HOST.test(host)) return null;
  const proto = firstValue(env.forwardedProto);
  // Anything but the two schemes we could actually be reached over is ignored
  // rather than carried into a document clients will act on.
  return originOf(`${proto === 'http' ? 'http' : 'https'}://${host}`);
}

/** `URL.origin`, or null when the value is not a usable absolute URL. */
function originOf(raw: string): string | null {
  try {
    const url = new URL(raw);
    // `origin` is "null" for schemes without one (e.g. `file:`); a document
    // built on that string would be nonsense.
    return url.origin === 'null' ? null : url.origin;
  } catch {
    return null;
  }
}

/**
 * RFC 8414. Public clients with PKCE only — no secret is ever issued, so there
 * is no client authentication to announce beyond `none`.
 *
 * Every list here is a promise the endpoints keep: `refresh_token` is absent
 * because we issue none (the access block does not expire; revocation replaces
 * it), and `plain` is absent because `/oauth/authorize` refuses it.
 */
export function authorizationServerMetadata(issuer: string): Record<string, unknown> {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: SCOPES,
  };
}

/**
 * The `WWW-Authenticate` value for a Bearer we were given and cannot use.
 *
 * This is the doorway the MCP specification prescribes: the `resource_metadata`
 * pointer (RFC 9728 §5.1) tells a client where to read who may authorize it,
 * which is how a client that never probed our well-known paths still finds them.
 *
 * Without an issuer the verdict stands and only the pointer falls away — the
 * token really is unusable, and naming an origin we did not choose would be
 * worse than saying nothing.
 */
export function bearerChallenge(issuer: string | null): string {
  const parts = [
    'error="invalid_token"',
    'error_description="The access token is invalid or has been revoked."',
  ];
  if (issuer) parts.push(`resource_metadata="${issuer}/.well-known/oauth-protected-resource"`);
  return `Bearer ${parts.join(', ')}`;
}

/** RFC 9728 — the MCP endpoint, and this server as the authority for it. */
export function protectedResourceMetadata(issuer: string): Record<string, unknown> {
  return {
    resource: `${issuer}/mcp`,
    authorization_servers: [issuer],
    scopes_supported: SCOPES,
    bearer_methods_supported: ['header'],
  };
}
