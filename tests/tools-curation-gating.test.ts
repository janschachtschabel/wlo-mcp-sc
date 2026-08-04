/**
 * tools-curation-gating.test.ts – write tools exist only where they may be used.
 *
 * Two layers, and both are needed. Absence from `tools/list` is what keeps the
 * public endpoint honest — a model that cannot see a write tool will not try to
 * use one. The call-time refusal (asserted in `tools-curation-update.test.ts`)
 * is the backstop, because a host may serve a tool list cached from a session
 * that did have an identity.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient } from './fetchMock.js';

/** Every curation tool. Listed in full so a new one cannot quietly skip the gate. */
const WRITE_TOOLS = [
  'wlo_update_content', 'wlo_create_content', 'wlo_submit_content',
  'wlo_create_collection', 'wlo_rename_collection',
  'wlo_add_to_collection', 'wlo_remove_from_collection',
  'wlo_update_compendium',
  // Reading proposals is gated too: they are curation workflow, not public data.
  'wlo_suggest_metadata', 'wlo_list_suggestions', 'wlo_decide_suggestion',
  'wlo_delete_content', 'wlo_delete_collection',
];

test('an anonymous server offers no write tool at all', async () => {
  const client = await connectedClient('none');
  try {
    const names = (await client.listTools()).tools.map(t => t.name);
    for (const name of WRITE_TOOLS) assert.ok(!names.includes(name), `${name} is absent`);
    // 25 of the 27 read tools: `find_wlo_skills` needs a configured skills
    // collection (the suite runs without one), and `get_url_text` is present
    // because unsafe tools are registered unless the operator disables them —
    // see tests/server-unsafe-disabled.test.ts for that state.
    assert.equal(names.length, 25, 'exactly the read tools, nothing more');
  } finally {
    await client.close();
  }
});

test('a logged-in user gets the write tools', async () => {
  const client = await connectedClient('user');
  try {
    const names = (await client.listTools()).tools.map(t => t.name);
    for (const name of WRITE_TOOLS) assert.ok(names.includes(name), `${name} is offered`);
  } finally {
    await client.close();
  }
});

test('a service account with writes enabled gets them too', async () => {
  const client = await connectedClient('service');
  try {
    const names = (await client.listTools()).tools.map(t => t.name);
    assert.ok(names.includes('wlo_update_content'));
  } finally {
    await client.close();
  }
});

test('the default is the safe one — no identity, no write tools', async () => {
  // The suite runs without a configured service account, so the unparameterised
  // factory must resolve to `none`. A default that guessed otherwise would put
  // write tools on the public endpoint.
  const client = await connectedClient();
  try {
    const names = (await client.listTools()).tools.map(t => t.name);
    assert.ok(!names.includes('wlo_update_content'));
  } finally {
    await client.close();
  }
});

test('a write tool does not declare itself callable without authentication', async () => {
  // Every read tool carries `_meta.securitySchemes: [{type:'noauth'}]`. Claiming
  // that for a tool that refuses anonymous callers would be a false declaration
  // to the host.
  const client = await connectedClient('user');
  try {
    const { tools } = await client.listTools();
    const write = tools.find(t => t.name === 'wlo_update_content');
    const read = tools.find(t => t.name === 'get_compendium_text');
    assert.ok(write, 'the write tool is present — otherwise this test proves nothing');
    assert.ok(read, 'and a read tool to compare against');
    assert.deepEqual((read._meta as { securitySchemes?: unknown }).securitySchemes, [{ type: 'noauth' }]);
    assert.deepEqual((write._meta as { securitySchemes?: unknown }).securitySchemes, [{ type: 'http' }]);
  } finally {
    await client.close();
  }
});
