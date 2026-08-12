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
  resolveMayPrepare,
  mayPrepare,
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

/*
 * Preparing (E2) is a second axis, not a fourth write mode.
 *
 * A prepared request changes nothing here — it describes a call that a
 * repository page will make with the visitor's OWN session. The objection that
 * closes writing to a shared service account ("the edit would be attributable
 * to nobody") therefore does not apply: the edit ends up attributed to the
 * person who confirmed it. What stays is that the preview reads the record
 * under our identity, so anonymous callers are out either way.
 */

test('anonymous callers may never prepare, flag or not', () => {
  assert.equal(resolveMayPrepare(null, false), false);
  assert.equal(resolveMayPrepare(null, true), false, 'the flag widens a configured identity, not the public');
});

test('a service account prepares only when the operator enabled it', () => {
  assert.equal(resolveMayPrepare(SERVICE, false), false);
  assert.equal(resolveMayPrepare(SERVICE, true), true);
});

test('an individual login may prepare when preparing is enabled at all', () => {
  // Moot in practice — such a call can just write, and the tool prefers that.
  // Pinned so the rule stays "the flag decides", not "the source decides".
  assert.equal(resolveMayPrepare(USER, false), false);
  assert.equal(resolveMayPrepare(USER, true), true);
});

test('mayPrepare reads the credential in scope', () => {
  // The suite runs without WLO_ALLOW_PREPARED_WRITES, so this is the off state.
  setServiceCredentialForTest(null);
  runAnonymous(() => assert.equal(mayPrepare(), false));
  runWithCredential(USER, () => assert.equal(mayPrepare(), false));
});
