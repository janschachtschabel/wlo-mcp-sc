/**
 * tests/live/guard.ts – the one gate every live test passes through.
 *
 * Extracted when the second live file was added: the guard decides which
 * repository a WRITING test may touch, and a second copy is the kind that gets
 * relaxed in one place and not the other. "Testing target is staging, never
 * production" is an operator rule, so the check that enforces it belongs in one
 * file that both tests import rather than in each of them.
 */

import assert from 'node:assert/strict';

import { WLO_REPOSITORY_URL } from '../../src/wlo-config.js';
import { resolveServiceCredential } from '../../src/auth/credential.js';

/**
 * The one host these files will talk to. Hard-coded, not configurable: a
 * contract test that can be pointed at production by one env line is how the
 * operator rule breaks.
 */
export const STAGING_HOST = 'repository.staging.openeduhub.net';

/** Names every throwaway after the run, so a leftover is identifiable. */
export const runStamp = new Date().toISOString();

/** Refuse to run against the wrong repository, or without a credential. */
export function requireLiveTarget(): void {
  const host = new URL(WLO_REPOSITORY_URL).hostname;
  assert.equal(
    host,
    STAGING_HOST,
    `Live-Vertragstests laufen ausschließlich gegen Staging (${STAGING_HOST}); ` +
      `konfiguriert ist "${host}". Testziel ist Staging, niemals Produktion.`,
  );
  const cred = resolveServiceCredential({
    user: process.env['WLO_SERVICE_USER'],
    password: process.env['WLO_SERVICE_PASSWORD'],
  });
  assert.ok(
    cred,
    'WLO_SERVICE_USER / WLO_SERVICE_PASSWORD sind nicht gesetzt — `npm run test:live` ' +
      'lädt sie aus .env; ohne Anmeldung gibt es keinen Schreib-Vertrag zu prüfen.',
  );
}
