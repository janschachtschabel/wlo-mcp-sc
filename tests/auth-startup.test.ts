/**
 * auth-startup.test.ts – tell the operator at boot whether the configured
 * service account actually works.
 *
 * Credentials the repository rejects are invisible in a normal reply: WLO
 * answers 401 to every call (measured 2026-07-31), so without a boot-time check
 * the only clue is that everything comes back empty.
 * The check must also stay OUT OF THE WAY of the default deployment: with no
 * credentials configured there is nothing to verify and no reason to call
 * upstream at all.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { verifyConfiguredCredential } from '../src/auth/identity.js';
import { setServiceCredentialForTest } from '../src/auth/credential.js';

function countingFetch(person: unknown) {
  const original = globalThis.fetch;
  const state = { calls: 0 };
  globalThis.fetch = (async () => {
    state.calls++;
    return new Response(JSON.stringify({ person }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { state, restore: () => { globalThis.fetch = original; } };
}

test('without a configured credential nothing is checked and nothing is called', async () => {
  setServiceCredentialForTest(null);
  const f = countingFetch({ authorityName: 'esguest' });
  try {
    const r = await verifyConfiguredCredential();
    assert.equal(r.checked, false, 'no credential → nothing to verify');
    assert.equal(f.state.calls, 0, 'and no upstream call on an anonymous boot');
  } finally { f.restore(); }
});

test('a working service account verifies as ok', async () => {
  setServiceCredentialForTest({ header: 'Basic x', label: 'wlo-mcp', source: 'service' });
  const f = countingFetch({ authorityName: 'wlo-mcp' });
  try {
    const r = await verifyConfiguredCredential();
    assert.equal(r.checked, true);
    assert.equal(r.ok, true);
    assert.equal(r.authority, 'wlo-mcp');
    assert.equal(f.state.calls, 1, 'exactly one probe');
  } finally { f.restore(); setServiceCredentialForTest(null); }
});

test('credentials that leave us as guest are reported as NOT ok', async () => {
  setServiceCredentialForTest({ header: 'Basic wrong', label: 'wlo-mcp', source: 'service' });
  const f = countingFetch({ authorityName: 'esguest' });
  try {
    const r = await verifyConfiguredCredential();
    assert.equal(r.checked, true);
    assert.equal(r.ok, false, 'configured is not the same as working');
    assert.equal(r.authority, 'esguest');
  } finally { f.restore(); setServiceCredentialForTest(null); }
});

test('the check never throws — a boot must not fail on an unreachable repository', async () => {
  setServiceCredentialForTest({ header: 'Basic x', label: 'wlo-mcp', source: 'service' });
  const original = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch;
  try {
    const r = await verifyConfiguredCredential();
    assert.equal(r.checked, true);
    assert.equal(r.ok, false);
    assert.equal(r.authority, null);
  } finally { globalThis.fetch = original; setServiceCredentialForTest(null); }
});

test('cleartext transport is called out even when no service account is configured', async () => {
  // The per-user mode needs no service account — so gating this warning behind
  // one means the deployment where EVERY user's own password travels in the
  // clear is precisely the one that never hears about it. The warning belongs
  // to the transport, not to the service credential.
  setServiceCredentialForTest(null);
  const realWrite = process.stderr.write.bind(process.stderr);
  const realFetch = globalThis.fetch;
  const captured: string[] = [];
  process.stderr.write = ((chunk: unknown) => { captured.push(String(chunk)); return true; }) as never;
  globalThis.fetch = (() => { throw new Error('no upstream call may happen here'); }) as never;
  try {
    const r = await verifyConfiguredCredential('http://repo.example.test/edu-sharing');
    assert.equal(r.checked, false, 'there is still nothing to verify — and no network call');
    assert.match(captured.join(''), /not https/i, 'but the operator is told');
  } finally {
    process.stderr.write = realWrite;
    globalThis.fetch = realFetch;
  }
});

test('an https repository produces no cleartext warning', async () => {
  setServiceCredentialForTest(null);
  const realWrite = process.stderr.write.bind(process.stderr);
  const captured: string[] = [];
  process.stderr.write = ((chunk: unknown) => { captured.push(String(chunk)); return true; }) as never;
  try {
    await verifyConfiguredCredential('https://repo.example.test/edu-sharing');
    assert.doesNotMatch(captured.join(''), /not https/i);
  } finally { process.stderr.write = realWrite; }
});

test('a credential over a cleartext repository URL is called out', async () => {
  // HTTP Basic is base64, not encryption: over http:// the password travels
  // readable on the wire. edu-sharing gives no hint, so the operator would
  // never learn it from behaviour alone.
  const { isInsecureCredentialTransport } = await import('../src/auth/credential.js');
  assert.equal(isInsecureCredentialTransport('http://repo.example.test/edu-sharing'), true);
  assert.equal(isInsecureCredentialTransport('https://redaktion.openeduhub.net/edu-sharing'), false);
});

test('cleartext on the loopback interface is not flagged', async () => {
  // A local edu-sharing over http is the normal development setup; warning
  // there would train the operator to ignore the warning that matters.
  const { isInsecureCredentialTransport } = await import('../src/auth/credential.js');
  assert.equal(isInsecureCredentialTransport('http://localhost:8080/edu-sharing'), false);
  assert.equal(isInsecureCredentialTransport('http://127.0.0.1:8080/edu-sharing'), false);
  assert.equal(isInsecureCredentialTransport('http://[::1]:8080/edu-sharing'), false);
});

test('an unparseable repository URL is not treated as secure', async () => {
  const { isInsecureCredentialTransport } = await import('../src/auth/credential.js');
  assert.equal(isInsecureCredentialTransport('not a url'), true, 'unknown means unsafe, not safe');
});
