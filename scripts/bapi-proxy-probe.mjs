/**
 * Probe W0 of the chatbot team's wish "Kestra flows through the repository proxy"
 * (2026-11-17): does the repository's b-api proxy (`{repo}/rest/bapi/**`) answer
 * for a person signed in with a session, and does it list the flow
 * `edusharing.chatbot/node-metadata-write`?
 *
 * Three questions, each asked with the person's session (`Cookie` +
 * `DisableGuest: true`, as `upstream-auth.ts` sends it) and, for comparison,
 * without any login:
 *   1. GET /rest/bapi/api/v1/llm/openai/models      — is the proxy reachable?
 *   2. GET /rest/bapi/api/v1/jobs/flows              — which flows are released?
 *   3. GET /rest/bapi/api/v1/jobs/<unknown id>       — 404, not 400/401?
 *
 * Read-only, plus `destroySession` on the probe's OWN session. Prints status
 * codes, error codes and flow names — never a cookie, a ticket or a password.
 * Uses the test account (`WLO_TEST_USER` / `WLO_TEST_PASSWORD`, from the process
 * environment or `.env`), falling back to `probe-session.mjs`'s order.
 *
 * Usage:  node scripts/bapi-proxy-probe.mjs [repository-url]
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadCredentialFiles, resolveRepositoryUrl, obtainCredentials, openSession, cookieHeader, TIMEOUT_MS,
} from './probe-session.mjs';

// The test account is a person without admin rights — the case the chatbot has.
// Only these two keys are read from `.env`; nothing else there is touched.
function takeTestAccount() {
  const here = dirname(fileURLToPath(import.meta.url));
  let text = '';
  try { text = readFileSync(join(here, '..', '.env'), 'utf8'); } catch { /* none */ }
  for (const key of ['WLO_TEST_USER', 'WLO_TEST_PASSWORD']) {
    if (process.env[key]) continue;
    const line = text.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
    if (line) process.env[key] = line.slice(key.length + 1).trim().replace(/^"(.*)"$/, '$1');
  }
  if (process.env['WLO_TEST_USER'] && process.env['WLO_TEST_PASSWORD']) {
    process.env['WLO_USER'] = process.env['WLO_TEST_USER'];
    process.env['WLO_PASSWORD'] = process.env['WLO_TEST_PASSWORD'];
    return true;
  }
  return false;
}

const usedTestAccount = takeTestAccount();
loadCredentialFiles();
const REPO = resolveRepositoryUrl(process.argv[2]);
const BAPI = `${REPO}/rest/bapi`;
const ME = `${REPO}/rest/iam/v1/people/-home-/-me-`;
const DESTROY = `${REPO}/rest/authentication/v1/destroySession`;

/** Status, a short error code, and — for the flow list — the flow names. */
async function ask(label, path, headers) {
  try {
    const res = await fetch(`${BAPI}${path}`, {
      headers: { Accept: 'application/json', ...headers },
      redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    let note = '';
    try {
      const body = JSON.parse(text);
      const code = body?.error?.code ?? body?.code ?? (typeof body?.error === 'string' ? body.error : '');
      if (code) note = `code=${String(code).slice(0, 80)}`;
      const list = Array.isArray(body) ? body : Array.isArray(body?.flows) ? body.flows : Array.isArray(body?.data) ? body.data : null;
      if (list) {
        const names = list.map((f) => (typeof f === 'string' ? f
          : f?.namespace && f?.id ? `${f.namespace}/${f.id}` : f?.flowId ?? f?.id ?? f?.name ?? '?'));
        note = `${list.length} entries: ${names.slice(0, 20).join(', ')}`;
        if (label.startsWith('2') && list[0] && typeof list[0] === 'object') note += ` | fields: ${Object.keys(list[0]).join(',')}`;
        if (label.startsWith('2') && list[0] && process.env['PROBE_SHOW_FLOW']) console.log(JSON.stringify(list[0], null, 1).slice(0, 2500));
      }
    } catch {
      note = text ? `non-JSON body, ${text.length} chars` : 'empty body';
    }
    const retry = res.headers.get('retry-after');
    console.log(`${label.padEnd(52)} ${res.status}${retry ? ` retry-after=${retry}` : ''} ${note}`);
    return res.status;
  } catch (err) {
    console.log(`${label.padEnd(52)} no answer (${err instanceof Error ? err.name : 'error'})`);
    return 0;
  }
}

const creds = await obtainCredentials();
if (!creds) { console.error('no credentials found'); process.exit(1); }
const session = await openSession(ME, creds.basic);
if (!session.jar.get('JSESSIONID')) { console.error(`login gave no JSESSIONID (status ${session.status})`); process.exit(1); }
console.log(`repository: ${REPO}`);
console.log(`account: ${usedTestAccount ? 'the test account (WLO_TEST_USER)' : 'from probe-session.mjs order'}`);

const person = { Cookie: cookieHeader(session.jar, ['JSESSIONID', 'INGRESSCOOKIE']), DisableGuest: 'true' };
const unknownJob = `/api/v1/jobs/${randomUUID()}`;

try {
  console.log('\n-- with the person\'s session (Cookie + DisableGuest) --');
  await ask('1 GET /api/v1/llm/openai/models', '/api/v1/llm/openai/models', person);
  await ask('2 GET /api/v1/jobs/flows', '/api/v1/jobs/flows', person);
  await ask('3 GET /api/v1/jobs/<unknown id>', unknownJob, person);
  console.log('\n-- with the person\'s password (Basic + DisableGuest), no session --');
  const basic = { Authorization: creds.basic, DisableGuest: 'true' };
  await ask('1 GET /api/v1/llm/openai/models', '/api/v1/llm/openai/models', basic);
  await ask('2 GET /api/v1/jobs/flows', '/api/v1/jobs/flows', basic);
  await ask('3 GET /api/v1/jobs/<unknown id>', unknownJob, basic);
  console.log('\n-- without any login --');
  await ask('1 GET /api/v1/llm/openai/models', '/api/v1/llm/openai/models', {});
  await ask('2 GET /api/v1/jobs/flows', '/api/v1/jobs/flows', {});
  await ask('3 GET /api/v1/jobs/<unknown id>', unknownJob, {});
  console.log('\n-- with the session, plus a self-made X-Edu-User-Id (must be refused or stripped) --');
  await ask('2 GET /api/v1/jobs/flows', '/api/v1/jobs/flows', { ...person, 'X-Edu-User-Id': 'someone-else' });
} finally {
  const end = await fetch(DESTROY, { headers: { Cookie: person.Cookie }, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) })
    .then((r) => r.status).catch(() => 0);
  console.log(`\nown session ended: ${end}`);
}
