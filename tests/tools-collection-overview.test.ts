/**
 * tools-collection-overview.test.ts – a collection at a glance, in one call
 * (BOERDi wishlist item 1, 2026-11-06).
 *
 * Replaces the chain get_compendium_text → get_collection_stats →
 * get_collection_contents (32/37 counted) and the 2–4 calls the chatbot's page
 * context made for "what is here?". The parts run in parallel; a part that
 * fails is NAMED in `missing` and the rest still comes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock, makeNode, toolText, type MockResult } from './fetchMock.js';
import { stopSkillRegistryCache } from '../src/services/skill-registry-cache.js';

const COLL = 'coll-optik';
const COMPENDIUM = '# Optik\n\nEinleitung.\n\n## Licht\n\nWas Licht ist.\n\n## Linsen\n\nWie Linsen brechen.';

function collectionNode(props: Record<string, string[]> = {}) {
  return { ...makeNode(COLL, 'Optik', {
    'cclom:title': ['Optik'],
    'ccm:oeh_collection_compendium_text': [COMPENDIUM],
    ...props,
  }), type: 'ccm:map', aspects: ['ccm:collection'] };
}

function children(nodes: unknown[], total = nodes.length): MockResult {
  return { json: { nodes, pagination: { total, from: 0, count: nodes.length } } };
}

function repository(override?: (url: string) => MockResult | undefined) {
  return installFetchMock(url => {
    const special = override?.(url);
    if (special) return special;
    if (url.includes(`/${COLL}/metadata`)) return { json: { node: collectionNode() } };
    if (url.includes(`/${COLL}/parents`)) {
      return { json: { nodes: [collectionNode(), { ...makeNode('physik', 'Physik', { 'cclom:title': ['Physik'] }), type: 'ccm:map' }] } };
    }
    if (url.includes(`/${COLL}/children`) && url.includes('filter=folders')) {
      return children([
        { ...makeNode('sub-linsen', 'Linsen', { 'cclom:title': ['Linsen'] }), type: 'ccm:map' },
        { ...makeNode('sub-licht', 'Licht', { 'cclom:title': ['Licht'] }), type: 'ccm:map' },
      ]);
    }
    // The registry scan (its projection asks for the content type) sees the
    // whole listing — a capped scan may not say "no registry" (project rule).
    if (url.includes(`/${COLL}/children`) && url.includes('oeh_extendedType')) return children([]);
    if (url.includes(`/${COLL}/children`)) {
      const max = Number(new URL(url).searchParams.get('maxItems') ?? '10');
      const all = Array.from({ length: 12 }, (_, i) => makeNode(`m-${i}`, `Material ${i}`));
      return children(all.slice(0, max), 212);
    }
    if (/\/sub-(linsen|licht)\/children/.test(url)) return children([makeNode('x', 'x')], url.includes('linsen') ? 34 : 7);
    return children([]);
  });
}

interface Overview {
  collection?: { nodeId: string; title: string; isTopicPage: boolean };
  breadcrumb?: Array<{ nodeId: string; title: string }>;
  compendium?: { hasText: boolean; chars: number; toc: Array<{ title: string; depth: number }> };
  stats?: { contents: number; subcollections: number };
  skills?: unknown[];
  subcollections?: Array<{ nodeId: string; title: string; contentCount?: number }>;
  contents?: { total: number; items: Array<{ nodeId: string }>; truncated: boolean };
  missing: Array<{ part: string; code: string }>;
  error?: { code: string; message: string };
}

async function overview(args: Record<string, unknown>, override?: Parameters<typeof repository>[0]) {
  stopSkillRegistryCache();
  const mock = repository(override);
  const c = await connectedClient();
  try {
    const r = await c.callTool({ name: 'get_collection_overview', arguments: args });
    return { r, sc: r.structuredContent as unknown as Overview, calls: mock.calls };
  } finally { await c.close(); mock.restore(); }
}

test('everything about a collection in one call', async () => {
  const { r, sc } = await overview({ collectionId: COLL, maxContents: 5 });
  assert.notEqual(r.isError, true, toolText(r));
  assert.equal(sc.collection?.title, 'Optik');
  assert.deepEqual(sc.breadcrumb?.map(b => b.title), ['Physik', 'Optik']);
  assert.equal(sc.compendium?.hasText, true);
  assert.deepEqual(sc.compendium?.toc.map(t => t.title), ['Licht', 'Linsen'], 'the outline, not the text');
  assert.equal(sc.stats?.contents, 212);
  assert.equal(sc.stats?.subcollections, 2);
  assert.deepEqual(sc.subcollections?.map(s => [s.title, s.contentCount]), [['Licht', 7], ['Linsen', 34]]);
  assert.equal(sc.contents?.total, 212);
  assert.equal(sc.contents?.items.length, 5);
  assert.equal(sc.contents?.truncated, true);
  assert.deepEqual(sc.skills, []);
  assert.deepEqual(sc.missing, []);
});

test('the compendium outline costs no read of its own', async () => {
  const { calls } = await overview({ collectionId: COLL, include: ['compendium'] });
  assert.deepEqual(calls.map(c => new URL(c.url).pathname.split('/').slice(-2).join('/')), [`${COLL}/metadata`],
    'the head read already carries the text');
});

test('a failing part is named, the rest still comes', async () => {
  // The stats sample is the only 100-item listing; refuse just that one.
  const { r, sc, calls } = await overview({ collectionId: COLL }, url =>
    url.includes(`/${COLL}/children`) && url.includes('maxItems=100') ? { status: 500, json: {} } : undefined);
  assert.notEqual(r.isError, true);
  assert.deepEqual(sc.missing, [{ part: 'stats', code: 'upstream_error' }],
    JSON.stringify(calls.filter(c => c.url.includes('maxItems=100')).map(c => c.url.replace(/^.*\/nodes\//, ''))));
  assert.equal(sc.stats, undefined);
  assert.equal(sc.contents?.total, 212, 'the other parts are unaffected');
});

test('include narrows what is read', async () => {
  const { sc, calls } = await overview({ collectionId: COLL, include: ['breadcrumb'] });
  assert.ok(sc.breadcrumb);
  assert.equal(sc.stats, undefined);
  assert.equal(sc.contents, undefined);
  assert.ok(!calls.some(c => c.url.includes('/children')), 'no listing for parts nobody asked for');
});

test('error codes instead of repository text', async () => {
  const notFound = await overview({ collectionId: 'gibt-es-nicht' }, url =>
    url.includes('/gibt-es-nicht/') ? { status: 404, json: {} } : undefined);
  assert.equal(notFound.r.isError, true);
  assert.equal(notFound.sc.error?.code, 'not_found');

  const forbidden = await overview({ collectionId: 'geheim' }, url =>
    url.includes('/geheim/') ? { status: 403, json: {} } : undefined);
  assert.equal(forbidden.sc.error?.code, 'forbidden');

  const busy = await overview({ collectionId: 'voll' }, url =>
    url.includes('/voll/') ? { status: 503, json: {} } : undefined);
  assert.equal(busy.sc.error?.code, 'upstream_busy', 'busy, not broken');
  assert.equal((busy.sc.error as { retryAfter?: number } | undefined)?.retryAfter, 10);

  const material = await overview({ collectionId: 'ein-material' }, url =>
    url.includes('/ein-material/metadata') ? { json: { node: { ...makeNode('ein-material', 'Arbeitsblatt'), type: 'ccm:io' } } } : undefined);
  assert.equal(material.sc.error?.code, 'not_a_collection');

  // A folder reports `ccm:map` too; only the aspect makes a collection (measured 2026-11-12).
  const folder = await overview({ collectionId: 'ein-ordner' }, url =>
    url.includes('/ein-ordner/metadata') ? { json: { node: { ...makeNode('ein-ordner', 'Ablage'), type: 'ccm:map', aspects: ['ccm:mapdata'] } } } : undefined);
  assert.equal(folder.sc.error?.code, 'not_a_collection');
});

test('a skill lookup that could not answer says "not checked", not "none approved"', async () => {
  // 212 children, of which the bounded registry scan reads 50: "there is no
  // registry here" is a claim that read does not support.
  const { sc } = await overview({ collectionId: COLL, include: ['skills'] }, url =>
    url.includes(`/${COLL}/children`) && url.includes('oeh_extendedType')
      ? children(Array.from({ length: 50 }, (_, i) => makeNode(`m-${i}`, `M ${i}`)), 212) : undefined);
  assert.equal(sc.skills, undefined);
  assert.deepEqual(sc.missing, [{ part: 'skills', code: 'not_checked' }]);
});

test('the outline stops at two levels — the full one is get_compendium_text\'s', async () => {
  // Measured 2026-11-06 on Optik: 242 headings, 19 KB of outline JSON in full,
  // 1.3 KB for the top two levels (188 of the 242 sit on the third).
  const deep = '# Optik\n\n## Licht\n\n### Farbe\n\n#### Spektrum\n\n## Linsen\n\nText.';
  const { sc } = await overview({ collectionId: COLL, include: ['compendium'] }, url =>
    url.includes(`/${COLL}/metadata`)
      ? { json: { node: collectionNode({ 'ccm:oeh_collection_compendium_text': [deep] }) } } : undefined);
  const c = sc.compendium as unknown as { toc: Array<{ title: string; depth: number }>; headings: number; tocDepthLimited?: boolean };
  assert.deepEqual(c.toc.map(t => t.title), ['Licht', 'Farbe', 'Linsen']);
  assert.equal(c.headings, 4, 'how many there are in full');
  assert.equal(c.tocDepthLimited, true, 'and that some were left out');
});

test('a printed skill list closes with the "this is not the instruction" note; no skills, no note', async () => {
  const { DESCRIPTIONS_ONLY_NOTE } = await import('../src/registry-render.js');
  const registryMd = [
    '::: ki-skill',
    '[Fragen generieren](https://repo.example/edu-sharing/components/render/00000001-0000-4000-8000-000000000000)',
    ':::',
  ].join('\n');
  const { r } = await overview({ collectionId: COLL, include: ['skills'] }, url => {
    if (url.includes(`/${COLL}/children`) && url.includes('oeh_extendedType')) {
      return children([{ ...makeNode('reg-1', 'Registry', {
        'cm:name': ['SKILL_REGISTRY.md'],
        'ccm:oeh_extendedType': ['http://w3id.org/openeduhub/vocabs/contentTypes/ai_prompt'],
      }), mimetype: 'text/x-web-markdown' }]);
    }
    if (url.includes('/eduservlet/download')) return { text: registryMd };
    return undefined;
  });
  const text = toolText(r);
  assert.match(text, /00000001-0000-4000-8000-000000000000/, 'the skill id is printed');
  assert.ok(text.includes(DESCRIPTIONS_ONLY_NOTE), text);

  const none = await overview({ collectionId: COLL, include: ['skills'] });
  assert.ok(!toolText(none.r).includes(DESCRIPTIONS_ONLY_NOTE), 'no ids printed, no promise of a get_skill step');
});

test('more sub-collections than listed are disclosed (review R-C: subcollectionsTruncated was dead)', async () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ ...makeNode(`sub-${i}`, `Teil ${i}`, { 'cclom:title': [`Teil ${i}`] }), type: 'ccm:map' }));
  const folders = (url: string) => {
    if (!url.includes(`/${COLL}/children`) || !url.includes('filter=folders')) return undefined;
    // Like the repository: never more than asked for.
    const max = Number(new URL(url).searchParams.get('maxItems') ?? '100');
    return children(many.slice(0, max), many.length);
  };
  const cut = await overview({ collectionId: COLL, include: ['subcollections'], maxSubcollections: 3 }, folders);
  assert.equal(cut.sc.subcollections?.length, 3);
  assert.equal((cut.sc as { subcollectionsTruncated?: boolean }).subcollectionsTruncated, true);
  const whole = await overview({ collectionId: COLL, include: ['subcollections'], maxSubcollections: 5 }, folders);
  assert.equal(whole.sc.subcollections?.length, 5);
  assert.equal((whole.sc as { subcollectionsTruncated?: boolean }).subcollectionsTruncated, undefined, 'exactly all — nothing cut');
});
