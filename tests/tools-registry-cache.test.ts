/**
 * tools-registry-cache.test.ts – every path that renders collections carries the
 * catalogue the cache already knows, and pays nothing for it.
 *
 * The rule these pin: `attachCachedRegistries` is not a search feature. A model
 * that reached a collection through `get_collection_contents` or
 * `get_node_collections` is exactly as likely to want its approved skills — and
 * with a warm cache the answer is a map lookup, so there is no cost to weigh.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ensureRegistryFor,
  queueCollections,
  queueLength,
  runCacheTick,
  stopSkillRegistryCache,
} from '../src/services/skill-registry-cache.js';
import { subjectRegistryText } from '../src/tools/shared.js';
import { REGISTRY_CONTENT_TYPE_URI } from '../src/services/skill-catalogue.js';
import { connectedClient, installFetchMock, makeNode, toolText, type MockResult } from './fetchMock.js';

const SKILL_A = '00000001-0000-4000-8000-000000000000';
const REGISTRY_MD =
  `::: ki-skill\n[Fragen generieren](https://repo.example/edu-sharing/components/render/${SKILL_A})\n:::`;

/** A real `ccm:map` — `makeNode` builds a `ccm:io`, which formats as content. */
function collectionNode(id: string, title: string) {
  return { ...makeNode(id, title), type: 'ccm:map', isDirectory: true };
}

function registryChild() {
  return {
    ...makeNode('reg-1', 'Skill Registry Optik', {
      'cm:name': ['SKILL_REGISTRY.md'], 'ccm:oeh_extendedType': [REGISTRY_CONTENT_TYPE_URI],
    }),
    mimetype: 'text/x-web-markdown',
    mediatype: 'file-markdown',
  };
}

/**
 * Every endpoint the four tools touch, with `coll-1` as the collection that
 * carries a registry.
 *
 * `counts.children` deliberately counts ONLY `coll-1`'s listing. `searchAll`
 * makes a `/children` call on its own account — the topic-page leg lists the
 * root portals — so a blanket counter measures that too and says nothing about
 * what the registry lookup cost. (Same trap the enrichment tests documented on
 * 2026-08-10.)
 */
function toolMock() {
  const counts = { children: 0 };
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/eduservlet/download')) return { text: REGISTRY_MD };
    if (url.includes('/coll-1/children')) {
      counts.children++;
      return { json: { nodes: [registryChild()], pagination: { total: 1, from: 0, count: 1 } } };
    }
    if (url.includes('/children')) {
      // Any OTHER collection: one sub-collection (`coll-1`) and no files, so
      // `get_collection_contents` renders a collection rather than the registry
      // document itself.
      return { json: {
        nodes: url.includes('filter=folders') ? [collectionNode('coll-1', 'Sammlung Optik')] : [],
        pagination: { total: 1, from: 0, count: 1 },
      } };
    }
    // Checked BEFORE `/collections`: the usage URL ends in `/collections` too,
    // so the looser pattern swallows it and the tool sees a node listing where
    // it expects a usage array.
    if (url.includes('/usage/')) {
      return { json: [{ collectionUsageType: 'ACTIVE', collection: collectionNode('coll-1', 'Sammlung Optik') }] };
    }
    if (url.includes('/collections')) return { json: { nodes: [collectionNode('coll-1', 'Sammlung Optik')] } };
    if (url.includes('/ngsearch')) {
      return { json: { nodes: [makeNode('c-1', 'Arbeitsblatt')], pagination: { total: 1, from: 0, count: 1 } } };
    }
    if (url.includes('/metadata')) return { json: { node: collectionNode('coll-1', 'Sammlung Optik') } };
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
  return { mock, counts };
}

/** Warm `coll-1` through the children listing, exactly as the tick does. */
async function warm(): Promise<void> {
  queueCollections(['coll-1']);
  await runCacheTick();
}

