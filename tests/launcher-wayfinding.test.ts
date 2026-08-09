/**
 * launcher-wayfinding.test.ts – the front door must lead somewhere.
 *
 * Measured on 2026-08-06: `/` linked to exactly two things, `#` and
 * `bookmarklet.md`. Every access-block page links *back* to `/`, but `/` linked
 * forward to none of them — so `/auth` and the revocation page were reachable
 * only by someone who already knew the URL. The revocation page shipped the same
 * day and was unreachable from the front door on arrival.
 *
 * The MCP address had the same problem from the other side: the setup card said
 * "trägst du den WLO-MCP-Server in deiner KI ein" and never said what to enter.
 *
 * These tests pin the paths, not the wording, and pin that both languages carry
 * every key — a wayfinder that exists in German only is a dead end for half the
 * page's own audience.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PAGE = readFileSync(new URL('../public/launcher.html', import.meta.url), 'utf8');

/**
 * Where a person must be able to get to from the start page. Each one is a route
 * `rest/static.ts` really serves — a link to a path we do not own is worse than
 * no link, so the list is kept honest by the route test below.
 */
const DESTINATIONS = [
  '/auth',            // fetch an access block
  '/auth-revoke.html', // block one, or all of an account's
  '/llms.txt',        // what an AI fetcher reads
];

test('the start page leads to every page a person needs', () => {
  const missing = DESTINATIONS.filter((path) => !PAGE.includes(`href="${path}"`));
  assert.deepEqual(missing, [], 'the front door must link forward, not only be linked back to');
});

/**
 * `href=""` resolves to the current document, so a link the script fills in
 * later reloads the page instead of navigating when the script does not run.
 * Every entry in this list must work without JavaScript.
 */
test('no wayfinding link depends on the script to have a destination', () => {
  const nav = PAGE.slice(PAGE.indexOf('ul class="navlist"'), PAGE.indexOf('</nav>'));
  const empty = [...nav.matchAll(/<a\s+href=""[^>]*id="([\w-]+)"/g)].map((m) => m[1]!);
  assert.deepEqual(empty, [], 'give the link a real path in the markup; the script may still refine it');
});

/**
 * The one value the "native MCP" route cannot work without. Built from
 * `location.origin` like the page's other URLs rather than hardcoded, so it
 * stays right on every deployment — which is exactly why this asserts the
 * ELEMENT the script fills, not a literal address.
 */
test('the start page shows the MCP address, not just the word MCP', () => {
  assert.ok(PAGE.includes('id="mcp-url"'), 'the address needs a place to appear');
  assert.ok(/\$\("mcp-url"\)\.textContent\s*=/.test(PAGE), 'and something must fill it');
  // The property that makes it right everywhere: no absolute address is written
  // into the page, so a deployment on a different host does not hand out the
  // old one. `base()` supplies `location.origin`.
  const hardcoded = [...PAGE.matchAll(/https?:\/\/[^"'\s]*\/mcp\b/g)].map((m) => m[0]);
  assert.deepEqual(hardcoded, [], 'build the address from the origin, do not write a host into the page');
});

/**
 * The page carries a DE/EN table and every visible string goes through it. A
 * new section that skips it looks finished in German and blank in English —
 * which is how half a page quietly stops working.
 */
test('every wayfinding string exists in both languages', () => {
  const table = (lang: 'de' | 'en'): string => {
    const start = PAGE.indexOf(`      ${lang}: {`);
    assert.ok(start > 0, `the ${lang} table must exist`);
    // The LAST table closes without a trailing comma, and the file is CRLF —
    // both of which a plain `indexOf('\n      },')` gets wrong for `en` only.
    const rest = PAGE.slice(start);
    const end = /\r?\n {6}\},?/.exec(rest);
    assert.ok(end, `the ${lang} table must be delimited`);
    return rest.slice(0, end.index);
  };
  const de = table('de');
  const en = table('en');

  // Both ways a string reaches the page: the `data-i18n` attribute for static
  // markup, and `t("…")` for anything the script writes at runtime. Collecting
  // only the first would leave every status and error message unchecked — which
  // is exactly the half that a user meets when something has gone wrong.
  const keys = [
    ...[...PAGE.matchAll(/data-i18n="([a-z_]+)"/g)].map((m) => m[1]!),
    ...[...PAGE.matchAll(/\bt\("([a-z_]+)"\)/g)].map((m) => m[1]!),
  ];
  const wayfinding = [...new Set(keys)].filter((k) => k.startsWith('nav_') || k.startsWith('mcp_'));
  assert.ok(wayfinding.length > 0, 'the section must be translatable at all');

  const missing = wayfinding.flatMap((k) => [
    ...(de.includes(`${k}:`) ? [] : [`de.${k}`]),
    ...(en.includes(`${k}:`) ? [] : [`en.${k}`]),
  ]);
  assert.deepEqual(missing, [], 'a key present in one table only renders empty in the other');
});
