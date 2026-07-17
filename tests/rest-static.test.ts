import { test } from 'node:test';
import assert from 'node:assert/strict';

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