const CASES: { tool: string; args: Record<string, unknown> }[] = [
  { tool: 'search_wlo_collections', args: { query: 'optik' } },
  { tool: 'search_wlo_all', args: { query: 'optik' } },
  { tool: 'get_collection_contents', args: { nodeId: 'parent-1', contentFilter: 'folders' } },
  { tool: 'get_node_collections', args: { nodeId: 'c-1' } },
];

for (const { tool, args } of CASES) {
  test(`${tool}: a warm collection carries its catalogue, for free`, async () => {
    stopSkillRegistryCache();
    const { mock, counts } = toolMock();
    const client = await connectedClient();
    try {
      await warm();
      const afterWarm = counts.children;

      const text = toolText(await client.callTool({ name: tool, arguments: args }));

      assert.match(text, /Skill-Registry: Skill Registry Optik/, `${tool} must carry the catalogue`);
      assert.match(text, new RegExp(SKILL_A), 'with the nodeId get_skill needs');
      assert.equal(counts.children, afterWarm, 'and must not spend a request on it');
    } finally {
      await client.close();
      mock.restore();
      stopSkillRegistryCache();
    }
  });
}

/**
 * The other half of the same rule, and the one that was missing until
 * 2026-08-15: a tool can be ABOUT a collection without ever returning it as a
 * result. `get_collection_contents` hands back that collection's materials,
 * `search_wlo_within_collection` a filtered slice of them, `get_node_details`
 * its metadata — and in all three the collection whose approved skills the
 * caller wants is the one named in the arguments, which never appears in the
 * result list at all. Attaching to the RESULTS therefore answered for everything
 * except the subject.
 */
const SUBJECT_CASES: { tool: string; args: Record<string, unknown> }[] = [
  { tool: 'get_collection_contents', args: { nodeId: 'coll-1' } },
  { tool: 'search_wlo_within_collection', args: { nodeId: 'coll-1' } },
];

for (const { tool, args } of SUBJECT_CASES) {
  test(`${tool}: the collection being worked on reports its own registry`, async () => {
    stopSkillRegistryCache();
    const { mock } = toolMock();
    const client = await connectedClient();
    try {
      await warm();
      const text = toolText(await client.callTool({ name: tool, arguments: args }));

      assert.match(text, /Skill-Registry: Skill Registry Optik/,
        `${tool} must report the registry of the collection it was called on`);
      assert.match(text, new RegExp(SKILL_A), 'with the nodeId get_skill needs');
      // WHICH collection, in words. The block lands under the last listed
      // record — a material, usually — and without this line it reads as that
      // record's registry, which is a thing that cannot exist.
      assert.match(text, /angefragte Sammlung coll-1/,
        'the block must name the collection it belongs to');
    } finally {
      await client.close();
      mock.restore();
      stopSkillRegistryCache();
    }
  });
}

test('get_node_details: a collection carries its registry on the record itself', async () => {
  // Not part of the loop above: here the collection IS the record being
  // detailed, so the catalogue belongs to it rather than beside it — no
  // "angefragte Sammlung" lead-in, and the field rides in structuredContent.
  stopSkillRegistryCache();
  const { mock } = toolMock();
  const client = await connectedClient();
  try {
    await warm();
    const result = await client.callTool({ name: 'get_node_details', arguments: { nodeId: 'coll-1' } });
    assert.match(toolText(result), /Skill-Registry: Skill Registry Optik/);
    const structured = result.structuredContent as { results: { skillRegistry?: { title: string } }[] };
    assert.equal(structured.results[0]?.skillRegistry?.title, 'Skill Registry Optik',
      'and the widget reads it from structuredContent, which zod would strip it from');
  } finally {
    await client.close();
    mock.restore();
    stopSkillRegistryCache();
  }
});

