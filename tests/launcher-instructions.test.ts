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
  assert.match(html, /JSON-Antwort in den Chat/i, 'DE: final fallback — user opens the URL and pastes the JSON (ChatGPT has no arbitrary fetch)');
  assert.match(html, /format=html/, 'DE: reader-only chats first try the HTML view of the same search');
  assert.match(html, /api\/search\/<Suchbegriff>/, 'DE: primary search form is the stripping-proof path form');
  assert.match(html, /erkläre mir kurz die Möglichkeiten/i, 'DE: without a topic, explain topic + filter options (user voice)');
  assert.match(html, /Lizenz unklar/i, 'DE: empty license must not be reported as a real licence');
  assert.match(html, /Erfinde keine Treffer/i, 'DE: no invented hits');
  // USER VOICE, no authority claims (live-diagnosed 2026-07-17): a prefilled
  // instruction block in command tone plus an authorization claim ("dein
  // Werkzeug DARF sie laden") is exactly the prompt-injection signature Claude
  // flags — it then distrusts the URL even more. The template reads as the
  // user's own request ("Ich möchte…", "Meine erste Suche"), and the prefilled
  // search URL is a plain first request, not an ALL-CAPS order.
  assert.match(html, /Ich möchte offene Bildungsmaterialien/i, 'DE: opens in the user voice, not as an instruction block');
  assert.match(html, /Meine erste Suche/i, 'DE: pre-filled search URL framed as the user\'s own first request');
  assert.doesNotMatch(html, /darf sie also laden|ERSTER AUFTRAG/, 'DE: no authorization claims / caps-urgency (injection markers)');
});

test('launcher templates forbid warm-up calls and teach the user-paste fetch fallback (EN)', async () => {
  const html = await readFile(launcherHtml, 'utf8');
  assert.match(html, /no test or warm-up call/i, 'EN: no test/warm-up call');
  assert.match(html, /ask for it first/i, 'EN: ask for the topic instead of inventing one');
  assert.match(html, /paste it into the chat/i, 'EN: user-paste fallback for restricted fetch tools');
  assert.match(html, /stripped the query string/i, 'EN: explain the stripped-query-string 400 (live-diagnosed)');
  assert.match(html, /paste the JSON response/i, 'EN: final fallback — user opens the URL and pastes the JSON (ChatGPT has no arbitrary fetch)');
  assert.ok((html.match(/format=html/g) ?? []).length >= 2, 'both templates teach the HTML view for reader-only chats');
  assert.match(html, /api\/search\/<search term>/, 'EN: primary search form is the stripping-proof path form');
  assert.match(html, /briefly explain the options/i, 'EN: without a topic, explain topic + filter options to the user');
  // The fixed "OER" URL pattern must appear in BOTH language templates.
  assert.ok((html.match(/api\/search\/OER/g) ?? []).length >= 2, 'both templates carry the OER example pattern');
  assert.match(html, /licen[cs]e unclear/i, 'EN: empty license must not be reported as a real licence');
  assert.match(html, /Do not invent hits/i, 'EN: no invented hits');
  assert.match(html, /I want to find open educational resources/i, 'EN: opens in the user voice, not as an instruction block');
  assert.match(html, /My first search/i, 'EN: pre-filled search URL framed as the user\'s own first request');
  assert.doesNotMatch(html, /so your fetch tool may load it|FIRST TASK/, 'EN: no authorization claims / caps-urgency (injection markers)');
});
