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
  // The variant is a real node in its own right: the query path passes its id
  // alongside the collection so both can be read in parallel.
  if (url.includes('var-1/metadata')) {
    return { json: { node: makeNode('var-1', 'Variante', {
      'ccm:page_variant_config': [rawConfig],
      'ccm:page_variant_profiling_target_group': ['teacher'],
      'cclom:title': ['Variante Ideal'],
    }) } };
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

/**
 * An empty result used to collapse five distinct causes into one German
 * sentence, so a client could only guess and re-probe other candidates (~4 s
 * per blind retry — client latency report 2026-07-27). Each cause now names
 * itself in `structuredContent.reason`.
 */
async function reasonFor(args: Record<string, unknown>, handler: (url: string) => { json: unknown }): Promise<string | undefined> {
  const mock = installFetchMock(handler);
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'get_topic_page_content',
      arguments: { outputFormat: 'json', ...args },
    });
    return (result.structuredContent as { reason?: string }).reason;
  } finally {
    await client.close();
    mock.restore();
  }
}

test('get_topic_page_content: reason no_match when the query resolves to no Themenseite', async () => {
  const reason = await reasonFor({ query: 'Nichtsda' }, (url) =>
    url.includes('/collections') ? { json: { nodes: [] } } : { json: {} });
  assert.equal(reason, 'no_match');
});

test('get_topic_page_content: reason node_not_found for an unknown collectionId', async () => {
  const reason = await reasonFor({ collectionId: 'ghost' }, () => ({ json: {} }));
  assert.equal(reason, 'node_not_found');
});

test('get_topic_page_content: reason no_page_config_ref when the collection has no topic page', async () => {
  const reason = await reasonFor({ collectionId: 'coll-9' }, (url) =>
    url.includes('/metadata')
      ? { json: { node: makeNode('coll-9', 'Sammlung ohne Themenseite') } }
      : { json: {} });
  assert.equal(reason, 'no_page_config_ref');
});

test('get_topic_page_content: reason no_variant when the page config holds no usable variant', async () => {
  const reason = await reasonFor({ collectionId: 'coll-1' }, (url) => {
    if (url.includes('/metadata') && url.includes('coll-1')) {
      return { json: { node: makeNode('coll-1', 'Optik', {
        'ccm:page_config_ref': ['workspace://SpacesStore/cfg-1'],
      }) } };
    }
    // Only a TEMPLATE variant → nothing renderable.
    if (url.includes('cfg-1/children')) {
      return { json: { nodes: [makeNode('var-t', 'Vorlage', {
        'ccm:page_variant_config': [rawConfig],
        'ccm:page_variant_is_template': ['true'],
      })] } };
    }
    return { json: {} };
  });
  assert.equal(reason, 'no_variant');
});

test('get_topic_page_content: reason empty_config when the variant carries no swimlanes', async () => {
  const reason = await reasonFor({ collectionId: 'coll-1' }, (url) => {
    if (url.includes('/metadata') && url.includes('coll-1')) {
      return { json: { node: makeNode('coll-1', 'Optik', {
        'ccm:page_config_ref': ['workspace://SpacesStore/cfg-1'],
      }) } };
    }
    if (url.includes('cfg-1/children')) {
      return { json: { nodes: [makeNode('var-1', 'Variante', {
        'ccm:page_variant_config': [JSON.stringify({ structure: { swimlanes: [] } })],
      })] } };
    }
    return { json: {} };
  });
  assert.equal(reason, 'empty_config');
});

test('get_topic_page_content: a successful result carries no reason', async () => {
  const mock = installFetchMock(topicPageHandler);
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'get_topic_page_content',
      arguments: { query: 'Optik', outputFormat: 'json' },
    });
    assert.equal((result.structuredContent as { reason?: string }).reason, undefined);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('get_topic_page_content: the empty result honours outputFormat json', async () => {
  // The success path returns JSON in content[0].text; the empty path returned
  // German prose, so a client parsing that field crashed on exactly the case
  // it most needed to inspect.
  const mock = installFetchMock((url) => url.includes('/collections') ? { json: { nodes: [] } } : { json: {} });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'get_topic_page_content',
      arguments: { query: 'Nichtsda', outputFormat: 'json' },
    });
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? '';
    const parsed = JSON.parse(text);
    assert.equal(parsed.reason, 'no_match');
    assert.deepEqual(parsed.swimlanes, []);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('get_topic_page_content: the empty result stays human-readable in markdown', async () => {
  const mock = installFetchMock((url) => url.includes('/collections') ? { json: { nodes: [] } } : { json: {} });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'get_topic_page_content',
      arguments: { query: 'Nichtsda', outputFormat: 'markdown' },
    });
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? '';
    assert.match(text, /Keine Themenseite/i);
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
