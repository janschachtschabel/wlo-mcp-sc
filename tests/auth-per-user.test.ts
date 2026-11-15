/**
 * auth-per-user.test.ts – the per-user rung: a WLO user's OWN credentials,
 * supplied as an `Authorization` header by the AI host's connector settings.
 *
 * Why this is possible at all: edu-sharing declares `basicAuth` as a supported
 * scheme (P0, 2026-07-30). Per-user login was never blocked by the repository —
 * only the delivery of the credentials was open. The header route keeps them
 * out of the conversation entirely: the model never sees them, the server never
 * stores them.
 *
 * The hard requirement is isolation. One HTTP endpoint serves everybody, so two
 * concurrent requests carrying different credentials must never bleed into each
 * other.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  credentialFromHeader,
  currentCredential,
  isUnusableAuthorization,
  resolveServiceCredential,
  runAnonymous,
  runWithCredential,
  setServiceCredentialForTest,
} from '../src/auth/credential.js';

const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;

test('a Basic header becomes a per-user credential', () => {
  const c = credentialFromHeader(basic('lehrerin', 'geheim'));
  assert.ok(c);
  assert.equal(c.source, 'user');
  assert.equal(c.header, basic('lehrerin', 'geheim'));
  assert.equal(c.label, 'lehrerin', 'the user name is readable for the status tool');
});

test('a non-Basic scheme is refused, not forwarded', () => {
  // edu-sharing ignores Bearer (probed live). Forwarding one would produce a
  // request that LOOKS authenticated and silently is not — the exact failure
  // mode the identity check exists to prevent.
  assert.equal(credentialFromHeader('Bearer abc.def.ghi'), null);
  assert.equal(credentialFromHeader('Digest username="x"'), null);
  assert.equal(credentialFromHeader('Basic'), null, 'no payload');
  assert.equal(credentialFromHeader('Basic    '), null);
  assert.equal(credentialFromHeader(undefined), null);
  assert.equal(credentialFromHeader(''), null);
});

test('a malformed Basic payload is refused', () => {
  const noColon = `Basic ${Buffer.from('nurname').toString('base64')}`;
  assert.equal(credentialFromHeader(noColon), null, 'user:password is required');
  const emptyUser = `Basic ${Buffer.from(':geheim').toString('base64')}`;
  assert.equal(credentialFromHeader(emptyUser), null);
});

test('an empty password is refused here exactly as it is for the service account', () => {
  // resolveServiceCredential refuses `user` without a password on purpose: a
  // half-filled login must not become an identity. The header path had the
  // opposite rule, so a connector with an empty password field produced
  // mode="user", registered the write tools, and then got 401 on every call.
  const emptyPassword = `Basic ${Buffer.from('maria:').toString('base64')}`;
  assert.equal(credentialFromHeader(emptyPassword), null);
  assert.equal(resolveServiceCredential({ user: 'maria', password: '' }), null, 'the rule both share');
});

test('a header we cannot use is distinguishable from no header at all', () => {
  // Not the same situation: "nothing presented" may fall back to the service
  // account, "presented and refused" may not — that caller asked to act as
  // themselves and must not silently borrow a shared identity.
  assert.equal(isUnusableAuthorization(undefined), false);
  assert.equal(isUnusableAuthorization(''), false);
  assert.equal(isUnusableAuthorization('   '), false);
  assert.equal(isUnusableAuthorization(basic('lehrerin', 'geheim')), false, 'usable');
  assert.equal(isUnusableAuthorization('Bearer abc.def'), true);
  assert.equal(isUnusableAuthorization('Digest username="x"'), true);
  assert.equal(isUnusableAuthorization(`Basic ${Buffer.from('nurname').toString('base64')}`), true);
  assert.equal(isUnusableAuthorization(`Basic ${Buffer.from('maria:').toString('base64')}`), true);
});

test('the per-user credential wins over the service account', () => {
  setServiceCredentialForTest({ header: basic('dienst', 'x'), label: 'dienst', source: 'service' });
  try {
    const user = credentialFromHeader(basic('lehrerin', 'geheim'))!;
    runWithCredential(user, () => {
      assert.equal(currentCredential()?.label, 'lehrerin');
      assert.equal(currentCredential()?.source, 'user');
    });
    assert.equal(currentCredential()?.label, 'dienst', 'and the service account applies again outside');
  } finally { setServiceCredentialForTest(null); }
});

test('concurrent requests with different users never bleed into each other', async () => {
  // The isolation requirement, stated as a test: interleave two "requests" so
  // one is suspended while the other runs, and assert each still sees its own
  // identity after resuming.
  const seen: string[] = [];
  const request = (name: string, delay: number) =>
    runWithCredential(credentialFromHeader(basic(name, 'x'))!, async () => {
      await new Promise(r => setTimeout(r, delay));
      seen.push(`${name}:${currentCredential()?.label}`);
      await new Promise(r => setTimeout(r, delay));
      assert.equal(currentCredential()?.label, name, `${name} kept its own identity`);
    });

  await Promise.all([request('anna', 30), request('bruno', 10), request('carla', 20)]);
  assert.deepEqual(seen.sort(), ['anna:anna', 'bruno:bruno', 'carla:carla']);
});

test('outside any request there is no per-user credential', () => {
  setServiceCredentialForTest(null);
  assert.equal(currentCredential(), null);
});

test('an anonymous scope beats the service account and does not leak out of itself', () => {
  // The rule the internet-facing surface rests on. "No scope" and "explicitly
  // anonymous" must stay different things: the first falls back to the service
  // account, the second must not — otherwise a public surface silently reads
  // with the operator's rights.
  setServiceCredentialForTest({ header: basic('dienst', 'x'), label: 'dienst', source: 'service' });
  try {
    assert.equal(currentCredential()?.label, 'dienst', 'no scope → the service account applies');
    runAnonymous(() => {
      assert.equal(currentCredential(), null, 'inside an anonymous scope there is no identity at all');
    });
    assert.equal(currentCredential()?.label, 'dienst', 'and the scope does not outlive itself');
  } finally { setServiceCredentialForTest(null); }
});

test('a per-user credential still applies inside an anonymous scope when opened explicitly', () => {
  // The MCP endpoint runs inside the handler-wide anonymous scope and opens its
  // own on top; nesting must therefore work in that direction.
  setServiceCredentialForTest(null);
  runAnonymous(() => {
    const user = credentialFromHeader(basic('anna', 'geheim'))!;
    runWithCredential(user, () => {
      assert.equal(currentCredential()?.label, 'anna');
      assert.equal(currentCredential()?.source, 'user');
    });
    assert.equal(currentCredential(), null, 'and it collapses back to anonymous afterwards');
  });
});
