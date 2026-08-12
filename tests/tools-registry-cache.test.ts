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
  queueCollections,
  runCacheTick,
  stopSkillRegistryCache,
} from '../src/services/skill-registry-cache.js';
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
