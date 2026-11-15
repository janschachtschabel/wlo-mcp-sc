import { test } from 'node:test';
import assert from 'node:assert/strict';

import { orderVariants, parsePageConfigOrder } from '../src/topic-page-config.js';
import { getTopicPageContent } from '../src/topic-page-structure.js';
import { connectedClient, installFetchMock, makeNode, toolText } from './fetchMock.js';

/**
 * Which variant a Themenseite actually renders is recorded on the page-config
 * FOLDER, in `ccm:page_config` — measured 2026-08-07 on 99/99 production and
 * 45/45 staging pages (docs/plans/2026-08-07-topic-page-variants-analysis.md §4):
 *
 *   { "variants": ["workspace://SpacesStore/…", …], "default": "…" }
 *
 * `default` is set on 76/99 production pages and, where set, is always
 * `variants[0]`. `variants[]` covers every real child but can also name
 * variants that no longer exist (3 dangling refs on staging).
 *
 * Before this, the code took the first CHILD of the folder. That happened to
 * land on the same node in all 13 measured multi-variant pages — by an ordering
 * the repository never promised, not by a rule.
 */

const REF = (id: string) => `workspace://SpacesStore/${id}`;

function variant(id: string, title: string, extra: Record<string, string[]> = {}) {
  return makeNode(id, title, {
    'cclom:title': [title],
    'ccm:page_variant_config': ['{"structure":{"swimlanes":[{"heading":"' + title + '","type":"container","grid":[]}]}}'],
    ...extra,
  });
}

// ── the pure rules ──────────────────────────────────────────────────────────

test('parsePageConfigOrder: store refs are reduced to bare ids', () => {
  const cfg = parsePageConfigOrder(JSON.stringify({ variants: [REF('a'), REF('b')], default: REF('b') }));
  assert.deepEqual(cfg, { order: ['a', 'b'], defaultId: 'b' });
});

test('parsePageConfigOrder: a page without a recorded default still yields its order', () => {
  const cfg = parsePageConfigOrder(JSON.stringify({ variants: [REF('a'), REF('b')] }));
  assert.deepEqual(cfg, { order: ['a', 'b'], defaultId: '' });
});

test('parsePageConfigOrder: missing or broken JSON degrades to no opinion', () => {
  assert.deepEqual(parsePageConfigOrder(undefined), { order: [], defaultId: '' });
  assert.deepEqual(parsePageConfigOrder('{not json'), { order: [], defaultId: '' });
  assert.deepEqual(parsePageConfigOrder('{"variants":"nope"}'), { order: [], defaultId: '' });
});

test('orderVariants: the recorded default comes first', () => {
  const nodes = [variant('a', 'A'), variant('b', 'B'), variant('c', 'C')];
  const out = orderVariants(nodes, { order: ['a', 'b', 'c'], defaultId: 'c' });
  assert.deepEqual(out.map(n => n.ref?.id), ['c', 'a', 'b']);
});

test('orderVariants: a dangling config entry is skipped, not fetched', () => {
  // Measured: `variants[]` named 3 nodes on staging that no longer exist.
  const nodes = [variant('a', 'A'), variant('c', 'C')];
  const out = orderVariants(nodes, { order: ['a', 'gone', 'c'], defaultId: '' });
  assert.deepEqual(out.map(n => n.ref?.id), ['a', 'c']);
});

test('orderVariants: a variant the config never listed still survives, at the end', () => {
  const nodes = [variant('a', 'A'), variant('orphan', 'O'), variant('b', 'B')];
  const out = orderVariants(nodes, { order: ['b', 'a'], defaultId: '' });
  assert.deepEqual(out.map(n => n.ref?.id), ['b', 'a', 'orphan']);
});

test('orderVariants: no config at all keeps the repository order', () => {
  const nodes = [variant('a', 'A'), variant('b', 'B')];
  const out = orderVariants(nodes, { order: [], defaultId: '' });
  assert.deepEqual(out.map(n => n.ref?.id), ['a', 'b']);
});