test('a subject collection without a registry is not announced as having one', async () => {
  stopSkillRegistryCache();
  const { mock } = toolMock();
  const client = await connectedClient();
  try {
    // `other-1` is served by the generic `/children` branch, which holds no
    // registry document. Silence is the answer; an empty block would read as a
    // collection that declares nothing, which is a different claim.
    //
    // `files`, not `folders`: that branch returns `coll-1` as a sub-collection,
    // and `coll-1` HAS a registry — so a folders listing legitimately prints a
    // registry line for a child and the assertion could not tell the two apart.
    const text = toolText(await client.callTool({
      name: 'get_collection_contents', arguments: { nodeId: 'other-1', contentFilter: 'files' },
    }));
    const own = text.split('\n').filter(l => l.startsWith('Skill-Registry:'));
    assert.equal(own.length, 0, `no registry for the subject collection, so no line:\n${text}`);
  } finally {
    await client.close();
    mock.restore();
    stopSkillRegistryCache();
  }
});

/**
 * The browse tools render one LINE per collection, and that shape is the whole
 * point of them — a tree where every node may unfold a hundred skills stops
 * being a tree. They carry the head line instead: title, count and the nodeId
 * `get_skill_registry` needs. And they read the cache only: 30 portals or 50
 * branches firing a children listing each is exactly the crawl the cache exists
 * to prevent, so a cold collection is queued and shows up on the next call.
 */
const BROWSE_CASES: { tool: string; args: Record<string, unknown> }[] = [
  { tool: 'browse_collection_tree', args: { nodeId: 'parent-1' } },
  { tool: 'get_subject_portals', args: {} },
];

for (const { tool, args } of BROWSE_CASES) {
  test(`${tool}: marks a collection that declares skills, without listing them`, async () => {
    stopSkillRegistryCache();
    const { mock, counts } = toolMock();
    const client = await connectedClient();
    try {
      await warm();
      const afterWarm = counts.children;

      const text = toolText(await client.callTool({ name: tool, arguments: args }));

      assert.match(text, /Skill-Registry: Skill Registry Optik/, `${tool} must mark the collection`);
      assert.match(text, /get_skill_registry/, 'and say how to read the catalogue');
      assert.ok(!text.includes(SKILL_A),
        'the entries stay out — one node is one line here');
      assert.equal(counts.children, afterWarm, 'and a broad listing spends no request on registries');
    } finally {
      await client.close();
      mock.restore();
      stopSkillRegistryCache();
    }
  });
}

test('browse_collection_tree: a cold collection is queued, not looked up', async () => {
  stopSkillRegistryCache();
  const { mock, counts } = toolMock();
  const client = await connectedClient();
  try {
    // No `warm()`: `coll-1` is unknown to the cache. The tree must come back
    // without its marker and without having paid for the answer.
    const text = toolText(await client.callTool({
      name: 'browse_collection_tree', arguments: { nodeId: 'parent-1' },
    }));
    assert.ok(!text.includes('Skill-Registry'), 'nothing is claimed about a collection nobody read');
    assert.equal(counts.children, 0, 'and the listing stays free');
  } finally {
    await client.close();
    mock.restore();
    stopSkillRegistryCache();
  }
});

/**
 * A Themenseite is a collection with a page layout, so its approved skills hang
 * off the COLLECTION id — never the variant id, which is a rendering of it.
 */
