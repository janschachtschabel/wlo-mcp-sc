import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WLO_REPOSITORY_URL } from '../src/wlo-api.js';
import { connectedClient, installFetchMock, makeNode } from './fetchMock.js';

/**
 * Mode C (no query → page_variant search) upstream shape, live-verified
 * 2026-07-27:
 *   variant --virtual:primaryparent--> cfgFolder --virtual:primaryparent--> collection
 *
 * The owner is resolved through two /metadata reads, NOT through /parents:
 * that endpoint answers 500 (AccessDeniedException) for anonymous callers on
 * page-config folders, so every walk silently returned an empty chain — the
 * listing showed identical "Fachportalstartseite" titles with no topic-page
 * URLs, and burned ~1.1 s per variant doing it. /metadata works anonymously
 * and costs ~0.19 s.
 *
 * These tests pin the UPSTREAM CALL COUNT as well as the output, because the
 * number of round-trips IS the latency.
 */

function variantNode(i: number, cfg: string) {
  return makeNode(`var-${i}`, `PAGE_VARIANT_${i}`, {
    'cm:name': [`PAGE_VARIANT_${i}`],
    'ccm:page_variant_profiling_target_group': ['teacher'],
    'virtual:primaryparent_nodeid': [`workspace://SpacesStore/${cfg}`],
  });
}

/** cfg-i → coll-i, each collection carrying its own (active) page config. */
function installModeCMock(variantCount: number) {
  return installFetchMock((url) => {
    if (url.includes('/queries/-home-/mds_oeh/page_variant')) {
      return { json: { nodes: Array.from({ length: variantCount }, (_, i) => variantNode(i, `cfg-${i}`)) } };
    }
    const cfg = /nodes\/-home-\/cfg-(\d+)\/metadata/.exec(url);
    if (cfg) {
      return { json: { node: makeNode(`cfg-${cfg[1]}`, 'Config', {
        'virtual:primaryparent_nodeid': [`workspace://SpacesStore/coll-${cfg[1]}`],
      }) } };
    }
    const coll = /nodes\/-home-\/coll-(\d+)\/metadata/.exec(url);
    if (coll) {
      return { json: { node: makeNode(`coll-${coll[1]}`, `Sammlung ${coll[1]}`, {
        'cclom:title': [`Sammlung ${coll[1]}`],
        'ccm:page_config_ref': [`workspace://SpacesStore/cfg-${coll[1]}`],
      }) } };
    }
    return { json: {} };
  });
}

function parseResults(result: unknown): { total: number; results: Array<{ title: string; collectionId: string; topicPageUrl: string }> } {
  const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
  return JSON.parse(text);
}

async function modeC(args: Record<string, unknown>) {
  const client = await connectedClient();
  try {
    return parseResults(await client.callTool({
      name: 'search_wlo_topic_pages',
      arguments: { outputFormat: 'json', ...args },
    }));
  } finally {
    await client.close();
  }
}

test('search_wlo_topic_pages Mode C: resolves owner titles and topic-page URLs', async () => {
  const mock = installModeCMock(3);
  try {
    const parsed = await modeC({ maxResults: 3 });
    assert.equal(parsed.total, 3);
    assert.deepEqual(parsed.results.map(r => r.title), ['Sammlung 0', 'Sammlung 1', 'Sammlung 2']);
    assert.equal(parsed.results[0].collectionId, 'coll-0');
    assert.equal(
      parsed.results[0].topicPageUrl,
      `${WLO_REPOSITORY_URL}/components/topic-pages?collectionId=coll-0`,
    );
  } finally {
    mock.restore();
  }
});

test('search_wlo_topic_pages Mode C: never calls /parents (500s anonymously)', async () => {
  const mock = installModeCMock(3);
  try {
    await modeC({ maxResults: 3 });
    assert.equal(mock.calls.filter(c => c.url.includes('/parents')).length, 0);
    // 1 variant search + 2 metadata reads per distinct page-config folder.
    assert.equal(mock.calls.length, 7);
  } finally {
    mock.restore();
  }
});

test('search_wlo_topic_pages Mode C: the owner reads ask for only the fields used', async () => {
  const mock = installModeCMock(1);
  try {
    await modeC({ maxResults: 1 });
    const cfgCall = mock.calls.find(c => /cfg-\d+\/metadata/.test(c.url));
    const ownerCall = mock.calls.find(c => /coll-\d+\/metadata/.test(c.url));
    assert.ok(cfgCall && ownerCall, 'expected both metadata reads');
    assert.deepEqual(new URL(cfgCall.url).searchParams.getAll('propertyFilter'), ['virtual:primaryparent_nodeid']);
    assert.deepEqual(new URL(ownerCall.url).searchParams.getAll('propertyFilter'),
      ['ccm:page_config_ref', 'cclom:title', 'cm:name']);
  } finally {
    mock.restore();
  }
});

