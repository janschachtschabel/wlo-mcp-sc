import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock, makeNode } from './fetchMock.js';

// One-step topic path (2026-07-17): get_topic_page_content accepts a topic
// `query`, resolves the best Themenseite internally (same Mode-B logic as
// search_wlo_topic_pages) and returns render-ready swimlanes — so the swimlane
// widget triggers WITHOUT the model first calling search_wlo_topic_pages
// (live-observed: that two-step chain broke, so the widget never rendered).

const rawConfig = JSON.stringify({ structure: { swimlanes: [
  { heading: 'Einführung', type: 'container', grid: [{ item: 'ai-text' }] },
] } });

/** coll-1 --page_config_ref--> cfg-1 --child--> var-1 (page_variant_config). */
function topicPageHandler(url: string): { json: unknown } {
  if (url.includes('/collections')) {
    // Keyword-collections hit (reduced projection, no page_config_ref).
    return { json: { nodes: [makeNode('coll-1', 'Themenseite Optik', { 'cclom:title': ['Themenseite Optik'] })] } };
  }
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

test('get_topic_page_content: query resolves the Themenseite and returns swimlanes in ONE call', async () => {
  const mock = installFetchMock(topicPageHandler);
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'get_topic_page_content',
      arguments: { query: 'Optik', outputFormat: 'json' },
    });
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? '';
    const parsed = JSON.parse(text);
    // Resolved via collectionId (carries the WLO-style header title).
    assert.equal(parsed.collectionId, 'coll-1');
    assert.equal(parsed.collectionTitle, 'Themenseite Optik');
    assert.equal(parsed.swimlanes[0].heading, 'Einführung');
  } finally {
    await client.close();
    mock.restore();
  }
});

test('get_topic_page_content: a query with no matching Themenseite → empty payload, not an error', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/collections')) return { json: { nodes: [] } };
    return { json: {} };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'get_topic_page_content',
      arguments: { query: 'Nichtsda', outputFormat: 'json' },
    });
    assert.notEqual(result.isError, true);
    // The empty case returns a human message as text but keeps the structured
    // contract (empty swimlanes) in structuredContent — the widget stays valid.
    const sc = result.structuredContent as { swimlanes: unknown[] };
    assert.deepEqual(sc.swimlanes, []);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('get_topic_page_content: none of query/collectionId/variantId → error', async () => {
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'get_topic_page_content', arguments: {} });
    assert.equal(result.isError, true);
  } finally {
    await client.close();
  }
});
