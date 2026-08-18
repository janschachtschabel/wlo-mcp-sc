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
import { DESCRIPTIONS_ONLY_NOTE } from '../src/formatter.js';
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
      assert.ok(text.includes(DESCRIPTIONS_ONLY_NOTE),
        `${tool} lists skill titles, so it must say the instructions are not among them`);
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
      assert.ok(text.includes(DESCRIPTIONS_ONLY_NOTE),
        `${tool} lists skill titles, so it must say the instructions are not among them`);
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
      assert.ok(!text.includes(DESCRIPTIONS_ONLY_NOTE),
        'and with no skill nodeId printed, "load it with get_skill" would name ids this answer lacks');
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

// ── skillContext an den Sammlungs-Werkzeugen ─────────────────────────────────

/**
 * `skillContext` costs ONE live lookup (2 upstream calls, ~1.0–1.4 s), because
 * the cache holds the summary and not the editors' prose. That is opt-in and
 * bounded, and it is still cheaper than the round trip it replaces — the
 * alternative, `get_skill_registry`, pays the same two calls plus one metadata
 * read per skill.
 */

const OUTLINED_MD = [
  '# Skillkatalog Optik',
  '',
  'Allgemeine Vorrede der Redaktion.',
  '',
  '::: ki-skill',
  '[Lehrprofil](https://repo.example/edu-sharing/components/render/00000009-0000-4000-8000-000000000000)',
  ':::',
  '',
  '## Browserplugin',
  '',
  'Anweisung fuer das Browserplugin.',
  '',
  '## Redaktionsumgebung',
  '',
  'Zuerst den Bestand sichten, dann kuratieren.',
  '',
  '::: ki-skill',
  '[Vertretungsstunde](https://repo.example/edu-sharing/components/render/00000008-0000-4000-8000-000000000000)',
  ':::',
].join('\n');

