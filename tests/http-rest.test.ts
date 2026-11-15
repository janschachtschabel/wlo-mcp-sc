import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleRestRequest } from '../src/rest/routes.js';
import { installFetchMock, makeNode } from './fetchMock.js';

/** A minimal ServerResponse stand-in capturing what the adapter wrote. */
function fakeRes() {
  const rec: { status?: number; headers?: Record<string, string>; body?: string } = {};
  return {
    rec,
    writeHead(status: number, headers?: Record<string, string>) { rec.status = status; rec.headers = headers; },
    end(body?: string) { rec.body = body; },
  };
}

test('handleRestRequest writes JSON + status and returns true for a known route', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/ngsearch')) return { json: { nodes: [makeNode('c-1', 'X')], pagination: { total: 1, from: 0, count: 1 } } };
    if (url.includes('/collections')) return { json: { nodes: [] } };
    return { json: {} };
  });
  try {
    const res = fakeRes();
    const handled = await handleRestRequest({ method: 'GET', url: '/api/search?q=optik' }, res);
    assert.equal(handled, true);
    assert.equal(res.rec.status, 200);
    assert.equal(res.rec.headers?.['Content-Type'], 'application/json');
    const body = JSON.parse(res.rec.body ?? '{}');
    assert.equal(body.query, 'optik');
  } finally {
    mock.restore();
  }
});

test('handleRestRequest returns false and writes nothing for a non-/api path', async () => {
  const res = fakeRes();
  const handled = await handleRestRequest({ method: 'GET', url: '/health' }, res);
  assert.equal(handled, false);
  assert.equal(res.rec.status, undefined);
  assert.equal(res.rec.body, undefined);
});

test('handleRestRequest surfaces a 400 for invalid input', async () => {
  const res = fakeRes();
  // /api/search without q is now a 200 guidance envelope (stripped-query UX);
  // /api/wikipedia keeps the strict contract and stays the 400 witness.
  const handled = await handleRestRequest({ method: 'GET', url: '/api/wikipedia' }, res);
  assert.equal(handled, true);
  assert.equal(res.rec.status, 400);
});

/**
 * `?format=html` is the one REST response a browser renders, and it embeds
 * repository-supplied titles and descriptions. The escaping in `search-page.ts`
 * is the control; the CSP is the second one, and it can be strict here because
 * the page carries no scripts and no images of its own.
 */
test('the HTML search view is served under a strict content security policy', async () => {
  const res = fakeRes();
  await handleRestRequest({ method: 'GET', url: '/api/search?format=html' }, res); // guidance page, offline
  assert.match(res.rec.headers?.['Content-Type'] ?? '', /text\/html/);
  const csp = res.rec.headers?.['Content-Security-Policy'] ?? '';
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /script-src 'unsafe-inline'/, 'this page runs no script at all');
});

test('a JSON response carries no content security policy', () => {
  // A CSP on `application/json` governs nothing and only invites someone to
  // copy it onto a surface where the value would be wrong.
  const res = fakeRes();
  return handleRestRequest({ method: 'GET', url: '/api/search' }, res).then(() => {
    assert.equal(res.rec.headers?.['Content-Security-Policy'], undefined);
  });
});

test('handleRestRequest sends nosniff + no-store on JSON and raw responses', async () => {
  const res = fakeRes();
  await handleRestRequest({ method: 'GET', url: '/api/search' }, res); // guidance envelope, offline
  assert.equal(res.rec.headers?.['X-Content-Type-Options'], 'nosniff');
  assert.equal(res.rec.headers?.['Cache-Control'], 'no-store');
  const raw = fakeRes();
  await handleRestRequest({ method: 'GET', url: '/api/skills/wlo-search' }, raw); // raw markdown path
  assert.equal(raw.rec.headers?.['X-Content-Type-Options'], 'nosniff');
  assert.equal(raw.rec.headers?.['Cache-Control'], 'no-store');
});
