/**
 * oauth-authorize-page.test.ts – the page where somebody types their WLO
 * password so a client may act as them (P3/T3.5).
 *
 * Twin of `auth.html`, and held to the same rules for the same reason: the
 * policy that forbids inline script is only safe to ship if the markup actually
 * complies with it, and a page that takes a password is exactly where an
 * injected inline script would undo encrypting it in the browser.
 *
 * The page is deliberately NOT in the static allow-list. It is served only by
 * `GET /oauth/authorize`, after the request's parameters have been checked —
 * asking for a password first and validating afterwards would mean anyone could
 * point a WLO editor at a password field on our domain.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { resolveStaticRoute, AUTHORIZE_ASSET } from '../src/rest/static.js';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const read = (name: string) => readFileSync(publicDir + name, 'utf8');
const html = read('authorize.html');
const script = read('authorize.js');

test('the page itself is not reachable as a static file', () => {
  for (const path of ['/authorize.html', '/authorize', '/oauth/authorize']) {
    assert.equal(resolveStaticRoute('GET', path), null,
      `${path} would show a password field before any parameter was checked`);
  }
  assert.equal(AUTHORIZE_ASSET.relPath, 'authorize.html');
});

test('its script is served, and under the same policy as the other pages', () => {
  const route = resolveStaticRoute('GET', '/authorize.js');
  assert.equal(route?.status, 200);
  assert.equal(route?.asset?.relPath, 'authorize.js');
  assert.match(route!.asset!.contentType, /javascript/);

  const csp = AUTHORIZE_ASSET.csp;
  assert.ok(csp, 'the authorization page must carry its own policy');
  assert.match(csp, /script-src 'self'/);
  assert.ok(!csp.includes('unsafe-inline'), 'a page that takes a password must not allow inline script');
  assert.match(csp, /form-action 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
});

test('the page carries no inline script or style for that policy to break', () => {
  assert.ok(!/ style=/.test(html), 'inline style attribute');
  assert.ok(!/<script(?![^>]*\ssrc=)/.test(html), 'inline script');
});

test('every input is labelled, and none is labelled by its placeholder', () => {
  const ids = [...html.matchAll(/<input\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]!);
  assert.ok(ids.length >= 2, `expected at least a user and a password field, found ${ids.length}`);
  for (const id of ids) {
    assert.match(html, new RegExp(`<label for="${id}"`), `no <label for="${id}">`);
  }
  assert.ok(!/<input\b[^>]*placeholder=/.test(html), 'a placeholder is not a label');
});

test('the password field is a password field, and both fields autocomplete', () => {
  assert.match(html, /type="password"[^>]*autocomplete="current-password"|autocomplete="current-password"[^>]*type="password"/);
  assert.match(html, /autocomplete="username"/);
});

test('the result of an action is announced, not only shown', () => {
  assert.match(html, /aria-live="polite"/, 'the status line needs a live region');
});

test('the page names who is asking and where the answer goes', () => {
  // Consent means knowing what is being consented to. Both values are filled in
  // by the script from data the SERVER validated — never from the query string.
  for (const id of ['client-name', 'redirect-origin']) {
    assert.match(html, new RegExp(`id="${id}"`), `the page has no #${id} to fill`);
    assert.match(script, new RegExp(`getElementById\\('${id}'\\)`), `the script never fills #${id}`);
  }
  // Assignment, not the mere word: the file explains in a comment WHY it uses
  // textContent, and a test that trips over its own rationale teaches people to
  // delete the rationale.
  assert.ok(!/\b(inner|outer)HTML\s*=|insertAdjacentHTML/.test(script),
    'foreign text goes in via textContent — innerHTML would let a client name carry markup');
});

test('the script talks to this server and nowhere else', () => {
  // Same check as `access-block-browser.test.ts` applies to auth.js: a page that
  // holds a password in memory must not have a second destination.
  const targets = [...script.matchAll(/fetch\(\s*([^)]+?)[,)]/g)].map((m) => m[1]!.trim());
  assert.ok(targets.length > 0, 'no fetch call found — did the file move?');
  for (const target of targets) {
    assert.ok(
      /^'\/[a-z/-]+'$/.test(target) || target === 'location.href',
      `fetch target must be a same-origin path literal, got ${target}`,
    );
  }
  assert.ok(script.includes("'/oauth/authorize'"), 'the consent POST must go to /oauth/authorize');
  assert.ok(!/https?:\/\//.test(script.replace(/^\s*\*.*$/gm, '')),
    'no absolute URL outside comments');
});

test('the block is built in the browser, from the shared module', () => {
  // The password must never leave as plaintext, which is only true if this page
  // uses the same encoder the access page uses.
  assert.match(script, /from '\.\/access-block\.js'/);
  assert.match(script, /encodeAccessBlock\(/);
});

test('the page posts every field the endpoint requires', async () => {
  // Found by running it, not by reading it: the page and the endpoint were each
  // tested against the author's own idea of the body, and they disagreed —
  // `response_type` was missing, so every consent came back "Dieser Anfragetyp
  // wird nicht unterstützt". A unit test on either side alone cannot see that.
  // This one takes the field names out of the PAGE and feeds them to the REAL
  // check.
  // Since 2026-08-06 the body is built in ONE function used by both exits (log
  // in, or connect without an account) — a second literal is exactly where a
  // field goes missing again.
  const post = /function authorizeBody\([^)]*\)\s*\{[\s\S]*?JSON\.stringify\(\{([\s\S]*?)\n\s*\}\);/.exec(script);
  assert.ok(post, 'could not find authorizeBody() in authorize.js');
  const fields = [...post[1]!.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]!);
  // `token` is added by the caller, not by the shared body — the anonymous exit
  // deliberately has none. What must hold is that the login exit supplies it.
  assert.ok(/grant\(authorizeBody\(\{ token:/.test(script), 'the block itself must be posted when signing in');
  fields.push('token');

  const { generateKeyPairSync } = await import('node:crypto');
  const { loadAuthKeys } = await import('../src/auth/access-token.js');
  const { encodeClientId } = await import('../src/auth/oauth-clients.js');
  const { checkAuthorizeParams } = await import('../src/auth/oauth-authorize.js');

  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keys = loadAuthKeys({ current: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
  assert.ok(keys);
  const redirectUri = 'https://a.example/cb';
  const values: Record<string, string> = {
    client_id: encodeClientId({ redirectUris: [redirectUri], name: 'X' }, keys),
    redirect_uri: redirectUri,
    response_type: 'code',
    code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    code_challenge_method: 'S256',
    state: 'xyz',
  };
  const sent = new Set(fields);
  const checked = checkAuthorizeParams(
    (name) => (sent.has(name) ? values[name] ?? null : null),
    keys,
  );
  assert.equal(checked.ok, true,
    `the page does not post everything the endpoint checks: ${checked.ok ? '' : checked.error}`);
});

test('the verified destination outranks the self-chosen name', () => {
  // Registration is open by design (RFC 7591, and the MCP specification expects
  // it), so `client_name` is whatever the caller typed — a phishing client can
  // call itself "WirLernenOnline offiziell". The destination is the part this
  // server checked against the registration, and it is the only thing on the
  // screen that can contradict the name. Listing them as two equal rows with the
  // invented one first puts the reassuring lie where the eye lands.
  const nameAt = html.indexOf('id="client-name"');
  const originAt = html.indexOf('id="redirect-origin"');
  assert.ok(nameAt > 0 && originAt > 0, 'both values are on the page');
  assert.ok(originAt < nameAt, 'the destination is presented before the name');
  // And the name is labelled as the caller's own claim, not as a fact.
  assert.match(html, /selbst angegeben/i,
    'the page says the name is self-declared, so it is not read as verified');
});
