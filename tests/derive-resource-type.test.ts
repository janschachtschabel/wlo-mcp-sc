/**
 * derive-resource-type.test.ts – The medium a teacher names belongs in the
 * FILTER, not in the search words.
 *
 * "Arbeitsblatt KI" means: search for KI, restrict to worksheets. Stripping
 * "Arbeitsblatt" (as the topic variant does) recovers the results but throws
 * the constraint away; leaving it in empties them.
 *
 * The mapping is CURATED and cannot be delegated to `resolveVocab`, which
 * fuzzy-matches. Measured 2026-08-21:
 *
 *   material         → 0b2d7dec  (= Übungsmaterial)   — "Material" is generic
 *   bildungsinhalte  → b8fb5fb2  (= Bild)             — matched on "Bild"!
 *
 * Deriving a filter from those would silently turn "Bildungsinhalte zur Optik"
 * into a search for PICTURES. Only words that unambiguously name a medium are
 * mapped; everything else stays a framing word that is merely stripped.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveResourceTypeFromQuery } from '../src/filter-criteria.js';

test('an unambiguous medium word becomes the content-type filter', () => {
  assert.equal(deriveResourceTypeFromQuery('Arbeitsblatt KI'), 'Arbeitsblatt');
  assert.equal(deriveResourceTypeFromQuery('Erklärvideo Photosynthese'), 'Video');
  assert.equal(deriveResourceTypeFromQuery('Zeig mir ein Video zur Eiszeit'), 'Video');
  assert.equal(deriveResourceTypeFromQuery('Simulation zum Treibhauseffekt'), 'Simulation');
});

test('a generic word is NOT a content type', () => {
  // The whole reason the map is curated — resolveVocab answers for all of these.
  assert.equal(deriveResourceTypeFromQuery('Bildungsinhalte zur Optik'), undefined);
  assert.equal(deriveResourceTypeFromQuery('Material zum Klimawandel'), undefined);
  assert.equal(deriveResourceTypeFromQuery('Unterrichtsstunde zur Revolution'), undefined);
  assert.equal(deriveResourceTypeFromQuery('Beispiel für Photosynthese'), undefined);
});

test('nothing to derive from a plain topic', () => {
  assert.equal(deriveResourceTypeFromQuery('Photosynthese'), undefined);
  assert.equal(deriveResourceTypeFromQuery('Französische Revolution'), undefined);
});

test('whole words only', () => {
  // "Videokonferenz" is a subject, not a request for a video.
  assert.equal(deriveResourceTypeFromQuery('Videokonferenz im Unterricht'), undefined);
});

test('every derivable label resolves in the LRT vocabulary', async () => {
  // A label nothing can resolve would be a filter that silently does nothing.
  // One query per TARGET label, so a later map entry cannot ship uncovered —
  // the first cut sampled 4 of the 6 labels and would have missed a bad one.
  const { resolveVocab } = await import('../src/vocabs.js');
  const perLabel = [
    'Arbeitsblatt KI',                    // Arbeitsblatt
    'Video zur Eiszeit',                  // Video
    'Simulation zum Treibhauseffekt',     // Simulation
    'Podcast zur Geschichte',             // Podcast
    'Übungen zur Prozentrechnung',        // Übung
    'Bilder vom Wasserkreislauf',         // Bild
  ];
  const seen = new Set<string>();
  for (const q of perLabel) {
    const label = deriveResourceTypeFromQuery(q);
    assert.ok(label, `${q} should derive a label`);
    assert.ok(resolveVocab(label!, 'lrt'), `${label} must resolve`);
    seen.add(label!);
  }
  assert.equal(seen.size, 6, 'all six target labels are exercised');
});

/**
 * The derivation lives in the TOOL handler, not in `searchAll` — that is where
 * `labeled` is built, so the filter is disclosed in `_queryMeta` instead of
 * narrowing a search silently. These two pin that it actually reaches the wire
 * AND the disclosure; a measurement against `searchAll` directly would bypass
 * it and prove nothing (it did, on the first attempt).
 */
