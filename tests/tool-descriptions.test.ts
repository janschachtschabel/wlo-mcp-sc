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
