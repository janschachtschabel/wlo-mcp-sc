/**
 * Probe for the session exchange (`POST /auth/session`): what does the
 * repository answer to a session cookie that is DEAD, with and without
 * `DisableGuest: true`?
 *
 * The question behind it: a call that carries an invalid `JSESSIONID` answers
 * `200` as the guest (measured 2026-08-12, `session-cookie-probe.mjs`). For the
 * exchange itself that is caught by reading the authority. But a session that
 * dies LATER would then read as "nothing found" on every search — the silent
 * guest this server refuses everywhere else. `DisableGuest: true` is the header
 * the md-editor sends for exactly that reason; this measures what it does.
 *
 * Prints status codes and the reported authority, never a cookie value or a
 * credential. Read-only calls plus `destroySession` on the probe's OWN session.
 *
 * Usage:  node scripts/session-disableguest-probe.mjs [repository-url]
 */

import { randomBytes } from 'node:crypto';

import {
  loadCredentialFiles, resolveRepositoryUrl, obtainCredentials, openSession, GUEST, TIMEOUT_MS,
} from './probe-session.mjs';

loadCredentialFiles();
const REPO = resolveRepositoryUrl(process.argv[2]);
const ME = `${REPO}/rest/iam/v1/people/-home-/-me-`;
const SEARCH = `${REPO}/rest/search/v1/queries/-home-/mds_oeh/ngsearch?maxItems=1&contentType=FILES`;
const DESTROY = `${REPO}/rest/authentication/v1/destroySession`;

async function ask(label, url, headers, init = {}) {
  try {
    const res = await fetch(url, { ...init, headers: { Accept: 'application/json', ...headers }, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    let authority = '';
    let total = '';
    try {
      const body = await res.json();
      authority = body?.person?.authorityName ?? '';
      if (body?.pagination) total = ` total=${body.pagination.total}`;
      if (body?.error) authority = `error=${String(body.error).slice(0, 80)}`;
    } catch { /* no JSON body */ }
    console.log(`${label.padEnd(58)} ${res.status} ${authority === GUEST ? 'GUEST' : authority ? (authority.startsWith('error=') ? authority : 'a named user') : ''}${total}`);
  } catch (err) {
    console.log(`${label.padEnd(58)} no answer (${err instanceof Error ? err.name : 'error'})`);
  }
}

const search = { method: 'POST', body: JSON.stringify({ criteria: [{ property: 'ngsearchword', values: ['Physik'] }] }) };
const json = { 'Content-Type': 'application/json' };

const creds = await obtainCredentials();
if (!creds) { console.error('no credentials found (process env, scripts/probe.env or .env)'); process.exit(1); }
const session = await openSession(ME, creds.basic);
const sid = session.jar.get('JSESSIONID');
if (!sid) { console.error(`login gave no JSESSIONID (status ${session.status})`); process.exit(1); }
console.log(`repository: ${REPO}`);
console.log(`cookies set at login: ${[...session.jar.keys()].join(', ')}; JSESSIONID length ${sid.length}`);

const live = { Cookie: `JSESSIONID=${sid}` };
const dead = { Cookie: `JSESSIONID=${randomBytes(16).toString('hex').toUpperCase()}` };
const off = { DisableGuest: 'true' };

await ask('identity · live session', ME, live);
await ask('identity · live session + DisableGuest', ME, { ...live, ...off });
await ask('identity · unknown session', ME, dead);
await ask('identity · unknown session + DisableGuest', ME, { ...dead, ...off });
await ask('identity · no cookie + DisableGuest', ME, off);
await ask('search   · live session + DisableGuest', SEARCH, { ...live, ...off, ...json }, search);
await ask('search   · unknown session', SEARCH, { ...dead, ...json }, search);
await ask('search   · unknown session + DisableGuest', SEARCH, { ...dead, ...off, ...json }, search);

// The probe's own session, ended the way a logout ends it.
await ask('destroySession · live session', DESTROY, live);
await ask('identity · ended session', ME, live);
await ask('identity · ended session + DisableGuest', ME, { ...live, ...off });
await ask('search   · ended session + DisableGuest', SEARCH, { ...live, ...off, ...json }, search);
