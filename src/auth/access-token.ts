/**
 * auth/access-token.ts – the encrypted access block a user pastes into their AI
 * host's connector settings.
 *
 *   wlo2.<b64u(wrappedKey)>.<b64u(iv)>.<b64u(ciphertext||gcmTag)>
 *
 * The browser encrypts with the public key this server advertises; only this
 * server can open the result. That is the whole point: today's `Basic <base64>`
 * is the password in a thin disguise and works against ALL of WLO, while a
 * block is useless anywhere except here.
 *
 * **Hybrid, not plain RSA.** RSA-2048-OAEP-SHA256 caps the plaintext at 190
 * bytes; a long password plus the id can exceed that, and the failure would hit
 * only some users and only in production. So a fresh AES-256-GCM key encrypts
 * the payload and RSA wraps just that key.
 *
 * **Everything is inside the AEAD, especially the `jti`.** Revocation acts on
 * the id, so an id outside the authenticated payload could be swapped: a holder
 * of a revoked block would splice in an id that is still listed and carry on.
 * `tests/access-token.test.ts` pins that splice as unreadable.
 *
 * Pure: no HTTP, no filesystem, no registry, no environment access. The
 * environment is read by the caller and passed in, the way `resolveWriteMode`
 * and `verifyConfiguredCredential` take theirs.
 */

import {
  constants,
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
  type KeyObject,
} from 'node:crypto';
import { log } from '../logger.js';

/** What a block carries. `secret` is the WLO password (see the design's Verified facts). */
export interface AccessPayload {
  v: 2;
  /** Access id — what the registry lists and what revocation removes. */
  jti: string;
  /** WLO user name, kept for the registry label and the logs. */
  u: string;
  secret: string;
  /**
   * Issued-at, seconds, as claimed by the BROWSER that built the block. Inside
   * the AEAD, so nobody else can change it — but the issuer chose it, so it is
   * not a fact about when we registered anything. `/auth/issue` records its own
   * clock in the registry. No expiry is enforced either way; revocation is the
   * mechanism (design, 2026-08-04).
   */
  iat: number;
}

export interface AuthKeys {
  /** SPKI PEM of the current key — this is what the issuance page ships. */
  publicKeyPem: string;
  /** Tried in order: current first, then the previous one during a rotation. */
  privateKeys: KeyObject[];
}

const PREFIX = 'wlo2';
const OAEP = { padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' } as const;
/** 96-bit nonce — the size AES-GCM is specified for. */
const IV_BYTES = 12;
const KEY_BYTES = 32;
const TAG_BYTES = 16;

function parsePrivateKey(pem: string, name: string): KeyObject | null {
  try {
    return createPrivateKey(pem);
  } catch (err) {
    log.error('auth key is not a usable private key', {
      variable: name,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Build the key material, or null when the feature is off or misconfigured.
 *
 * An absent current key is the ordinary anonymous deployment and stays silent.
 * A PRESENT but unusable key is logged and still yields null — and so is an
 * unusable PREVIOUS key: the rotation window exists precisely so blocks issued
 * under the old key keep working, and quietly dropping it would break that with
 * the operator finding out from user complaints instead of from the boot log.
 */
export function loadAuthKeys(env: { current?: string; previous?: string }): AuthKeys | null {
  const rawCurrent = (env.current ?? '').trim();
  if (!rawCurrent) return null;

  const current = parsePrivateKey(rawCurrent, 'WLO_AUTH_PRIVATE_KEY');
  if (!current) return null;

  const privateKeys = [current];
  const rawPrevious = (env.previous ?? '').trim();
  if (rawPrevious) {
    const previous = parsePrivateKey(rawPrevious, 'WLO_AUTH_PRIVATE_KEY_PREVIOUS');
    if (!previous) return null;
    privateKeys.push(previous);
  }

  // Derived, never configured separately: two variables could drift, and a
  // public key that does not match the private one produces blocks that nobody
  // — including us — can open.
  const publicKeyPem = createPublicKey(current).export({ type: 'spki', format: 'pem' }).toString();
  return { publicKeyPem, privateKeys };
}

/**
 * Produce a block for `publicKeyPem`.
 *
 * The server never issues blocks in production — the browser does, with
 * WebCrypto. This is the executable specification of the wire format: the
 * browser implementation is validated against it, and the decoder is tested
 * against real blocks rather than hand-built ones.
 */
export function encodeAccessToken(payload: AccessPayload, publicKeyPem: string): string {
  const key = randomBytes(KEY_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const wrapped = publicEncrypt({ key: publicKeyPem, ...OAEP }, key);
  return [PREFIX, wrapped.toString('base64url'), iv.toString('base64url'), body.toString('base64url')].join('.');
}

/** Reject anything whose shape we would otherwise pass on as a credential. */
function validatePayload(value: unknown): AccessPayload | null {
  if (typeof value !== 'object' || value === null) return null;
  const p = value as Record<string, unknown>;
  const { v, jti, u, secret, iat } = p;
  if (v !== 2) return null;
  if (typeof jti !== 'string' || !jti) return null;
  if (typeof u !== 'string' || !u) return null;
  if (typeof secret !== 'string' || !secret) return null;
  if (typeof iat !== 'number' || !Number.isFinite(iat)) return null;
  return { v: 2, jti, u, secret, iat };
}

function open(privateKey: KeyObject, wrapped: Buffer, iv: Buffer, body: Buffer): AccessPayload | null {
  try {
    const key = privateDecrypt({ key: privateKey, ...OAEP }, wrapped);
    if (key.length !== KEY_BYTES) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
    const json = Buffer.concat([
      decipher.update(body.subarray(0, body.length - TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
    return validatePayload(JSON.parse(json));
  } catch {
    // Deliberately collapsed to null: a wrong key, a tampered tag and a
    // non-JSON plaintext all mean "not a block we issued", and telling the
    // caller WHICH one would turn this into an oracle. The HTTP layer logs the
    // rejection once, without the block.
    return null;
  }
}

/**
 * Open a block, or null if it is not one of ours. During a key rotation the
 * previous key is tried after the current one.
 */
export function decodeAccessToken(raw: string, keys: AuthKeys): AccessPayload | null {
  const parts = raw.split('.');
  if (parts.length !== 4) return null;
  const [prefix, wrappedPart, ivPart, bodyPart] = parts;
  if (prefix !== PREFIX || !wrappedPart || !ivPart || !bodyPart) return null;

  const wrapped = Buffer.from(wrappedPart, 'base64url');
  const iv = Buffer.from(ivPart, 'base64url');
  const body = Buffer.from(bodyPart, 'base64url');
  if (iv.length !== IV_BYTES || body.length <= TAG_BYTES) return null;

  for (const privateKey of keys.privateKeys) {
    const payload = open(privateKey, wrapped, iv, body);
    if (payload) return payload;
  }
  return null;
}
