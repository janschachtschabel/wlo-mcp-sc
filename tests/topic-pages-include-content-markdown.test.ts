/**
 * `includeContent` resolves the swimlanes in JSON mode only. Asked for in
 * Markdown it was ignored without a word — the caller read a listing and took
 * it for the pages' content. The answer now says that the flag did nothing
 * here, and what does.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock, makeNode } from './fetchMock.js';

function variantNode(i: number) {
  return makeNode(`var-${i}`, `PAGE_VARIANT_${i}`, {
    'cm:name': [`PAGE_VARIANT_${i}`],
    'ccm:page_variant_profiling_target_group': ['teacher'],
    'virtual:primaryparent_nodeid': [`workspace://SpacesStore/cfg-${i}`],
  });
}

/** Two Themenseiten, listed without a query (variant → config folder → collection). */
function twoPages() {
  return installFetchMock((url) => {
    if (url.includes('/queries/-home-/mds_oeh/page_variant')) return { json: { nodes: [variantNode(0), variantNode(1)] } };
    const cfg = /nodes\/-home-\/cfg-(\d+)\/metadata/.exec(url);
    if (cfg) return { json: { node: makeNode(`cfg-${cfg[1]}`, 'Config', { 'virtual:primaryparent_nodeid': [`workspace://SpacesStore/coll-${cfg[1]}`] }) } };
    const coll = /nodes\/-home-\/coll-(\d+)\/metadata/.exec(url);
    if (coll) {
      return { json: { node: makeNode(`coll-${coll[1]}`, `Sammlung ${coll[1]}`, {
        'cclom:title': [`Sammlung ${coll[1]}`], 'ccm:page_config_ref': [`workspace://SpacesStore/cfg-${coll[1]}`],
      }) } };
    }
    return { json: {} };
  });
}

const firstBlock = (result: unknown) => (result as { content: { text: string }[] }).content[0]!.text;

test('search_wlo_topic_pages (Markdown): includeContent says that it did nothing here', async () => {
  const mock = twoPages();
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'search_wlo_topic_pages', arguments: { includeContent: true } });
    const text = firstBlock(result);
    assert.match(text, /Gefundene Themenseiten: 2/);
    assert.match(text, /includeContent wirkt nur mit outputFormat="json"/);
    assert.match(text, /get_topic_page_content/);
    // Ahead of the repository's titles, like every sentence of the server's own.
    assert.ok(text.indexOf('includeContent') < text.indexOf('## '), 'before the first page');
  } finally { await client.close(); mock.restore(); }
});

test('search_wlo_topic_pages (Markdown): without the flag there is no such sentence', async () => {
  const mock = twoPages();
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'search_wlo_topic_pages', arguments: {} });
    assert.doesNotMatch(firstBlock(result), /includeContent/);
  } finally { await client.close(); mock.restore(); }
});

test('search_wlo_topic_pages (JSON): the flag works as before and block 0 stays JSON', async () => {
  const mock = twoPages();
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'search_wlo_topic_pages', arguments: { includeContent: true, outputFormat: 'json' } });
    assert.equal((JSON.parse(firstBlock(result)) as { total: number }).total, 2);
    assert.doesNotMatch(firstBlock(result), /includeContent wirkt nur/);
  } finally { await client.close(); mock.restore(); }
});
