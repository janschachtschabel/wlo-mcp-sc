/**
 * access-block.js — builds the encrypted access block, in the browser.
 *
 * The password is encrypted HERE and leaves the machine only as ciphertext. The
 * server can open it; the AI provider that stores it in its connector settings
 * cannot, and neither can anything on the path.
 *
 * The wire format is specified by `src/auth/access-token.ts`, and the two are
 * held together by `tests/access-block-browser.test.ts`, which imports this very
 * file and hands its output to the real server decoder. Change one side and that
 * test goes red.
 *
 *   wlo2.<b64u(wrappedKey)>.<b64u(iv)>.<b64u(ciphertext||tag)>
 *
 * Plain ESM with no imports so it runs unchanged in the browser and under Node.
 * User-facing error text is German because the page shows it verbatim.
 */

const PREFIX = 'wlo2';
const IV_BYTES = 12;

function base64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** SPKI PEM → DER, the form `crypto.subtle.importKey` takes. */
function pemToDer(pem) {
  const body = String(pem).replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  if (!body) throw new Error('Der Schlüssel des Servers fehlt.');
  let binary;
  try {
    binary = atob(body);
  } catch {
    throw new Error('Der Schlüssel des Servers ist unlesbar.');
  }
  const der = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) der[i] = binary.charCodeAt(i);
  return der;
}

/**
 * Encrypt one login into a block.
 *
 * @param {string} user   WLO user name
 * @param {string} secret WLO password
 * @param {string} spkiPem  the server's public key, as served by /auth/public-key
 * @returns {Promise<string>} the block to paste into the connector settings
 * @throws {Error} with German text when the key is unusable — the page shows it
 */
export async function encodeAccessBlock(user, secret, spkiPem) {
  const der = pemToDer(spkiPem);
  let publicKey;
  try {
    publicKey = await crypto.subtle.importKey(
      'spki', der, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt'],
    );
  } catch {
    throw new Error('Der Schlüssel des Servers ist ungültig.');
  }

  // A fresh AES key per block. Reusing one would let two blocks be spliced
  // together, and the id inside is what revocation acts on.
  const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));

  const payload = {
    v: 2,
    // randomUUID, not a counter: the id is the handle revocation uses, and a
    // guessable one would let anyone revoke someone else's access.
    jti: crypto.randomUUID(),
    u: user,
    secret,
    iat: Math.floor(Date.now() / 1000),
  };

  // WebCrypto appends the GCM tag to the ciphertext, which is exactly the
  // layout the server splits apart (verified against node:crypto).
  const body = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, aesKey, new TextEncoder().encode(JSON.stringify(payload)),
  );
  const rawAes = await crypto.subtle.exportKey('raw', aesKey);
  const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, rawAes);

  return [PREFIX, base64url(wrapped), base64url(iv), base64url(body)].join('.');
}
