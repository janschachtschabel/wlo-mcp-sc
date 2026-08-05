/**
 * rest/oauth-token.ts – `POST /oauth/token`, where a code becomes the access.
 *
 * What comes out is the `wlo2.…` access block itself. There is no second
 * credential to mint: the block already IS a bearer this server can verify and
 * the holder can revoke, so wrapping it in another token would only add a store
 * to lose on restart and a lifetime we could not honestly name.
 *
 * Two rules the order encodes:
 *
 * - **Consumed is consumed.** The code is taken out of the store BEFORE any
 *   check runs. A failed PKCE proof must not leave it lying there for the next
 *   guess — that would turn the one-time code into an oracle.
 * - **PKCE is proof, not decoration.** The verifier is hashed and compared in
 *   constant time. Without it, whoever intercepted the redirect (a shared
 *   machine, a logging proxy, a browser extension) could redeem the code.
 *
 * `application/x-www-form-urlencoded`, because that is what RFC 6749 §4.1.3
 * prescribes and what every OAuth client sends. Errors follow §5.2: a short
 * machine code, and a description that never says which check failed — an
 * attacker holding a stolen code should not learn whether the client id was the
 * wrong part.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

import { redirectUriMatches } from '../auth/oauth-clients.js';
import { log } from '../logger.js';
import { readBodyWithLimit } from '../read-body.js';
import { send, type OAuthEndpointDeps, type OAuthReq, type OAuthRes } from './oauth-http.js';

/** RFC 6749 §5.2 shape. `no-store` because the body carries the credential. */
function tokenError(res: OAuthRes, error: string, description: string): true {
  return send(res, 400, { error, error_description: description }, { 'Cache-Control': 'no-store' });
}

/** The S256 transformation of RFC 7636 §4.6. */
const s256 = (verifier: string): string =>
  createHash('sha256').update(verifier).digest('base64url');

/**
 * Compare two challenge strings without leaking where they differ.
 *
 * Both sides are hashes here, so a timing leak is of limited use — but the
 * comparison is one line either way, and the next person to reuse this function
 * may not be comparing hashes.
 */
function sameChallenge(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function exchangeCode(
  req: OAuthReq,
  res: OAuthRes,
  deps: OAuthEndpointDeps,
): Promise<true> {
  const { tooLarge, text } = await readBodyWithLimit(req, deps.maxBodyBytes);
  if (tooLarge || !text) {
    return tokenError(res, 'invalid_request', 'A form-encoded request body is required.');
  }
  const form = new URLSearchParams(text);

  if (form.get('grant_type') !== 'authorization_code') {
    return tokenError(res, 'unsupported_grant_type',
      'Only the authorization_code grant is supported.');
  }

  // Removed first, always: whatever fails below, this code is spent.
  const record = deps.codeStore.consume(form.get('code') ?? '', Date.now());

  // One message for every way this can fail. Which check it was is exactly the
  // thing a holder of a stolen code would like to know.
  const refuse = (reason: string): true => {
    log.info('token exchange refused', { reason });
    return tokenError(res, 'invalid_grant',
      'The authorization code is invalid, expired, or already used.');
  };

  if (!record) return refuse('unknown or expired code');
  if (record.clientId !== (form.get('client_id') ?? '')) return refuse('code belongs to another client');
  if (!redirectUriMatches(record.redirectUri, form.get('redirect_uri') ?? '')) {
    return refuse('redirect target does not match the one the code was issued for');
  }
  if (!sameChallenge(s256(form.get('code_verifier') ?? ''), record.challenge)) {
    return refuse('PKCE verifier does not match the challenge');
  }

  log.info('access token issued', { label: record.label });
  return send(res, 200, {
    // The block, unchanged. `Pragma` alongside `Cache-Control` because RFC 6749
    // §5.1 asks for it and an HTTP/1.0 proxy still reads it.
    access_token: record.block,
    token_type: 'Bearer',
    scope: 'wlo',
  }, { 'Cache-Control': 'no-store', Pragma: 'no-cache' });
}
