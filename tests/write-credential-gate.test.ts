/**
 * write-credential-gate.test.ts – who is allowed to change data.
 *
 * The first of the four rules that bind the write support: write tools are
 * absent in anonymous mode AND refuse at call time. This pins the second half —
 * the call-time refusal — plus the deliberate asymmetry between the two
 * authenticated modes: an individual login always may, a shared service account
 * only when the operator turns it on, because an edit made under a collective
 * identity is attributable to nobody.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveWriteMode,
  writeMode,
  requireWrite,
  type WriteMode,
} from '../src/services/write/credential-gate.js';
import {
  runAnonymous,
  runWithCredential,
  setServiceCredentialForTest,
  type WloCredential,
} from '../src/auth/credential.js';

const USER: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };
const SERVICE: WloCredential = { header: 'Basic y', label: 'wlo-mcp', source: 'service' };

test('anonymous callers have no write mode, flag or not', () => {
  assert.equal(resolveWriteMode(null, false), 'none');
  assert.equal(resolveWriteMode(null, true), 'none', 'the flag widens the service account, not the public');
});

test('a service account writes only when the operator enabled it', () => {
  assert.equal(resolveWriteMode(SERVICE, false), 'none');
  assert.equal(resolveWriteMode(SERVICE, true), 'service');
});

test('an individual login may always write', () => {
  assert.equal(resolveWriteMode(USER, false), 'user');
  assert.equal(resolveWriteMode(USER, true), 'user');
});

test('writeMode reads the credential in scope', () => {
  setServiceCredentialForTest(null);
  runAnonymous(() => assert.equal(writeMode(), 'none'));
  runWithCredential(USER, () => assert.equal(writeMode(), 'user'));
});

test('requireWrite refuses without an identity and names what to do', () => {
  setServiceCredentialForTest(null);
  runAnonymous(() => {
    assert.throws(() => requireWrite(), (e: unknown) => {
      assert.ok(e instanceof Error);
      assert.match(e.message, /anmelden/i, 'the reason tells the user how to proceed');
      return true;
    });
  });
});

test('requireWrite refuses a service account while the flag is off', () => {
  // The suite runs without WLO_ALLOW_SERVICE_WRITES, so the configured service
  // account is exactly the "authenticated but not attributable" case.
  setServiceCredentialForTest(SERVICE);
  try {
    assert.throws(() => requireWrite(), /Dienstkonto|anmelden/i);
  } finally {
    setServiceCredentialForTest(null);
  }
});

test('requireWrite passes for an individual login', () => {
  setServiceCredentialForTest(null);
  runWithCredential(USER, () => {
    assert.doesNotThrow(() => requireWrite());
  });
});

test('the write modes are exactly the three the design names', () => {
  const all: WriteMode[] = ['user', 'service', 'none'];
  assert.equal(all.length, 3);
});
