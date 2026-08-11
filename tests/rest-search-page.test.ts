import { test } from 'node:test';
import assert from 'node:assert/strict';

import { routeRestRequest } from '../src/rest/routes.js';
import { renderSearchPage } from '../src/rest/search-page.js';
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

/**
 * `?format=html` accepts `license` like every other search path, and the
 * exactness pass runs on it — but the page rendered none of it. The JSON view
 * discloses through `content.licenseFilter`; the HTML view dropped that field,
 * so a filter that removed every candidate showed up as a bare "Keine Treffer."
 * over material that is demonstrably there (staging holds 18 793 OER records
 * for `Mathematik` alone). This is the most visible of the paths, and it was the
 * only one saying nothing.
 */
test('the HTML view says when a licence filter emptied the result', async () => {
  // The mock node carries no `ccm:commonlicense_key`, so the exactness pass
  // drops it — exactly the case a bare "Keine Treffer." would misreport.
  const mock = searchMock();
  try {
    const r = await routeRestRequest('GET', '/api/search/optik?license=CC%20BY%204.0&format=html');
    const html = String(r!.raw ?? '');
    assert.match(html, /genau der Lizenz/, 'names the licence check as the reason');
    assert.match(html, /CC BY 4\.0/, 'and which licence was asked for');
  } finally {
    mock.restore();
  }
});

test('the HTML view discloses the licence pass when hits survive it', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/ngsearch')) {
      return {
        json: {
          nodes: [
            makeNode('c-1', 'Genau CC BY', { 'ccm:commonlicense_key': ['CC_BY'] }),
            makeNode('c-2', 'Eine NC-Verwandte', { 'ccm:commonlicense_key': ['CC_BY_NC'] }),
          ],
          pagination: { total: 5, from: 0, count: 2 },
        },
      };
    }
    if (url.includes('/collections')) return { json: { nodes: [] } };
    return { json: {} };
  });
  try {
    const r = await routeRestRequest('GET', '/api/search/optik?license=CC%20BY%204.0&format=html');
    const html = String(r!.raw ?? '');
    assert.match(html, /Genau CC BY/, 'the exact match is listed');
    assert.doesNotMatch(html, /Eine NC-Verwandte/, 'the family relative is not');
    assert.match(html, /entfernt|genau der Lizenz/, 'and the page says a pass removed something');
  } finally {
    mock.restore();
  }
});

/**
 * Same trap the tool fell into: the paging caveat belongs to the CONTENT search,
 * so it must not fire when `include` left that search out. `content.licenseFilter`
 * is the honest gate — it exists exactly when a licence was set AND the content
 * leg ran.
 */
test('the HTML view stays quiet about paging when no content search ran', async () => {
  const mock = searchMock();
  try {
    const r = await routeRestRequest(
      'GET',
      '/api/search/optik?license=OER&include=collections&skipCount=8&format=html',
    );
    const html = String(r!.raw ?? '');
    assert.doesNotMatch(html, /Fortsetzung/, 'no paging caveat about a search that did not happen');
    assert.doesNotMatch(html, /genau der Lizenz/, 'and no licence notice either');
  } finally {
    mock.restore();
  }
});

/**
 * The page hardcodes a LIGHT palette (near-black text, a blue link, a pale
 * warning strip) but declared no background, so a browser in dark mode painted
 * its own dark canvas underneath — measured live 2026-08-03 at
 * `color: rgb(26,26,26)` on a transparent body, roughly 1.1:1. Unreadable, and
 * invisible to every unit test and to reading the source; only opening the page
 * showed it. A palette has to state both halves of its contrast or neither.
 */
test('the HTML view states its own background, not just its text colour', async () => {
  const r = await routeRestRequest('GET', '/api/search?format=html');
  const html = String(r!.raw ?? '');
  const body = /body\{([^}]*)\}/.exec(html)?.[1] ?? '';
  assert.match(body, /color:/, 'text colour');
  assert.match(body, /background:/, 'and the surface it is read against');
  assert.match(html, /color-scheme:\s*light/, 'so the UA paints a light canvas and matching scrollbars');
});

test('the HTML view renders a collection registry the envelope carries', () => {
  // The operator switch is read inside `searchAll`, so /api/search inherits the
  // enrichment without asking for it — and paid ~1,0–1,4 s per search for a
  // field this page dropped on the floor. An envelope field is not a disclosure
  // if the renderer discards it.
  const html = renderSearchPage({
    query: 'optik',
    collections: { total: 1, count: 1, results: [{
      title: 'Sammlung Optik',
      skillRegistry: {
        nodeId: 'reg-1',
        title: 'Skill Registry Optik',
        entries: [{ nodeId: 'skill-a', title: 'Fragen generieren' }],
      },
    }] },
  });

  assert.match(html, /Skill Registry Optik/, 'the registry is named');
  assert.match(html, /Fragen generieren/, 'and the skills it declares');
});

test('the HTML view escapes a registry title like every other backend field', () => {
  const html = renderSearchPage({
    collections: { results: [{
      title: 'Sammlung',
      skillRegistry: { nodeId: 'reg-1', title: '<img src=x onerror=alert(1)>', entries: [] },
    }] },
  });
  assert.ok(!html.includes('<img src=x'), 'no raw markup from repository data');
});
