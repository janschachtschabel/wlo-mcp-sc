import { test } from 'node:test';
import assert from 'node:assert/strict';

import { routeRestRequest } from '../src/rest/routes.js';
import { installFetchMock, makeNode } from './fetchMock.js';

// `?format=html` renders the SAME search as a readable HTML page. Evidence
// behind it (live, 2026-07-17): ChatGPT's browsing DID retrieve a pasted API
// URL but could not use the body ("keine WLO-JSON-Suchantwort") — its reader
// pipeline consumes HTML, not raw JSON. The HTML view is also the human-
// friendly share target.

function searchMock(title = 'Arbeitsblatt Optik') {
  return installFetchMock((url) => {
    if (url.includes('/ngsearch')) {
      return { json: { nodes: [makeNode('c-1', title)], pagination: { total: 5, from: 0, count: 1 } } };
    }
    if (url.includes('/collections')) return { json: { nodes: [] } };
    return { json: {} };
  });
}

test('GET /api/search/<term>?format=html returns a readable HTML page with the hits', async () => {
  const mock = searchMock();
  try {
    const r = await routeRestRequest('GET', '/api/search/optik?format=html');
    assert.equal(r?.status, 200);
    assert.match(r?.contentType ?? '', /text\/html/);
    const html = String(r!.raw ?? '');
    assert.match(html, /<!doctype html>/i);
    assert.match(html, /Arbeitsblatt Optik/);
    assert.match(html, /optik/, 'query echoed on the page');
    assert.match(html, /\/api\/search\/optik/, 'links the JSON view');
  } finally {
    mock.restore();
  }
});

test('GET /api/search?q=…&format=html works on the query form too', async () => {
  const mock = searchMock();
  try {
    const r = await routeRestRequest('GET', '/api/search?q=optik&format=html');
    assert.equal(r?.status, 200);
    assert.match(r?.contentType ?? '', /text\/html/);
    assert.match(String(r!.raw ?? ''), /Arbeitsblatt Optik/);
  } finally {
    mock.restore();
  }
});

test('the HTML view escapes untrusted node fields (no injection)', async () => {
  const mock = searchMock('<script>alert(1)</script>');
  try {
    const r = await routeRestRequest('GET', '/api/search/optik?format=html');
    const html = String(r!.raw ?? '');
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.match(html, /&lt;script&gt;/);
  } finally {
    mock.restore();
  }
});

test('GET /api/search?format=html without a term renders the guidance as HTML', async () => {
  const r = await routeRestRequest('GET', '/api/search?format=html');
  assert.equal(r?.status, 200);
  assert.match(r?.contentType ?? '', /text\/html/);
  assert.match(String(r!.raw ?? ''), /api\/search\//, 'hint teaches the path form');
});
