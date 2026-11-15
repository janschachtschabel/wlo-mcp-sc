/**
 * auth-pages-static.test.ts – serving the two access-block pages (P5).
 *
 * They get a STRICTER policy than the launcher: the launcher runs an inline
 * script and therefore needs `script-src 'unsafe-inline'`, while these pages
 * keep their code in files and can refuse inline entirely. That is not
 * decoration — the password is typed into these pages, so an injected inline
 * script is the one thing that would defeat encrypting it in the browser.
 *
 * `form-action 'none'` matters for the same reason: if the JS ever failed, a
 * native form submit would post the password in clear. The policy makes that
 * impossible rather than relying on `event.preventDefault()`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveStaticRoute } from '../src/rest/static.js';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const read = (name: string) => readFileSync(publicDir + name, 'utf8');

test('both pages and their assets are served', () => {
  for (const [path, file] of [
    ['/auth', 'auth.html'],
    ['/auth.html', 'auth.html'],
    ['/auth-revoke.html', 'auth-revoke.html'],
    // The path the design names and people guess, mirroring /auth. It is also
    // the POST endpoint; auth-pages.ts hands the GET here deliberately.
    ['/auth/revoke', 'auth-revoke.html'],
    ['/auth.css', 'auth.css'],
    ['/auth.js', 'auth.js'],
    ['/auth-revoke.js', 'auth-revoke.js'],
    ['/access-block.js', 'access-block.js'],
  ]) {
    const r = resolveStaticRoute('GET', path);
    assert.equal(r?.status, 200, path);
    assert.equal(r?.asset?.relPath, file, path);
  }
});

test('scripts and styles are served with their own content type', () => {
  assert.match(resolveStaticRoute('GET', '/auth.css')!.asset!.contentType, /^text\/css/);
  assert.match(resolveStaticRoute('GET', '/auth.js')!.asset!.contentType, /javascript/);
});

test('the access-block pages refuse inline script and native form posts', () => {
  const csp = resolveStaticRoute('GET', '/auth.html')!.asset!.csp;
  assert.ok(csp, 'these pages must carry their own policy');
  assert.match(csp, /script-src 'self'/);
  assert.ok(!csp.includes('unsafe-inline'), 'a page that takes a password must not allow inline script');
  assert.match(csp, /form-action 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /connect-src 'self'/);
});

test('the pages carry no inline script or style for that policy to break', () => {
  // The policy above is only safe to ship if the markup complies with it — an
  // inline `style=` would be dropped silently and shift the layout with nothing
  // in the console to explain it (found exactly that way during P4).
  for (const page of ['auth.html', 'auth-revoke.html']) {
    const html = read(page);
    assert.ok(!/ style=/.test(html), `${page} has an inline style attribute`);
    assert.ok(!/<script(?![^>]*\ssrc=)/.test(html), `${page} has an inline script`);
  }
});

test('a non-GET on a page path is 405', () => {
  assert.equal(resolveStaticRoute('POST', '/auth.html')?.status, 405);
});

test('the block can be copied both as a header value and on its own', () => {
  // Measured on 2026-08-05: the field is labelled "Wert für das Feld
  // Authorization", so `Bearer …` belongs in it — but somebody using the block
  // where only the block is wanted copies the word too and gets
  // `Authorization: Bearer Bearer wlo2…`, which the server rejects as an
  // unusable token. Both uses are real, so the page offers both.
  const html = read('auth.html');
  const js = read('auth.js');

  for (const id of ['copy', 'copy-plain']) {
    assert.ok(html.includes(`id="${id}"`), `the page has no #${id} button`);
    assert.ok(js.includes(`getElementById('${id}')`), `#${id} is never wired up`);
  }
  // Both are real buttons, not links or divs, so they answer to Enter and Space.
  assert.match(html, /<button type="button" id="copy-plain"/);

  // The textarea keeps the prefix: that is what its own label promises.
  assert.match(js, /`Bearer \$\{block\}`/,
    'the Authorization value must still carry the prefix');
});

test('die Zustimmungsseite bietet einen dritten Ausgang: ohne eigenes Konto', () => {
  // Ohne ihn hat ein Client, der die Discovery gefunden hat, nur Anmelden oder
  // Abbrechen — und Abbrechen ist keine Verbindung. Gemessen am 2026-08-06 bei
  // claude.ai: die MCP-Adresse eintragen, nichts weiter, und der Browser landet
  // auf unserer Anmeldeseite ohne Weg daran vorbei.
  const html = read('authorize.html');
  const js = read('authorize.js');

  assert.ok(html.includes('id="anonymous"'), 'der Knopf fehlt auf der Seite');
  // Der Text muss sagen, was passiert — „anonym" allein liest sich wie eine
  // Zusicherung über Datenschutz, gemeint ist „ohne eigenes WLO-Konto".
  assert.match(html, /ohne (eigenes )?(WLO-)?Konto/i, 'der Knopf muss benennen, was er tut');

  // Und die Absicht muss im Rumpf stehen: der Endpunkt verweigert sonst, weil
  // ein vergessener Zugangsblock nicht als anonyme Verbindung enden darf.
  assert.ok(js.includes('anonymous: true'), 'die Absicht wird nicht mitgeschickt');
  assert.ok(!js.includes('token: block, anonymous'), 'anonym und Anmeldung sind zwei Wege, nicht einer');
});

// ── audit 2026-11-12, F-2: the three pages in English too ────────────────────

const PAGES = ['auth.html', 'auth-revoke.html', 'authorize.html'];
const SCRIPTS = ['auth.js', 'auth-revoke.js', 'authorize.js'];

test('the language module is served, under the pages\' own policy', () => {
  const r = resolveStaticRoute('GET', '/auth-i18n.js');
  assert.equal(r?.status, 200);
  assert.match(r!.asset!.contentType, /javascript/);
  for (const script of SCRIPTS) assert.match(read(script), /from '\.\/auth-i18n\.js'/, `${script} uses it`);
});

test('every text marked for translation has an English text, and no English text is orphaned', async () => {
  const { EN } = await import('../public/auth-i18n.js') as { EN: Record<string, string> };
  const used = new Set<string>();
  for (const page of PAGES) {
    for (const m of read(page).matchAll(/data-i18n(?:-title)?="([^"]+)"/g)) used.add(m[1]!);
  }
  for (const script of SCRIPTS) {
    for (const m of read(script).matchAll(/\bmsg\('([^']+)'/g)) used.add(m[1]!);
  }
  used.add('server_said');   // used by `serverMessage` inside the module
  const missing = [...used].filter(k => !EN[k]);
  const orphaned = Object.keys(EN).filter(k => !used.has(k));
  assert.deepEqual(missing, [], 'marked in a page or script, but there is no English text');
  assert.deepEqual(orphaned, [], 'an English text nothing shows');
  assert.ok(used.size > 60, `only ${used.size} keys found — the patterns no longer match the pages`);
});

test('every page offers the switch as a real, labelled button group', () => {
  for (const page of PAGES) {
    const html = read(page);
    assert.match(html, /<div class="lang" role="group" aria-label="[^"]+">/, page);
    assert.match(html, /<button type="button" data-lang="de" aria-pressed="true" lang="de" aria-label="Deutsch">DE<\/button>/, page);
    assert.match(html, /<button type="button" data-lang="en" aria-pressed="false" lang="en" aria-label="English">EN<\/button>/, page);
  }
});

test('which language: asked for, else the browser\'s, else English for everybody else', async () => {
  const { pickLang } = await import('../public/auth-i18n.js') as { pickLang: (s: string, l: readonly string[]) => string };
  assert.equal(pickLang('?lang=en', ['de-DE']), 'en', 'an explicit choice wins');
  assert.equal(pickLang('?lang=de', ['en-US']), 'de');
  assert.equal(pickLang('?lang=fr', ['de-AT', 'en']), 'de', 'an unknown value is no choice');
  assert.equal(pickLang('', ['fr-FR', 'en-GB', 'de']), 'en', 'the first of the two we have');
  assert.equal(pickLang('', ['de']), 'de');
  assert.equal(pickLang('', ['tr-TR']), 'en', 'whoever reads neither gets the more widely read one');
  assert.equal(pickLang('', []), 'en');
});

test('a message from script keeps its German when there is no English, and fills its numbers', async () => {
  const { msg, currentLang } = await import('../public/auth-i18n.js') as {
    msg: (k: string, de: string, v?: Record<string, number>) => string; currentLang: () => string;
  };
  assert.equal(currentLang(), 'de', 'German until a page says otherwise');
  assert.equal(msg('revoke_all_many', '{n} Zugänge wurden gesperrt.', { n: 3 }), '3 Zugänge wurden gesperrt.');
  assert.equal(msg('gibt-es-nicht', 'Bleibt deutsch.'), 'Bleibt deutsch.');
});

test('the values the SERVER confirmed are never marked for translation — a switch must not overwrite them', () => {
  const html = read('authorize.html');
  for (const id of ['redirect-origin', 'client-name', 'status']) {
    const tag = new RegExp(`<[^>]*id="${id}"[^>]*>`).exec(html)?.[0] ?? '';
    assert.ok(tag, id);
    assert.doesNotMatch(tag, /data-i18n/, id);
  }
  assert.doesNotMatch(read('auth-i18n.js'), /(?:localStorage|sessionStorage)\s*[.[]|document\.cookie/, 'the choice is not stored');
});