function outlinedCollectionMock(markdown = OUTLINED_MD, collection = 'coll-1') {
  return installFetchMock((url): MockResult => {
    if (url.includes('/eduservlet/download')) return { text: markdown };
    if (url.includes(`/${collection}/children`)) {
      return { json: { nodes: [registryChild()], pagination: { total: 1, from: 0, count: 1 } } };
    }
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
}

test('subjectRegistryText: a matched context narrows the block and carries the instruction', async () => {
  const mock = outlinedCollectionMock();
  try {
    const text = await subjectRegistryText('coll-1', 'Redaktionsumgebung');

    assert.match(text, /Redaktionsumgebung/, 'the block names the context it is about');
    assert.match(text, /Vertretungsstunde/, 'its skill');
    assert.match(text, /Lehrprofil/, 'plus the ones that apply always');
    assert.match(text, /Zuerst den Bestand sichten/, 'and the editors instruction for that context');
    assert.match(text, /Allgemeine Vorrede/, 'together with the general one, which governs everywhere');
    assert.ok(!text.includes('Anweisung fuer das Browserplugin'), 'and nothing from the other context');
  } finally { mock.restore(); }
});

test('subjectRegistryText: the instruction is marked as repository content, not as an order', async () => {
  const mock = outlinedCollectionMock();
  try {
    const text = await subjectRegistryText('coll-1', 'Redaktionsumgebung');
    assert.match(text, /kuratierter Inhalt|keine System-Anweisung/i,
      'an instruction is meant to be followed — so it must say whose it is');
  } finally { mock.restore(); }
});

test('subjectRegistryText: a long instruction is capped rather than pasted whole', async () => {
  const long = OUTLINED_MD.replace('Zuerst den Bestand sichten, dann kuratieren.',
    'Wort '.repeat(600).trim());
  const mock = outlinedCollectionMock(long);
  try {
    const text = await subjectRegistryText('coll-1', 'Redaktionsumgebung');
    assert.ok(text.length < 2500, `a collection hit must not carry 3 kB of prose, got ${text.length}`);
  } finally { mock.restore(); }
});

test('subjectRegistryText: an unknown context still answers in full and names the ones that exist', async () => {
  const mock = outlinedCollectionMock();
  try {
    const text = await subjectRegistryText('coll-1', 'Klassenfahrt');

    assert.match(text, /Klassenfahrt/, 'it says which name did not match');
    assert.match(text, /Browserplugin/);
    assert.match(text, /Redaktionsumgebung/);
    assert.match(text, /Vertretungsstunde/, 'and the catalogue is complete');
    assert.match(text, /Lehrprofil/);
    assert.ok(!/Zuerst den Bestand sichten/.test(text),
      'but no instruction — a mistyped name must not trigger the most expensive answer');
  } finally { mock.restore(); }
});

test('subjectRegistryText: without a context nothing changes and nothing is fetched live', async () => {
  // The cheap path stays the cheap path: the cache answers, and the block looks
  // exactly as it did before this parameter existed.
  const mock = outlinedCollectionMock();
  try {
    await warm();
    const text = await subjectRegistryText('coll-1');
    assert.match(text, /Für die angefragte Sammlung coll-1/);
    assert.ok(!/Zuerst den Bestand sichten/.test(text), 'no instruction without an explicit ask');
  } finally { mock.restore(); }
});

test('subjectRegistryText: a collection without a registry stays silent, context or not', async () => {
  const mock = installFetchMock((): MockResult =>
    ({ json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } }));
  try {
    assert.equal(await subjectRegistryText('coll-9', 'Planung'), '');
  } finally { mock.restore(); }
});

test('the five collection tools take skillContext, and the search tools deliberately do not', async () => {
  // Per registry, context names are a different vocabulary. One parameter over
  // five collections at once would hit in one and miss in another, meaning
  // something different per row — so the search tools hand over the INDEX from
  // which a model learns the names, and the targeted call follows.
  const mock = outlinedCollectionMock();
  try {
    const client = await connectedClient();
    const tools = new Map((await client.listTools()).tools.map(t => [t.name, t]));
    const has = (n: string) => Object.keys(
      (tools.get(n)?.inputSchema as { properties?: Record<string, unknown> })?.properties ?? {},
    ).includes('skillContext');

    for (const n of ['get_collection_contents', 'search_wlo_within_collection', 'get_node_details',
      'get_topic_page_content', 'get_related_content']) {
      assert.ok(has(n), `${n} must accept skillContext`);
    }
    for (const n of ['search_wlo_collections', 'search_wlo_all', 'browse_collection_tree',
      'get_subject_portals', 'search_wlo_topic_pages']) {
      assert.ok(!has(n), `${n} must NOT accept skillContext`);
    }
  } finally { mock.restore(); }
});

test('get_collection_contents passes skillContext through to the block', async () => {
  const mock = outlinedCollectionMock();
  try {
    const client = await connectedClient();
    const text = toolText(await client.callTool({
      name: 'get_collection_contents',
      arguments: { nodeId: 'coll-1', skillContext: 'Redaktionsumgebung' },
    }));
    assert.match(text, /Zuerst den Bestand sichten/, 'the instruction reached the answer');
  } finally { mock.restore(); }
});

test('subjectRegistryText: a matched context drops the outline, a miss keeps it', async () => {
  // Grouping by the full outline in a narrowed answer prints a context name with
  // the DOCUMENT's count and none of its skills beneath it — "Material (3)" over
  // an empty group. A caller who named one context does not need the others; a
  // caller who got the name wrong needs exactly them.
  const mock = outlinedCollectionMock();
  try {
    const hit = await subjectRegistryText('coll-1', 'Redaktionsumgebung');
    assert.ok(!hit.includes('Kontext: Browserplugin'), 'the other context is not grouped in');

    const miss = await subjectRegistryText('coll-1', 'Klassenfahrt');
    assert.match(miss, /Browserplugin/, 'but a miss shows every name there is');
  } finally { mock.restore(); }
});

/** A SEPARATE collection whose registry has no headings at all. */
const FLAT_MD = [
  '# Skillkatalog',
  '',
  'Allgemeine Vorrede.',
  '',
  '::: ki-skill',
  '[Stunde planen](https://repo.example/edu-sharing/components/render/00000001-0000-4000-8000-000000000000)',
  ':::',
].join('\n');

function flatCollectionMock() {
  return installFetchMock((url): MockResult => {
    if (url.includes('/eduservlet/download')) return { text: FLAT_MD };
    if (url.includes('/coll-flat/children')) {
      return { json: { nodes: [registryChild()], pagination: { total: 1, from: 0, count: 1 } } };
    }
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
}

test('subjectRegistryText: "all" is an ask that lands, not a context that missed', async () => {
  // `all` is the documented way to say "everything", so an answer claiming it
  // "konnte nicht greifen" is false about a correct call — and teaches a model
  // to distrust the one value that always works. `get_skill_registry` excused
  // the reserved word; this surface re-derived the same rule and forgot to.
  const mock = flatCollectionMock();
  try {
    for (const wanted of ['all', 'All', ' ALL ']) {
      const text = await subjectRegistryText('coll-flat', wanted);
      assert.ok(!/konnte nicht greifen|gliedert sich nicht in Kontexte/.test(text),
        `${JSON.stringify(wanted)} must not be reported as a failed context`);
      assert.match(text, /Stunde planen/, 'and it still answers with the whole catalogue');
    }
  } finally { mock.restore(); }
});

test('subjectRegistryText: a name that cannot land on a flat registry still says so', async () => {
  const mock = flatCollectionMock();
  try {
    const text = await subjectRegistryText('coll-flat', 'Planung');
    assert.match(text, /gliedert sich nicht in Kontexte/, 'the caller learns why the name did nothing');
    assert.match(text, /Stunde planen/, 'and gets everything, as always on a miss');
  } finally { mock.restore(); }
});

test('subjectRegistryText: "all" still triggers no live REGISTRY lookup', async () => {
  // The live path exists because the cache holds the SUMMARY and not the
  // editors' prose. `all` needs no prose, so re-reading the document for it is
  // the cost this whole package exists to avoid.
  //
  // Since 2026-08-18 the overview DOES pay for the first few descriptions (the
  // user's decision), so this no longer asserts "no calls at all" — what it
  // still guards is that `all` does not fall down the document path.
  const { mock } = toolMock();
  try {
    await warm();
    const before = mock.calls.filter(c => /children|download/.test(c.url)).length;
    const text = await subjectRegistryText('coll-1', 'all');
    const after = mock.calls.filter(c => /children|download/.test(c.url)).length;
    assert.equal(after, before, 'the cached catalogue answers it — no re-read of the document');
    assert.match(text, /Für die angefragte Sammlung coll-1/);
  } finally { mock.restore(); }
});

test('subjectRegistryText: the two instruction levels stay apart, each named', async () => {
  // They used to be joined with a space, so a reader could not tell where the
  // general part ended and the context's own began — the levels are written by
  // the editors as separate sections and must not arrive as one paragraph.
  const mock = outlinedCollectionMock();
  try {
    const text = await subjectRegistryText('coll-1', 'Redaktionsumgebung');
    const general = text.split('\n').find(l => l.includes('Allgemeine Vorrede'));
    const own = text.split('\n').find(l => l.includes('Zuerst den Bestand sichten'));

    assert.ok(general && own, 'both instructions are there');
    assert.notEqual(general, own, 'and they are NOT the same line');
    assert.match(general, /^Allgemein/, 'the general one says it applies everywhere');
    assert.match(own, /^Kontext/, 'the context one names its context');
    assert.ok(own.includes('Redaktionsumgebung'), 'by name');
    // The label belongs to the line it introduces: a general instruction that
    // arrived under the context label would assert editorial intent nobody wrote.
    assert.ok(!general.includes('Zuerst den Bestand sichten'));
    assert.ok(!own.includes('Allgemeine Vorrede'));
  } finally { mock.restore(); }
});

test('subjectRegistryText: a named context also carries what each skill is FOR', async () => {
  // The overview is title+nodeId only and costs no metadata call — that is the
  // cheap tier's contract. A NAMED context is already a live read of one
  // collection, so it can afford one head per skill it will actually show.
  // Keywords stay out by decision: they are the longest field and the
  // description answers "is this the one I want".
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/eduservlet/download')) return { text: OUTLINED_MD };
    if (url.includes('/coll-1/children')) {
      return { json: { nodes: [registryChild()], pagination: { total: 1, from: 0, count: 1 } } };
    }
    const meta = /-home-\/([^/]+)\/metadata/.exec(url);
    if (meta) {
      return { json: { node: makeNode(meta[1], 'Titel ' + meta[1], {
        'cclom:general_description': ['Wofuer dieser Skill da ist.'],
        'cclom:general_keyword': ['ein-schlagwort', 'noch-eins'],
      }) } };
    }
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
  try {
    const text = await subjectRegistryText('coll-1', 'Redaktionsumgebung');
    assert.match(text, /Wofuer dieser Skill da ist\./, 'the description of a shown skill');
    assert.ok(!text.includes('ein-schlagwort'), 'keywords deliberately stay out');

    const meta = mock.calls.filter(c => c.url.includes('/metadata')).length;
    assert.ok(meta > 0 && meta <= 3, `one head per SHOWN skill, not per declared one; got ${meta}`);
  } finally { mock.restore(); }
});

test('subjectRegistryText: the overview is bounded to three metadata reads, never the whole registry', async () => {
  // Written on 2026-08-17 as "costs no metadata call" and rewritten on 2026-08-18
  // when the user asked for descriptions here too. The number changed; the thing
  // it guards did not — that this surface cannot turn into one read per declared
  // skill. `DESCRIBED_MAX` is the whole reason it is affordable.
  const mock = outlinedCollectionMock();
  try {
    await subjectRegistryText('coll-1');
    const reads = mock.calls.filter(c => c.url.includes('/metadata')).length;
    assert.ok(reads <= 3, `at most three reads for one collection, got ${reads}`);
  } finally { mock.restore(); }
});

test('subjectRegistryText: every description line is indented, including the first', async () => {
  // `capText` trims, so leading spaces baked in BEFORE the cap are lost on the
  // first line only — which made it look like a heading with a sub-list under
  // it. Indentation carries meaning in this block: flush left reads as a
  // statement about the record above.
  const mock = installFetchMock((url) => {
    if (url.includes('/eduservlet/download')) return { text: OUTLINED_MD };
    if (url.includes('/coll-1/children')) {
      return { json: { nodes: [registryChild()], pagination: { total: 1, from: 0, count: 1 } } };
    }
    const meta = /-home-\/([^/]+)\/metadata/.exec(url);
    if (meta) {
      return { json: { node: makeNode(meta[1], 'Titel ' + meta[1], {
        'cclom:general_description': ['Wofuer dieser Skill da ist.'],
      }) } };
    }
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
  try {
    const text = await subjectRegistryText('coll-1', 'Redaktionsumgebung');
    const body = text.split('\n').filter(l => l.includes('Wofuer dieser Skill da ist.'));
    assert.ok(body.length >= 2, 'more than one description is shown');
    for (const l of body) assert.match(l, /^ {2}\S/, `indented: ${JSON.stringify(l.slice(0, 30))}`);
  } finally { mock.restore(); }
});

// ── Descriptions in the plain overview (2026-08-18, the user's decision) ─────

/** Five skills, so the top-3 cap has something to cut. */
const FIVE_MD = [
  '# Katalog',
  '',
  'Vorrede.',
  '',
  ...[1, 2, 3, 4, 5].flatMap(n => [
    '::: ki-skill',
    `[Skill ${n}](https://repo.example/edu-sharing/components/render/0000000${n}-0000-4000-8000-000000000000)`,
    ':::',
    '',
  ]),
].join('\n');

/** `unreadable` names a node id whose metadata read answers 404. */
function fiveSkillMock(collection: string, unreadable = '') {
  return installFetchMock((url) => {
    if (url.includes('/eduservlet/download')) return { text: FIVE_MD };
    if (url.includes(`/${collection}/children`)) {
      return { json: { nodes: [registryChild()], pagination: { total: 1, from: 0, count: 1 } } };
    }
    const meta = /-home-\/([^/]+)\/metadata/.exec(url);
    if (meta) {
      if (unreadable && meta[1] === unreadable) return { status: 404, json: {} };
      return { json: { node: makeNode(meta[1], `Titel ${meta[1]}`, {
        'cclom:general_description': [`Wozu ${meta[1]} da ist.`],
      }) } };
    }
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
}

test('subjectRegistryText: the plain overview carries descriptions too', async () => {
  const mock = fiveSkillMock('coll-desc');
  try {
    const text = await subjectRegistryText('coll-desc');
    assert.match(text, /Wozu die Skills da sind/, 'the block is there without a context');
    assert.match(text, /Wozu 00000001-0000-4000-8000-000000000000 da ist\./);
  } finally { mock.restore(); }
});

test('subjectRegistryText: only the first three are described, and only three are fetched', async () => {
  // The cap is what makes this affordable on a registry of any size: a hundred
  // declared skills must not become a hundred metadata reads per answer.
  const mock = fiveSkillMock('coll-cap');
  try {
    const text = await subjectRegistryText('coll-cap');
    for (const n of [1, 2, 3]) {
      assert.match(text, new RegExp(`Wozu 0000000${n}-`), `skill ${n} is described`);
    }
    for (const n of [4, 5]) {
      assert.ok(!text.includes(`Wozu 0000000${n}-`), `skill ${n} keeps title and nodeId only`);
      assert.ok(text.includes(`0000000${n}-0000-4000-8000-000000000000`), `but is still listed`);
    }
    assert.equal(mock.calls.filter(c => c.url.includes('/metadata')).length, 3,
      'three reads, not five');
  } finally { mock.restore(); }
});

test('subjectRegistryText: a skill we just learned is unreadable is not offered for loading', async () => {
  // We paid for the head, so we KNOW. Still printing "laden mit get_skill" next
  // to it promises a call that answers "nicht abrufbar" — the disclosure also
  // says how far the check reached, because the cap means it did not cover all.
  const mock = fiveSkillMock('coll-403', '00000002-0000-4000-8000-000000000000');
  try {
    const text = await subjectRegistryText('coll-403');
    assert.match(text, /Nicht abrufbar/, 'the finding is stated');
    assert.match(text, /00000002-0000-4000-8000-000000000000/, 'by nodeId');
    assert.match(text, /ersten 3|erste 3/, 'and says how far the check reached');
  } finally { mock.restore(); }
});

// ── Always the general instruction; a hit keeps the shape (2026-08-18) ──────

test('subjectRegistryText: the overview carries the general instruction too', async () => {
  // The catalogue is meant to hang on every collection/topic-page answer WITH
  // the general skills AND the words that govern them. It comes from the cache,
  // not from a live read: the document costs ~1.5 s and the overview is 0.3 s.
  const mock = outlinedCollectionMock(OUTLINED_MD, 'coll-general');
  try {
    const text = await subjectRegistryText('coll-general');
    assert.match(text, /Allgemeine Vorrede/, 'the general instruction is attached');
    assert.match(text, /Allgemein \(gilt in jedem Kontext\)/, 'labelled as the general level');
    assert.ok(!text.includes('Anweisung fuer das Browserplugin'),
      'but no context prose — that is what naming a context is for');
  } finally { mock.restore(); }
});

test('subjectRegistryText: a matched context keeps the always-valid skills apart', async () => {
  // Previously the narrowed list was flat, so a reader could not tell which
  // skill belonged to the context and which applies everywhere — while
  // get_skill_registry made exactly that distinction.
  const mock = outlinedCollectionMock(OUTLINED_MD, 'coll-apart');
  try {
    const text = await subjectRegistryText('coll-apart', 'Redaktionsumgebung');
    const lines = text.split('\n');
    const ctxAt = lines.findIndex(l => /Kontext: Redaktionsumgebung/.test(l));
    const alwaysAt = lines.findIndex(l => /gilt immer/.test(l));
    const skillAt = lines.findIndex(l => /Vertretungsstunde/.test(l));

    assert.ok(ctxAt >= 0, 'the matched context is named as a group');
    assert.ok(alwaysAt > ctxAt, 'the always-valid block follows it');
    assert.ok(skillAt > ctxAt && skillAt < alwaysAt, 'its own skill sits under the context');
    assert.match(lines[alwaysAt], /Lehrprofil|\(1\)/, 'and the always-block has its own count');
  } finally { mock.restore(); }
});

test('subjectRegistryText: a matched context still names the other contexts', async () => {
  // So a second, more precise get_skill_registry call is possible without first
  // asking again without a context.
  const mock = outlinedCollectionMock(OUTLINED_MD, 'coll-others');
  try {
    const text = await subjectRegistryText('coll-others', 'Redaktionsumgebung');
    assert.match(text, /Weitere Kontexte/, 'the other names are offered');
    assert.match(text, /Browserplugin/, 'by name');
    assert.ok(!text.includes('Anweisung fuer das Browserplugin'),
      'names only — their prose stays out');
  } finally { mock.restore(); }
});

/** Two H3 with the SAME title under different H2 — the ambiguous shape. */
const NESTED_MD = [
  '# Katalog',
  '',
  'Vorrede.',
  '',
  '## Planung',
  '',
  '### Material',
  '',
  '::: ki-skill',
  '[Planungsmaterial](https://repo.example/edu-sharing/components/render/00000011-0000-4000-8000-000000000000)',
  ':::',
  '',
  '## Pruefung',
  '',
  '### Material',
  '',
  '::: ki-skill',
  '[Pruefmaterial](https://repo.example/edu-sharing/components/render/00000012-0000-4000-8000-000000000000)',
  ':::',
].join('\n');

test('subjectRegistryText: EVERY context name it offers is one that lands', async () => {
  // The round trip is the point, and it has to cover every name — the first one
  // offered here is an H2 whose bare heading is unique, so checking only that
  // one passes while a sub-context's bare heading ("Material" under two
  // parents) comes back AMBIGUOUS: a recommendation that cannot be followed.
  const mock = outlinedCollectionMock(NESTED_MD, 'coll-nested');
  try {
    const first = await subjectRegistryText('coll-nested', 'Planung/Material');
    const line = first.split('\n').find(l => l.startsWith('Weitere Kontexte'));
    assert.ok(line, `a "Weitere Kontexte" line is there: ${JSON.stringify(first.slice(-300))}`);

    const offered = line
      .replace(/^Weitere Kontexte in dieser Registry: /, '')
      .split(' \u2014 ')[0]
      .split(' \u00b7 ')
      .map(s => (s.lastIndexOf(' (') > 0 ? s.slice(0, s.lastIndexOf(' (')) : s).trim())
      .filter(Boolean);
    assert.ok(offered.length >= 2, `several names are offered, got ${JSON.stringify(offered)}`);

    for (const name of offered) {
      const back = await subjectRegistryText('coll-nested', name);
      assert.ok(!back.includes('mehrdeutig'), `"${name}" must not come back as ambiguous`);
      assert.ok(!back.includes('kommt in dieser Registry nicht vor'), `"${name}" must be known`);
    }
  } finally { mock.restore(); }
});