test('search_wlo_content sends the derived content type upstream', async () => {
  const { connectedClient, installFetchMock } = await import('./fetchMock.js');
  const seen: string[] = [];
  const mock = installFetchMock((url, init) => {
    if (init?.body) seen.push(String(init.body));
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
  const client = await connectedClient();
  try {
    await client.callTool({ name: 'search_wlo_content', arguments: { query: 'Arbeitsblatt KI' } });
    const bodies = seen.join(' ');
    assert.match(bodies, /ccm:oeh_lrt_aggregated/, 'the derived filter must reach the repository');
  } finally {
    await client.close();
    mock.restore();
  }
});

test('an explicit content type always wins over the derived one', async () => {
  const { connectedClient, installFetchMock } = await import('./fetchMock.js');
  const seen: string[] = [];
  const mock = installFetchMock((url, init) => {
    if (init?.body) seen.push(String(init.body));
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
  const client = await connectedClient();
  try {
    // "Arbeitsblatt" in the query, "Video" on the parameter: the caller said
    // what it wants, and guessing against that from prose would be worse than
    // useless.
    const { resolveVocab } = await import('../src/vocabs.js');
    await client.callTool({
      name: 'search_wlo_content',
      arguments: { query: 'Arbeitsblatt KI', learningResourceType: 'Video' },
    });
    assert.match(seen.join(' '), new RegExp(String(resolveVocab('Video', 'lrt')).split('/').pop()!));
  } finally {
    await client.close();
    mock.restore();
  }
});

/**
 * The derivation NARROWS, so it must be disclosed where the reader looks —
 * block 0 and structuredContent, not only the trailing _queryMeta block, which
 * a measured real client never hands to the model (2026-08-19). Without this,
 * "Podcast zur Französischen Revolution" with zero podcasts reads as a bare
 * "Keine Inhalte gefunden." over a topic holding 480 records — the exact
 * misreport class the licence filter got its sentences for.
 */
test('an emptied result names the derived filter in block 0', async () => {
  const { connectedClient, installFetchMock } = await import('./fetchMock.js');
  const mock = installFetchMock(() => ({ json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } }));
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'search_wlo_content', arguments: { query: 'Podcast zur Französischen Revolution' } });
    const block0 = (result.content as Array<{ text: string }>)[0]!.text;
    assert.match(block0, /abgeleitet/, 'the narrowing must be visible in the first block');
    assert.match(block0, /Podcast/);
    const sc = result.structuredContent as Record<string, unknown>;
    assert.equal(sc['derivedResourceType'], 'Podcast', 'and travel as a declared field');
  } finally {
    await client.close();
    mock.restore();
  }
});

test('a non-empty derived result still discloses the narrowing', async () => {
  const { connectedClient, installFetchMock, makeNode } = await import('./fetchMock.js');
  const mock = installFetchMock(() => ({
    json: { nodes: [makeNode('n1', 'Arbeitsblatt Brüche')], pagination: { total: 1, from: 0, count: 1 } },
  }));
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'search_wlo_content', arguments: { query: 'Arbeitsblatt Bruchrechnung' } });
    assert.match((result.content as Array<{ text: string }>)[0]!.text, /abgeleitet/);
    assert.equal((result.structuredContent as Record<string, unknown>)['derivedResourceType'], 'Arbeitsblatt');
  } finally {
    await client.close();
    mock.restore();
  }
});

test('an explicit learningResourceType is not reported as derived', async () => {
  const { connectedClient, installFetchMock } = await import('./fetchMock.js');
  const mock = installFetchMock(() => ({ json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } }));
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_content',
      arguments: { query: 'Bruchrechnung', learningResourceType: 'Video' },
    });
    for (const block of result.content as Array<{ text: string }>) {
      assert.doesNotMatch(block.text, /abgeleitet/, 'the caller chose the filter — nothing was derived');
    }
    assert.equal((result.structuredContent as Record<string, unknown>)['derivedResourceType'], undefined);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('search_wlo_all carries the disclosure in markdown and in the envelope', async () => {
  const { connectedClient, installFetchMock } = await import('./fetchMock.js');
  const mock = installFetchMock(() => ({ json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } }));
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_all',
      arguments: { query: 'Erklärvideo Photosynthese', include: ['content'] },
    });
    assert.match((result.content as Array<{ text: string }>)[0]!.text, /abgeleitet/);
    // Inside the content bucket, beside `licenseFilter`: both describe the
    // content leg, and the placement is the established disclosure pattern.
    const content = (result.structuredContent as { content: Record<string, unknown> }).content;
    assert.equal(content['derivedResourceType'], 'Video');
  } finally {
    await client.close();
    mock.restore();
  }
});

test('in json mode the notice is its own block — block 0 stays parseable', async () => {
  const { connectedClient, installFetchMock } = await import('./fetchMock.js');
  const mock = installFetchMock(() => ({ json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } }));
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_content',
      arguments: { query: 'Arbeitsblatt KI', outputFormat: 'json' },
    });
    const blocks = result.content as Array<{ text: string }>;
    JSON.parse(blocks[0]!.text); // must not be corrupted by the notice
    assert.ok(blocks.some(b => /abgeleitet/.test(b.text)), 'the notice rides as its own block');
  } finally {
    await client.close();
    mock.restore();
  }
});
