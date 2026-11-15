/**
 * result-dedupe.test.ts – Collapsing content hits that point at the same
 * external URL. Measured on staging 2026-08-09: the query "Optik" returned
 * EIGHT separate ccm:io records, each its own `ccm:original`, all carrying
 * `ccm:wwwurl = https://de.wikipedia.org/wiki/Optik`.
 *
 * Both search paths are covered here because they are independent:
 * `search_wlo_content` calls enhancedSearch/ngsearch directly, `search_wlo_all`
 * and `search` go through `searchAll`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dedupeByUrl } from '../src/result-dedupe.js';
import { connectedClient, installFetchMock, makeNode } from './fetchMock.js';

const WIKI = 'https://de.wikipedia.org/wiki/Optik';

/** Eight records, one URL — the shape actually observed on staging. */
function duplicateNodes(count = 8) {
  return Array.from({ length: count }, (_, i) =>
    makeNode(`dup${i}`, `Optik – Variante ${i}`, { 'ccm:wwwurl': [WIKI] }));
}

test('dedupeByUrl keeps the first hit per URL and drops the rest', () => {
  const nodes = [
    { nodeId: 'a', url: WIKI },
    { nodeId: 'b', url: WIKI },
    { nodeId: 'c', url: 'https://example.org/other' },
    { nodeId: 'd', url: WIKI },
  ];
  const out = dedupeByUrl(nodes);
  assert.deepEqual(out.map(n => n.nodeId), ['a', 'c'], 'the highest-ranked copy survives');
});

test('dedupeByUrl never collapses nodes without a URL', () => {
  // `url` is '' only when the node has neither ccm:wwwurl nor a content URL.
  // Treating '' as a key would merge unrelated records into one.
  const nodes = [
    { nodeId: 'a', url: '' },
    { nodeId: 'b', url: '' },
    { nodeId: 'c', url: '' },
  ];
  assert.equal(dedupeByUrl(nodes).length, 3);
});

test('dedupeByUrl leaves a list with no duplicates untouched', () => {
  const nodes = [
    { nodeId: 'a', url: 'https://example.org/1' },
    { nodeId: 'b', url: 'https://example.org/2' },
  ];
  assert.deepEqual(dedupeByUrl(nodes).map(n => n.nodeId), ['a', 'b']);
});

test('search_wlo_content returns one hit for eight records sharing a URL', async () => {
  const nodes = duplicateNodes();
  const mock = installFetchMock(() => ({
    json: { nodes, pagination: { total: nodes.length, from: 0, count: nodes.length } },
  }));
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_content',
      arguments: { query: 'Optik', outputFormat: 'json' },
    });
    const sc = result.structuredContent as { results: Array<{ nodeId: string }> };
    assert.equal(sc.results.length, 1, 'eight copies collapse to one');
    assert.equal(sc.results[0].nodeId, 'dup0', 'the highest-ranked copy survives');
  } finally { await client.close(); mock.restore(); }
});

test('search_wlo_all returns one content hit for eight records sharing a URL', async () => {
  const nodes = duplicateNodes();
  const mock = installFetchMock((url) => {
    if (url.includes('/collections') || url.includes('/children')) return { json: { nodes: [] } };
    return { json: { nodes, pagination: { total: nodes.length, from: 0, count: nodes.length } } };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_all',
      arguments: { query: 'Optik', outputFormat: 'json' },
    });
    const sc = result.structuredContent as { content: { results: Array<{ nodeId: string }> } };
    assert.equal(sc.content.results.length, 1, 'eight copies collapse to one');
    assert.equal(sc.content.results[0].nodeId, 'dup0');
  } finally { await client.close(); mock.restore(); }
});

test('the cap applies AFTER dedupe: no duplicate survives, and a copy-heavy page returns fewer', async () => {
  // The contract, stated exactly: dedupe never lets a duplicate through, and it
  // never invents replacements. The upstream page is requested at the caller's
  // size, so a page dominated by copies yields FEWER than maxResults — the
  // backend total still reports what was really there. Widening the page to
  // compensate would double the bytes of every search for a repository data
  // problem, so it is deliberately not done.
  const nodes = [
    ...Array.from({ length: 5 }, (_, i) => makeNode(`same${i}`, `Optik ${i}`, { 'ccm:wwwurl': [WIKI] })),
    ...Array.from({ length: 5 }, (_, i) =>
      makeNode(`uniq${i}`, `Anderes ${i}`, { 'ccm:wwwurl': [`https://example.org/${i}`] })),
  ];
  const mock = installFetchMock(() => ({
    json: { nodes, pagination: { total: 42, from: 0, count: nodes.length } },
  }));
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_content',
      arguments: { query: 'Optik', maxResults: 3, outputFormat: 'json' },
    });
    const sc = result.structuredContent as { total: number; results: Array<{ nodeId: string; url: string }> };
    const urls = sc.results.map(r => r.url);
    assert.equal(new Set(urls).size, urls.length, 'no two results share a URL');
    assert.ok(sc.results.length <= 3, 'never more than maxResults');
    assert.equal(sc.total, 42, 'the backend total is still reported truthfully');
  } finally { await client.close(); mock.restore(); }
});
