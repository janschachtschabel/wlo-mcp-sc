/**
 * auth-credential.test.ts – the service-account rung of the credential chain.
 *
 * P0 (2026-07-30, probed against staging + prod) established the ground rules
 * this pins:
 *   - edu-sharing declares exactly two auth schemes in its own OpenAPI:
 *     `basicAuth` (HTTP Basic) and `cookieAuth` (JSESSIONID). No Bearer.
 *   - WRONG credentials are REJECTED with 401 — on the identity endpoint and
 *     on the search endpoints alike (re-measured against production
 *     2026-07-31; a 2026-07-30 note claiming 200/guest was wrong). A typo in
 *     the operator's password therefore does not degrade to anonymous mode, it
 *     breaks every upstream call.
 *   - `/rest/iam/v1/people/-home-/-me-` reports `authorityName`, which is the
 *     only reliable "am I who I think I am" signal.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveServiceCredential, ANONYMOUS_AUTHORITY } from '../src/auth/credential.js';

test('a configured service account becomes an HTTP Basic header', () => {
  const c = resolveServiceCredential({ user: 'wlo-mcp', password: 'geheim' });
  assert.ok(c, 'a credential is produced');
  assert.equal(c.source, 'service');
  assert.equal(c.header, `Basic ${Buffer.from('wlo-mcp:geheim').toString('base64')}`);
  assert.equal(c.label, 'wlo-mcp', 'the user name is carried for the status tool');
});

test('no credential unless BOTH user and password are set', () => {
  // Half a credential is a configuration mistake, not a partial login: sending
  // Basic with an empty password would silently downgrade to guest.
  assert.equal(resolveServiceCredential({ user: '', password: '' }), null);
  assert.equal(resolveServiceCredential({ user: 'wlo-mcp', password: '' }), null);
  assert.equal(resolveServiceCredential({ user: '', password: 'geheim' }), null);
  assert.equal(resolveServiceCredential({ user: '  ', password: ' ' }), null, 'whitespace is not a credential');
});

test('the secret never appears in the credential label', () => {
  const c = resolveServiceCredential({ user: 'wlo-mcp', password: 'geheim' });
  assert.doesNotMatch(c?.label ?? '', /geheim/);
});

test('the anonymous authority is the documented guest name', () => {
  // Probed live: an unauthenticated call reports authorityName "esguest".
  assert.equal(ANONYMOUS_AUTHORITY, 'esguest');
});
