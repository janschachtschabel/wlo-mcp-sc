/**
 * harness-strict-client.test.ts – the standard test client validates what a
 * tool answers (audit 2026-11-14, T5b).
 *
 * `connectedClient()` used to skip `tools/list`, and without the list the SDK
 * client has no output schema to hold an answer against — so an undeclared key
 * in `structuredContent` passed in 99 of 109 test files. This pins the harness
 * itself: remove the `listTools()` call from it and these fail.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, strictClient } from './fetchMock.js';

type WithValidators = { getToolOutputValidator(name: string): ((value: unknown) => { valid: boolean }) | undefined };

test('connectedClient holds an output validator for a tool that advertises a schema', async () => {
  const client = await connectedClient();
  try {
    const validate = (client as unknown as WithValidators).getToolOutputValidator('get_url_text');
    assert.equal(typeof validate, 'function', 'the tool list was fetched, so the client validates');
    assert.equal(validate!({ url: 'https://example.org/', text: 'x', charCount: 1, truncated: false }).valid, true);
    assert.equal(validate!({ url: 'https://example.org/', text: 'x', charCount: 1, truncated: false, undeclared: 1 }).valid, false,
      'an undeclared key breaks the advertised schema');
    assert.equal(validate!({ error: { code: 'upstream_error', message: 'x' } }).valid, true, 'a coded error is the other branch');
  } finally { await client.close(); }
});

test('strictClient is the same client, not a second harness', () => {
  assert.equal(strictClient, connectedClient);
});