// ── the rule applied to a real resolution ───────────────────────────────────

/** A collection whose page-config folder holds three variants in child order a,b,c. */
function installPage(pageConfig: unknown | undefined) {
  return installFetchMock((url) => {
    if (url.includes('/nodes/-home-/coll-1/metadata')) {
      return { json: { node: makeNode('coll-1', 'Optik', {
        'cclom:title': ['Optik'],
        'ccm:page_config_ref': [REF('cfg-1')],
      }) } };
    }
    if (url.includes('/nodes/-home-/cfg-1/children')) {
      return { json: { nodes: [variant('a', 'Erste'), variant('b', 'Zweite'), variant('c', 'Dritte')] } };
    }
    if (url.includes('/nodes/-home-/cfg-1/metadata')) {
      return { json: { node: makeNode('cfg-1', 'Config', {
        ...(pageConfig ? { 'ccm:page_config': [JSON.stringify(pageConfig)] } : {}),
      }) } };
    }
    return { json: {} };
  });
}

test('get_topic_page_content renders the variant the page marks as default', async () => {
  const mock = installPage({ variants: [REF('c'), REF('a'), REF('b')], default: REF('c') });
  try {
    const { structure } = await getTopicPageContent({ collectionId: 'coll-1' });
    assert.equal(structure?.variantId, 'c');
    assert.equal(structure?.swimlanes[0]?.heading, 'Dritte');
  } finally {
    mock.restore();
  }
});

test('get_topic_page_content falls back to the config order when no default is recorded', async () => {
  const mock = installPage({ variants: [REF('b'), REF('a'), REF('c')] });
  try {
    const { structure } = await getTopicPageContent({ collectionId: 'coll-1' });
    assert.equal(structure?.variantId, 'b', 'variants[0], not children[0]');
  } finally {
    mock.restore();
  }
});

test('get_topic_page_content keeps the child order when the folder has no page config', async () => {
  const mock = installPage(undefined);
  try {
    const { structure } = await getTopicPageContent({ collectionId: 'coll-1' });
    assert.equal(structure?.variantId, 'a');
  } finally {
    mock.restore();
  }
});

test('a single-variant page is not charged an extra read for the config', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/nodes/-home-/coll-1/metadata')) {
      return { json: { node: makeNode('coll-1', 'Optik', {
        'cclom:title': ['Optik'],
        'ccm:page_config_ref': [REF('cfg-1')],
      }) } };
    }
    if (url.includes('/nodes/-home-/cfg-1/children')) return { json: { nodes: [variant('a', 'Erste')] } };
    if (url.includes('/nodes/-home-/cfg-1/metadata')) {
      throw new Error('the page config must not be read when there is only one variant');
    }
    return { json: {} };
  });
  try {
    const { structure } = await getTopicPageContent({ collectionId: 'coll-1' });
    assert.equal(structure?.variantId, 'a');
    assert.equal(mock.calls.filter(c => c.url.includes('cfg-1/metadata')).length, 0);
  } finally {
    mock.restore();
  }
});

