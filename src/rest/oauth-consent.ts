/**
 * rest/oauth-consent.ts – `/oauth/authorize`, both halves.
 *
 * The GET decides whether anyone is shown a password field; the POST decides
 * whether a code is minted. They share one check (`auth/oauth-authorize.ts`)
 * because they are the same request seen twice, and two copies of that rule are
 * where the PKCE requirement quietly disappears from the path that actually
 * hands out the code.
 *
 * Two properties hold on both halves:
 *
 * - **Check first, ask second.** Nothing is shown and nothing is minted until
 *   the client, the redirect target, the response type and the PKCE method are
 *   all recognised.
 * - **A refusal never redirects.** Sending an error to a `redirect_uri` we did
 *   not recognise would make this server a way to bounce people to arbitrary
 *   targets with our domain as the referrer.
 *
 * German user text on purpose: it is read by the person in front of the screen.
 */

import { issueAccessBlock } from '../auth/access-issue.js';
import type { AuthKeys } from '../auth/access-token.js';
import { ANONYMOUS_ACCESS_TOKEN, type AccessSupport } from '../auth/credential.js';
import { authorizationRedirect, checkAuthorizeParams } from '../auth/oauth-authorize.js';
import { log } from '../logger.js';
import { isJsonContentType } from '../read-body.js';
import { sanitizeText } from '../text-sanitize.js';
import { send, readJsonBody, type OAuthEndpointDeps, type OAuthReq, type OAuthRes } from './oauth-http.js';
import { AUTHORIZE_ASSET, AUTH_CSP, sendAsset } from './static.js';

/** What the log records for a connection made without an account. */
const ANONYMOUS_LABEL = '(ohne Konto)';

/** Does the caller want data rather than the page? The page's own fetch does. */
function wantsJson(req: OAuthReq): boolean {
  const accept = req.headers?.['accept'];
  return (Array.isArray(accept) ? accept.join(',') : accept ?? '').includes('application/json');
}

/**
 * A refusal, as a page. No interpolation of anything the caller sent: the text
 * is one of a fixed set from `oauth-authorize.ts`, so there is nothing here that
 * needs escaping and nothing a client can make this page say.
 */
