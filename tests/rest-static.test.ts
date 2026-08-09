import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { resolveStaticRoute, handleStaticRequest } from '../src/rest/static.js';

// ── pure core: path → asset mapping ──────────────────────────────────────────

test('resolveStaticRoute maps GET /launcher.html to the launcher asset', () => {
  const r = resolveStaticRoute('GET', '/launcher.html');
  assert.ok(r);
  assert.equal(r.status, 200);
  assert.equal(r.asset?.relPath, 'launcher.html');
  assert.match(r.asset?.contentType ?? '', /text\/html/);
});

test('resolveStaticRoute maps GET / to the launcher asset', () => {
  const r = resolveStaticRoute('GET', '/');
  assert.equal(r?.asset?.relPath, 'launcher.html');
});

test('resolveStaticRoute ignores the query string (bookmarklet ?q=)', () => {
  const r = resolveStaticRoute('GET', '/launcher.html?q=Photosynthese');
  assert.equal(r?.status, 200);
  assert.equal(r?.asset?.relPath, 'launcher.html');
});

test('resolveStaticRoute maps GET /bookmarklet.md to the bookmarklet asset', () => {
  const r = resolveStaticRoute('GET', '/bookmarklet.md');
  assert.equal(r?.status, 200);
  assert.equal(r?.asset?.relPath, 'bookmarklet.md');
  assert.match(r?.asset?.contentType ?? '', /markdown/);
});

test('resolveStaticRoute returns 405 for a non-GET method on a static-only path', () => {
  const r = resolveStaticRoute('POST', '/launcher.html');
  assert.equal(r?.status, 405);
  assert.equal(r?.asset, undefined);
});

test('resolveStaticRoute returns null for a path it does not own', () => {
  assert.equal(resolveStaticRoute('GET', '/nope.html'), null);
  assert.equal(resolveStaticRoute('GET', '/api/search'), null);
  assert.equal(resolveStaticRoute('GET', '/mcp'), null);
});

test('handleStaticRequest sends X-Content-Type-Options: nosniff on served assets', async () => {
  const rec: { status?: number; headers?: Record<string, string> } = {};
  const res = {
    writeHead(status: number, headers?: Record<string, string>) { rec.status = status; rec.headers = headers; },
    end() { /* body irrelevant here */ },
  };
  const handled = await handleStaticRequest({ method: 'GET', url: '/launcher.html' }, res);
  assert.equal(handled, true);
  assert.equal(rec.status, 200);
  assert.equal(rec.headers?.['X-Content-Type-Options'], 'nosniff');
});

// ── thin adapter (reads the real public/launcher.html) ───────────────────────

/** A minimal ServerResponse stand-in capturing what the adapter wrote. */
function fakeRes() {
  const rec: { status?: number; headers?: Record<string, string>; body?: string } = {};
  return {
    rec,
    writeHead(status: number, headers?: Record<string, string>) { rec.status = status; rec.headers = headers; },
    end(body?: string) { rec.body = body; },
  };
}

test('handleStaticRequest serves the launcher HTML for GET /launcher.html', async () => {
  const res = fakeRes();
  const handled = await handleStaticRequest({ method: 'GET', url: '/launcher.html' }, res);
  assert.equal(handled, true);
  assert.equal(res.rec.status, 200);
  assert.match(res.rec.headers?.['Content-Type'] ?? '', /text\/html/);
  const body = String(res.rec.body ?? '');
  assert.match(body, /<!doctype html/i);
  assert.match(body, /\/api\/search/); // launcher references the REST endpoint
});

test('handleStaticRequest returns false and writes nothing for a non-owned path', async () => {
  const res = fakeRes();
  const handled = await handleStaticRequest({ method: 'GET', url: '/health' }, res);
  assert.equal(handled, false);
  assert.equal(res.rec.status, undefined);
  assert.equal(res.rec.body, undefined);
});

test('handleStaticRequest returns 405 for POST on a static-only path', async () => {
  const res = fakeRes();
  const handled = await handleStaticRequest({ method: 'POST', url: '/launcher.html' }, res);
  assert.equal(handled, true);
  assert.equal(res.rec.status, 405);
});

// ── llms.txt (self-describing API surface for AI fetchers) ───────────────────

