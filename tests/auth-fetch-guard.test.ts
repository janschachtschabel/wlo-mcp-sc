/**
 * auth-fetch-guard.test.ts – where the credential may travel.
 *
 * One place attaches it (`wloFetch`) and one rule bounds it: only requests to
 * the configured repository carry the header. Wikipedia, the text-extraction
 * service and anything else must never see the operator's password.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WLO_REPOSITORY_URL } from '../src/wlo-config.js';
import { wloFetch } from '../src/wlo-fetch.js';
import { setServiceCredentialForTest } from '../src/auth/credential.js';

/** Capture the headers `wloFetch` would send, without a network call. */
function captureFetch(): { calls: { url: string; auth: string | undefined }[]; restore: () => void } {
  const original = globalThis.fetch;
  const calls: { url: string; auth: string | undefined }[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const headers = new Headers(init?.headers ?? {});
    calls.push({ url: String(input), auth: headers.get('authorization') ?? undefined });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('the repository gets the credential', async () => {
  const cap = captureFetch();
  setServiceCredentialForTest({ header: 'Basic dGVzdDp4', label: 'test', source: 'service' });
  try {
    await wloFetch(`${WLO_REPOSITORY_URL}/rest/search/v1/queries/-home-/mds_oeh/ngsearch`);
    assert.equal(cap.calls[0]?.auth, 'Basic dGVzdDp4');
  } finally { setServiceCredentialForTest(null); cap.restore(); }
});

test('a foreign host NEVER gets the credential', async () => {
  const cap = captureFetch();
  setServiceCredentialForTest({ header: 'Basic dGVzdDp4', label: 'test', source: 'service' });
  try {
    for (const url of [
      'https://de.wikipedia.org/api/rest_v1/page/summary/Optik',
      'https://text-extraction.staging.openeduhub.net/from-url',
      // A look-alike prefix must not pass either.
      `${WLO_REPOSITORY_URL}.evil.example/rest/x`,
    ]) {
      await wloFetch(url);
    }
    for (const c of cap.calls) {
      assert.equal(c.auth, undefined, `${c.url} must not carry the credential`);
    }
  } finally { setServiceCredentialForTest(null); cap.restore(); }
});

test('without a configured credential nothing changes (guest mode is untouched)', async () => {
  const cap = captureFetch();
  setServiceCredentialForTest(null);
  try {
    await wloFetch(`${WLO_REPOSITORY_URL}/rest/anything`);
    assert.equal(cap.calls[0]?.auth, undefined);
  } finally { cap.restore(); }
});

test('a caller-supplied Authorization header is not overwritten', async () => {
  const cap = captureFetch();
  setServiceCredentialForTest({ header: 'Basic dGVzdDp4', label: 'test', source: 'service' });
  try {
    await wloFetch(`${WLO_REPOSITORY_URL}/rest/x`, { headers: { Authorization: 'Basic ZXhwbGljaXQ6eA==' } });
    assert.equal(cap.calls[0]?.auth, 'Basic ZXhwbGljaXQ6eA==', 'an explicit header wins');
  } finally { setServiceCredentialForTest(null); cap.restore(); }
});