test('search_wlo_topic_pages Mode C: sibling variants of one page share a single resolution', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/queries/-home-/mds_oeh/page_variant')) {
      return { json: { nodes: ['teacher', 'learner', 'general'].map((tg, i) => makeNode(`var-${i}`, `PAGE_VARIANT_${i}`, {
        'cm:name': [`PAGE_VARIANT_${i}`],
        'ccm:page_variant_profiling_target_group': [tg],
        'virtual:primaryparent_nodeid': ['workspace://SpacesStore/cfg-1'],
      })) } };
    }
    if (url.includes('cfg-1/metadata')) {
      return { json: { node: makeNode('cfg-1', 'Config', {
        'virtual:primaryparent_nodeid': ['workspace://SpacesStore/coll-1'],
      }) } };
    }
    if (url.includes('coll-1/metadata')) {
      return { json: { node: makeNode('coll-1', 'Sammlung Eins', {
        'cclom:title': ['Sammlung Eins'],
        'ccm:page_config_ref': ['workspace://SpacesStore/cfg-1'],
      }) } };
    }
    return { json: {} };
  });
  try {
    const parsed = await modeC({ maxResults: 5 });
    assert.equal(parsed.total, 1, 'three variants of one collection merge into one entry');
    assert.equal(mock.calls.filter(c => c.url.includes('cfg-1/metadata')).length, 1,
      'the owner resolution is memoized across sibling variants');
  } finally {
    mock.restore();
  }
});

test('search_wlo_topic_pages Mode C: a legacy page-config folder still resolves its collection', async () => {
  // Live-verified: a collection may hold SEVERAL page-config folders while its
  // own ccm:page_config_ref names only the ACTIVE one (5 of 25 sampled pages).
  // Requiring the folder to match that ref would drop those pages entirely.
  const mock = installFetchMock((url) => {
    if (url.includes('/queries/-home-/mds_oeh/page_variant')) {
      return { json: { nodes: [variantNode(0, 'cfg-legacy')] } };
    }
    if (url.includes('cfg-legacy/metadata')) {
      return { json: { node: makeNode('cfg-legacy', 'Alter Config-Ordner', {
        'virtual:primaryparent_nodeid': ['workspace://SpacesStore/coll-7'],
      }) } };
    }
    if (url.includes('coll-7/metadata')) {
      return { json: { node: makeNode('coll-7', 'Zukunfts- und Berufsorientierung', {
        'cclom:title': ['Zukunfts- und Berufsorientierung'],
        'ccm:page_config_ref': ['workspace://SpacesStore/cfg-active'], // NOT cfg-legacy
      }) } };
    }
    return { json: {} };
  });
  try {
    const parsed = await modeC({ maxResults: 5 });
    assert.equal(parsed.total, 1);
    assert.equal(parsed.results[0].title, 'Zukunfts- und Berufsorientierung');
    assert.equal(parsed.results[0].collectionId, 'coll-7');
  } finally {
    mock.restore();
  }
});

test('search_wlo_topic_pages Mode C: a parent without a page config is not an owner', async () => {
  // Guard against mislabelling: the primary parent of a page-config folder is
  // only a Themenseite owner when it carries ccm:page_config_ref at all.
  const mock = installFetchMock((url) => {
    if (url.includes('/queries/-home-/mds_oeh/page_variant')) {
      return { json: { nodes: [variantNode(0, 'cfg-x')] } };
    }
    if (url.includes('cfg-x/metadata')) {
      return { json: { node: makeNode('cfg-x', 'Config', {
        'virtual:primaryparent_nodeid': ['workspace://SpacesStore/coll-plain'],
      }) } };
    }
    if (url.includes('coll-plain/metadata')) {
      return { json: { node: makeNode('coll-plain', 'Normale Sammlung', {
        'cclom:title': ['Normale Sammlung'],
      }) } };
    }
    return { json: {} };
  });
  try {
    const parsed = await modeC({ maxResults: 5 });
    // No owner → the generic label, never the raw PAGE_VARIANT id and never a
    // wrong collection name.
    assert.equal(parsed.results[0].title, 'Themenseite');
    assert.equal(parsed.results[0].topicPageUrl, '', 'no topic-page URL without a resolved owner');
  } finally {
    mock.restore();
  }
});
