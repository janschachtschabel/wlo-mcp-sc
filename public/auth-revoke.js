/**
 * auth-revoke.js — page logic for "MCP-Zugang sperren".
 *
 * Two ways in, because the block reaches the person on only one of the two
 * routes into this server:
 *
 *  - **By block.** No crypto: the block is sent as-is, the server opens it,
 *    reads the id and strikes it. Possession of the block is the proof, so no
 *    password is typed on a page you may be visiting precisely because that
 *    password is compromised.
 *  - **By account.** Over OAuth the block goes to the AI host and the person
 *    never sees it, so there is no id to send. Here the password is the proof —
 *    encrypted in the browser exactly as on the issuance page — and the server
 *    strikes every access of that account.
 */

import { encodeAccessBlock, fetchPublicKey } from './access-block.js';
import { initI18n, msg, serverMessage } from './auth-i18n.js';

// First: the page is in the visitor's language before anything is announced.
initI18n();

const form = document.getElementById('revoke-form');
const blockInput = document.getElementById('block');
const submit = document.getElementById('submit');
const status = document.getElementById('status');

const accountForm = document.getElementById('account-form');
const userInput = document.getElementById('user');
const secretInput = document.getElementById('secret');
const accountSubmit = document.getElementById('account-submit');
const accountStatus = document.getElementById('account-status');

function say(text, kind) {
  status.textContent = text;
  status.className = kind ? `status ${kind}` : 'status';
}

function sayAccount(text, kind) {
  accountStatus.textContent = text;
  accountStatus.className = kind ? `status ${kind}` : 'status';
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  // The issuance page hands out the value WITH the scheme, because that is what
  // the connector field wants. Accepting it back verbatim spares people an edit
  // they would otherwise get wrong.
  const token = blockInput.value.trim().replace(/^Bearer\s+/i, '');

  if (!token) {
    say(msg('revoke_need_block', 'Bitte den Zugangsblock einfügen.'), 'error');
    blockInput.focus();
    return;
  }

  submit.disabled = true;
  say(msg('revoke_busy', 'Wird gesperrt …'), 'busy');

  try {
    const res = await fetch('/auth/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      throw new Error(detail?.error ? serverMessage(detail.error) : msg('revoke_failed', 'Der Block konnte nicht gesperrt werden.'));
    }

    const data = await res.json();
    // "was not active" is not an error: the honest outcomes are "it is gone now"
    // and "it was already gone", and both end with the block being useless.
    say(
      data?.revoked
        ? msg('revoke_done', 'Gesperrt. Dieser Zugang funktioniert ab sofort nicht mehr.')
        : msg('revoke_was_gone', 'Dieser Block war bereits gesperrt oder nie aktiv. Er funktioniert nicht.'),
      'ok',
    );
    blockInput.value = '';
  } catch (err) {
    say(err instanceof Error ? err.message : msg('unknown_error', 'Unbekannter Fehler.'), 'error');
  } finally {
    submit.disabled = false;
  }
});

accountForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const user = userInput.value.trim();
  const secret = secretInput.value;

  // Checked here rather than with `required` alone so the message lands in the
  // live region, where a screen reader announces it.
  if (!user || !secret) {
    sayAccount(msg('fill_both', 'Bitte Benutzername und Passwort ausfüllen.'), 'error');
    (user ? secretInput : userInput).focus();
    return;
  }

  accountSubmit.disabled = true;
  sayAccount(msg('revoke_all_busy', 'Anmeldung prüfen und sperren …'), 'busy');

  try {
    const token = await encodeAccessBlock(user, secret, await fetchPublicKey());

    const res = await fetch('/auth/revoke-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      // The server distinguishes "WLO rejected these credentials" from
      // everything else, and that distinction matters more here than on the
      // issuance page: a typo would otherwise read as "you had no accesses".
      throw new Error(detail?.error ? serverMessage(detail.error) : msg('revoke_all_failed', 'Die Zugänge konnten nicht gesperrt werden.'));
    }

    const data = await res.json();
    const count = Number(data?.revoked ?? 0);
    sayAccount(
      count === 1
        ? msg('revoke_all_one', '1 Zugang wurde gesperrt. Betroffene KI-Programme müssen neu verbunden werden.')
        : count > 1
          ? msg('revoke_all_many', '{n} Zugänge wurden gesperrt. Betroffene KI-Programme müssen neu verbunden werden.', { n: count })
          : msg('revoke_all_none', 'Für dieses Konto war kein Zugang aktiv. Es ist nichts offen.'),
      'ok',
    );
    secretInput.value = '';
  } catch (err) {
    sayAccount(err instanceof Error ? err.message : msg('unknown_error', 'Unbekannter Fehler.'), 'error');
  } finally {
    accountSubmit.disabled = false;
  }
});
