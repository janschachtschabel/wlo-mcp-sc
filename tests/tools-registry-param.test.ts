/**
 * tools-registry-param.test.ts – the opt-in parameter that makes a search carry
 * each collection's skill registry.
 *
 * CONTRACT CHANGED 2026-08-11. The catalogue is now always in the answer:
 * from the background cache when it knows the collection, and through a bounded
 * live children listing when it does not. The parameter no longer decides
 * WHETHER the registry comes — it decides whether a FRESH lookup is forced over
 * a remembered one, which matters right after a registry is created or edited.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { stopSkillRegistryCache } from '../src/services/skill-registry-cache.js';
import { connectedClient, installFetchMock, makeNode, toolText } from './fetchMock.js';
import { REGISTRY_CONTENT_TYPE_URI } from '../src/services/skill-catalogue.js';

const SKILL_A = '00000001-0000-4000-8000-000000000000';
const REGISTRY_MD =
  `::: ki-skill\n[Fragen generieren](https://repo.example/edu-sharing/components/render/${SKILL_A})\n:::`;

/** A real `ccm:map` — `makeNode` builds a `ccm:io`, which formats as content. */
function collectionNode(id: string, title: string) {
  return { ...makeNode(id, title), type: 'ccm:map', isDirectory: true };
}