test('a variant in a SUPERSEDED page-config folder is never marked as the rendering one', async () => {
  // Found live 2026-08-07: one production collection holds three page-config
  // folders and its `ccm:page_config_ref` names only one of them. Marking the
  // first variant of each folder as "the one the page shows" claimed three
  // rendering variants for a page that has one. The page still gets listed —
  // dropping superseded folders would lose pages whose only folder is one.
  const mock = installFetchMock((url) => {
    if (url.includes('/queries/-home-/mds_oeh/page_variant')) {
      return { json: { nodes: [
        makeNode('var-live', 'PAGE_VARIANT_live', { 'virtual:primaryparent_nodeid': [REF('cfg-live')] }),
        makeNode('var-old', 'PAGE_VARIANT_old', { 'virtual:primaryparent_nodeid': [REF('cfg-old')] }),
      ] } };
    }
    const cfg = /(cfg-\w+)\/metadata/.exec(url);
    if (cfg) {
      return { json: { node: makeNode(cfg[1], 'Config', {
        'virtual:primaryparent_nodeid': [REF('coll-1')],
      }) } };
    }
    if (url.includes('coll-1/metadata')) {
      return { json: { node: makeNode('coll-1', 'Optik', {
        'cclom:title': ['Optik'],
        'ccm:page_config_ref': [REF('cfg-live')],   // cfg-old is superseded
      }) } };
    }
    return { json: {} };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_topic_pages',
      arguments: { outputFormat: 'json', maxResults: 5 },
    });
    const parsed = JSON.parse(toolText(result).split('\n')[0]);
    assert.equal(parsed.total, 1, 'both folders belong to one Themenseite');
    const flags = Object.fromEntries(
      parsed.results[0].variants.map((v: { variantId: string; isDefault: boolean }) => [v.variantId, v.isDefault]),
    );
    assert.deepEqual(flags, { 'var-live': true, 'var-old': false });
  } finally {
    await client.close();
    mock.restore();
  }
});

test('search_wlo_topic_pages marks the rendering variant with isDefault', async () => {
  const mock = installPage({ variants: [REF('c'), REF('a'), REF('b')], default: REF('c') });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_topic_pages',
      arguments: { collectionId: 'coll-1', outputFormat: 'json', mergeVariants: true },
    });
    const parsed = JSON.parse(toolText(result).split('\n')[0]);
    assert.equal(parsed.results[0].variants[0].variantId, 'c',
      'the merged entry leads with the variant the page shows');
    assert.equal(parsed.results[0].variants[0].isDefault, true);
    assert.equal(parsed.results[0].variants[1].isDefault, false);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('includeContent does not guess a variant when none is known to be the rendered one', async () => {
  // Measured live 2026-08-07: a production collection holds several page-config
  // folders and the ACTIVE one was not among those the listing resolved, so no
  // variant carried isDefault. Passing variants[0] anyway made
  // get_topic_page_content render a SUPERSEDED copy of the page. Without a
  // variantId the resolver walks collection → ccm:page_config_ref → default,
  // which is the authoritative chain.
  const asked: string[] = [];
  const mock = installFetchMock((url) => {
    if (url.includes('/queries/-home-/mds_oeh/page_variant')) {
      return { json: { nodes: [
        makeNode('var-stale', 'PAGE_VARIANT_stale', { 'virtual:primaryparent_nodeid': [REF('cfg-stale')] }),
      ] } };
    }
    if (url.includes('cfg-stale/metadata')) {
      return { json: { node: makeNode('cfg-stale', 'Config', {
        'virtual:primaryparent_nodeid': [REF('coll-1')],
      }) } };
    }
    if (url.includes('coll-1/metadata')) {
      asked.push(url);
      return { json: { node: makeNode('coll-1', 'Optik', {
        'cclom:title': ['Optik'],
        'ccm:page_config_ref': [REF('cfg-live')],   // NOT the folder we resolved
      }) } };
    }
    if (url.includes('cfg-live/children')) {
      return { json: { nodes: [variant('v-live', 'Aktuelle Fassung')] } };
    }
    if (url.includes('cfg-live/metadata')) return { json: { node: makeNode('cfg-live', 'Config') } };
    if (url.includes('var-stale/metadata')) {
      throw new Error('the superseded variant must not be resolved as the page content');
    }
    return { json: {} };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_topic_pages',
      arguments: { outputFormat: 'json', maxResults: 5, includeContent: true },
    });
    const parsed = JSON.parse(toolText(result).split('\n')[0]);
    assert.equal(parsed.results[0].variants.some((v: { isDefault: boolean }) => v.isDefault), false,
      'no variant is known to be the rendered one');
    assert.equal(parsed.results[0].content?.variantId, 'v-live',
      'the content comes from the collection walk, not from the superseded variant');
  } finally {
    await client.close();
    mock.restore();
  }
});
