import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WLO_ROOT_COLLECTION_ID } from '../src/wlo-api.js';
import { connectedClient, installFetchMock, makeNode } from './fetchMock.js';

const rawConfig = JSON.stringify({ structure: { swimlanes: [
  { heading: 'Einführung', type: 'container', grid: [{ item: 'ai-text' }] },
] } });

/**
 * The single true topic-page shape (live-verified 2026-07-17): the page
 * VARIANTS are the direct children of the config folder and THEMSELVES carry
 * ccm:page_variant_config — their contents are widget nodes, not variants.
 *   coll-1 --page_config_ref--> cfg-1 --child--> var-1 (page_variant_config)
 */
function topicPageMockHandler(url: string): { json: unknown } {
  if (url.includes('/metadata') && url.includes('coll-1')) {
    return { json: { node: makeNode('coll-1', 'Themenseite Optik', {
      'cclom:title': ['Themenseite Optik'],
      'ccm:page_config_ref': ['workspace://SpacesStore/cfg-1'],
    }) } };
  }
  if (url.includes('cfg-1/children')) {
    return { json: { nodes: [makeNode('var-1', 'Variante', {
      'ccm:page_variant_config': [rawConfig],
      'ccm:page_variant_profiling_target_group': ['teacher'],
      'cclom:title': ['Variante Ideal'],
    })] } };
  }
  return { json: {} };
}

function installTopicPageMock() {
  return installFetchMock(topicPageMockHandler);
}

test('search_wlo_topic_pages: Mode B finds the Themenseite of a matching collection (characterization)', async () => {
  // Pins Mode B (query → collection with page_config_ref → its Themenseite)
  // before/after the parallelization of the per-collection resolution. The
  // keyword-collection search is answered here; everything else by the shared
  // topic-page handler.
  const mock = installFetchMock((url) => {
    if (url.includes('/collections')) {
      // Live shape (verified 2026-07-17): the keyword-collections endpoint
      // returns a fixed reduced projection WITHOUT ccm:page_config_ref — the
      // topic-page check must come from the /metadata fetch, not the hit props.
      return { json: { nodes: [makeNode('coll-1', 'Themenseite Optik', {
        'cclom:title': ['Themenseite Optik'],
      })] } };
    }
    return topicPageMockHandler(url);
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'search_wlo_topic_pages', arguments: { query: 'Optik', outputFormat: 'json' } });
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    const parsed = JSON.parse(text);
    assert.equal(parsed.results.length, 1);
    assert.equal(parsed.results[0].title, 'Themenseite Optik');
    // Deep-audit #1: the variant is the config-folder CHILD itself — its id and
    // target group must come from that node, not from its (widget) contents.
    assert.equal(parsed.results[0].variants[0].variantId, 'var-1');
    assert.equal(parsed.results[0].variants[0].targetGroup, 'teacher');
    const metaBlock = (result.content as Array<{ text?: string }>).map(p => p.text ?? '').find(t => t.includes('_queryMeta')) ?? '';
    assert.match(metaBlock, /topic_pages_by_keyword/);
  } finally {
    await client.close();
    mock.restore();
  }
});

/**
 * Two collections with page configs whose alphabetical and relevance order
 * differ: "Physik" is the exact match (relevance #1) but sorts after
 * "Astronomie und Physik" alphabetically.
 */
function installTwoTopicPagesMock() {
  const coll = (id: string, title: string, cfg: string) => makeNode(id, title, {
    'cclom:title': [title],
    'ccm:page_config_ref': [`workspace://SpacesStore/${cfg}`],
  });
  return installFetchMock((url) => {
    if (url.includes('/collections')) {
      // Keyword hits carry NO page_config_ref (reduced projection, live shape).
      return { json: { nodes: [
        makeNode('coll-a', 'Astronomie und Physik'),
        makeNode('coll-z', 'Physik'),
      ] } };
    }
    if (url.includes('/metadata') && url.includes('coll-a')) return { json: { node: coll('coll-a', 'Astronomie und Physik', 'cfg-a') } };
    if (url.includes('/metadata') && url.includes('coll-z')) return { json: { node: coll('coll-z', 'Physik', 'cfg-z') } };
    if (url.includes('cfg-a/children')) {
      return { json: { nodes: [makeNode('var-a', 'PAGE_VARIANT_a', { 'ccm:page_variant_config': [rawConfig], 'ccm:page_variant_profiling_target_group': ['teacher'] })] } };
    }
    if (url.includes('cfg-z/children')) {
      return { json: { nodes: [makeNode('var-z', 'PAGE_VARIANT_z', { 'ccm:page_variant_config': [rawConfig], 'ccm:page_variant_profiling_target_group': ['teacher'] })] } };
    }
    return { json: {} };
  });
}

