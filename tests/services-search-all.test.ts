import { test } from 'node:test';
import assert from 'node:assert/strict';

import { searchAll } from '../src/services/search.js';
import { WLO_ROOT_COLLECTION_ID } from '../src/wlo-api.js';
import { installFetchMock, makeNode } from './fetchMock.js';

/** Collection node that is a Themenseite (has a page_config_ref → topicPageUrl). */
function topicPageNode(id: string, title: string, extra: Record<string, string[]> = {}) {
  return makeNode(id, title, { 'ccm:page_config_ref': ['workspace://SpacesStore/cfg-' + id], ...extra });
}

test('searchAll: default flags — separates content, collections and topic pages', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/collections')) {
      return { json: { nodes: [
        makeNode('coll-1', 'Sammlung Optik'),          // plain collection
        topicPageNode('tp-1', 'Themenseite Optik'),    // topic page
      ] } };
    }
    if (url.includes('/ngsearch')) {
      return { json: { nodes: [makeNode('c-1', 'Arbeitsblatt Optik')], pagination: { total: 42, from: 0, count: 1 } } };
    }
    return { json: {} };
  });
  try {
    const env = await searchAll({ query: 'optik' });
    assert.equal(env.query, 'optik');
    assert.equal(env.content.total, 42);
    assert.deepEqual(env.content.results.map(r => r.title), ['Arbeitsblatt Optik']);
    assert.deepEqual(env.collections.results.map(r => r.title), ['Sammlung Optik']);
    assert.deepEqual(env.topicPages.results.map(r => r.title), ['Themenseite Optik']);
    // No enrichment fields by default.
    assert.equal(env.wikipedia, undefined);
    assert.equal(env.content.results[0].textContent, undefined);
    assert.equal((env.topicPages.results[0] as { topicPageContent?: unknown }).topicPageContent, undefined);
  } finally {
    mock.restore();
  }
});

test('searchAll: include filter can restrict to content only (no collection call)', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/ngsearch')) return { json: { nodes: [makeNode('c-1', 'X')], pagination: { total: 1, from: 0, count: 1 } } };
    return { json: {} };
  });
  try {
    const env = await searchAll({ query: 'x', include: ['content'] });
    assert.equal(env.content.results.length, 1);
    assert.equal(env.collections.results.length, 0);
    assert.ok(!mock.calls.some(c => c.url.includes('/collections')));
  } finally {
    mock.restore();
  }
});

test('searchAll: includeWikipedia attaches a summary', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/page/summary/')) {
      return { json: { type: 'standard', title: 'Optik', extract: 'Die Optik.', content_urls: { desktop: { page: 'https://de.wikipedia.org/wiki/Optik' } }, lang: 'de' } };
    }
    if (url.includes('/collections')) return { json: { nodes: [] } };
    if (url.includes('/ngsearch')) return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
    return { json: {} };
  });
  try {
    const env = await searchAll({ query: 'optik', includeWikipedia: true });
    assert.ok(env.wikipedia);
    assert.equal(env.wikipedia.title, 'Optik');
    assert.match(env.wikipedia.extract, /Die Optik\./);
  } finally {
    mock.restore();
  }
});

test('searchAll: includeTextContent enriches content results (capped)', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/textContent')) return { json: { content: 'Volltext c-1' } };
    if (url.includes('/collections')) return { json: { nodes: [] } };
    if (url.includes('/ngsearch')) return { json: { nodes: [makeNode('c-1', 'Inhalt')], pagination: { total: 1, from: 0, count: 1 } } };
    return { json: {} };
  });
  try {
    const env = await searchAll({ query: 'x', include: ['content'], includeTextContent: true });
    assert.match(env.content.results[0].textContent ?? '', /Volltext c-1/);
  } finally {
    mock.restore();
  }
});

test('searchAll: includeCompendium gap-fills a collection missing its inline compendium', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/collections')) return { json: { nodes: [makeNode('coll-1', 'Sammlung Optik')] } }; // no inline compendium
    if (url.includes('/metadata') && url.includes('coll-1')) {
      return { json: { node: makeNode('coll-1', 'Sammlung Optik', {
        'ccm:oeh_collection_compendium_text': ['Volles Kompendium zur Optik.'],
      }) } };
    }
    if (url.includes('/ngsearch')) return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
    return { json: {} };
  });
  try {
    const env = await searchAll({ query: 'optik', include: ['collections'], includeCompendium: true });
    assert.match(env.collections.results[0].compendiumText ?? '', /Volles Kompendium zur Optik\./);
  } finally {
    mock.restore();
  }
});

