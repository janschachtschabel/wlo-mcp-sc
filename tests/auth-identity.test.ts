/**
 * auth-identity.test.ts – "who am I, really" against edu-sharing.
 *
 * The reason this exists at all: probing (P0, 2026-07-30) showed that WRONG
 * credentials do not produce 401. edu-sharing answers 200 and reports the guest
 * authority, so a typo in the operator's password is indistinguishable from
 * "auth is switched off" unless the server asks who it is.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkIdentity } from '../src/auth/identity.js';
import { WLO_REPOSITORY_URL } from '../src/wlo-config.js';

function fetchMock(handler: (url: string) => { status?: number; json?: unknown }) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const r = handler(String(input));
    return new Response(JSON.stringify(r.json ?? {}), {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { restore: () => { globalThis.fetch = original; } };
}

test('a real account is reported as authenticated, with its name', async () => {
  const m = fetchMock(() => ({ json: { person: { authorityName: 'wlo-mcp', profile: { firstName: 'WLO', lastName: 'Dienst' } } } }));
  try {
    const id = await checkIdentity();
    assert.equal(id.authenticated, true);
    assert.equal(id.authority, 'wlo-mcp');
  } finally { m.restore(); }
});

test('the guest authority is reported as NOT authenticated', async () => {
  // The trap this whole module exists for: 200 OK, but we are nobody.
  const m = fetchMock(() => ({ json: { person: { authorityName: 'esguest' } } }));
  try {
    const id = await checkIdentity();
    assert.equal(id.authenticated, false);
    assert.equal(id.authority, 'esguest');
  } finally { m.restore(); }
});

test('an unreachable repository is reported as unknown, not as authenticated', async () => {
  const m = fetchMock(() => ({ status: 500 }));
  try {
    const id = await checkIdentity();
    assert.equal(id.authenticated, false);
    assert.equal(id.authority, null, 'no identity claim when the answer is unusable');
  } finally { m.restore(); }
});

test('the identity probe asks the endpoint that actually reports the authority', async () => {
  let seen = '';
  const m = fetchMock((url) => { seen = url; return { json: { person: { authorityName: 'esguest' } } }; });
  try {
    await checkIdentity();
    assert.equal(seen, `${WLO_REPOSITORY_URL}/rest/iam/v1/people/-home-/-me-`);
  } finally { m.restore(); }
});
