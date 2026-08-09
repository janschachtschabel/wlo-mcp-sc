import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock, makeNode } from './fetchMock.js';

/**
 * `withinCollectionId` answers a question the tool could not answer before:
 * every Themenseite BELOW a collection, not just the one that collection owns.
 *
 * Measured 2026-08-07 against production: `virtual:parent_recursive` scoped to
 * the Physik portal returns 31 variants, while the page_config_ref → children
 * route (`collectionId`) returns 1 — the subtree carries topic pages of its own
 * sub-collections. The field takes exactly ONE value; two are refused with
 * `InvalidParameterException: … non-multivalue field`, so candidate collections
 * cannot be batched (docs/plans/2026-08-07-topic-page-variants-analysis.md §3).
 */

const REF = (id: string) => `workspace://SpacesStore/${id}`;

function variantNode(i: number, cfg: string) {
  return makeNode(`var-${i}`, `PAGE_VARIANT_${i}`, {
    'cm:name': [`PAGE_VARIANT_${i}`],
    'virtual:primaryparent_nodeid': [REF(cfg)],
  });
}

function installSubtreeMock(variantCount: number) {
  return installFetchMock((url) => {
    if (url.includes('/queries/-home-/mds_oeh/page_variant')) {
      return { json: { nodes: Array.from({ length: variantCount }, (_, i) => variantNode(i, `cfg-${i}`)) } };
    }
    const cfg = /nodes\/-home-\/cfg-(\d+)\/metadata/.exec(url);
    if (cfg) {
      return { json: { node: makeNode(`cfg-${cfg[1]}`, 'Config', {
        'virtual:primaryparent_nodeid': [REF(`coll-${cfg[1]}`)],
      }) } };
    }
    const coll = /nodes\/-home-\/coll-(\d+)\/metadata/.exec(url);
    if (coll) {
      return { json: { node: makeNode(`coll-${coll[1]}`, `Unterthema ${coll[1]}`, {
        'cclom:title': [`Unterthema ${coll[1]}`],
        'ccm:page_config_ref': [REF(`cfg-${coll[1]}`)],
      }) } };
    }
    return { json: {} };
  });
}

async function call(args: Record<string, unknown>) {
  const client = await connectedClient();
  try {
    const r = await client.callTool({
      name: 'search_wlo_topic_pages',
      arguments: { outputFormat: 'json', ...args },
    });
    return JSON.parse((r as { content: Array<{ text: string }> }).content[0]?.text ?? '{}');
  } finally {
    await client.close();
  }
}

function criteriaOf(calls: Array<{ url: string; init?: RequestInit }>) {
  const call = calls.find(c => c.url.includes('/queries/-home-/mds_oeh/page_variant'));
  assert.ok(call, 'expected a page_variant search');
  return JSON.parse(String(call.init?.body ?? '{}')).criteria as Array<{ property: string; values: string[] }>;
}

test('withinCollectionId scopes the variant search to the subtree', async () => {
  const mock = installSubtreeMock(3);
  try {
    const parsed = await call({ withinCollectionId: 'portal-physik', maxResults: 10 });
    assert.deepEqual(criteriaOf(mock.calls), [
      { property: 'ccm:page_variant_is_template', values: ['false'] },
      { property: 'virtual:parent_recursive', values: ['portal-physik'] },
    ]);
    assert.equal(parsed.total, 3, 'every topic page below the collection, not just its own');
  } finally {
    mock.restore();
  }
});

test('withinCollectionId resolves each page to its own owning collection', async () => {
  const mock = installSubtreeMock(2);
  try {
    const parsed = await call({ withinCollectionId: 'portal-physik', maxResults: 10 });
    assert.deepEqual(parsed.results.map((r: { title: string }) => r.title), ['Unterthema 0', 'Unterthema 1']);
  } finally {
    mock.restore();
  }
});

test('withinCollectionId is bounded by maxResults like every other listing', async () => {
  const mock = installSubtreeMock(30);
  try {
    const parsed = await call({ withinCollectionId: 'portal-physik', maxResults: 4 });
    assert.equal(parsed.total, 4);
    assert.equal(mock.calls.length, 1 + 4 * 2, 'search + (folder + owner) per returned page');
  } finally {
    mock.restore();
  }
});

