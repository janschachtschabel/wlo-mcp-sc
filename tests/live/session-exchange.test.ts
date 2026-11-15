/**
 * tests/live/session-exchange.test.ts – a REAL repository session through the
 * session exchange (`POST /auth/session`).
 *
 * The offline tests prove what we send. This proves the repository accepts it,
 * and — the part that matters — what happens when the session ENDS: every call
 * of a session block carries `DisableGuest: true`, so a dead session must be
 * refused out loud instead of answering as the guest (measured 2026-11-15,
 * `scripts/session-disableguest-probe.mjs`).
 *
 * One throwaway collection, created and deleted with the session, and
 * `destroySession` on the session this test opened itself.
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
import { credentialFromHeader, runWithCredential, setAccessSupport } from '../../src/auth/credential.js';
import { checkIdentity } from '../../src/auth/identity.js';
import { readAuthStatus } from '../../src/auth/auth-status.js';
import { createDistinctValueLimiter } from '../../src/rate-limit.js';
import { IDENTITY_URL, WLO_REPOSITORY_URL } from '../../src/wlo-config.js';
import { wloFetch } from '../../src/wlo-fetch.js';
import { getNodeMetadata } from '../../src/wlo-node.js';
import { createCollection, deleteCollection } from '../../src/services/write/collections.js';
import { requireLiveTarget, runStamp } from './guard.js';

test('a real session becomes a block, reads as its person, and is refused out loud once it ends', async (t) => {
  requireLiveTarget();
  const basic = 'Basic ' + Buffer.from(`${process.env['WLO_SERVICE_USER']}:${process.env['WLO_SERVICE_PASSWORD']}`).toString('base64');

  // What a browser has after signing in: the cookies the repository set.
  const login = await fetch(IDENTITY_URL, { headers: { Authorization: basic, Accept: 'application/json' } });
  assert.equal(login.status, 200);
  const who = (await login.json() as { person?: { authorityName?: string } }).person?.authorityName;
  const cookieHeader = login.headers.getSetCookie().map(line => line.split(';')[0]).join('; ');
  const session = sessionCookiesFrom(cookieHeader);
  assert.ok(session, 'the login set a JSESSIONID we accept');

  const dir = mkdtempSync(join(tmpdir(), 'wlo-live-session-'));
  const registry = await openRegistry(join(dir, 'registry.json'));
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keys = loadAuthKeys({ current: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
  assert.ok(registry && keys);
  setAccessSupport({ keys, registry });
  t.after(() => { setAccessSupport(null); rmSync(dir, { recursive: true, force: true }); });

  const out = await exchangeSession(session, {
    ip: '198.51.100.1', authAbuseLimiter: createDistinctValueLimiter(5, 600_000), support: { keys, registry },
  }, Date.now());
  assert.equal(out.ok, true, JSON.stringify(out.ok ? {} : out));
  if (!out.ok) return;
  assert.equal(out.authority, who, 'the block is labelled with the person the session belongs to');

  const cred = credentialFromHeader(`Bearer ${out.block}`);
  assert.ok(cred);

  // Alive: the identity and a search answer as that person.
  const search = `${WLO_REPOSITORY_URL}/rest/search/v1/queries/-home-/mds_oeh/ngsearch?maxItems=1&contentType=FILES`;
  const body = JSON.stringify({ criteria: [{ property: 'ngsearchword', values: ['Physik'] }] });
  const ask = () => wloFetch(search, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body });
  await runWithCredential(cred, async () => {
    const id = await checkIdentity();
    assert.deepEqual([id.authenticated, id.authority], [true, who]);
    assert.equal((await ask()).status, 200);

    // A WRITE with nothing but the session cookie: created, read back, deleted.
    // (No CSRF token is needed — measured 2026-08-12 — and this is the first
    // write of ours that travels without an Authorization header.)
    const made = await createCollection(null, {
      title: `MCP-Sitzungstausch ${runStamp}`,
      description: 'Wegwerf-Sammlung des Live-Vertragstests — darf gelöscht werden.',
    });
    if (made.status !== 'created') assert.fail(`Sammlung abgelehnt: ${JSON.stringify(made)}`);
    try {
      assert.ok(await getNodeMetadata(made.nodeId), 'the collection made with the session is readable');
    } finally {
      await deleteCollection(made.nodeId);
    }
  });

  // Ended, the way a logout ends it.
  const bye = await fetch(`${WLO_REPOSITORY_URL}/rest/authentication/v1/destroySession`, { headers: { Cookie: session.cookie, Accept: 'application/json' } });
  assert.equal(bye.status, 200);

  // A FRESH credential object: the refusal memo is per credential instance.
  const after = credentialFromHeader(`Bearer ${out.block}`);
  assert.ok(after);
  await runWithCredential(after, async () => {
    const id = await checkIdentity();
    assert.equal(id.authenticated, false, 'an ended session is not a login');
    assert.notEqual(id.authority, 'esguest', 'and it is not answered as the guest either');
    assert.equal((await ask()).status, 401, 'a search is refused, not answered with the public results');
  });
  // What the chatbot team reads (their 1c): an answer, not an outage — and the block's own end.
  const status = await readAuthStatus(after);
  assert.deepEqual([status.authenticated, status.upstream, status.authority, status.credential], [false, 'ok', null, 'session']);
  assert.ok(status.expiresAt, 'expiresAt is named for a session block');
});
