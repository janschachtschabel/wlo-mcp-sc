/**
 * tool-status.test.ts – the per-tool invocation status copy table.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOL_STATUS, TOOL_STATUS_MAX, toolStatusMeta } from '../src/apps/tool-status.js';

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
