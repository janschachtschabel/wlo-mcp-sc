/**
 * rest/oauth-pages.ts – the OAuth surface, as HTTP.
 *
 * Sibling of `rest/auth-pages.ts` and built the same way: a closed set of paths,
 * `false` for anything else so the caller falls through, and an error boundary
 * that turns an unexpected throw into a generic 500 with the reason in the log.
 *
 * This module is the ROUTER plus the two surfaces that need no login:
 *
 *   GET  /.well-known/oauth-authorization-server[/mcp]  → RFC 8414
 *   GET  /.well-known/oauth-protected-resource[/mcp]    → RFC 9728
 *   POST /oauth/register                                → RFC 7591
 *
 * The login flow lives beside it — `oauth-consent.ts` for `/oauth/authorize`,
 * `oauth-token.ts` for `/oauth/token` — and what they share sits in
 * `oauth-http.ts`. Split when this file passed 300 lines with distinct reasons
 * to change: publishing metadata, taking somebody's password, and redeeming a
 * one-time code are three different things to get wrong.
 *
 * Both spellings of each, because clients differ on whether the resource path is
 * appended (RFC 8414 §3.1 prescribes it for an issuer WITH a path component;
 * ours has none, so the plain form is the correct one — but serving the other
 * costs nothing and a client guessing wrong would otherwise see a 404 and
 * conclude this server has no OAuth at all).
 *
 * OFF is 404, never 500, and there are two ways to be off. Without key material
 * there is no access block to hand out, so there is nothing for OAuth to issue.
 * Without a resolvable issuer the documents would name endpoints on a host we
 * did not choose (see `auth/oauth-metadata.ts`). Either way the endpoint should
 * not exist rather than half-work — the same shape as a tool that is never
 * registered.
 */

import { currentAccessSupport } from '../auth/credential.js';
import type { AuthKeys } from '../auth/access-token.js';
import {
  MAX_REDIRECT_URIS,
  encodeClientId,
  isValidRedirectUri,
} from '../auth/oauth-clients.js';
import {
  authorizationServerMetadata,
  protectedResourceMetadata,
} from '../auth/oauth-metadata.js';
import { log } from '../logger.js';
import { parseRequestUrl } from '../request-url.js';
import { flattenText } from '../text-sanitize.js';
import { grantConsent, showConsent } from './oauth-consent.js';
import { exchangeCode } from './oauth-token.js';
import {
  JSON_HEADERS,
  readJsonBody,
  send,
  type OAuthEndpointDeps,
  type OAuthReq,
  type OAuthRes,
} from './oauth-http.js';

/** Five minutes: long enough to spare the round trip, short enough that a
 *  corrected issuer reaches clients the same day. */
const METADATA_CACHE = 'max-age=300';

/** Which document each path serves. Both spellings map to the same builder. */
const DISCOVERY: Record<string, (issuer: string) => Record<string, unknown>> = {
  '/.well-known/oauth-authorization-server': authorizationServerMetadata,
  '/.well-known/oauth-authorization-server/mcp': authorizationServerMetadata,
  '/.well-known/oauth-protected-resource': protectedResourceMetadata,
  '/.well-known/oauth-protected-resource/mcp': protectedResourceMetadata,
};

const REGISTER_PATH = '/oauth/register';
const AUTHORIZE_PATH = '/oauth/authorize';
const TOKEN_PATH = '/oauth/token';

/** Paths this module owns, with the methods each accepts. */
const ROUTES: Record<string, readonly ('GET' | 'POST')[]> = {
  ...Object.fromEntries(Object.keys(DISCOVERY).map((p) => [p, ['GET'] as const])),
  [REGISTER_PATH]: ['POST'],
  [AUTHORIZE_PATH]: ['GET', 'POST'],
  [TOKEN_PATH]: ['POST'],
};

/** Shown on the consent screen when a client registers without a name. */
const FALLBACK_CLIENT_NAME = 'MCP-Client';
const MAX_CLIENT_NAME = 100;

/**
 * Error boundary, for the reason `auth-pages.ts` documents: node:http ignores a
 * handler's returned promise, so a rejection that escapes leaves the caller with
 * no response at all until `requestTimeout`.
 */
