/**
 * authorize.js — page logic for "Zugriff erlauben" (the OAuth consent screen).
 *
 * Same order, same argument as `auth.js`: fetch the server's public key,
 * encrypt in the browser, and only THEN send anything. The password never
 * crosses the network. What travels is the block, which the server opens in
 * memory to verify the login before it mints an authorization code.
 *
 * Who is asking is NOT read from the query string. The `client_id` is a
 * ciphertext only the server can open, so the name and the redirect target
 * shown here come back from `GET /oauth/authorize` — that is, from the values
 * this server recognised. Repeating the caller's own text back at the user
 * would make the consent screen say whatever the caller wants it to say.
 *
 * German user text on purpose: the page is shown verbatim to WLO editors.
 */

import { encodeAccessBlock } from './access-block.js';

const form = document.getElementById('authorize-form');
const userInput = document.getElementById('user');
const secretInput = document.getElementById('secret');
const submit = document.getElementById('submit');
const deny = document.getElementById('deny');
const anonymous = document.getElementById('anonymous');
const status = document.getElementById('status');
const clientName = document.getElementById('client-name');
const redirectOrigin = document.getElementById('redirect-origin');

const params = new URLSearchParams(location.search);

/** The redirect target as the SERVER confirmed it; null until it has. */
let approvedRedirect = null;

/** Set the live region. `kind` drives the styling; the words carry the meaning. */
function say(text, kind) {
  status.textContent = text;
  status.className = kind ? `status ${kind}` : 'status';
}

async function publicKey() {
  const res = await fetch('/auth/public-key', { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Der Server bietet gerade keine Zugänge an. Bitte später erneut versuchen.');
  const data = await res.json();
  if (!data || typeof data.publicKey !== 'string') throw new Error('Der Server hat keinen Schlüssel geliefert.');
  return data.publicKey;
}

/**
 * Ask this same URL what it made of the request. The parameters were already
 * checked before this page was served, so a failure here means the page was
 * reloaded after they went stale — say so instead of showing a password field
 * for a request nobody recognises.
 */
async function loadRequest() {
  const res = await fetch(location.href, { headers: { Accept: 'application/json' } });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || typeof data.redirect_uri !== 'string') {
    throw new Error(data?.error ?? 'Diese Anfrage ist nicht mehr gültig. Bitte im Programm neu verbinden.');
  }
  return data;
}

loadRequest().then((request) => {
  approvedRedirect = request.redirect_uri;
  // textContent, never innerHTML: the name is text a client chose.
  clientName.textContent = request.client_name;
  redirectOrigin.textContent = new URL(request.redirect_uri).origin;
  submit.disabled = false;
  anonymous.disabled = false;
  say('', null);
  userInput.focus();
}).catch((err) => {
  clientName.textContent = 'unbekannt';
  redirectOrigin.textContent = 'unbekannt';
  say(err instanceof Error ? err.message : 'Unbekannter Fehler.', 'error');
});

/**
 * The authorization request, as the endpoint re-checks it.
 *
 * ONE place, used by both exits. Every parameter travels again because the POST
 * is validated by the same function the GET used — and a field left out here is
 * a request the endpoint refuses. That is not hypothetical: `response_type` was
 * missing once, every consent failed, and page and endpoint were each green
 * against their own idea of the body.
 *
 * `state` is the exception, deliberately: absent must stay absent, or a client
 * that sent none gets an empty one back and compares it against nothing. An
 * empty string it DID send is passed on unchanged.
 */
function authorizeBody(extra) {
  return JSON.stringify({
    client_id: params.get('client_id') ?? '',
    redirect_uri: approvedRedirect,
    response_type: params.get('response_type') ?? '',
    code_challenge: params.get('code_challenge') ?? '',
    code_challenge_method: params.get('code_challenge_method') ?? '',
    ...(params.has('state') ? { state: params.get('state') } : {}),
    ...extra,
  });
}

/** Send a prepared body and follow the target the SERVER hands back. */
async function grant(body) {
  const res = await fetch('/oauth/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || typeof data.redirect !== 'string') {
    // The server distinguishes "WLO rejected these credentials" from everything
    // else; showing its text means a typo says so plainly.
    throw new Error(data?.error ?? 'Die Anmeldung konnte nicht abgeschlossen werden.');
  }
  return data.redirect;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!approvedRedirect) return;

  const user = userInput.value.trim();
  const secret = secretInput.value;

  // Checked here rather than with `required` alone so the message lands in the
  // live region, where a screen reader announces it.
  if (!user || !secret) {
    say('Bitte Benutzername und Passwort ausfüllen.', 'error');
    (user ? secretInput : userInput).focus();
    return;
  }

  submit.disabled = true;
  deny.disabled = true;
  anonymous.disabled = true;
  say('Verschlüsseln und anmelden …', 'busy');

  try {
    const block = await encodeAccessBlock(user, secret, await publicKey());
    const target = await grant(authorizeBody({ token: block }));

    // The password is done with; it should not sit in the field while the
    // browser navigates away.
    secretInput.value = '';
    say('Angemeldet. Zurück zum Programm …', 'ok');
    location.assign(target);
  } catch (err) {
    say(err instanceof Error ? err.message : 'Unbekannter Fehler.', 'error');
    anonymous.disabled = false;
    submit.disabled = false;
    deny.disabled = false;
  }
});

deny.addEventListener('click', () => {
  // Refusing is an answer the client is entitled to (RFC 6749 §4.1.2.1), and it
  // goes to the target the server confirmed — not to whatever the query said.
  if (!approvedRedirect) {
    say('Abgelehnt. Du kannst dieses Fenster schließen.', 'ok');
    return;
  }
  const target = new URL(approvedRedirect);
  target.searchParams.set('error', 'access_denied');
  const state = params.get('state');
  if (state !== null) target.searchParams.set('state', state);
  location.assign(target.toString());
});

anonymous.addEventListener('click', async () => {
  // The third exit: connect, but as nobody in particular. Nothing is encrypted
  // and nothing is sent upstream, because there is no credential involved — the
  // token this yields grants exactly what a call with no Authorization grants.
  if (!approvedRedirect) return;

  submit.disabled = true;
  deny.disabled = true;
  anonymous.disabled = true;
  say('Verbinden …', 'busy');

  try {
    location.assign(await grant(authorizeBody({ anonymous: true })));
  } catch (err) {
    say(err instanceof Error ? err.message : 'Unbekannter Fehler.', 'error');
    anonymous.disabled = false;
    submit.disabled = false;
    deny.disabled = false;
  }
});
