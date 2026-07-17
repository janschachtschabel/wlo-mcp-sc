import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient } from './fetchMock.js';

// The primary search tools must LEAD with concrete, teacher-phrased triggers in
// the first 256 chars — where ChatGPT/OpenAI weights tool selection — so a
// natural query like "Video zur Eiszeit" fires WLO instead of a generic web
// search. Teachers say "Video zur Eiszeit", not "ich suche Bildungsmaterial",
// so the description must name concrete material types and example queries up
// front, not bury them behind architecture prose (user request 2026-07-17).
const HEAD = 256;
const MATERIAL = /video|arbeitsblatt|material|übung/;
const WLO = /wirlernenonline|wlo/;

test('primary search tools lead with concrete triggers in the first 256 chars', async () => {
  const client = await connectedClient();
  try {
    const { tools } = await client.listTools();
    const head = (name: string): string =>
      (tools.find(t => t.name === name)?.description ?? '').slice(0, HEAD).toLowerCase();

    for (const name of ['search_wlo_all', 'search_wlo_content', 'search']) {
      const h = head(name);
      assert.ok(h.length > 0, `${name} has a description`);
      assert.match(h, MATERIAL, `${name}: names a concrete material type (video/Arbeitsblatt/…) in the first 256 chars`);
      assert.match(h, WLO, `${name}: names WLO/WirLernenOnline in the first 256 chars`);
    }

    // The combined search (the primary entry point) carries an example teacher
    // query up front so the model recognises the intent behind a bare topic.
    assert.match(head('search_wlo_all'), /eiszeit|bruchrechnung|photosynthese|prozentrechnung/,
      'search_wlo_all: an example teacher query appears in the first 256 chars');
  } finally {
    await client.close();
  }
});
