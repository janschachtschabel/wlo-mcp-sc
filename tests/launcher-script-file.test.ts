/**
 * launcher-script-file.test.ts – the launcher runs its script from a FILE.
 *
 * The launcher shares its origin with the pages a WLO password is typed on. As
 * long as its script was inline, its policy had to allow `script-src
 * 'unsafe-inline'` — the one such allowance on that origin. Since 2026-11-14
 * the script is `public/launcher.js`, the policy says `'self'`, and these tests
 * keep the three parts in step: the page, the route, the policy.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LAUNCHER_CSP, resolveStaticRoute } from '../src/rest/static.js';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

const html = read('../public/launcher.html');

test('the page has ONE script tag, and it loads the file', () => {
  const tags = html.match(/<script\b[^>]*>/g) ?? [];
  assert.deepEqual(tags, ['<script src="/launcher.js">']);
  assert.match(html, /<script src="\/launcher\.js"><\/script>/, 'no inline code between the tags');
});

test('nothing in the page needs inline script', () => {
  // An inline handler or a javascript: link is dropped silently under script-src 'self'.
  assert.doesNotMatch(html, /\son[a-z]+\s*=\s*["']/i, 'no inline event handler attributes');
  assert.doesNotMatch(html, /href\s*=\s*["']\s*javascript:/i);
});

test('the script is served, as a script', () => {
  const route = resolveStaticRoute('GET', '/launcher.js');
  assert.equal(route?.status, 200);
  assert.match(route!.asset!.contentType, /javascript/);
  assert.ok(read('../public/launcher.js').includes('"use strict"'), 'the file holds the script');
});

test("the launcher's policy allows no inline script", () => {
  assert.match(LAUNCHER_CSP, /script-src 'self'/);
  assert.doesNotMatch(LAUNCHER_CSP, /script-src[^;]*unsafe-inline/);
});