test('get_topic_page_content: the page reports the registry of its collection', async () => {
  stopSkillRegistryCache();
  const rawConfig = JSON.stringify({ structure: { swimlanes: [
    { heading: 'Einführung', type: 'container', grid: [{ item: 'ai-text' }] },
  ] } });
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/eduservlet/download')) return { text: REGISTRY_MD };
    // The registry lookup reads the collection's FILE children; the page walk
    // reads the config folder's. Two different ids, so they cannot collide.
    if (url.includes('/coll-1/children')) {
      return { json: { nodes: [registryChild()], pagination: { total: 1, from: 0, count: 1 } } };
    }
    if (url.includes('cfg-1/children') || url.includes('var-1/metadata')) {
      return { json: { nodes: [makeNode('var-1', 'Variante', { 'ccm:page_variant_config': [rawConfig] })],
        node: makeNode('var-1', 'Variante', { 'ccm:page_variant_config': [rawConfig] }) } };
    }
    if (url.includes('/metadata')) {
      return { json: { node: { ...makeNode('coll-1', 'Themenseite Optik', {
        'ccm:page_config_ref': ['workspace://SpacesStore/cfg-1'],
      }), type: 'ccm:map', isDirectory: true } } };
    }
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
  const client = await connectedClient();
  try {
    await warm();
    const text = toolText(await client.callTool({
      name: 'get_topic_page_content', arguments: { collectionId: 'coll-1' },
    }));
    assert.match(text, /Skill-Registry: Skill Registry Optik/, 'the page names its collection\'s registry');
    assert.match(text, new RegExp(SKILL_A), 'with the nodeId get_skill needs');
  } finally {
    await client.close();
    mock.restore();
    stopSkillRegistryCache();
  }
});

test('search_wlo_topic_pages: each page is marked through its COLLECTION id', async () => {
  stopSkillRegistryCache();
  const variantConfig = JSON.stringify({ structure: { swimlanes: [{ heading: 'Einführung' }] } });
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/eduservlet/download')) return { text: REGISTRY_MD };
    // The registry lives among coll-1's own FILES; the page walk reads the
    // config folder's children. Narrowing this branch keeps them apart.
    if (url.includes('/coll-1/children') && url.includes('filter=files')) {
      return { json: { nodes: [registryChild()], pagination: { total: 1, from: 0, count: 1 } } };
    }
    if (url.includes('cfg-1/children')) {
      return { json: { nodes: [makeNode('var-1', 'Variante Optik', {
        'ccm:page_variant_config': [variantConfig],
      })], pagination: { total: 1, from: 0, count: 1 } } };
    }
    if (url.includes('/metadata')) {
      return { json: { node: { ...makeNode('coll-1', 'Optik', {
        'ccm:page_config_ref': ['workspace://SpacesStore/cfg-1'],
      }), type: 'ccm:map', isDirectory: true } } };
    }
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
  const client = await connectedClient();
  try {
    await warm();
    const text = toolText(await client.callTool({
      name: 'search_wlo_topic_pages', arguments: { collectionId: 'coll-1' },
    }));
    assert.match(text, /Skill-Registry: Skill Registry Optik/,
      'a Themenseite carries the registry of the collection that owns it');
    assert.ok(!text.includes(SKILL_A), 'head line only — this listing is one block per page');
  } finally {
    await client.close();
    mock.restore();
    stopSkillRegistryCache();
  }
});

/**
 * The catalogue must not depend on which output format was asked for.
 *
 * This is the defect the review of 2026-08-15 found: both browse tools computed
 * the registries AFTER their `outputFormat === 'json'` early return, so a JSON
 * caller got nothing while a Markdown caller got the head line — and the docs
 * written in the same change promised it to both. `get_node_details` carries a
 * comment about the previous time this project paid for exactly that.
 */
const JSON_CASES: { tool: string; args: Record<string, unknown> }[] = [
  { tool: 'browse_collection_tree', args: { nodeId: 'parent-1', outputFormat: 'json' } },
  { tool: 'get_subject_portals', args: { outputFormat: 'json' } },
];