export async function handleOAuthEndpoint(
  req: OAuthReq,
  res: OAuthRes,
  deps: OAuthEndpointDeps,
): Promise<boolean> {
  try {
    return await route(req, res, deps);
  } catch (err) {
    log.error('oauth endpoint failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    if (!res.headersSent) {
      res.writeHead(500, JSON_HEADERS);
      res.end(JSON.stringify({ error: 'Serverfehler. Bitte später erneut versuchen.' }));
    }
    return true;
  }
}

async function route(req: OAuthReq, res: OAuthRes, deps: OAuthEndpointDeps): Promise<boolean> {
  const parsed = parseRequestUrl(req.url);
  if (!parsed) return false;

  const wanted = ROUTES[parsed.pathname];
  if (!wanted) return false;

  const support = currentAccessSupport();
  if (!support || !deps.issuer) {
    return send(res, 404, { error: 'OAuth ist auf diesem Server nicht eingerichtet.' });
  }

  if (!wanted.includes(req.method as 'GET' | 'POST')) {
    const allow = wanted.join(', ');
    return send(res, 405, { error: `Method not allowed. Use ${allow}.` }, { Allow: allow });
  }

  if (deps.rateLimiter.check(deps.ip, Date.now())) {
    return send(res, 429, { error: 'Zu viele Anfragen. Bitte in einer Minute erneut versuchen.' },
      { 'Retry-After': '60' });
  }

  const document = DISCOVERY[parsed.pathname];
  if (document) return send(res, 200, document(deps.issuer), { 'Cache-Control': METADATA_CACHE });

  if (parsed.pathname === AUTHORIZE_PATH) {
    return req.method === 'POST'
      ? grantConsent(req, res, deps, support)
      : showConsent(req, res, parsed.searchParams, support.keys);
  }

  if (parsed.pathname === TOKEN_PATH) return exchangeCode(req, res, deps);

  return registerClient(req, res, deps, support.keys);
}

/** RFC 7591 error shape. Two codes, and the caller never learns more. */
function metadataError(res: OAuthRes, description: string, status = 400): true {
  return send(res, status, { error: 'invalid_client_metadata', error_description: description });
}

/**
 * Dynamic Client Registration (RFC 7591) — open, as the MCP specification
 * expects, and harmless because it grants nothing: the resulting `client_id`
 * carries only where a code may be sent, and getting a code still requires a
 * WLO login in the user's own browser.
 */
async function registerClient(
  req: OAuthReq,
  res: OAuthRes,
  deps: OAuthEndpointDeps,
  keys: AuthKeys,
): Promise<true> {
  const body = await readJsonBody(req, deps.maxBodyBytes);
  if (body === 'too-large') return metadataError(res, 'Request body is too large.', 413);
  if (!body) return metadataError(res, 'Body must be a JSON object.');

  const uris = body['redirect_uris'];
  if (
    !Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS
    || !uris.every((u): u is string => typeof u === 'string' && isValidRedirectUri(u))
  ) {
    return send(res, 400, {
      error: 'invalid_redirect_uri',
      error_description:
        `redirect_uris must be 1–${MAX_REDIRECT_URIS} absolute https URLs (http only on localhost), without a fragment.`,
    });
  }

  // The name is caller-chosen text that will be shown to a person about to type
  // their password. `flattenText` drops invisible characters and flattens
  // control ones, so it cannot forge a second line on that screen; the cap keeps
  // it from pushing the rest of the screen out of view.
  const rawName = body['client_name'];
  const name = (typeof rawName === 'string' ? flattenText(rawName).slice(0, MAX_CLIENT_NAME).trim() : '')
    || FALLBACK_CLIENT_NAME;

  const clientId = encodeClientId({ redirectUris: uris, name }, keys);
  log.info('oauth client registered', { name, redirectUris: uris.length });

  // No `client_secret`: public clients with PKCE only. There is nowhere to keep
  // a secret anyway — see `auth/oauth-clients.ts` on why the id is self-contained.
  return send(res, 201, {
    client_id: clientId,
    client_name: name,
    redirect_uris: uris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code'],
    response_types: ['code'],
  }, { 'Cache-Control': 'no-store' });
}