test('resolveStaticRoute maps GET /llms.txt and the file documents the search endpoints', async () => {
  const r = resolveStaticRoute('GET', '/llms.txt');
  assert.equal(r?.status, 200);
  assert.equal(r?.asset?.relPath, 'llms.txt');
  assert.match(r?.asset?.contentType ?? '', /text\/plain/);
  const res = fakeRes();
  await handleStaticRequest({ method: 'GET', url: '/llms.txt' }, res);
  const body = String(res.rec.body ?? '');
  assert.match(body, /\/api\/search\/</, 'documents the stripping-proof path form');
  assert.match(body, /\/api\/search\?q=/, 'documents the query alias');
});

/**
 * Every path this file names must exist. `llms.txt` is what an AI fetcher reads
 * INSTEAD of asking, so a path that quietly went away does not produce a broken
 * link someone notices — it produces a client that confidently calls a 404 and
 * concludes the server has nothing.
 *
 * Checked against the SOURCE rather than by calling the routes: the REST
 * handlers reach upstream, and a test that had to mock the network to confirm a
 * route exists would be testing the mock. A renamed or deleted route fails here.
 */
test('every path llms.txt advertises is one the server really serves', () => {
  const text = readFileSync(new URL('../public/llms.txt', import.meta.url), 'utf8');
  const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
  const routes = src('rest/routes.ts');
  const oauth = src('rest/oauth-pages.ts') + src('auth/oauth-metadata.ts');
  const app = src('http-app.ts');

  // Trailing punctuation and the `<term>` placeholders are documentation, not
  // part of the path.
  const paths = [...new Set(
    [...text.matchAll(/(?<![\w.])\/[\w./-]*[\w/]/g)]
      .map((m) => m[0].replace(/\/<[^>]*>.*$/, '').replace(/\/$/, ''))
      .filter((p) => p.length > 1),
  )];
  assert.ok(paths.length >= 8, `expected llms.txt to name several paths, found ${paths.length}`);

  const unserved = paths.filter((path) => {
    if (resolveStaticRoute('GET', path)) return false;
    // `/api/search/<term>` is a VARIABLE route, so no literal for it exists in
    // the table — it is matched by prefix. The example paths in llms.txt take
    // that form, and demanding a literal would fail on a route that works.
    if (path.startsWith('/api/search/')) return !routes.includes("SEARCH_PREFIX = '/api/search/'");
    if (path.startsWith('/api/')) return !routes.includes(`'${path}'`);
    if (path.startsWith('/.well-known/')) return !oauth.includes(path);
    return !app.includes(`'${path}'`);
  });
  assert.deepEqual(unserved, [], 'llms.txt names a path no route serves');
});

// ── robots.txt (AI fetch tools check it before touching /api/*) ──────────────

test('resolveStaticRoute maps GET /robots.txt to the robots asset', () => {
  const r = resolveStaticRoute('GET', '/robots.txt');
  assert.equal(r?.status, 200);
  assert.equal(r?.asset?.relPath, 'robots.txt');
  assert.match(r?.asset?.contentType ?? '', /text\/plain/);
});

test('handleStaticRequest serves a permissive robots.txt', async () => {
  const res = fakeRes();
  const handled = await handleStaticRequest({ method: 'GET', url: '/robots.txt' }, res);
  assert.equal(handled, true);
  assert.equal(res.rec.status, 200);
  const body = String(res.rec.body ?? '');
  assert.match(body, /User-agent: \*/);
  assert.match(body, /^Disallow:\s*$/m);
});

/**
 * A target that will not parse is not a target this layer owns.
 *
 * `http-app.ts` guards its own parse and falls back to the raw string, which it
 * then hands here — so a throw at this second parse escaped the handler and the
 * client got no response at all. Every layer that parses the same target must
 * answer the same way: not ours.
 */
test('resolveStaticRoute returns null for a target that will not parse', () => {
  for (const target of ['//[', '//[bad]x', '//user@[::1]x']) {
    assert.equal(resolveStaticRoute('GET', target), null, target);
  }
});

/**
 * `req.url` is `string | undefined` in the node:http types, and an absent target
 * must not be told apart from an unparseable one — both mean "no route here".
 */
test('resolveStaticRoute returns null when there is no target at all', () => {
  assert.equal(resolveStaticRoute('GET', undefined), null);
});
