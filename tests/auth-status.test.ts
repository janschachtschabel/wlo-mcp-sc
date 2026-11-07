/**
 * auth-status.test.ts – what `wlo_auth_status` and `GET /auth/status` both
 * report (plan 2026-11-07, S4): ONE payload function, so the cheap endpoint and
 * the MCP tool can never disagree about a login.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { authStatusPayload } from '../src/auth/auth-status.js';
import type { WloCredential } from '../src/auth/credential.js';

const GUEST = { authenticated: false, authority: 'esguest' };
const PERSON = { authenticated: true, authority: 'maria', displayName: 'Maria M.' };

test('no credential → anonymous, credential none', () => {
  assert.deepEqual(authStatusPayload(null, GUEST),
    { mode: 'anonymous', authenticated: false, authority: 'esguest', credential: 'none', upstream: 'ok' });
});

test('the kind of credential is named — basic, access block, ticket block, service account', () => {
  const basic: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };
  const block: WloCredential = { header: 'Basic y', label: 'maria', source: 'user', jti: 'j1' };
  const ticket: WloCredential = { header: 'EDU-TICKET t', label: 'maria', source: 'user', jti: 'j2' };
  const service: WloCredential = { header: 'Basic s', label: 'dienst', source: 'service' };
  assert.equal(authStatusPayload(basic, PERSON).credential, 'basic');
  assert.equal(authStatusPayload(block, PERSON).credential, 'access-block');
  assert.equal(authStatusPayload(ticket, PERSON).credential, 'ticket');
  assert.equal(authStatusPayload(service, PERSON).credential, 'service');
  assert.deepEqual(authStatusPayload(basic, PERSON), {
    mode: 'user', authenticated: true, configuredAs: 'maria', authority: 'maria', displayName: 'Maria M.', credential: 'basic', upstream: 'ok',
  });
});

test('a label of nothing readable is named as such, never echoed raw', () => {
  const odd: WloCredential = { header: 'Basic z', label: '\u0000\u0001', source: 'user' };
  assert.equal(authStatusPayload(odd, GUEST).configuredAs, 'ohne lesbaren Namen');
});

test('a block with an expiry names it as expiresAt (ISO); without one the field is absent', () => {
  const ticket: WloCredential = { header: 'EDU-TICKET t', label: 'maria', source: 'user', jti: 'j2' };
  assert.equal(authStatusPayload(ticket, PERSON, 1_800_043_200).expiresAt, '2027-01-15T20:00:00.000Z');
  assert.equal('expiresAt' in authStatusPayload(ticket, PERSON), false);
});

test('upstream says whether the repository answered at all — "refused" and "not reached" are told apart (B2)', () => {
  const block: WloCredential = { header: 'Basic y', label: 'maria', source: 'user', jti: 'j1' };
  const refused = authStatusPayload(block, { authenticated: false, authority: null });
  const silent = authStatusPayload(block, { authenticated: false, authority: null, unreachable: true });
  assert.equal(refused.upstream, 'ok', 'the repository answered — and said no');
  assert.equal(silent.upstream, 'unreachable', 'no verdict on the login');
  assert.equal(authStatusPayload(null, GUEST).upstream, 'ok');
});
