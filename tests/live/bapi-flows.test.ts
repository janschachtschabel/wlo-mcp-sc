/**
 * tests/live/bapi-flows.test.ts – the flow `edusharing.chatbot/node-metadata-write`
 * started through the REPOSITORY's b-api proxy as a person, against STAGING
 * only (`guard.ts`; plan 2026-11-17, step 4 of the team's version of 18.11.).
 *
 * The person comes the way the chatbot's does: a repository SESSION exchanged
 * for an access block (`exchangeSession`), the block read back as the server
 * reads every block (`credentialFromHeader`), so each call below goes through
 * `applyUpstreamAuth` — Cookie + `DisableGuest`, no Authorization.
 *
 * Questions:
 *   W0 with that session: models 200, flow list with the flow, unknown job 404;
 *      the flow list with a Basic login as well.
 *   1. Does the start reach the b-api as the person — 202 and a jobId?
 *   2. Does the flow WRITE with the person frozen in its token, and what does the
 *      report say? (Measured yes on 2026-11-18, Basic.)
 *   3. Can ANOTHER person read that job? (Measured yes on 2026-11-18: through the
 *      proxy every person carries the repository's one key, and the b-api keeps
 *      jobs per key — why `services/bapi/job-owners.ts` exists.) Read-only.
 *
 * Throwaway data only: one record (`boerdi-durchtest-…`) in the test account's
 * own area, deleted in `finally`. No account name, no login value is printed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { exchangeSession, sessionCookiesFrom } from '../../src/auth/session-exchange.js';
import { loadAuthKeys } from '../../src/auth/access-token.js';
import { openRegistry } from '../../src/auth/access-registry.js';
import { credentialFromHeader, runWithCredential, setAccessSupport, type WloCredential } from '../../src/auth/credential.js';
import { createDistinctValueLimiter } from '../../src/rate-limit.js';
import { BASE_URL, IDENTITY_URL, WLO_REPOSITORY_URL } from '../../src/wlo-config.js';
import { wloFetch } from '../../src/wlo-fetch.js';
import { getNodeMetadata } from '../../src/wlo-node.js';
import { deleteContentNode } from '../../src/services/write/nodes-lifecycle.js';
import { planFulltext, writeFulltext } from '../../src/services/write/fulltext.js';
import { flowStatus, listFlows, startFlow } from '../../src/services/bapi/jobs.js';
import { NODE_METADATA_WRITE } from '../../src/services/bapi/node-metadata-write.js';
import { requireLiveTarget, runStamp } from './guard.js';

const basic = (user: string, password: string) => 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');

test('node-metadata-write through the repository proxy, as a person with a session block', { timeout: 15 * 60_000 }, async (t) => {
  requireLiveTarget();
  const user = process.env['WLO_TEST_USER'];
  const password = process.env['WLO_TEST_PASSWORD'];
  if (!user || !password) { t.skip('WLO_TEST_USER / WLO_TEST_PASSWORD sind nicht gesetzt'); return; }
  const withPassword: WloCredential = { header: basic(user, password), label: user, source: 'user' };

  // The test account signs in, as a browser would; its session becomes a block.
  const login = await fetch(IDENTITY_URL, { headers: { Authorization: withPassword.header, Accept: 'application/json' } });
  assert.equal(login.status, 200);
  const session = sessionCookiesFrom(login.headers.getSetCookie().map(line => line.split(';')[0]).join('; '));
  assert.ok(session, 'the login set a JSESSIONID we accept');
  const dir = mkdtempSync(join(tmpdir(), 'wlo-live-flow-'));
  const registry = await openRegistry(join(dir, 'registry.json'));
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keys = loadAuthKeys({ current: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
  assert.ok(registry && keys);
  setAccessSupport({ keys, registry });
  t.after(() => { setAccessSupport(null); rmSync(dir, { recursive: true, force: true }); });
  const exchanged = await exchangeSession(session!, {
    ip: '198.51.100.1', authAbuseLimiter: createDistinctValueLimiter(5, 600_000), support: { keys, registry },
  }, Date.now());
  assert.ok(exchanged.ok, 'the session becomes a block');
  if (!exchanged.ok) return;
  const person = credentialFromHeader(`Bearer ${exchanged.block}`);
  assert.ok(person && person.source === 'user', 'the block reads as a personal login');
  const asPerson = <T>(fn: () => Promise<T>) => runWithCredential(person!, fn);

  // W0, with the session block.
  const models = await asPerson(() => wloFetch(`${WLO_REPOSITORY_URL}/rest/bapi/api/v1/llm/openai/models`, {
    headers: { Accept: 'application/json', DisableGuest: 'true' },
  }));
  t.diagnostic(`W0 Sitzung: models ${models.status}`);
  assert.equal(models.status, 200);
  const flows = await asPerson(() => listFlows());
  t.diagnostic(`W0 Sitzung: flows ${flows.ok ? 'ok' : flows.reason}`);
  // `listFlows` cuts to WLO_BAPI_FLOWS; the flow must be in the b-api's list for this person.
  process.env['WLO_BAPI_FLOWS'] = NODE_METADATA_WRITE;
  const listed = await asPerson(() => listFlows());
  assert.ok(listed.ok && listed.flows.some(f => f.flow === NODE_METADATA_WRITE), 'the flow is released for the person');
  const unknown = await asPerson(() => flowStatus('00000000-0000-4000-8000-000000000000'));
  t.diagnostic(`W0 Sitzung: unbekannter Job ${unknown.ok ? 'gefunden?!' : unknown.reason}`);
  assert.equal(!unknown.ok && unknown.reason, 'unknown_job');
  const viaPassword = await runWithCredential(withPassword, () => listFlows());
  t.diagnostic(`W0 Basic: flows ${viaPassword.ok ? `${viaPassword.flows.length} freigegeben` : viaPassword.reason}`);

  // The record: a title that says nothing, and a text the metadata agent can work with.
  const title = `boerdi-durchtest-${runStamp.replace(/[^0-9]/g, '')}`;
  const id = await asPerson(async () => {
    const res = await wloFetch(`${BASE_URL}/node/v1/nodes/-home-/-userhome-/children?type=ccm:io&renameIfExists=true&versionComment=live`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ 'cm:name': [`${title}.txt`], 'cclom:title': [title] }),
    });
    assert.ok(res.ok, `record create ${res.status}`);
    const nodeId = ((await res.json()) as { node?: { ref?: { id?: string } } }).node?.ref?.id;
    assert.ok(nodeId);
    return nodeId!;
  });
  try {
    const text = '# Die Photosynthese\n\nPflanzen wandeln mit Hilfe von Licht Kohlenstoffdioxid und Wasser in Traubenzucker '
      + 'und Sauerstoff um. Das geschieht in den Chloroplasten, die den grünen Farbstoff Chlorophyll enthalten. '
      + 'Die Photosynthese ist die Grundlage fast aller Nahrungsketten auf der Erde und wird im Biologieunterricht '
      + 'der Sekundarstufe I behandelt, etwa in Klasse 7 oder 8.\n';
    const stored = await asPerson(async () => {
      const planned = await planFulltext({ nodeId: id, markdown: text, source: 'manual' });
      assert.ok(planned.ok, 'a record without content can take a full text');
      return writeFulltext(planned.plan, text);
    });
    assert.equal(stored.status, 'stored', JSON.stringify(stored));

    // 1. The start, as the person, with the session block.
    const started = await asPerson(() => startFlow(NODE_METADATA_WRITE, { node_ids: [id], language: 'de' }));
    t.diagnostic(`Start: ${JSON.stringify(started)}`);
    assert.ok(started.ok, 'the proxy starts the flow for a person');
    if (!started.ok) return;

    // 2. Watch it until it ends (each check is one GET).
    let last: Awaited<ReturnType<typeof flowStatus>> | null = null;
    for (let i = 0; i < 60; i++) {
      last = await asPerson(() => flowStatus(started.jobId));
      if (!last.ok || last.state !== 'running') break;
      await new Promise(r => setTimeout(r, 10_000));
    }
    t.diagnostic(`Stand am Ende: ${JSON.stringify(last)}`);
    assert.ok(last?.ok && last.state === 'succeeded', 'the flow ends successfully');

    // 3. Another person asks for the same job, through the b-api itself (read-only).
    const other = resolveOther();
    if (other) {
      const seen = await runWithCredential(other, () => flowStatus(started.jobId));
      t.diagnostic(`Eine ANDERE Person fragt den Job ab: ${seen.ok ? `sichtbar (${seen.state})` : `nicht sichtbar (${seen.reason})`}`);
    } else {
      t.diagnostic('Keine zweite Anmeldung (WLO_SERVICE_USER) — Sichtbarkeit für andere nicht gemessen');
    }

    // 4. The same job read WITHOUT a proven person: no login, and the right name with a wrong
    //    password. The owner binding (`job-owners.ts`) keys a Basic login by its name, so it holds
    //    only if the proxy refuses both — it must not answer them as the guest.
    const jobUrl = `${WLO_REPOSITORY_URL}/rest/bapi/api/v1/jobs/${started.jobId}?details=true`;
    const ask = (method: string, headers: Record<string, string>) =>
      fetch(method === 'DELETE' ? jobUrl.replace('?details=true', '') : jobUrl,
        { method, headers: { Accept: 'application/json', ...headers }, redirect: 'manual' });
    const wrong = { DisableGuest: 'true', Authorization: basic(user, `${password}-falsch`) };
    const noLogin = await ask('GET', { DisableGuest: 'true' });
    const wrongPassword = await ask('GET', wrong);
    // The job has finished: a DELETE that got through would answer 409, nothing would end.
    const wrongCancel = await ask('DELETE', wrong);
    const noLoginNoFlag = await ask('GET', {});
    t.diagnostic(`Job ohne Anmeldung (DisableGuest): ${noLogin.status}; mit falschem Passwort: ${wrongPassword.status}; `
      + `Abbruch mit falschem Passwort: ${wrongCancel.status}; ohne Anmeldung, ohne DisableGuest: ${noLoginNoFlag.status}`);
    assert.equal(wrongPassword.status, 401, 'a wrong password reads no job');
    assert.equal(noLogin.status, 401, 'nobody, with DisableGuest, reads no job');
    assert.equal(wrongCancel.status, 401, 'a wrong password cancels no job');
    // Measured 2026-11-18: WITHOUT DisableGuest and without any login the job reads with 200 — the
    // guest of the repository's proxy sees any job by its id. Every call of ours carries the header;
    // the gap is the proxy's, reported to the b-api team. Not asserted: it is theirs to close.

    // What landed on the record.
    const after = await asPerson(() => getNodeMetadata(id, ['cclom:title', 'cclom:general_description', 'cclom:general_keyword', 'ccm:taxonid', 'ccm:educationalcontext']));
    const props = after?.properties ?? {};
    t.diagnostic(`Datensatz danach: Titel ${props['cclom:title']?.[0] === title ? 'unverändert' : 'ersetzt'}, `
      + `Beschreibung ${props['cclom:general_description']?.length ? 'vorhanden' : 'leer'}, `
      + `${props['cclom:general_keyword']?.length ?? 0} Schlagworte, Fach ${props['ccm:taxonid']?.length ? 'gesetzt' : 'leer'}, `
      + `Stufe ${props['ccm:educationalcontext']?.length ? 'gesetzt' : 'leer'}`);
    assert.notEqual(props['cclom:title']?.[0], title, 'the flow replaced the title');
  } finally {
    const out = await asPerson(() => deleteContentNode(id)).catch((err: unknown) => ({ status: 'failed', detail: String(err) }));
    if ((out as { status?: string }).status !== 'ok') t.diagnostic(`Wegwerf-Datensatz ${id} NICHT gelöscht: ${JSON.stringify(out)}`);
    delete process.env['WLO_BAPI_FLOWS'];
    // The test account's session ends with the test.
    await fetch(`${BASE_URL}/authentication/v1/destroySession`, { headers: { Cookie: session!.cookie } }).catch(() => undefined);
  }
});

/** A second PERSON for question 3: the service account, presented as a personal login. */
function resolveOther(): WloCredential | null {
  const user = process.env['WLO_SERVICE_USER'];
  const password = process.env['WLO_SERVICE_PASSWORD'];
  if (!user || !password || user === process.env['WLO_TEST_USER']) return null;
  return { header: basic(user, password), label: user, source: 'user' };
}
