/**
 * tool-status.test.ts – the per-tool invocation status copy table.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOL_STATUS, TOOL_STATUS_MAX, toolStatusMeta } from '../src/apps/tool-status.js';
import { BATCH_TOOLS, CURATION_TOOLS, TWO_STEP_TOOLS } from './curation-tools.js';
import { connectedClient } from './fetchMock.js';

test('every status string is non-empty and within the Apps-SDK length cap', () => {
  for (const [name, { invoking, invoked }] of Object.entries(TOOL_STATUS)) {
    assert.ok(invoking.length > 0 && invoking.length <= TOOL_STATUS_MAX, `${name} invoking ≤${TOOL_STATUS_MAX}`);
    assert.ok(invoked.length > 0 && invoked.length <= TOOL_STATUS_MAX, `${name} invoked ≤${TOOL_STATUS_MAX}`);
  }
});

test('toolStatusMeta returns the openai/* keys for a known tool', () => {
  const meta = toolStatusMeta('search_wlo_all');
  assert.equal(meta['openai/toolInvocation/invoking'], TOOL_STATUS['search_wlo_all']!.invoking);
  assert.equal(meta['openai/toolInvocation/invoked'], TOOL_STATUS['search_wlo_all']!.invoked);
});

test('toolStatusMeta returns an empty object for an unknown tool', () => {
  assert.deepEqual(toolStatusMeta('does_not_exist'), {});
});

test('a two-step write tool says its request is being worked on — true of the preview AND of the write', () => {
  // The copy is stamped ONCE per tool (`tool-defaults.ts`), so it stands over
  // both calls. "wird angelegt" was false over the preview; "wird vorbereitet"
  // (the first fix) was false over the confirmed write — a deletion running
  // under "Löschung wird vorbereitet" (review of the follow-ups, finding 1).
  const wrong = TWO_STEP_TOOLS
    .filter(name => TOOL_STATUS[name] && !/ wird bearbeitet…$/.test(TOOL_STATUS[name]!.invoking))
    .map(name => `${name}: „${TOOL_STATUS[name]!.invoking}“`);
  assert.deepEqual(wrong, []);
});

test('every curation tool the server registers has status copy — measured, batch switch on (finding 4)', async () => {
  const saved = process.env['WLO_BATCH_UPLOAD_ENABLED'];
  process.env['WLO_BATCH_UPLOAD_ENABLED'] = '1';
  const client = await connectedClient();
  try {
    const { tools } = await client.listTools();
    // A curation tool is one that declares ONLY oauth2 (`registerCurationTool`).
    const curation = tools.filter(t => {
      const schemes = (t._meta as { securitySchemes?: Array<{ type: string }> } | undefined)?.securitySchemes ?? [];
      return schemes.length === 1 && schemes[0]!.type === 'oauth2';
    }).map(t => t.name).sort();
    // The hand lists the other checks rely on cover exactly what is registered.
    assert.deepEqual(curation, [...CURATION_TOOLS, ...BATCH_TOOLS].sort());
    assert.deepEqual(curation.filter(name => !TOOL_STATUS[name]), [], 'a curation tool without status copy');
  } finally {
    await client.close();
    if (saved === undefined) delete process.env['WLO_BATCH_UPLOAD_ENABLED'];
    else process.env['WLO_BATCH_UPLOAD_ENABLED'] = saved;
  }
});
