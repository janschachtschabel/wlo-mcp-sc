import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WLO_REPOSITORY_URL } from '../src/wlo-api.js';
import { connectedClient, installFetchMock, makeNode } from './fetchMock.js';

/**
 * Mode C (no query → page_variant search) upstream shape, live-verified:
 *   var-N --virtual:primaryparent--> cfg-N --/parents--> coll-N
 * where coll-N is the owning collection (the node carrying page_config_ref).
 *
 * These tests pin the UPSTREAM CALL COUNT, not just the output: the whole
 * point of the Mode-C latency work is how many round-trips one listing costs
 * (client latency report 2026-07-27).
 */
function installModeCMock(variantCount: number) {
  return installFetchMock((url) => {
    if (url.includes('/queries/-home-/mds_oeh/page_variant')) {
      const nodes = Array.from({ length: variantCount }, (_, i) =>
        makeNode(`var-${i}`, `PAGE_VARIANT_${i}`, {
          'cm:name': [`PAGE_VARIANT_${i}`],
          'ccm:page_variant_profiling_target_group': ['teacher'],
          'virtual:primaryparent_nodeid': [`workspace://SpacesStore/cfg-${i}`],
        }),
      );
      return { json: { nodes } };
    }
    const parents = /nodes\/-home-\/cfg-(\d+)\/parents/.exec(url);
    if (parents) {
      const i = parents[1];
      // /parents returns the chain self-first; the owner carries page_config_ref.
      return { json: { nodes: [
        makeNode(`cfg-${i}`, `Config ${i}`),
        makeNode(`coll-${i}`, `Sammlung ${i}`, {
          'cclom:title': [`Sammlung ${i}`],
          'ccm:page_config_ref': [`workspace://SpacesStore/cfg-${i}`],
        }),
      ] } };
    }
    return { json: {} };
  });
}

function parseResults(result: unknown): { total: number; results: Array<{ title: string; collectionId: string; topicPageUrl: string }> } {
  const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
  return JSON.parse(text);
}

test('search_wlo_topic_pages Mode C: resolves owner titles and topic-page URLs', async () => {
  const mock = installModeCMock(3);
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_topic_pages',
      arguments: { maxResults: 3, outputFormat: 'json' },
    });
    const parsed = parseResults(result);
    assert.equal(parsed.total, 3);
    assert.deepEqual(parsed.results.map(r => r.title), ['Sammlung 0', 'Sammlung 1', 'Sammlung 2']);
    assert.equal(parsed.results[0].collectionId, 'coll-0');
    assert.equal(
      parsed.results[0].topicPageUrl,
      `${WLO_REPOSITORY_URL}/components/topic-pages?collectionId=coll-0`,
    );
  } finally {
    await client.close();
    mock.restore();
  }
});

test('search_wlo_topic_pages Mode C: costs ONE upstream call per variant, no owner-metadata fetch', async () => {
  // The owner is selected BECAUSE it carries ccm:page_config_ref, and
  // buildTopicPageUrl only truthiness-checks that value — so fetching the
  // owner's metadata to read it back was dead work (~50% of Mode C).
  const mock = installModeCMock(3);
  const client = await connectedClient();
  try {
    await client.callTool({
      name: 'search_wlo_topic_pages',
      arguments: { maxResults: 3, outputFormat: 'json' },
    });
    const ownerMetaCalls = mock.calls.filter(c => /coll-\d+\/metadata/.test(c.url));
    assert.equal(ownerMetaCalls.length, 0, 'owner metadata must not be fetched again');
    const parentCalls = mock.calls.filter(c => /cfg-\d+\/parents/.test(c.url));
    assert.equal(parentCalls.length, 3, 'one parent walk per distinct page-config parent');
    assert.equal(mock.calls.length, 4, 'one variant search + one parent walk per variant');
  } finally {
    await client.close();
    mock.restore();
  }
});

test('search_wlo_topic_pages Mode C: the owner walk asks for three properties, not -all-', async () => {
  // /parents applies the projection to EVERY node of the ancestor chain, so
  // the default -all- was the second-largest cost on this path.
  const mock = installModeCMock(1);
  const client = await connectedClient();
  try {
    await client.callTool({
      name: 'search_wlo_topic_pages',
      arguments: { maxResults: 1, outputFormat: 'json' },
    });
    const walk = mock.calls.find(c => /cfg-\d+\/parents/.test(c.url));
    assert.ok(walk, 'expected a parent walk');
    const filters = new URL(walk.url).searchParams.getAll('propertyFilter');
    assert.deepEqual(filters, ['ccm:page_config_ref', 'cclom:title', 'cm:name']);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('search_wlo_topic_pages Mode C: sibling variants of one page share a single parent walk', async () => {
  // The per-batch parent cache must still dedupe when several variants
  // (target groups) belong to the same Themenseite.
  const mock = installFetchMock((url) => {
    if (url.includes('/queries/-home-/mds_oeh/page_variant')) {
      return { json: { nodes: ['teacher', 'learner', 'general'].map((tg, i) =>
        makeNode(`var-${i}`, `PAGE_VARIANT_${i}`, {
          'cm:name': [`PAGE_VARIANT_${i}`],
          'ccm:page_variant_profiling_target_group': [tg],
          'virtual:primaryparent_nodeid': ['workspace://SpacesStore/cfg-1'],
        }),
      ) } };
    }
    if (url.includes('cfg-1/parents')) {
      return { json: { nodes: [
        makeNode('cfg-1', 'Config'),
        makeNode('coll-1', 'Sammlung Eins', {
          'cclom:title': ['Sammlung Eins'],
          'ccm:page_config_ref': ['workspace://SpacesStore/cfg-1'],
        }),
      ] } };
    }
    return { json: {} };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_topic_pages',
      arguments: { maxResults: 5, outputFormat: 'json' },
    });
    const parsed = parseResults(result);
    assert.equal(parsed.total, 1, 'three variants of one collection merge into one entry');
    const parentCalls = mock.calls.filter(c => /cfg-1\/parents/.test(c.url));
    assert.equal(parentCalls.length, 1, 'the parent walk is memoized across sibling variants');
  } finally {
    await client.close();
    mock.restore();
  }
});
