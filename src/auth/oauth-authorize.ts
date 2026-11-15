/**
 * auth/oauth-authorize.ts – what makes an authorization request acceptable.
 *
 * Pure, and shared by both halves of `/oauth/authorize`: the GET that decides
 * whether anyone is shown a password field, and the POST that decides whether a
 * code is minted. One copy on purpose — a second one is where the PKCE method
 * quietly becomes optional on the path that actually hands out the code.
 *
 * The order below is the security argument of the whole endpoint: **everything
 * is checked before a password is asked for, and a request that fails is never
 * redirected anywhere.** Sending an error to a `redirect_uri` we did not
 * recognise would make this server a way to bounce people to arbitrary targets
 * with our domain as the referrer.
 *
 * German error text: it is shown to the person in front of the screen.
 */

import type { AuthKeys } from './access-token.js';
import { decodeClientId, redirectUriMatches, type OAuthClient } from './oauth-clients.js';

/**
 * Read one parameter. A function rather than an object so the GET can use
 * `URLSearchParams.get` — which takes the FIRST of a repeated parameter, the
 * same one the browser page reads — while the POST reads its JSON body.
 */
export type ParamReader = (name: string) => string | null;

export interface AuthorizeRequest {
  client: OAuthClient;
  /** The `client_id` as presented, carried on so the code can be bound to it. */
  clientId: string;
  /** The redirect target, as matched against the registration. */
  redirectUri: string;
  /** PKCE `code_challenge` (S256). */
  challenge: string;
  /** Opaque client state, passed back untouched. Absent stays absent. */
  state: string | null;
}

export type AuthorizeCheck =
  | { ok: true; request: AuthorizeRequest }
  | { ok: false; error: string };

/**
 * A PKCE S256 challenge: SHA-256, base64url, unpadded — always 43 characters.
 * Length is part of the check because a short "challenge" would otherwise pass
 * and be brute-forceable at the token endpoint.
 */
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export function checkAuthorizeParams(read: ParamReader, keys: AuthKeys): AuthorizeCheck {
  const clientId = (read('client_id') ?? '').trim();
  const client = clientId ? decodeClientId(clientId, keys) : null;
  if (!client) {
    return { ok: false, error: 'Diese Anfrage stammt von keinem Programm, das dieser Server kennt.' };
  }

  const redirectUri = (read('redirect_uri') ?? '').trim();
  const registered = client.redirectUris.find((uri) => redirectUriMatches(uri, redirectUri));
  if (!registered) {
    return {
      ok: false,
      error: 'Die Rückleitungsadresse dieser Anfrage gehört nicht zu diesem Programm.',
    };
  }

  if (read('response_type') !== 'code') {
    return { ok: false, error: 'Dieser Anfragetyp wird von diesem Server nicht unterstützt.' };
  }

  // `plain` is refused, not tolerated: with it the "proof" at the token endpoint
  // is the same string that travelled in the URL, which proves nothing.
  const challenge = read('code_challenge') ?? '';
  if (read('code_challenge_method') !== 'S256' || !CHALLENGE.test(challenge)) {
    return {
      ok: false,
      error: 'Diese Anfrage erfüllt die Sicherheitsanforderungen nicht (PKCE mit S256 ist Pflicht).',
    };
  }

  return {
    ok: true,
    request: { client, clientId, redirectUri, challenge, state: read('state') },
  };
}

/**
 * Where to send the browser once consent has been given.
 *
 * The code travels in the query, as RFC 6749 §4.1.2 prescribes; the access block
 * never does. `state` is passed back exactly as it arrived — including empty —
 * and omitted when it was absent, because a client that sent none will compare
 * against none.
 */
export function authorizationRedirect(request: AuthorizeRequest, code: string): string {
  const url = new URL(request.redirectUri);
  url.searchParams.set('code', code);
  if (request.state !== null) url.searchParams.set('state', request.state);
  return url.toString();
}
