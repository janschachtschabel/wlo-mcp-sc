/**
 * auth.js — page logic for "MCP-Zugang holen".
 *
 * Order matters and is the security argument of the page: fetch the server's
 * public key, encrypt in the browser, and only THEN send anything. The password
 * never crosses the network, not even to us — what we receive is the block,
 * which we open in memory to verify the login and register the id.
 *
 * German user text on purpose: the page is shown verbatim to WLO editors.
 */

import { encodeAccessBlock } from './access-block.js';

const form = document.getElementById('issue-form');
const userInput = document.getElementById('user');
const secretInput = document.getElementById('secret');
const submit = document.getElementById('submit');
const status = document.getElementById('status');
const result = document.getElementById('result');
const blockOut = document.getElementById('block');
const copyButton = document.getElementById('copy');
const copyStatus = document.getElementById('copy-status');

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

form.addEventListener('submit', async (event) => {
  event.preventDefault();
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
  say('Verschlüsseln und prüfen …', 'busy');
  result.hidden = true;

  try {
    const block = await encodeAccessBlock(user, secret, await publicKey());

    const res = await fetch('/auth/issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: block }),
    });

    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      // The server distinguishes "WLO rejected these credentials" from
      // everything else; showing its text means a typo says so plainly instead
      // of surfacing days later as "the tools return nothing".
      throw new Error(detail?.error ?? 'Der Zugang konnte nicht erzeugt werden.');
    }

    blockOut.value = `Bearer ${block}`;
    result.hidden = false;
    say('Zugang erzeugt. Er gilt, bis du ihn sperrst.', 'ok');
    // The form keeps its values — clearing it would look like a failure — but
    // the password does not stay on screen once it is no longer needed.
    secretInput.value = '';
    blockOut.focus();
  } catch (err) {
    say(err instanceof Error ? err.message : 'Unbekannter Fehler.', 'error');
  } finally {
    submit.disabled = false;
  }
});

copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(blockOut.value);
    copyStatus.textContent = 'Kopiert.';
    copyStatus.className = 'status ok';
  } catch {
    // Clipboard access can be denied, and an unusable button with no
    // explanation is worse than none: the text is selectable either way.
    blockOut.select();
    copyStatus.textContent = 'Kopieren nicht erlaubt — der Block ist jetzt markiert.';
    copyStatus.className = 'status busy';
  }
});