test('searchAll: includeTopicPageContent attaches resolved swimlanes to a topic page', async () => {
  const rawConfig = JSON.stringify({ structure: { swimlanes: [
    { heading: 'Einführung', type: 'container', grid: [{ item: 'ai-text' }] },
  ] } });
  const mock = installFetchMock((url) => {
    if (url.includes('/collections')) return { json: { nodes: [topicPageNode('tp-1', 'Themenseite Optik')] } };
    if (url.includes('/ngsearch')) return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
    // getTopicPageContent: seed metadata → owning collection with page_config_ref.
    if (url.includes('/metadata') && url.includes('tp-1')) {
      return { json: { node: makeNode('tp-1', 'Themenseite Optik', {
        'ccm:page_config_ref': ['workspace://SpacesStore/cfg-tp-1'],
      }) } };
    }
    // children of the config folder → the real page variant (carries the config).
    if (url.includes('/children') && url.includes('cfg-tp-1')) {
      return { json: { nodes: [makeNode('var-1', 'Variante', {
        'ccm:page_variant_config': [rawConfig],
        'cclom:title': ['Variante Ideal'],
      }) ] } };
    }
    return { json: {} };
  });
  try {
    const env = await searchAll({ query: 'optik', include: ['topicPages'], includeTopicPageContent: true, maxPerSwimlane: 3 });
    const tp = env.topicPages.results[0] as { topicPageContent?: { swimlanes: { heading: string }[] } };
    assert.ok(tp.topicPageContent, 'expected topicPageContent attached');
    assert.equal(tp.topicPageContent.swimlanes[0].heading, 'Einführung');
  } finally {
    mock.restore();
  }
});

test('searchAll: topicPages bucket is fed by locally-matched subject portals', async () => {
  // Live shape (verified 2026-07-17): keyword-collection hits NEVER carry
  // ccm:page_config_ref (fixed reduced projection) and the subject portals are
  // absent from those hits — so the topicPages bucket must come from the root
  // portals matched locally against the query.
  const mock = installFetchMock((url) => {
    if (url.includes('/collections')) return { json: { nodes: [makeNode('coll-1', 'Sammlung Physik')] } };
    if (url.includes(`${WLO_ROOT_COLLECTION_ID}/children`)) {
      return { json: { nodes: [makeNode('portal-p', 'Physik', {
        'cm:name': ['Physik'],
        'ccm:page_config_ref': ['workspace://SpacesStore/cfg-p'],
      })] } };
    }
    if (url.includes('/ngsearch')) return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
    return { json: {} };
  });
  try {
    const env = await searchAll({ query: 'physik', include: ['collections', 'topicPages'] });
    assert.deepEqual(env.collections.results.map(r => r.title), ['Sammlung Physik']);
    assert.deepEqual(env.topicPages.results.map(r => r.title), ['Physik'], 'the portal must land in topicPages');
  } finally {
    mock.restore();
  }
});

test('searchAll: a thrown collections search degrades to partial results instead of rejecting', async () => {
  // Regression (deep-audit #3): the wiki leg had .catch, the collections leg
  // was bare in Promise.all — one collections timeout discarded the already-
  // fetched content results and failed the whole combined search.
  const mock = installFetchMock((url) => {
    if (url.includes('/collections')) throw new Error('upstream timeout');
    if (url.includes('/ngsearch')) {
      return { json: { nodes: [makeNode('c-1', 'Arbeitsblatt Optik')], pagination: { total: 42, from: 0, count: 1 } } };
    }
    return { json: {} };
  });
  try {
    const env = await searchAll({ query: 'optik' });
    assert.deepEqual(env.content.results.map(r => r.title), ['Arbeitsblatt Optik'], 'content leg must survive');
    assert.equal(env.collections.results.length, 0);
    assert.equal(env.topicPages.results.length, 0);
  } finally {
    mock.restore();
  }
});

test('searchAll: skipCount is forwarded to the content search offset', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/ngsearch')) return { json: { nodes: [], pagination: { total: 0, from: 8, count: 0 } } };
    if (url.includes('/collections')) return { json: { nodes: [] } };
    return { json: {} };
  });
  try {
    await searchAll({ query: 'optik', include: ['content'], skipCount: 8 });
    const searchCalls = mock.calls.filter(c => c.url.includes('/ngsearch'));
    assert.ok(searchCalls.length > 0);
    assert.ok(searchCalls.every(c => c.url.includes('skipCount=8')));
  } finally {
    mock.restore();
  }
});