test('search_wlo_topic_pages: Mode B defaults to relevance order for a query (audit #6)', async () => {
  // Regression: zod .default('alpha') made the "relevance when a query is
  // present" default a dead branch — Mode B reranked by relevance, then threw
  // the order away alphabetically on every default call.
  const mock = installTwoTopicPagesMock();
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'search_wlo_topic_pages', arguments: { query: 'Physik', outputFormat: 'json' } });
    const parsed = JSON.parse((result.content as Array<{ text: string }>)[0]?.text ?? '');
    assert.deepEqual(parsed.results.map((r: { title: string }) => r.title), ['Physik', 'Astronomie und Physik'],
      'with a query and no explicit sort, the reranked (relevance) order must survive the merge');
  } finally {
    await client.close();
    mock.restore();
  }
});

test('search_wlo_topic_pages: Mode B finds a subject portal the keyword endpoint does not surface', async () => {
  // Live shape (verified 2026-07-17): the subject portals — the collections
  // that actually HAVE Themenseiten — do not appear in the keyword-collection
  // hits at all. Mode B must therefore also match the root portals locally.
  const portal = makeNode('portal-p', 'Physik', {
    'cm:name': ['Physik'],
    'ccm:page_config_ref': ['workspace://SpacesStore/cfg-p'],
  });
  const mock = installFetchMock((url) => {
    if (url.includes('/collections')) return { json: { nodes: [] } };
    if (url.includes(`${WLO_ROOT_COLLECTION_ID}/children`)) return { json: { nodes: [portal] } };
    if (url.includes('/metadata') && url.includes('portal-p')) return { json: { node: portal } };
    if (url.includes('cfg-p/children')) {
      return { json: { nodes: [makeNode('var-p', 'PAGE_VARIANT_p', { 'ccm:page_variant_config': [rawConfig], 'ccm:page_variant_profiling_target_group': ['teacher'] })] } };
    }
    return { json: {} };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'search_wlo_topic_pages', arguments: { query: 'Physik', outputFormat: 'json' } });
    const parsed = JSON.parse((result.content as Array<{ text: string }>)[0]?.text ?? '');
    assert.equal(parsed.results.length, 1);
    assert.equal(parsed.results[0].title, 'Physik');
    assert.equal(parsed.results[0].variants[0].variantId, 'var-p');
  } finally {
    await client.close();
    mock.restore();
  }
});

test('search_wlo_topic_pages: attaches swimlane content when includeContent is set (json)', async () => {
  const mock = installTopicPageMock();
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_topic_pages',
      arguments: { collectionId: 'coll-1', includeContent: true, outputFormat: 'json' },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    const parsed = JSON.parse(text);
    assert.equal(parsed.results.length, 1);
    assert.ok(parsed.results[0].content, 'expected content attached');
    assert.equal(parsed.results[0].content.swimlanes[0].heading, 'Einführung');
  } finally {
    await client.close();
    mock.restore();
  }
});

test('search_wlo_topic_pages: no content attached without includeContent', async () => {
  const mock = installTopicPageMock();
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_topic_pages',
      arguments: { collectionId: 'coll-1', outputFormat: 'json' },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    const parsed = JSON.parse(text);
    assert.equal(parsed.results.length, 1);
    assert.equal(parsed.results[0].content, undefined);
  } finally {
    await client.close();
    mock.restore();
  }
});