for (const { tool, args } of JSON_CASES) {
  test(`${tool}: json output carries the registry too`, async () => {
    stopSkillRegistryCache();
    const { mock } = toolMock();
    const client = await connectedClient();
    try {
      await warm();
      const result = await client.callTool({ name: tool, arguments: args });
      const payload = JSON.parse(toolText(result));
      const nodes = (payload.results ?? []) as Array<{ nodeId: string; skillRegistry?: { title: string } }>;
      const marked = nodes.find(n => n.nodeId === 'coll-1');
      assert.ok(marked, `${tool} returned no coll-1 to check`);
      assert.equal(marked.skillRegistry?.title, 'Skill Registry Optik',
        'the field must survive into the json payload');
      // structuredContent goes through zod, which strips undeclared keys — the
      // separate assertion is what proves the field is declared, not just set.
      const structured = result.structuredContent as { results: typeof nodes };
      assert.ok(structured.results.find(n => n.nodeId === 'coll-1')?.skillRegistry,
        'and into structuredContent, which zod would silently drop it from');
    } finally {
      await client.close();
      mock.restore();
      stopSkillRegistryCache();
    }
  });
}

test('subjectRegistryText: an unreadable collection is reported as unchecked, not as empty', async () => {
  stopSkillRegistryCache();
  const mock = installFetchMock((): MockResult => ({ status: 500, json: {} }));
  try {
    const text = await subjectRegistryText('coll-1');
    assert.match(text, /nicht geprüft/,
      'a failed lookup and a collection that declares nothing must not read the same');
    assert.ok(!text.includes('freigegeben sind'), 'and nothing is claimed to be approved');
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});

test('subjectRegistryText: no collection id means no sentence at all', async () => {
  // `get_topic_page_content` passes `struct.collectionId ?? ''` — a query that
  // matched nothing has no collection. "Ob die angefragte Sammlung  …" names
  // nothing and offers a `get_skill_registry` call nobody can make.
  const mock = installFetchMock((): MockResult => ({ status: 500, json: {} }));
  try {
    assert.equal(await subjectRegistryText(''), '');
  } finally {
    mock.restore();
  }
});

test('ensureRegistryFor: a lookup that learned nothing leaves the collection queued', async () => {
  stopSkillRegistryCache();
  const mock = installFetchMock((): MockResult => ({ status: 500, json: {} }));
  try {
    assert.equal(queueLength(), 0, 'clean start');
    await ensureRegistryFor('coll-1');
    assert.equal(queueLength(), 1,
      'otherwise the tick never warms it and every request repeats the live call');
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});

/**
 * `get_related_content` reaches a collection without ever listing one: with
 * `includeSiblings` it reads the seed's parent to answer "aus derselben
 * Sammlung". That parent is the only collection in play, and until 2026-08-15
 * the tool asked `registryHintFor` about its two RESULT lists instead — both of
 * which come from `FILES` queries and can never hold a collection, so the line
 * was unreachable code standing in for an answer.
 */
test('get_related_content: the sibling collection reports its registry', async () => {
  stopSkillRegistryCache();
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/eduservlet/download')) return { text: REGISTRY_MD };
    if (url.includes('/coll-1/children')) {
      return { json: { nodes: [registryChild()], pagination: { total: 1, from: 0, count: 1 } } };
    }
    if (url.includes('/ngsearch')) {
      return { json: { nodes: [makeNode('c-2', 'Verwandtes Arbeitsblatt')], pagination: { total: 1, from: 0, count: 1 } } };
    }
    if (url.includes('/metadata')) {
      return { json: { node: makeNode('c-1', 'Arbeitsblatt Brechung', {
        'virtual:primaryparent_nodeid': ['coll-1'],
      }) } };
    }
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
  const client = await connectedClient();
  try {
    await warm();
    const text = toolText(await client.callTool({
      name: 'get_related_content', arguments: { nodeId: 'c-1', includeSiblings: true },
    }));
    assert.match(text, /Skill-Registry: Skill Registry Optik/,
      'the collection the siblings came from carries approved skills');
    assert.match(text, new RegExp(SKILL_A), 'with the nodeId get_skill needs');

    // Both formats, one expression — the block is appended to each branch of
    // the same return, and the last review found the version of this defect
    // where only the Markdown branch had it.
    const json = await client.callTool({
      name: 'get_related_content', arguments: { nodeId: 'c-1', includeSiblings: true, outputFormat: 'json' },
    });
    const blocks = (json.content as { text: string }[]).map(b => b.text).join('\n');
    assert.match(blocks, /Skill-Registry: Skill Registry Optik/, 'json carries it as its own block');
    JSON.parse((json.content as { text: string }[])[0].text);   // the payload block stays parseable
  } finally {
    await client.close();
    mock.restore();
    stopSkillRegistryCache();
  }
});

test('get_related_content: a COLLECTION seed reports its own registry, not its parent\'s', async () => {
  // The tool takes "eine nodeId eines Inhalts ODER einer Sammlung". For a
  // collection seed, `virtual:primaryparent_nodeid` is the collection ABOVE it —
  // so keying the registry off the siblings' source answered about a collection
  // the caller never named.
  stopSkillRegistryCache();
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/eduservlet/download')) return { text: REGISTRY_MD };
    if (url.includes('/coll-1/children')) {
      return { json: { nodes: [registryChild()], pagination: { total: 1, from: 0, count: 1 } } };
    }
    if (url.includes('/ngsearch')) {
      return { json: { nodes: [makeNode('c-2', 'Verwandtes')], pagination: { total: 1, from: 0, count: 1 } } };
    }
    if (url.includes('/metadata')) {
      return { json: { node: { ...collectionNode('coll-1', 'Sammlung Optik'),
        properties: { 'cclom:title': ['Sammlung Optik'], 'virtual:primaryparent_nodeid': ['portal-9'] } } } };
    }
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
  const client = await connectedClient();
  try {
    await warm();
    const text = toolText(await client.callTool({
      name: 'get_related_content', arguments: { nodeId: 'coll-1', includeSiblings: true },
    }));
    assert.match(text, /angefragte Sammlung coll-1/, 'the collection named by the caller');
    assert.ok(!text.includes('portal-9'), 'not the one above it');
  } finally {
    await client.close();
    mock.restore();
    stopSkillRegistryCache();
  }
});

test('get_related_content: no siblings asked for means no collection to report', async () => {
  stopSkillRegistryCache();
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/ngsearch')) {
      return { json: { nodes: [makeNode('c-2', 'Verwandtes')], pagination: { total: 1, from: 0, count: 1 } } };
    }
    if (url.includes('/metadata')) {
      return { json: { node: makeNode('c-1', 'Arbeitsblatt', { 'virtual:primaryparent_nodeid': ['coll-1'] }) } };
    }
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
  const client = await connectedClient();
  try {
    const text = toolText(await client.callTool({
      name: 'get_related_content', arguments: { nodeId: 'c-1', includeSiblings: false },
    }));
    // Without siblings this is a question about ONE material. Naming its parent
    // collection would answer something nobody asked, and cost a lookup for it.
    assert.ok(!text.includes('Skill-Registry'), `no collection is in play here:\n${text}`);
    assert.ok(!text.includes('nicht geprüft'), 'and nothing is left hanging either');
  } finally {
    await client.close();
    mock.restore();
    stopSkillRegistryCache();
  }
});

test('search_wlo_collections: only the collections actually shown are looked up', async () => {
  stopSkillRegistryCache();
  const { mock } = toolMock();
  const client = await connectedClient();
  try {
    // Enrichment runs AFTER the maxResults cap, so the cost — here only the
    // queueing — is bounded by what the caller sees, not by what the backend
    // returned.
    const text = toolText(await client.callTool({
      name: 'search_wlo_collections',
      arguments: { query: 'optik', maxResults: 1 },
    }));
    // The lookup follows what is SHOWN, not what the backend returned: the
    // enrichment runs after the maxResults cap, so a caller asking for one
    // collection pays for one.
    assert.match(text, /Skill-Registry: Skill Registry Optik/, 'the one shown collection is resolved');
  } finally {
    await client.close();
    mock.restore();
    stopSkillRegistryCache();
  }
});
