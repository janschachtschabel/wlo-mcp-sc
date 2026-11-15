/**
 * content-search-incomplete.test.ts – a ranked search whose query variants did
 * not all answer (review 2026-11-15).
 *
 * The ranked search runs several variants of a query and tolerates one that
 * fails. It did not claim the END then — and that was all it said: over an
 * empty window the many search answered "there is more", and once that was
 * fixed, "no hits" — both statements about a variant nobody read. Now it is
 * said as what it is, on every surface a content search has: `incomplete`,
 * with the phrase a client recognises an outage by.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { enhancedSearch } from '../src/reranker.js';
import { contentIncompleteNotice } from '../src/services/content-search.js';
import { renderSearchResults } from '../src/apps/widgets/search-results/render.js';
import { stopSkillRegistryCache } from '../src/services/skill-registry-cache.js';
import { installFetchMock, makeNode, strictClient, toolText, type MockResult } from './fetchMock.js';

const QUERY = 'xyzzyqwertz gibtesnicht material';
const emptyPage = { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };

/** Every content search answers `nodes`; the FIRST one fails when `failFirst`. */
function repository(nodes: unknown[], failFirst: boolean) {
  let searches = 0;
  return installFetchMock((url): MockResult => {
    if (!url.includes('/ngsearch')) return { json: { nodes: [], collections: [] } };
    searches += 1;
    if (failFirst && searches === 1) return { status: 500, json: {} };
    return nodes.length ? { json: { nodes, pagination: { total: nodes.length, from: 0, count: nodes.length } } } : emptyPage;
  });
}
const structured = (r: unknown) => (r as { structuredContent: Record<string, unknown> }).structuredContent;
const firstJson = (r: unknown) => JSON.parse((r as { content: Array<{ text: string }> }).content[0]!.text) as Record<string, unknown>;

test('the notice carries the phrase a client recognises an outage by', () => {
  for (const empty of [true, false]) assert.match(contentIncompleteNotice(empty), /hat nicht \(vollständig\) geantwortet/);
  assert.match(contentIncompleteNotice(true), /kein Befund/);
});

test('the ranked search says when a variant did not answer — and stays silent when all did', async () => {
  for (const failFirst of [true, false]) {
    const mock = repository([], failFirst);
    try {
      const response = await enhancedSearch(QUERY, 'FILES', [], 5, 0);
      assert.equal(response.incomplete, failFirst ? true : undefined);
    } finally { mock.restore(); }
  }
});

test('search_wlo_content: no hit beside a failed variant is "incomplete" in every format — not "Keine Inhalte gefunden"', async () => {
  stopSkillRegistryCache();
  const mock = repository([], true);
  const client = await strictClient();
  try {
    const md = await client.callTool({ name: 'search_wlo_content', arguments: { query: QUERY } });
    assert.equal(md.isError, undefined, toolText(md));
    assert.equal(structured(md)['incomplete'], true);
    const block0 = (md as { content: Array<{ text: string }> }).content[0]!.text;
    assert.ok(block0.includes(contentIncompleteNotice(true)), 'in the block a one-block client reads');
    assert.doesNotMatch(toolText(md), /Keine Inhalte gefunden/);
  } finally { await client.close(); mock.restore(); }
  const again = repository([], true);
  const c2 = await strictClient();
  try {
    const json = await c2.callTool({ name: 'search_wlo_content', arguments: { query: QUERY, outputFormat: 'json' } });
    assert.equal(firstJson(json)['incomplete'], true);
    assert.ok(toolText(json).includes(contentIncompleteNotice(true)));
  } finally { await c2.close(); again.restore(); stopSkillRegistryCache(); }
});

test('search_wlo_content: hits beside a failed variant are delivered, and the list says it may lack some', async () => {
  const mock = repository([makeNode('n-1', 'Optik Arbeitsblatt')], true);
  const client = await strictClient();
  try {
    const r = await client.callTool({ name: 'search_wlo_content', arguments: { query: QUERY } });
    assert.equal(structured(r)['count'], 1);
    assert.equal(structured(r)['incomplete'], true);
    assert.ok(toolText(r).includes(contentIncompleteNotice(false)));
  } finally { await client.close(); mock.restore(); }
});

test('search_wlo_content: every variant answered — nothing of this appears', async () => {
  const mock = repository([], false);
  const client = await strictClient();
  try {
    const r = await client.callTool({ name: 'search_wlo_content', arguments: { query: QUERY } });
    assert.equal('incomplete' in structured(r), false);
    assert.doesNotMatch(toolText(r), /hat nicht \(vollständig\) geantwortet/);
  } finally { await client.close(); mock.restore(); }
});

test('search_wlo_all: the content bucket carries incomplete, and the text says it', async () => {
  stopSkillRegistryCache();
  const mock = repository([], true);
  const client = await strictClient();
  try {
    const r = await client.callTool({ name: 'search_wlo_all', arguments: { query: QUERY, include: ['content'] } });
    assert.equal(r.isError, undefined, toolText(r));
    assert.equal((structured(r)['content'] as Record<string, unknown>)['incomplete'], true);
    assert.ok(toolText(r).includes(contentIncompleteNotice(true)));
    assert.doesNotMatch(toolText(r), /Keine Inhalte gefunden/);
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

test('search_wlo_content_many: an empty, incomplete query says so — neither "keine Treffer" alone nor "weitere Treffer"', async () => {
  const mock = repository([], true);
  const client = await strictClient();
  try {
    const r = await client.callTool({ name: 'search_wlo_content_many', arguments: { queries: [{ id: 'a', query: QUERY }] } });
    assert.equal(r.isError, undefined, toolText(r));
    const result = (structured(r)['results'] as Record<string, Record<string, unknown>>)['a']!;
    assert.deepEqual([result['count'], result['more'], result['incomplete']], [0, undefined, true]);
    const text = toolText(r);
    assert.match(text, /keine Treffer im geprüften Ausschnitt/);
    assert.ok(text.includes(contentIncompleteNotice(true)));
    assert.doesNotMatch(text, /weitere Treffer/i);
  } finally { await client.close(); mock.restore(); }
});

test('search widget: an empty content bucket that is incomplete is not "Keine Treffer gefunden."', () => {
  const bucket = { total: 0, count: 0, results: [] };
  const html = renderSearchResults({ query: 'x', content: { ...bucket, incomplete: true }, collections: bucket, topicPages: bucket } as never, 'de');
  assert.doesNotMatch(html, /Keine Treffer gefunden/);
  assert.match(html, /nicht vollständig erreichbar/);
});
