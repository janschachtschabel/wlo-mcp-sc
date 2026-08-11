// MUST stay the first import — see disable-unsafe-env.ts.
import './disable-unsafe-env.js';

/**
 * server-unsafe-disabled.test.ts – The operator's switch, end to end.
 *
 * unsafe-gate.test.ts proves the mechanism on synthetic tools; this proves the
 * real server honours it — and, just as importantly, that switching unsafe
 * tools off costs nothing else. A security knob that quietly removes ordinary
 * tools is an outage, not a mitigation.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient } from './fetchMock.js';
import { CURATION_TOOLS } from './curation-tools.js';

test('WLO_DISABLE_UNSAFE_TOOLS=all removes get_url_text and nothing else', async () => {
  const client = await connectedClient();
  try {
    const names = (await client.listTools()).tools.map(t => t.name);

    assert.equal(names.includes('get_url_text'), false, 'the unsafe tool is gone');
    // The 27 that are unconditional must all still be there.
    for (const kept of [
      'search_skill', 'get_skill', 'get_skill_registry',
      'search_wlo_collections', 'search_wlo_content', 'get_collection_contents', 'get_node_details',
      'search_wlo_all', 'lookup_wlo_vocabulary', 'search_wlo_topic_pages', 'get_subject_portals',
      'browse_collection_tree', 'wlo_health_check', 'get_nodes_details', 'get_topic_page_content',
      'get_wikipedia_summary', 'get_compendium_text', 'get_wlo_content_text',
      'search_wlo_within_collection', 'search', 'fetch', 'lookup_wlo_publishers',
      'get_related_content', 'get_node_breadcrumb', 'get_node_collections',
      'get_collection_stats', 'wlo_auth_status',
    ]) {
      assert.equal(names.includes(kept), true, `${kept} must survive the switch`);
    }
    // 27 read tools + the curation tools, which the switch does not touch.
    assert.equal(names.length, 27 + CURATION_TOOLS.length, 'exactly one tool was removed');
  } finally { await client.close(); }
});

test('the sibling that reads WLO material by nodeId is unaffected', async () => {
  // get_wlo_content_text also uses the extraction service — but on the record's
  // own curated ccm:wwwurl, where the caller cannot choose the target. That is
  // the whole reason only one of the two is declared unsafe.
  const client = await connectedClient();
  try {
    const tool = (await client.listTools()).tools.find(t => t.name === 'get_wlo_content_text');
    assert.ok(tool, 'still registered with unsafe tools switched off');
  } finally { await client.close(); }
});
