/**
 * tools-list-budget.test.ts – what `tools/list` costs every client, bounded.
 *
 * A host loads the whole list into the model's context before the first call.
 * Measured 2026-11-14: 60 tools, 231 306 characters of JSON — 43 000 of
 * descriptions, 89 000 of input schemas, 71 000 of output schemas. Nothing
 * bounded the total, so every new parameter description and every new output
 * field grew it unseen (the audit of that day found it at 229 000).
 *
 * This is a ratchet, not a target: the ceilings sit just above the measured
 * size. Whoever adds a tool or a field and meets them decides on purpose —
 * shorten something else, or raise the number in the same change and say why.
 * Lowering the total for real (sharing the result-record schema inside one
 * tool, moving the quality parameters into one object) changes the published
 * schema's shape and is the user's decision, not a refactoring.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectedClient } from './fetchMock.js';

/**
 * Measured 231 306 on 2026-11-14 and 234 912 on 2026-11-15: the `order`
 * parameter on three tools (`browse_collection_tree`,
 * `get_collection_overview`, `list_collection_tree`) with what its values and
 * the flag mean, and the new output fields (`childrenPositioned`,
 * `subcollectionsPositioned`, `unreadParents` / `refusedParents` and their
 * totals). The ceiling is the measured size plus about 3 000 — less than one
 * average tool (≈ 3 900), so a new tool still meets it.
 */
const TOTAL_MAX = 238_000;
/** The largest single tool (`search_wlo_all`, 17 219): its envelope repeats the record schema per bucket. */
const TOOL_MAX = 18_000;
/** A description past this is cut by at least one host (the limit the existing descriptions already keep). */
const DESCRIPTION_MAX = 1024;

test('the tool list stays within its budget', async () => {
  const client = await connectedClient();
  const { tools } = await client.listTools();
  const total = JSON.stringify(tools).length;
  assert.ok(total <= TOTAL_MAX, `tools/list is ${total} characters, over ${TOTAL_MAX}`);
  // A lower bound too: a list that suddenly halves lost its schemas, not its fat.
  assert.ok(total > 150_000, `tools/list is only ${total} characters — did the schemas go missing?`);
});

test('no single tool outgrows the largest one, and no description is cut by a host', async () => {
  const client = await connectedClient();
  const { tools } = await client.listTools();
  for (const tool of tools) {
    const size = JSON.stringify(tool).length;
    assert.ok(size <= TOOL_MAX, `${tool.name} is ${size} characters, over ${TOOL_MAX}`);
    const description = tool.description ?? '';
    assert.ok(description.length <= DESCRIPTION_MAX, `${tool.name}: description is ${description.length} characters, over ${DESCRIPTION_MAX}`);
  }
});