test('collectionId wins over withinCollectionId — the exact check is more specific', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/queries/-home-/mds_oeh/page_variant')) {
      throw new Error('Mode A must not run a variant search');
    }
    if (url.includes('/nodes/-home-/coll-exact/metadata')) {
      return { json: { node: makeNode('coll-exact', 'Optik', {
        'cclom:title': ['Optik'],
        'ccm:page_config_ref': [REF('cfg-exact')],
      }) } };
    }
    if (url.includes('/nodes/-home-/cfg-exact/children')) {
      return { json: { nodes: [makeNode('v-1', 'Variante', {
        'cclom:title': ['Variante'],
        'ccm:page_variant_config': ['{"structure":{"swimlanes":[]}}'],
      })] } };
    }
    return { json: {} };
  });
  try {
    const parsed = await call({ collectionId: 'coll-exact', withinCollectionId: 'portal-physik' });
    assert.equal(parsed.results[0].title, 'Optik');
  } finally {
    mock.restore();
  }
});

test('withinCollectionId wins over query — it names a scope, the query only guesses one', async () => {
  const mock = installSubtreeMock(2);
  try {
    const parsed = await call({ withinCollectionId: 'portal-physik', query: 'Optik', maxResults: 10 });
    assert.equal(parsed.total, 2);
    assert.ok(
      criteriaOf(mock.calls).some(c => c.property === 'virtual:parent_recursive'),
      'the subtree search runs, not the collection keyword search',
    );
  } finally {
    mock.restore();
  }
});

/** The `_queryMeta` block of a tool result. */
async function queryMeta(args: Record<string, unknown>) {
  const client = await connectedClient();
  try {
    const r = await client.callTool({
      name: 'search_wlo_topic_pages',
      arguments: { outputFormat: 'json', ...args },
    });
    const block = (r as { content: Array<{ text: string }> }).content
      .map(p => p.text).find(t => t.includes('_queryMeta')) ?? '{}';
    return JSON.parse(block)._queryMeta as {
      queryType: string; searchTerm: string; criteria: Array<{ property: string; values: string[] }>;
    };
  } finally {
    await client.close();
  }
}

test('_queryMeta reports the criteria the dispatched mode actually used', async () => {
  // Three of the four modes ignore parameters the caller may have passed
  // alongside. `criteria` is the machine-readable statement of what was
  // searched — listing an ngsearchword that never reached the repository makes
  // a downstream consumer misreport the query.
  const mock = installSubtreeMock(2);
  try {
    const meta = await queryMeta({ withinCollectionId: 'portal-physik', query: 'Optik' });
    assert.equal(meta.queryType, 'topic_pages_below_collection');
    assert.deepEqual(meta.criteria.map(c => c.property), ['virtual:parent_recursive']);
    assert.equal(meta.searchTerm, '', 'the query was not used, so it is not reported as the search term');
  } finally {
    mock.restore();
  }
});

test('_queryMeta still reports the query when the keyword mode ran', async () => {
  // Mode B needs a real hit: the empty-result branch answers without a
  // `_queryMeta` block at all, so an empty mock would test nothing.
  const mock = installFetchMock((url) => {
    if (url.includes('/nodes/-home-/cfg-optik/children')) {
      return { json: { nodes: [makeNode('v-1', 'Variante', {
        'cclom:title': ['Variante'],
        'ccm:page_variant_config': ['{"structure":{"swimlanes":[]}}'],
      })] } };
    }
    if (url.includes('/children')) {                       // the WLO root portals
      return { json: { nodes: [makeNode('coll-optik', 'Optik', {
        'cclom:title': ['Optik'],
        'ccm:page_config_ref': [REF('cfg-optik')],
      })] } };
    }
    if (url.includes('/nodes/-home-/coll-optik/metadata')) {
      return { json: { node: makeNode('coll-optik', 'Optik', {
        'cclom:title': ['Optik'],
        'ccm:page_config_ref': [REF('cfg-optik')],
      }) } };
    }
    return { json: { nodes: [] } };
  });
  try {
    const meta = await queryMeta({ query: 'Optik' });
    assert.equal(meta.queryType, 'topic_pages_by_keyword');
    assert.deepEqual(meta.criteria.map(c => c.property), ['ngsearchword']);
    assert.equal(meta.searchTerm, 'Optik');
  } finally {
    mock.restore();
  }
});

test('_queryMeta keeps the profiling filters, which every mode applies', async () => {
  const mock = installSubtreeMock(2);
  try {
    const meta = await queryMeta({ withinCollectionId: 'portal-physik', targetGroup: 'teacher' });
    assert.deepEqual(meta.criteria.map(c => c.property), ['virtual:parent_recursive', 'targetGroup']);
  } finally {
    mock.restore();
  }
});
