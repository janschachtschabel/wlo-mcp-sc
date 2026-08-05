/**
 * auth/oauth-clients.ts – registered OAuth clients, and where a code may go.
 *
 * Two responsibilities, both leaf-level and both pure:
 *
 * 1. **The redirect rule.** An authorization code is a one-time bearer of
 *    somebody's WLO access. A redirect check that is a little too generous
 *    hands it to whoever asked, so the comparison is character for character —
 *    with exactly one documented loosening (RFC 8252 §7.3, below).
 *
 * 2. **The `client_id`**, which carries its own content instead of living in a
 *    store: `wloc1.<b64u(iv)>.<b64u(ciphertext||tag)>`, AES-256-GCM.
 *
 * Why self-contained rather than stored. The access registry is the only module
 * in this project that writes to disk (enforced by
 * `tests/shared-rule-discipline.test.ts`), and a store held only in memory would
 * lose every registration on restart — so each deploy would break every client
 * that had connected. Encoding the registration into the id costs nothing at
 * rest, survives a restart, and needs no eviction policy.
 *
 * Nothing is lost by letting anyone mint one: RFC 7591 registration is open by
 * design, and a registration grants NOTHING on its own — an authorization still
 * requires a WLO login in the user's own browser. What the AEAD protects is the
 * binding: the holder of an id cannot rewrite the redirect list inside it.
 *
 * The symmetric key is derived from the server's RSA private key via HKDF with
 * its own `info` string, so this use is cryptographically separated from every
 * other use of that material. During a key rotation all keys are tried, which
 * is what keeps existing registrations working across it.
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, type KeyObject } from 'node:crypto';
import type { AuthKeys } from './access-token.js';

export interface OAuthClient {
  /** Absolute redirect targets, as registered. At least one. */
  redirectUris: string[];
  /** Display name, shown on the consent screen. Caller-supplied text. */
  name: string;
}

/**
 * How many redirect targets one registration may carry.
 *
 * A bound is needed because the list travels inside the `client_id`, which
 * travels in URLs. Real clients register one or two; ten leaves room for a host
 * that registers a callback per environment without letting anyone inflate an
 * id to the point where a client's URL handling gives up.
 */
export const MAX_REDIRECT_URIS = 10;

const PREFIX = 'wloc1';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const TAG_BYTES = 16;

/**
 * Loopback names, compared exactly. A suffix match would accept
 * `localhost.evil.example`, which resolves wherever its owner wants — and the
 * loosening below would then hand a code to it over plain http.
 */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const isLoopbackHost = (hostname: string): boolean => LOOPBACK.has(hostname);

function parse(uri: string): URL | null {
  try {
    return new URL(uri);
  } catch {
    return null;
  }
}

/**
 * May this redirect target be registered at all?
 *
 * `https` anywhere; plain `http` only on loopback, where the response never
 * leaves the machine. No fragment (RFC 6749 §3.1.2), and no userinfo — it hides
 * the effective host from anyone reading the URI, including the consent screen.
 */
export function isValidRedirectUri(uri: string): boolean {
  const url = parse(uri.trim());
  if (!url) return false;
  if (url.hash) return false;
  if (url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && isLoopbackHost(url.hostname);
}

/**
 * Does a presented `redirect_uri` match one that was registered?
 *
 * Exact string equality, except when BOTH sides are loopback: a native client
 * binds a port at runtime (RFC 8252 §7.3) and clients are inconsistent about
 * `localhost` versus `127.0.0.1` between registering and calling back. Those two
 * differences are forgiven; scheme, path and query are not, and for any other
 * host nothing is forgiven at all.
 */
export function redirectUriMatches(registered: string, presented: string): boolean {
  const r = parse(registered);
  const p = parse(presented);
  if (!r || !p) return false;
  if (registered === presented) return true;
  if (!isLoopbackHost(r.hostname) || !isLoopbackHost(p.hostname)) return false;
  return r.protocol === p.protocol && r.pathname === p.pathname && r.search === p.search && !p.hash;
}

/**
 * The AES key for this purpose, one per available private key.
 *
 * HKDF with a purpose-specific `info` string: the same private key also opens
 * access blocks, and deriving both from it without domain separation would let
 * a weakness in one use say something about the other. All keys are returned so
 * a rotation does not invalidate every client's registration at once — the same
 * reason `decodeAccessToken` tries the previous key.
 */
function derivedKeys(keys: AuthKeys): Buffer[] {
  return keys.privateKeys.map((k: KeyObject) =>
    Buffer.from(hkdfSync('sha256', k.export({ type: 'pkcs8', format: 'der' }), Buffer.alloc(0),
      'wlo-oauth-client-id-v1', KEY_BYTES)));
}

/** Produce a `client_id` that carries this registration. */
export function encodeClientId(client: OAuthClient, keys: AuthKeys): string {
  const key = derivedKeys(keys)[0];
  if (!key) throw new Error('no key material to derive a client id from');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  // Short field names: the id travels in URLs, and the long ones would add ~20
  // characters per registration for no reader's benefit.
  const body = Buffer.concat([
    cipher.update(JSON.stringify({ r: client.redirectUris, n: client.name }), 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return [PREFIX, iv.toString('base64url'), body.toString('base64url')].join('.');
}

/** Reject anything whose shape would otherwise reach the redirect check. */
function validate(value: unknown): OAuthClient | null {
  if (typeof value !== 'object' || value === null) return null;
  const { r, n } = value as Record<string, unknown>;
  if (!Array.isArray(r) || r.length === 0 || r.length > MAX_REDIRECT_URIS) return null;
  if (!r.every((u): u is string => typeof u === 'string' && u.length > 0)) return null;
  if (typeof n !== 'string') return null;
  return { redirectUris: r, name: n };
}

/**
 * Open a `client_id`, or null if it is not one of ours.
 *
 * Every failure collapses to null without saying which: a wrong key, a tampered
 * tag and a payload of the wrong shape all mean "not a registration we issued",
 * and distinguishing them would make this an oracle.
 */
export function decodeClientId(clientId: string, keys: AuthKeys): OAuthClient | null {
  const parts = clientId.split('.');
  if (parts.length !== 3) return null;
  const [prefix, ivPart, bodyPart] = parts;
  if (prefix !== PREFIX || !ivPart || !bodyPart) return null;

  const iv = Buffer.from(ivPart, 'base64url');
  const body = Buffer.from(bodyPart, 'base64url');
  if (iv.length !== IV_BYTES || body.length <= TAG_BYTES) return null;

  for (const key of derivedKeys(keys)) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
      const json = Buffer.concat([
        decipher.update(body.subarray(0, body.length - TAG_BYTES)),
        decipher.final(),
      ]).toString('utf8');
      const client = validate(JSON.parse(json));
      if (client) return client;
    } catch {
      // Try the next key; an exhausted loop is the "not ours" answer.
    }
  }
  return null;
}
