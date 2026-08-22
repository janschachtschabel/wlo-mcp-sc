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

test('every widget button names a tool whose description names the button back', async () => {
  // "Inhalte anzeigen" NEVER triggered in live ChatGPT (user report
  // 2026-08-22) while "Themenseite öffnen" sometimes did — and the lexical
  // difference was that the topic-page description almost quotes its button
  // message while the collections one did not; NO description named its
  // button. The model picks tools by their descriptions, so the literal
  // bridge „Der Widget-Knopf X führt hierher" is the strongest signal the
  // server can attach. It raises the match; it cannot force the call.
  const { FOLLOW_UP_TOOLS } = await import('../src/apps/widgets/shared/follow-up.js');
  const { t } = await import('../src/apps/widgets/shared/strings.js');
  // action → visible button label (mirrors ACTION_LABEL in tile.ts; a renamed
  // string key fails here at the type level).
  const BUTTON_LABEL = {
    contents: t('de', 'actionContents'),
    topicPage: t('de', 'actionTopicPage'),
    text: t('de', 'actionText'),
    related: t('de', 'actionRelated'),
  } as const;
  const client = await connectedClient();
  try {
    const { tools } = await client.listTools();
    for (const [action, tool] of Object.entries(FOLLOW_UP_TOOLS)) {
      const desc = tools.find(x => x.name === tool)?.description ?? '';
      const label = BUTTON_LABEL[action as keyof typeof BUTTON_LABEL];
      assert.ok(desc.includes(label), `${tool}: description names its button „${label}"`);
    }
  } finally {
    await client.close();
  }
});

test('search_wlo_topic_pages names the subject filter it does NOT have', async () => {
  // Unknown arguments are stripped silently by the schema parse, so a client
  // sent `discipline` here for months and got byte-identical results without
  // any signal (client report 2026-07-27). Until a generic warning exists, the
  // description must say so and point at the filters that do work.
  const client = await connectedClient();
  try {
    const { tools } = await client.listTools();
    const desc = tools.find(t => t.name === 'search_wlo_topic_pages')?.description ?? '';
    assert.match(desc, /discipline/, 'names the parameter clients wrongly assume');
    assert.match(desc, /educationalContext/, 'points at a filter that actually narrows this search');
  } finally {
    await client.close();
  }
});
