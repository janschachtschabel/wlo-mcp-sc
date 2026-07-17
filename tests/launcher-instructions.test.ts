import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The launcher hands its `instruction_tpl` to the chat as the opening message.
// Regression guard for the report "content search only recommended filters and
// never queried the API": both language templates must instruct the chat to
// actually call the search now (imperative), not merely state that it *can*.
const launcherHtml = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'launcher.html');

test('launcher DE instruction template directs the chat to search immediately', async () => {
  const html = await readFile(launcherHtml, 'utf8');
  assert.match(html, /rufe die Such-URL sofort/i,
    'DE template must tell the chat to call the search right away');
});

test('launcher EN instruction template directs the chat to search immediately', async () => {
  const html = await readFile(launcherHtml, 'utf8');
  assert.match(html, /call the search URL right away/i,
    'EN template must tell the chat to call the search right away');
});

// Live findings 2026-07-17: (a) without a topic the chat invented a "test"
// query; (b) claude.ai's fetch tool refuses MODEL-built URLs but accepts the
// same URL once the USER pastes it into the chat — the template must teach that
// workaround; (c) hits were misreported (junk descriptions quoted, empty
// license read as CC). Pin all three rules in BOTH language templates.
test('launcher templates forbid warm-up calls and teach the user-paste fetch fallback (DE)', async () => {
  const html = await readFile(launcherHtml, 'utf8');
  assert.match(html, /keinen Test- oder Probeaufruf/i, 'DE: no test/warm-up call');
  assert.match(html, /frag zuerst danach/i, 'DE: ask for the topic instead of inventing one');
  assert.match(html, /in den Chat zu kopieren/i, 'DE: user-paste fallback for restricted fetch tools');
  assert.match(html, /Query-String entfernt/i, 'DE: explain the stripped-query-string 400 (live-diagnosed)');
  assert.match(html, /api\/search\/<Suchbegriff>/, 'DE: primary search form is the stripping-proof path form');
  assert.match(html, /erkläre ihm kurz die Möglichkeiten/i, 'DE: without a topic, explain topic + filter options to the user');
  assert.match(html, /Lizenz unklar/i, 'DE: empty license must not be reported as a real licence');
  assert.match(html, /Erfinde keine Treffer/i, 'DE: no invented hits');
});

test('launcher templates forbid warm-up calls and teach the user-paste fetch fallback (EN)', async () => {
  const html = await readFile(launcherHtml, 'utf8');
  assert.match(html, /no test or warm-up call/i, 'EN: no test/warm-up call');
  assert.match(html, /ask for it first/i, 'EN: ask for the topic instead of inventing one');
  assert.match(html, /paste it into the chat/i, 'EN: user-paste fallback for restricted fetch tools');
  assert.match(html, /stripped the query string/i, 'EN: explain the stripped-query-string 400 (live-diagnosed)');
  assert.match(html, /api\/search\/<search term>/, 'EN: primary search form is the stripping-proof path form');
  assert.match(html, /briefly explain the options/i, 'EN: without a topic, explain topic + filter options to the user');
  // The fixed "OER" URL pattern must appear in BOTH language templates.
  assert.ok((html.match(/api\/search\/OER/g) ?? []).length >= 2, 'both templates carry the OER example pattern');
  assert.match(html, /licen[cs]e unclear/i, 'EN: empty license must not be reported as a real licence');
  assert.match(html, /Do not invent hits/i, 'EN: no invented hits');
});