function refusalPage(message: string): string {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Anfrage abgelehnt · WirLernenOnline</title>
<link rel="stylesheet" href="/auth.css" />
</head>
<body>
<main>
  <h1>Diese Anfrage wurde abgelehnt</h1>
  <div class="card">
    <p>${message}</p>
    <p class="hint">Es wurde nichts an dein Konto weitergegeben und keine Anmeldung versucht.
      Bitte die Verbindung im Programm neu einrichten.</p>
  </div>
  <footer><p>WirLernenOnline · <a href="/">Zur Launcher-Seite</a></p></footer>
</main>
</body>
</html>
`;
}

/**
 * `GET /oauth/authorize` — check first, ask second.
 *
 * The JSON form exists because the consent screen has to name who is asking, and
 * the `client_id` is a ciphertext the browser cannot open. The page therefore
 * asks this same URL what was recognised, rather than repeating the caller's own
 * query back at the person about to type their password.
 */
export async function showConsent(
  req: OAuthReq,
  res: OAuthRes,
  params: URLSearchParams,
  keys: AuthKeys,
): Promise<true> {
  const checked = checkAuthorizeParams((name) => params.get(name), keys);
  if (!checked.ok) {
    log.info('authorization request refused', { reason: checked.error });
    if (wantsJson(req)) return send(res, 400, { error: checked.error });
    res.writeHead(400, {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': AUTH_CSP,
    });
    res.end(refusalPage(checked.error));
    return true;
  }

  if (wantsJson(req)) {
    return send(res, 200, {
      client_name: checked.request.client.name,
      redirect_uri: checked.request.redirectUri,
    }, { 'Cache-Control': 'no-store' });
  }

  await sendAsset(res, AUTHORIZE_ASSET);
  return true;
}

/**
 * `POST /oauth/authorize` — the consent itself.
 *
 * JSON, not a form. `form-action 'none'` is in the page's policy, and a JSON
 * body cannot be sent cross-origin without a preflight the browser will refuse
 * here (`/oauth/authorize` carries no CORS header, by the rule from P1). That
 * closes CSRF without a token of our own — and CSRF on this endpoint would mean
 * a page elsewhere getting a code minted for a login it does not have anyway.
 *
 * The parameters are re-checked even though the GET already checked them: the
 * GET decided what to SHOW, this decides what to MINT, and only one of the two
 * can be trusted to have happened.
 *
 * What comes back is a redirect TARGET, not a redirect: the page navigates. A
 * 302 would work for a browser and would also let anything else discover the
 * code by following it.
 */
export async function grantConsent(
  req: OAuthReq,
  res: OAuthRes,
  deps: OAuthEndpointDeps,
  support: AccessSupport,
): Promise<true> {
  // The header is the CSRF defence, not a formality. A `<form
  // enctype="text/plain">` is a SIMPLE request — no preflight — and its body can
  // be crafted to parse as JSON, so an endpoint that parses whatever arrives is
  // reachable from any page in the world. Requiring `application/json` makes the
  // request non-simple, and the preflight then fails on the missing CORS header.
  // Without it a page could spend every visitor's address on a password guess,
  // which is exactly what `authAbuseLimiter` counts per address to prevent.
  if (!isJsonContentType(req.headers?.['content-type'])) {
    return send(res, 415, { error: 'Dieser Endpunkt erwartet einen JSON-Body (Content-Type: application/json).' });
  }

  const body = await readJsonBody(req, deps.maxBodyBytes);
  if (!body || body === 'too-large') {
    return send(res, 400, { error: 'Die Anfrage konnte nicht gelesen werden.' });
  }

  const checked = checkAuthorizeParams(
    (name) => (typeof body[name] === 'string' ? (body[name] as string) : null),
    support.keys,
  );
  if (!checked.ok) {
    log.info('consent refused before any login was tried', { reason: checked.error });
    return send(res, 400, { error: checked.error });
  }

  // The third exit of the consent page: connect without an account of one's own.
  // A client that found our discovery documents cannot simply send no header —
  // it wants a token — so without this its only choices are signing in or
  // cancelling, and cancelling is not a connection.
  //
  // Nothing is verified here because there is nothing to verify: the token that
  // comes out grants exactly what a request with no `Authorization` grants (see
  // `ANONYMOUS_ACCESS_TOKEN`). No upstream call, no allow-list entry, and the
  // guessing limiter is not touched — it counts credentials, and there is none.
  //
  // The INTENT has to be stated. A request that merely forgot the block keeps
  // failing below, rather than quietly ending up as an anonymous connection.
  const anonymous = body['anonymous'] === true;
  const token = typeof body['token'] === 'string' ? body['token'] : '';
  if (!anonymous && !token) return send(res, 400, { error: 'Es wurde kein Zugangsblock übermittelt.' });

  // The same issuance `/auth/issue` performs: decode, limit, and verify the
  // login at the AUTHORITY rather than at the status code.
  const outcome = anonymous
    ? ({ ok: true, label: ANONYMOUS_LABEL, jti: '' } as const)
    : await issueAccessBlock(
      token,
      { ip: deps.ip, authAbuseLimiter: deps.authAbuseLimiter, support },
      Date.now(),
    );
  if (!outcome.ok) {
    return send(res, outcome.status, { error: outcome.error },
      outcome.status === 429 ? { 'Retry-After': '600' } : {});
  }

  const code = deps.codeStore.mint({
    clientId: checked.request.clientId,
    redirectUri: checked.request.redirectUri,
    challenge: checked.request.challenge,
    // For a login: still a ciphertext. It waits here for `/oauth/token` and is
    // never opened in between — the password is not part of this path.
    block: anonymous ? ANONYMOUS_ACCESS_TOKEN : token,
    label: outcome.label,
  }, Date.now());

  // `sanitizeText` on the label like every other site that logs it: the logger's
  // JSON encoding already closes line forging, so this is about the length cap
  // and about the rule reading the same way everywhere it applies.
  log.info('authorization code issued', {
    client: checked.request.client.name,
    label: sanitizeText(outcome.label),
  });
  return send(res, 200, { redirect: authorizationRedirect(checked.request, code) },
    { 'Cache-Control': 'no-store' });
}