/** A collection search whose one collection carries a registry; counts the lookups. */
function searchMock() {
  const counts = { children: 0, download: 0 };
  const mock = installFetchMock((url) => {
    if (url.includes('/collections')) return { json: { nodes: [collectionNode('coll-1', 'Sammlung Optik')] } };
    if (url.includes('/ngsearch')) {
      return { json: { nodes: [makeNode('c-1', 'Arbeitsblatt')], pagination: { total: 1, from: 0, count: 1 } } };
    }
    if (url.includes('/coll-1/children')) {
      counts.children++;
      return { json: {
        nodes: [{
          ...makeNode('reg-1', 'Skill Registry Optik', {
            'cm:name': ['SKILL_REGISTRY.md'], 'ccm:oeh_extendedType': [REGISTRY_CONTENT_TYPE_URI],
          }),
          mimetype: 'text/x-web-markdown',
          mediatype: 'file-markdown',
        }],
        pagination: { total: 1, from: 0, count: 1 },
      } };
    }
    if (url.includes('/eduservlet/download')) { counts.download++; return { text: REGISTRY_MD }; }
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
  return { mock, counts };
}

for (const tool of ['search_wlo_all', 'search_wlo_collections']) {
  test(`${tool}: includeSkillRegistry delivers the registry in the same call`, async () => {
    const { mock, counts } = searchMock();
    const client = await connectedClient();
    try {
      const result = await client.callTool({
        name: tool,
        arguments: { query: 'optik', includeSkillRegistry: true },
      });
      const text = toolText(result);

      assert.notEqual(result.isError, true, `tool must not fail: ${text}`);
      assert.match(text, /Skill-Registry: Skill Registry Optik/, 'the registry is named');
      assert.match(text, /Fragen generieren/, 'and the skills it declares');
      assert.match(text, new RegExp(SKILL_A), 'with the nodeId get_skill needs');
      assert.equal(counts.children, 1, 'exactly one lookup for the one collection');
      assert.equal(counts.download, 1);
    } finally {
      await client.close();
      mock.restore();
    }
  });

  test(`${tool}: without the parameter the catalogue still arrives`, async () => {
    const { mock, counts } = searchMock();
    const client = await connectedClient();
    try {
      const text = toolText(await client.callTool({ name: tool, arguments: { query: 'optik' } }));

      // CONTRACT CHANGED 2026-08-11. This used to assert that nothing was
      // fetched without the parameter. The decision now is that the answer
      // carries the catalogue either way — the parameter only decides whether a
      // FRESH lookup is forced over a remembered one.
      assert.match(text, /Skill-Registry: Skill Registry Optik/, 'the catalogue is there');
      assert.equal(counts.children, 1, 'resolved through the fallback, once');
    } finally {
      await client.close();
      mock.restore();
      stopSkillRegistryCache();
    }
  });
}

/**
 * A `search_wlo_all` answer that fills BOTH collection-shaped buckets: one plain
 * collection and one topic page. Topic pages are `ccm:map` too, so they format
 * as `nodeType: 'collection'` — and the enrichment deliberately skips them.
 */
function composedMock(opts: { withRegistry?: boolean; childrenStatus?: number } = {}) {
  const collectionNodes = [
    collectionNode('coll-1', 'Sammlung Optik'),
    { ...collectionNode('tp-1', 'Themenseite Optik'),
      properties: { 'cclom:title': ['Themenseite Optik'], 'ccm:page_config_ref': ['workspace://SpacesStore/cfg-1'] } },
  ];
  return installFetchMock((url) => {
    if (url.includes('/collections')) return { json: { nodes: collectionNodes } };
    if (url.includes('/ngsearch')) {
      return { json: { nodes: [makeNode('c-1', 'Arbeitsblatt')], pagination: { total: 1, from: 0, count: 1 } } };
    }
    if (url.includes('/coll-1/children')) {
      if (opts.childrenStatus) return { status: opts.childrenStatus, json: {} };
      return { json: {
        nodes: opts.withRegistry === false ? [makeNode('pdf', 'Arbeitsblatt')] : [{
          ...makeNode('reg-1', 'Skill Registry Optik', {
            'cm:name': ['SKILL_REGISTRY.md'], 'ccm:oeh_extendedType': [REGISTRY_CONTENT_TYPE_URI],
          }),
          mimetype: 'text/x-web-markdown',
          mediatype: 'file-markdown',
        }],
        pagination: { total: 1, from: 0, count: 1 },
      } };
    }
    if (url.includes('/eduservlet/download')) return { text: REGISTRY_MD };
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
}

test('search_wlo_all: the pointer appears once in the whole answer, not once per bucket', async () => {
  // The listing fails, so nothing can be answered and the pointer HAS a reason
  // to appear — which is the only state in which its count is observable.
  const mock = composedMock({ childrenStatus: 503 });
  const client = await connectedClient();
  try {
    const text = toolText(await client.callTool({ name: 'search_wlo_all', arguments: { query: 'optik' } }));

    // The answer is composed of three rendered lists. Topic pages are
    // collections too, so a hint emitted per list fires twice for one answer.
    const hints = text.split('\n').filter(l => l.includes('nicht geprüft'));
    assert.equal(hints.length, 1, `one hint for the whole answer — got ${hints.length}`);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('search_wlo_all: a check that found nothing is not reported as "not checked"', async () => {
  const mock = composedMock({ withRegistry: false });
  const client = await connectedClient();
  try {
    const text = toolText(await client.callTool({
      name: 'search_wlo_all',
      arguments: { query: 'optik', includeSkillRegistry: true },
    }));

    // A collection without a registry carries no field at all, so the field
    // cannot tell "not looked up" from "looked up, none there". The caller
    // ASKED — repeating "nicht geprüft" is then simply false.
    assert.ok(!text.includes('nicht geprüft'), `the question was answered — got ${JSON.stringify(text)}`);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('search_wlo_collections: an answered question is not asked again', async () => {
  const mock = composedMock({ withRegistry: false });
  const client = await connectedClient();
  try {
    const text = toolText(await client.callTool({
      name: 'search_wlo_collections',
      arguments: { query: 'optik', includeSkillRegistry: true },
    }));
    assert.ok(!text.includes('nicht geprüft'), `the caller asked and got an answer — got ${JSON.stringify(text)}`);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('the parameter is advertised on both collection-returning searches', async () => {
  const client = await connectedClient();
  try {
    const { tools } = await client.listTools();
    for (const name of ['search_wlo_all', 'search_wlo_collections']) {
      const schema = tools.find(t => t.name === name)?.inputSchema as
        { properties?: Record<string, { description?: string }> } | undefined;
      const prop = schema?.properties?.['includeSkillRegistry'];
      assert.ok(prop, `${name} must offer includeSkillRegistry`);
      // The cost is the whole reason it is opt-in, so the description has to
      // state it — a model cannot weigh a round-trip it is not told about. The
      // NUMBER is pinned, not just the word: the first estimate (0,5 s) was
      // corrected to the measurement (2026-08-10) everywhere except the three
      // tool descriptions, which is exactly where the model reads it.
      assert.match(prop!.description ?? '', /2 Abrufe/, `${name}: the description must name the cost`);
      assert.match(prop!.description ?? '', /1,0–1,4 Sekunden/, `${name}: the measured figure, not the old estimate`);
    }
  } finally {
    await client.close();
  }
});
