/**
 * auth-revoke.js — page logic for "MCP-Zugang sperren".
 *
 * No crypto here: the block is sent as-is, the server opens it, reads the id and
 * strikes it from the allow-list. Nothing else identifies the holder, which is
 * deliberate — requiring a login to revoke would mean typing the password again
 * on the very page you visit because that password may be compromised.
 */

const form = document.getElementById('revoke-form');
const blockInput = document.getElementById('block');
const submit = document.getElementById('submit');
const status = document.getElementById('status');

function say(text, kind) {
  status.textContent = text;
  status.className = kind ? `status ${kind}` : 'status';
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  // The issuance page hands out the value WITH the scheme, because that is what
  // the connector field wants. Accepting it back verbatim spares people an edit
  // they would otherwise get wrong.
  const token = blockInput.value.trim().replace(/^Bearer\s+/i, '');

  if (!token) {
    say('Bitte den Zugangsblock einfügen.', 'error');
    blockInput.focus();
    return;
  }

  submit.disabled = true;
  say('Wird gesperrt …', 'busy');

  try {
    const res = await fetch('/auth/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      throw new Error(detail?.error ?? 'Der Block konnte nicht gesperrt werden.');
    }

    const data = await res.json();
    // "was not active" is not an error: the honest outcomes are "it is gone now"
    // and "it was already gone", and both end with the block being useless.
    say(
      data?.revoked
        ? 'Gesperrt. Dieser Zugang funktioniert ab sofort nicht mehr.'
        : 'Dieser Block war bereits gesperrt oder nie aktiv. Er funktioniert nicht.',
      'ok',
    );
    blockInput.value = '';
  } catch (err) {
    say(err instanceof Error ? err.message : 'Unbekannter Fehler.', 'error');
  } finally {
    submit.disabled = false;
  }
});
