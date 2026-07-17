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
  const handled = await handleRestRequest({ method: 'GET', url: '/api/search' }, res);
  assert.equal(handled, true);
  assert.equal(res.rec.status, 400);
});

test('handleRestRequest sends X-Content-Type-Options: nosniff on JSON and raw responses', async () => {
  const res = fakeRes();
  await handleRestRequest({ method: 'GET', url: '/api/search' }, res); // 400 JSON path, offline
  assert.equal(res.rec.headers?.['X-Content-Type-Options'], 'nosniff');
  const raw = fakeRes();
  await handleRestRequest({ method: 'GET', url: '/api/skills/wlo-search' }, raw); // raw markdown path
  assert.equal(raw.rec.headers?.['X-Content-Type-Options'], 'nosniff');
});
