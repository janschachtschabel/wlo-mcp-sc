/**
 * input-array-bounds.test.ts – every caller-supplied array is bounded in its
 * schema (audit 2026-11-05: zod GHSA-mrhx-c7xc-m3w5 exhausts memory while
 * validating oversized constrained collections; `keywords` and `suggestions`
 * were the two unbounded input arrays left).
 *
 * The rejection must happen in schema validation, BEFORE any upstream request —
 * `assertRejectsWithoutUpstream` counts the calls, so a handler that merely
 * failed later would not pass.
 */

import { test } from 'node:test';

import { assertRejectsWithoutUpstream, connectedClient } from './fetchMock.js';
import { MAX_KEYWORDS } from '../src/tools/curation-fields.js';
import { MAX_SUGGESTIONS } from '../src/tools/curation-suggestions.js';

test('keywords beyond the cap are refused by the schema', async () => {
  const client = await connectedClient();
  try {
    await assertRejectsWithoutUpstream(client, 'wlo_update_content', {
      nodeId: 'n1',
      keywords: Array.from({ length: MAX_KEYWORDS + 1 }, (_, i) => `kw${i}`),
    }, 'an oversized keyword list');
  } finally { await client.close(); }
});

test('suggestions beyond the cap are refused by the schema', async () => {
  const client = await connectedClient();
  try {
    await assertRejectsWithoutUpstream(client, 'wlo_suggest_metadata', {
      nodeId: 'n1',
      suggestions: Array.from({ length: MAX_SUGGESTIONS + 1 }, () => ({ field: 'title', value: 'x', reason: 'y' })),
    }, 'an oversized suggestion list');
  } finally { await client.close(); }
});
