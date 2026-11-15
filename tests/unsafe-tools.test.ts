/**
 * unsafe-tools.test.ts – The operator's off-switch for tools declared unsafe.
 *
 * `parseDisableList` is tested rather than the env-reading wrapper: the module
 * resolves `WLO_DISABLE_UNSAFE_TOOLS` once at load, so mutating `process.env`
 * mid-process would test nothing. The wrapper is covered for the default case
 * (nothing configured → nothing disabled), which is the one that decides what a
 * fresh deployment serves.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isUnsafeToolDisabled, parseDisableList } from '../src/unsafe-tools.js';

test('nothing configured disables nothing', () => {
  for (const raw of [undefined, '', '   ', ',', ' , , ']) {
    const r = parseDisableList(raw);
    assert.equal(r.all, false, JSON.stringify(raw));
    assert.equal(r.names.size, 0, JSON.stringify(raw));
  }
});

test('a single tool name disables that tool and no other', () => {
  const r = parseDisableList('get_url_text');
  assert.equal(r.all, false);
  assert.equal(r.names.has('get_url_text'), true);
  assert.equal(r.names.has('search_wlo_all'), false);
});

test('names may be separated by commas, spaces or both', () => {
  const r = parseDisableList('a, b ,c   d');
  assert.deepEqual([...r.names].sort(), ['a', 'b', 'c', 'd']);
});

test('names are matched case-insensitively', () => {
  assert.equal(parseDisableList('GET_URL_TEXT').names.has('get_url_text'), true);
});

test('"all" and the truthy tokens switch off every unsafe tool', () => {
  for (const raw of ['all', 'ALL', '1', 'true', 'YES', 'on']) {
    const r = parseDisableList(raw);
    assert.equal(r.all, true, raw);
  }
});

test('an "all" token anywhere in the list wins over the individual names', () => {
  // "get_url_text, all" is a contradiction only if you read it as a list; read
  // as an intent it plainly says everything. Silently disabling one of the two
  // would be the surprising answer.
  const r = parseDisableList('get_url_text, all');
  assert.equal(r.all, true);
});

test('an unknown name is not an error — it simply matches nothing', () => {
  const r = parseDisableList('tool_that_does_not_exist');
  assert.equal(r.all, false);
  assert.equal(r.names.has('get_url_text'), false);
});

test('with the variable unset, no tool is disabled', () => {
  // The suite runs without WLO_DISABLE_UNSAFE_TOOLS, which is exactly the state
  // of a deployment that never heard of it: unsafe tools are registered.
  assert.equal(process.env['WLO_DISABLE_UNSAFE_TOOLS'], undefined, 'precondition');
  assert.equal(isUnsafeToolDisabled('get_url_text'), false);
});
