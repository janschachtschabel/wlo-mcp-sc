/**
 * tool-descriptions.test.ts – the descriptions are a contract with the model.
 *
 * A tool description is the only thing a model has when it picks between two
 * similar tools. Two of them contradicted each other: `search_wlo_collections`
 * stated that a Sammlung IS a Themenseite, while `search_wlo_topic_pages`
 * described itself as searching collections and then checking which of them
 * have one. Both cannot be true, and the measurement settles it — for
 * "Mathematik": 5 collections, 1 topic page.
 *
 * The truth is containment: a Themenseite is a collection that additionally
 * carries a curated page layout (`ccm:page_config_ref`). Every topic page is a
 * collection; most collections are not topic pages.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient } from './fetchMock.js';

async function descriptionOf(name: string): Promise<string> {
  const client = await connectedClient();
  try {
    const tool = (await client.listTools()).tools.find(t => t.name === name);
    assert.ok(tool, `${name} is registered`);
    return tool.description ?? '';
  } finally {
    await client.close();
  }
}

test('search_wlo_collections does not claim a collection IS a topic page', async () => {
  const text = await descriptionOf('search_wlo_collections');
  assert.doesNotMatch(text, /dasselbe wie eine "?Themenseite"?/i);
  assert.doesNotMatch(text, /Sammlung.{0,20}(ist|=).{0,20}Themenseite/i);
});

test('search_wlo_collections says only SOME collections have a topic page', async () => {
  const text = await descriptionOf('search_wlo_collections');
  assert.match(text, /manche|einige|nicht jede|nur ein Teil/i, 'the relation is stated as partial');
  assert.match(text, /search_wlo_topic_pages/, 'and the other tool is named for the narrower case');
});

test('search_wlo_topic_pages describes a Themenseite as a collection WITH a page', async () => {
  const text = await descriptionOf('search_wlo_topic_pages');
  assert.match(text, /collection|Sammlung/i);
  // It already says it checks which collections have one; that must survive,
  // because it is the accurate half of the former contradiction.
  assert.match(text, /which ones have|welche.{0,20}haben|have a Themenseite/i);
});

/**
 * ── The words a teacher actually types (2026-08-06) ─────────────────────────
 *
 * The block above pins a contradiction out of two descriptions. These pin the
 * opposite failure: a description that is *correct* and still never matches the
 * request, because it is written in the vocabulary of the repository rather than
 * of the person asking. Nobody asks for "Bildungsinhalte"; they ask for "ein
 * Video zu Bruchrechnung", "Medien zum Klimawandel", "ein Arbeitsblatt".
 *
 * Each entry below comes from an observed miss, not from taste.
 */

/** Widely enforced cap on a tool description; truncation eats the end. */
const MAX_DESCRIPTION = 1024;

async function allDescriptions(): Promise<Map<string, string>> {
  const client = await connectedClient();
  try {
    const { tools } = await client.listTools();
    return new Map(tools.map(t => [t.name, t.description ?? '']));
  } finally {
    await client.close();
  }
}

/** tool → phrases its description must contain (case-insensitive). */
const REQUIRED: Record<string, string[]> = {
  // The default entry point. A request naming a MEDIUM ("ein Video zu …") is the
  // commonest shape there is and must land here, not in a web search.
  search_wlo_all: ['video', 'arbeitsblatt', 'medien', 'material'],
  // The deliberate narrowing — it has to name the tool it defers to, or it
  // competes with search_wlo_all for every single-medium request.
  search_wlo_content: ['search_wlo_all'],
  // Encyclopedic context, explicitly NOT the article text. Measured live
  // 2026-08-06: asked to build a record from a town's Wikipedia page, Claude ran
  // its own web search — this tool advertises a lead extract (correct, and not
  // what that task needed) and nothing pointed to the tool that does return the
  // page.
  get_wikipedia_summary: ['get_url_text'],
  get_url_text: ['wikipedia'],
  // The registry lookup has no natural trigger of its own: nothing in a user's
  // question says "check which skills this collection approves". Since
  // 2026-08-10 the search no longer attaches it either (it cost ~1.4 s per
  // search, measured), so the ONLY way a model learns the tool applies is a
  // pointer from the tools that hand out collection ids. Free, unlike a lookup.
  search_wlo_collections: ['get_skill_registry'],
  search_wlo_within_collection: ['get_skill_registry'],
  get_skill_registry: ['get_skill'],
  search_skill: ['get_skill_registry'],
};

for (const [name, phrases] of Object.entries(REQUIRED)) {
  test(`${name} names the words a user would actually type`, async () => {
    const text = (await allDescriptions()).get(name);
    assert.ok(text, `${name} is not registered`);
    for (const phrase of phrases) {
      assert.ok(
        text.toLowerCase().includes(phrase.toLowerCase()),
        `${name}: "${phrase}" is missing — a model matches the request against this text`,
      );
    }
  });
}

test('no description exceeds the length a host will truncate', async () => {
  // Applied to `get_wlo_content_text` on 2026-08-05 for one tool; the rule holds
  // for all of them. What truncation cuts is the end — where "do NOT use this
  // for …" sits, i.e. exactly the half that prevents a wrong pick.
  const tooLong = [...(await allDescriptions())]
    .filter(([, text]) => text.length > MAX_DESCRIPTION)
    .map(([name, text]) => `${name} (${text.length})`);
  assert.deepEqual(tooLong, [],
    `over ${MAX_DESCRIPTION} characters — truncation removes the guidance at the end`);
});

test('the server instructions answer to the repository’s other names', async () => {
  // "Leg das bei WirLernenOnline an", "trag das in edu-sharing ein" — the same
  // request, and only one of those names appeared anywhere in the surface. The
  // aliases belong in the instructions rather than in thirteen write-tool
  // descriptions: they are read once and apply to every tool.
  const client = await connectedClient();
  let instructions: string;
  try {
    instructions = client.getInstructions() ?? '';
  } finally {
    await client.close();
  }
  for (const alias of ['WirLernenOnline', 'edu-sharing', 'openeduhub']) {
    assert.ok(
      instructions.toLowerCase().includes(alias.toLowerCase()),
      `the instructions must name "${alias}" — it is what a user calls this repository`,
    );
  }
});
