/**
 * tests/search-unreachable.test.ts – "not reachable" is not "nothing there".
 *
 * Audit 2026-11-12, K-3: when the collection or topic-page search of the
 * repository failed, the caller got an empty list with no signal — and the tool
 * printed "Keine Sammlungen gefunden." over it. During a partial outage the
 * server stated, with full confidence, that the catalogue holds nothing on the
 * topic. Since the upstream gate exists (package 5) the server can produce that
 * non-answer itself, under load.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { routeRestRequest } from '../src/rest/routes.js';
import { findTopicPagesByQueryResult } from '../src/services/topic-page.js';
import { stopSkillRegistryCache } from '../src/services/skill-registry-cache.js';
import { connectedClient, installFetchMock, makeNode, toolText, type MockResult } from './fetchMock.js';

const collection = (id: string, title: string) => ({
  ...makeNode(id, title), type: 'ccm:map', aspects: ['ccm:collection'], isDirectory: true,
});

interface Down { keyword?: boolean; name?: boolean; portals?: boolean; variants?: boolean }

/** A repository whose content search works; `down` switches single sources to 503. */
function repository(down: Down) {
  return installFetchMock((url): MockResult => {
    if (url.includes('/mds_oeh/collections')) {
      return down.keyword ? { status: 503, json: {} } : { json: { nodes: [collection('k-1', 'Optik Grundlagen')] } };
    }
    if (url.includes('/collection/v1/collections/-home-/search')) {
      return down.name ? { status: 503, json: {} } : { json: { collections: [] } };
    }
    if (url.includes('/mds_oeh/page_variant')) {
      return down.variants ? { status: 503, json: {} } : { json: { nodes: [] } };
    }
    if (url.includes('/children')) {
      return down.portals ? { status: 503, json: {} } : { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
    }
    if (url.includes('/ngsearch')) {
      return { json: { nodes: [makeNode('c-1', 'Arbeitsblatt Optik')], pagination: { total: 1, from: 0, count: 1 } } };
    }
    return { json: {} };
  });
}

const structured = (r: unknown) => (r as { structuredContent: Record<string, Record<string, unknown>> }).structuredContent;

test('search_wlo_all: both collection indexes down is "not reachable" — and the content still comes', async () => {
  stopSkillRegistryCache();
  const mock = repository({ keyword: true, name: true });
  const client = await connectedClient();
  try {
    const r = await client.callTool({ name: 'search_wlo_all', arguments: { query: 'Optik' } });
    const text = toolText(r);
    assert.notEqual(r.isError, true, 'one leg down must not cost the caller the others');
    assert.match(text, /Arbeitsblatt Optik/);
    assert.match(text, /Suche nach Sammlungen hat nicht \(vollständig\) geantwortet/);
    assert.doesNotMatch(text, /Keine Sammlungen gefunden/, 'that is a statement about the catalogue');
    assert.equal(structured(r)['collections']!['incomplete'], true);

    const json = await client.callTool({ name: 'search_wlo_all', arguments: { query: 'Optik', outputFormat: 'json' } });
    assert.match(toolText(json), /KEIN Befund/, 'said in words in JSON mode too');
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

test('search_wlo_all: ONE index down with hits from the other says the list may be incomplete', async () => {
  stopSkillRegistryCache();
  const mock = repository({ name: true });
  const client = await connectedClient();
  try {
    const r = await client.callTool({ name: 'search_wlo_all', arguments: { query: 'Optik' } });
    const text = toolText(r);
    assert.match(text, /Optik Grundlagen/);
    assert.match(text, /nur teilweise erreichbar/);
    assert.equal(structured(r)['collections']!['incomplete'], true);
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

test('search_wlo_all: everything reachable carries no such field and keeps its plain "nothing found"', async () => {
  stopSkillRegistryCache();
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/mds_oeh/collections')) return { json: { nodes: [] } };
    if (url.includes('/collection/v1/collections/-home-/search')) return { json: { collections: [] } };
    if (url.includes('/ngsearch')) return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
  const client = await connectedClient();
  try {
    const r = await client.callTool({ name: 'search_wlo_all', arguments: { query: 'Optik' } });
    assert.match(toolText(r), /Keine Sammlungen gefunden/);
    assert.equal(structured(r)['collections']!['incomplete'], undefined);
    assert.equal(structured(r)['topicPages']!['incomplete'], undefined);
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

test('search_wlo_all: the portal listing down marks the TOPIC PAGES — that is where they come from', async () => {
  stopSkillRegistryCache();
  const mock = repository({ portals: true });
  const client = await connectedClient();
  try {
    const r = await client.callTool({ name: 'search_wlo_all', arguments: { query: 'Optik', include: ['topicPages'] } });
    assert.match(toolText(r), /Suche nach Themenseiten (hat|war)/);
    assert.equal(structured(r)['topicPages']!['incomplete'], true);
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

test('search_wlo_collections: an index down is said beside the hits, and never as "Keine Sammlungen gefunden"', async () => {
  stopSkillRegistryCache();
  const client = await connectedClient();
  try {
    let mock = repository({ name: true });
    const partial = await client.callTool({ name: 'search_wlo_collections', arguments: { query: 'Optik' } });
    mock.restore();
    assert.match(toolText(partial), /Optik Grundlagen/);
    assert.match(toolText(partial), /nur teilweise erreichbar/);
    assert.equal((structured(partial) as Record<string, unknown>)['incomplete'], true);

    mock = repository({ keyword: true, name: true });
    const none = await client.callTool({ name: 'search_wlo_collections', arguments: { query: 'Optik' } });
    mock.restore();
    assert.match(toolText(none), /KEIN Befund/);
    assert.doesNotMatch(toolText(none), /Keine Sammlungen gefunden/);
    assert.equal((structured(none) as Record<string, unknown>)['incomplete'], true);
  } finally { await client.close(); stopSkillRegistryCache(); }
});

test('the HTML search page says it too', async () => {
  stopSkillRegistryCache();
  const mock = repository({ keyword: true, name: true });
  try {
    const r = await routeRestRequest('GET', '/api/search?q=Optik&format=html');
    assert.match(String(r!.raw ?? ''), /Suche nach Sammlungen hat nicht \(vollständig\) geantwortet/);
  } finally { mock.restore(); stopSkillRegistryCache(); }
});

test('a topic-page listing whose index does not answer is an ERROR — not "es gibt keine Themenseiten"', async () => {
  const mock = repository({ variants: true });
  const client = await connectedClient();
  try {
    const r = await client.callTool({ name: 'search_wlo_topic_pages', arguments: {} });
    assert.equal(r.isError, true, toolText(r));
    assert.doesNotMatch(toolText(r), /Keine Themenseiten/);
  } finally { await client.close(); mock.restore(); }
});

test('findTopicPagesByQueryResult: one source down still answers — and SAYS that it is incomplete; ALL down throws', async () => {
  let mock = repository({ portals: true });
  try {
    assert.deepEqual(await findTopicPagesByQueryResult('Optik'), { pages: [], incomplete: true },
      'the portal listing is the main source of Themenseiten — without it an empty list is no finding');
  } finally { mock.restore(); }
  mock = repository({ portals: true, keyword: true, name: true });
  try { await assert.rejects(findTopicPagesByQueryResult('Optik'), /nicht erreichbar/); }
  finally { mock.restore(); }
});

// ── what is said about a bucket survives a trimmed response, and reaches the widget ──

test('/api/search with `fields` keeps what a bucket says about itself', async () => {
  stopSkillRegistryCache();
  const mock = repository({ keyword: true, name: true });
  try {
    const r = await routeRestRequest('GET', '/api/search?q=Optik&fields=nodeId,title');
    const body = r!.json as { collections: Record<string, unknown>; content: { results: Array<Record<string, unknown>> } };
    assert.equal(body.collections['incomplete'], true, 'a disclosure that disappears when the response is trimmed is none');
    assert.deepEqual(Object.keys(body.content.results[0] ?? {}).sort(), ['nodeId', 'title'], 'the ITEMS are still trimmed');
  } finally { mock.restore(); stopSkillRegistryCache(); }
});

test('the search widget does not say "no results" over an exhausted page or an unreachable source', async () => {
  const { renderSearchResults: renderResults } = await import('../src/apps/widgets/search-results/render.js');
  const empty = { total: 0, count: 0, results: [] };
  const plain = renderResults({ query: 'x', content: empty, collections: empty, topicPages: empty } as never, 'de');
  assert.match(plain, /Keine Treffer gefunden/);
  const more = renderResults({ query: 'x', content: { ...empty, total: 900, more: { nextSkipCount: 100 } }, collections: empty, topicPages: empty } as never, 'de');
  assert.doesNotMatch(more, /Keine Treffer gefunden/);
  assert.match(more, /der Katalog hält mehr/);
  const down = renderResults({ query: 'x', content: empty, collections: { ...empty, incomplete: true }, topicPages: empty } as never, 'de');
  assert.doesNotMatch(down, /Keine Treffer gefunden/);
  assert.match(down, /nicht vollständig erreichbar/);
});

// ── review of package 9: the paths one step further ──────────────────────────

test('search_wlo_topic_pages with a query: the portal listing down is NOT "keine Themenseiten für …"', async () => {
  const mock = repository({ portals: true });
  const client = await connectedClient();
  try {
    const r = await client.callTool({ name: 'search_wlo_topic_pages', arguments: { query: 'Optik' } });
    assert.match(toolText(r), /KEIN Befund/);
    assert.doesNotMatch(toolText(r), /Keine Themenseiten für/);
    assert.equal((structured(r) as Record<string, unknown>)['incomplete'], true);
  } finally { await client.close(); mock.restore(); }
});

test('search_wlo_topic_pages for ONE collection: a collection that could not be read is an error, not "has no page"', async () => {
  const mock = installFetchMock((url): MockResult => (url.includes('/metadata') ? { status: 503, json: {} } : { json: {} }));
  const client = await connectedClient();
  try {
    const r = await client.callTool({ name: 'search_wlo_topic_pages', arguments: { collectionId: 'coll-1' } });
    assert.equal(r.isError, true, toolText(r));
  } finally { await client.close(); mock.restore(); }
  // A collection that is GONE is a real "no page here".
  const gone = installFetchMock((url): MockResult => (url.includes('/metadata') ? { status: 404, json: {} } : { json: {} }));
  const c2 = await connectedClient();
  try {
    const r = await c2.callTool({ name: 'search_wlo_topic_pages', arguments: { collectionId: 'coll-1' } });
    assert.notEqual(r.isError, true);
    assert.match(toolText(r), /Keine Themenseiten gefunden/);
  } finally { await c2.close(); gone.restore(); }
});

test('get_topic_page_content by query: an unanswered lookup has its own reason — not no_match', async () => {
  stopSkillRegistryCache();
  const mock = repository({ portals: true });
  const client = await connectedClient();
  try {
    const r = await client.callTool({ name: 'get_topic_page_content', arguments: { query: 'Optik' } });
    assert.equal((structured(r) as Record<string, unknown>)['reason'], 'source_unreachable');
    assert.match(toolText(r), /KEIN Befund/);
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

test('search_wlo_collections: sub-lists the tree search could not read are not "nothing found"', async () => {
  stopSkillRegistryCache();
  // Both indexes answer with nothing, so the tool walks the tree: level 1 answers,
  // every level-2 listing does not.
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/mds_oeh/collections')) return { json: { nodes: [] } };
    if (url.includes('/collection/v1/collections/-home-/search')) return { json: { collections: [] } };
    if (url.includes('/children')) {
      return /\/nodes\/-home-\/sub-\d\/children/.test(url)
        ? { status: 503, json: {} }
        : { json: { nodes: [collection('sub-1', 'Physik'), collection('sub-2', 'Chemie')], pagination: { total: 2, from: 0, count: 2 } } };
    }
    return { json: {} };
  });
  const client = await connectedClient();
  try {
    const r = await client.callTool({ name: 'search_wlo_collections', arguments: { query: 'Quantenoptik' } });
    assert.match(toolText(r), /KEIN Befund/);
    assert.doesNotMatch(toolText(r), /Keine Sammlungen gefunden/);
    assert.equal((structured(r) as Record<string, unknown>)['incomplete'], true);

    // JSON mode: block 0 stays parseable, the sentence is its own block.
    const json = await client.callTool({ name: 'search_wlo_collections', arguments: { query: 'Quantenoptik', outputFormat: 'json' } });
    const blocks = (json as { content: Array<{ text: string }> }).content.map(c => c.text);
    assert.doesNotThrow(() => JSON.parse(blocks[0]!), 'a client parsing the first block must not meet prose');
    assert.ok(blocks.some(b => /KEIN Befund/.test(b)));
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

test('search_wlo_collections in JSON mode keeps _queryMeta as the LAST block beside the notice', async () => {
  stopSkillRegistryCache();
  const mock = repository({ name: true });
  const client = await connectedClient();
  try {
    const r = await client.callTool({ name: 'search_wlo_collections', arguments: { query: 'Optik', outputFormat: 'json' } });
    const blocks = (r as { content: Array<{ text: string }> }).content.map(c => c.text);
    assert.match(blocks[blocks.length - 1]!, /_queryMeta/);
    assert.ok(blocks.slice(0, -1).some(b => /nur teilweise erreichbar/.test(b)));
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

test('the widget keeps what a FLAT list says about itself', async () => {
  const { renderSearchResults } = await import('../src/apps/widgets/search-results/render.js');
  const down = renderSearchResults({ total: 0, count: 0, results: [], incomplete: true } as never, 'de');
  assert.doesNotMatch(down, /Keine Treffer gefunden/);
  const more = renderSearchResults({ total: 900, count: 0, results: [], more: { nextSkipCount: 100 } } as never, 'de');
  assert.match(more, /der Katalog hält mehr/);
});

test('the HTML page does not print "Keine Treffer." beside the warning that the search did not answer', async () => {
  stopSkillRegistryCache();
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/mds_oeh/collections') || url.includes('/collection/v1/collections/-home-/search')) return { status: 503, json: {} };
    if (url.includes('/ngsearch')) return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
  try {
    const html = String((await routeRestRequest('GET', '/api/search?q=Optik&format=html'))!.raw ?? '');
    assert.match(html, /KEIN Befund/);
    assert.doesNotMatch(html, /Keine Treffer\./);
  } finally { mock.restore(); stopSkillRegistryCache(); }
});

test('a hit the name index found and the re-read lost marks the list incomplete', async () => {
  const { searchCollectionsResult } = await import('../src/services/collection-search.js');
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/mds_oeh/collections')) return { json: { nodes: [] } };
    if (url.includes('/collection/v1/collections/-home-/search')) return { json: { collections: [collection('n-9', 'Optik')] } };
    if (url.includes('/n-9/metadata')) return { status: 503, json: {} };
    return { json: {} };
  });
  try {
    const r = await searchCollectionsResult('Optik');
    assert.deepEqual(r.nodes, []);
    assert.deepEqual(r.unreachable, ['name'], 'found by the one index that can find it, and then not readable');
  } finally { mock.restore(); }
});

test('the lean `search` has no field for an outage — an EMPTY list over an unanswered search is an error, hits stay an answer', async () => {
  stopSkillRegistryCache();
  // Both collection indexes down and no material found: `{results: []}` would say "WLO holds nothing".
  let mock = installFetchMock((url): MockResult => {
    if (url.includes('/mds_oeh/collections') || url.includes('/collection/v1/collections/-home-/search')) return { status: 503, json: {} };
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
  let client = await connectedClient();
  try {
    const r = await client.callTool({ name: 'search', arguments: { query: 'Optik' } });
    assert.equal(r.isError, true, toolText(r));
    assert.match(toolText(r), /KEIN Befund/);
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }

  // Everything answered and nothing matched: that IS a finding, in the convention shape.
  mock = installFetchMock((url): MockResult => {
    if (url.includes('/collection/v1/collections/-home-/search')) return { json: { collections: [] } };
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
  client = await connectedClient();
  try {
    const r = await client.callTool({ name: 'search', arguments: { query: 'Optik' } });
    assert.notEqual(r.isError, true, toolText(r));
    assert.deepEqual(structured(r), { results: [] });
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

test('findTopicPagesByQueryResult: the portal listing down ALONE makes an empty answer incomplete', async () => {
  // No keyword hit, so no candidate read can fail in its place: the flag has to
  // come from the listing itself.
  const answer = (portalsDown: boolean) => installFetchMock((url): MockResult => {
    if (url.includes('/mds_oeh/collections')) return { json: { nodes: [] } };
    if (url.includes('/collection/v1/collections/-home-/search')) return { json: { collections: [] } };
    if (url.includes('/children')) {
      return portalsDown ? { status: 503, json: {} } : { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
    }
    return { json: {} };
  });
  let mock = answer(true);
  try { assert.deepEqual(await findTopicPagesByQueryResult('Optik'), { pages: [], incomplete: true }); }
  finally { mock.restore(); }
  mock = answer(false);
  try { assert.deepEqual(await findTopicPagesByQueryResult('Optik'), { pages: [], incomplete: false }, 'everything answered: empty IS the finding'); }
  finally { mock.restore(); }
});
