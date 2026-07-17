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
