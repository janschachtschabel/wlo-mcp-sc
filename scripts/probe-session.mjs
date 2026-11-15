/**
 * probe-session.mjs – how a probe gets an authenticated session, and nothing else.
 *
 * Extracted from `session-cookie-probe.mjs` when a second probe needed the same
 * thing. Credential handling and redaction are the parts that must not exist
 * twice: a redaction fixed in one copy and forgotten in the other leaks the very
 * value it was written to hide.
 *
 * Nothing here prints a secret. Cookie values stay inside the returned jar; what
 * goes to the screen is a name, a length and the attributes.
 *
 * Credentials, first one found wins:
 *   1. environment    WLO_USER / WLO_PASSWORD / WLO_REPOSITORY_URL
 *   2. `probe.env` beside this file (KEY=VALUE per line, never committed)
 *   3. `.env` at the tree root — the server's own service account
 *      (WLO_SERVICE_USER / WLO_SERVICE_PASSWORD)
 *   4. terminal prompt (password without echo)
 * Deliberately not a command-line argument: that lands in the shell history and
 * in the process list.
 */

import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Only these keys are taken from files. A `.env` carries plenty that is none
 *  of a probe's business — that stays unread. */
const WANTED = new Set([
  'WLO_USER', 'WLO_PASSWORD',
  'WLO_SERVICE_USER', 'WLO_SERVICE_PASSWORD',
  'WLO_REPOSITORY_URL',
]);

export const TIMEOUT_MS = 15000;
export const GUEST = 'esguest';
const DEFAULT_REPOSITORY = 'https://repository.staging.openeduhub.net/edu-sharing';

/** Read one KEY=VALUE file. What is already in the environment wins, so a
 *  forgotten file never overrides a deliberate setting and the call order below
 *  IS the precedence. */
function readEnvFile(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null; // no file is not an error
  }
  let count = 0;
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    if (!WANTED.has(key)) continue;
    const value = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!value || process.env[key]) continue;
    process.env[key] = value;
    count++;
  }
  return count;
}

/**
 * Load both credential files into the environment.
 * @returns {Array<[string, number]>} which file contributed how many keys
 */
export function loadCredentialFiles() {
  const here = dirname(fileURLToPath(import.meta.url));
  return [
    ['probe.env', readEnvFile(join(here, 'probe.env'))],
    ['../.env', readEnvFile(join(here, '..', '.env'))],
  ].filter(([, n]) => n !== null && n > 0);
}

/** Repository base URL: argument, then environment, then staging. */
export function resolveRepositoryUrl(fromArgv) {
  return (fromArgv || process.env['WLO_REPOSITORY_URL'] || DEFAULT_REPOSITORY).replace(/\/+$/, '');
}

/** Input with visible echo (an account name is not a secret). */
function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(question, (a) => { rl.close(); res(a.trim()); }));
}

/** Input WITHOUT echo. The password must appear neither on screen nor in the
 *  shell history — hence a prompt rather than an argument or an environment
 *  variable typed by hand. */
function askSecret(question) {
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = process.stdout;
    // `_writeToOutput` is the hook readline calls for the prompt AND for key
    // echo — silenced, one types invisibly. The question itself therefore goes
    // straight to stdout, past readline.
    rl._writeToOutput = () => {};
    out.write(question);
    rl.question('', (a) => { rl.close(); out.write('\n'); res(a); });
  });
}

/**
 * Account name and Basic header. The password is never returned on its own.
 * @returns {Promise<{user: string, basic: string, fromEnvironment: boolean}>}
 */
export async function obtainCredentials() {
  // `WLO_SERVICE_*` is what the server calls its own account
  // (`auth/credential.ts`). Whoever has it in `.env` can run the probe without
  // typing; `WLO_*` wins so a deliberate entry beats the default.
  const user = (process.env['WLO_USER'] || process.env['WLO_SERVICE_USER'] || '').trim()
    || await ask('WLO-Konto:  ');
  const envPass = process.env['WLO_PASSWORD'] || process.env['WLO_SERVICE_PASSWORD'];
  const pass = envPass || await askSecret('Passwort (bleibt unsichtbar):  ');
  if (!user || !pass) return { user: '', basic: '', fromEnvironment: Boolean(envPass) };
  return {
    user,
    basic: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'),
    fromEnvironment: Boolean(envPass),
  };
}

/** Turn `name=value; Attr=…; Attr` into name + attributes. The value is replaced
 *  by its LENGTH — that gives nothing away and still helps recognise it. */
export function redact(setCookie) {
  const semi = setCookie.indexOf(';');
  const pair = semi === -1 ? setCookie : setCookie.slice(0, semi);
  const attrs = semi === -1 ? '' : setCookie.slice(semi + 1).trim();
  const eq = pair.indexOf('=');
  const name = eq === -1 ? pair : pair.slice(0, eq);
  const len = eq === -1 ? 0 : pair.length - eq - 1;
  return { name, len, attrs };
}

/**
 * Log in with Basic and collect the cookies the server hands out.
 * @returns {Promise<{status: number, lines: string[], jar: Map<string,string>}>}
 */
export async function openSession(identityUrl, basic) {
  const res = await fetch(identityUrl, {
    headers: { Authorization: basic, Accept: 'application/json' },
    redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const lines = res.headers.getSetCookie?.() ?? [];
  const jar = new Map();
  for (const line of lines) {
    const eq = line.indexOf('=');
    const semi = line.indexOf(';');
    if (eq === -1) continue;
    jar.set(line.slice(0, eq), line.slice(eq + 1, semi === -1 ? undefined : semi));
  }
  return { status: res.status, lines, jar };
}

/** `Cookie:` header for the named cookies, in the order given. */
export function cookieHeader(jar, names) {
  return names.filter((n) => jar.has(n)).map((n) => `${n}=${jar.get(n)}`).join('; ');
}

/**
 * Ask the identity endpoint who we are, and say so in one line.
 *
 * The status code is not the answer: an unauthenticated call to this API
 * answers `200` and reports the guest authority (measured 2026-08-04). Only the
 * reported authority settles it.
 */
export async function reportIdentity(identityUrl, headers, label) {
  try {
    const res = await fetch(identityUrl, {
      headers, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let authority = null;
    let note = '';
    const ctype = res.headers.get('content-type') || '';
    if (res.status >= 300 && res.status < 400) {
      note = ' (Weiterleitung — Ziel nicht gedruckt)';
    } else if (ctype.includes('json')) {
      const data = await res.json().catch(() => null);
      authority = data?.person?.authorityName ?? null;
    } else {
      note = ` (kein JSON: ${ctype.split(';')[0] || 'ohne Typ'})`;
    }
    const verdict = authority === null ? '—'
      : authority === GUEST ? 'GAST (nicht angemeldet)' : 'ANGEMELDET';
    console.log(`  ${label.padEnd(34)} HTTP ${res.status}  authority=${authority ?? '—'}  ${verdict}${note}`);
    return { status: res.status, authority };
  } catch (e) {
    console.log(`  ${label.padEnd(34)} FEHLER: ${e instanceof Error ? e.message : String(e)}`);
    return { status: 0, authority: null };
  }
}
