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

// ── refused vs. not reached (chatbot team feedback 2026-11-07, B2) ─────────
// `authority: null` used to mean both. A chatbot then had to treat a changed
// password like an outage (grace period) or an outage like a refused login
// (everyone logged out on every repository blip). `unreachable` separates them.

test('a refusal (401/403/404) is an ANSWER: not authenticated, but the repository was reached', async () => {
  for (const status of [401, 403, 404]) {
    const m = fetchMock(() => ({ status }));
    try {
      const id = await checkIdentity();
      assert.equal(id.authenticated, false);
      assert.equal(id.authority, null);
      assert.equal(id.unreachable, undefined, `${status} is the repository saying no, not silence`);
    } finally { m.restore(); }
  }
});

test('an overloaded or failing repository (429/5xx) is NOT reached — no verdict on the login', async () => {
  for (const status of [429, 500, 502, 503, 504]) {
    const m = fetchMock(() => ({ status }));
    try {
      assert.equal((await checkIdentity()).unreachable, true, `${status}`);
    } finally { m.restore(); }
  }
});

test('a network failure and an unreadable 200 (proxy maintenance page) are NOT reached either', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch;
  try {
    assert.equal((await checkIdentity()).unreachable, true, 'network failure');
  } finally { globalThis.fetch = original; }
  globalThis.fetch = (async () => new Response('<html>Wartung</html>', { status: 200, headers: { 'content-type': 'text/html' } })) as typeof fetch;
  try {
    assert.equal((await checkIdentity()).unreachable, true, 'HTML instead of JSON');
  } finally { globalThis.fetch = original; }
});

test('a definite identity — guest or person — carries no unreachable mark', async () => {
  for (const authorityName of ['esguest', 'maria']) {
    const m = fetchMock(() => ({ json: { person: { authorityName } } }));
    try {
      assert.equal((await checkIdentity()).unreachable, undefined, authorityName);
    } finally { m.restore(); }
  }
});

test('a 200 that parses but names no authority is NOT reached either (finding 9)', async () => {
  const m = fetchMock(() => ({ json: { somethingElse: true } }));
  try {
    assert.equal((await checkIdentity()).unreachable, true);
  } finally { m.restore(); }
});

test('each unreachable answer is its own object — a caller writing into one cannot poison the next (finding 4)', async () => {
  const m = fetchMock(() => ({ status: 503 }));
  try {
    const first = await checkIdentity();
    (first as { authority: string | null }).authority = 'manipuliert';
    const second = await checkIdentity();
    assert.equal(second.authority, null);
  } finally { m.restore(); }
});
