/**
 * accident.test.ts – which errors are OURS (answered generically) and which are
 * the repository not answering (answered as an upstream failure a client may
 * retry). One rule for MCP and REST (`src/accident.ts`).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAccident } from '../src/accident.js';
import { toolError } from '../src/tools/shared.js';
import { isOutcomeOpen } from '../src/services/write/timeouts.js';

test('for a WRITE, a connection lost mid-body is an open outcome', () => {
  // The request was answered, so it left; only the answer is gone.
  assert.equal(isOutcomeOpen(new TypeError('terminated')), true);
  assert.equal(isOutcomeOpen(new Error('HTTP 400')), false);
});

test("JavaScript's own error classes are accidents", () => {
  for (const err of [new TypeError("Cannot read properties of undefined (reading 'x')"), new RangeError('x'), new ReferenceError('x'), new SyntaxError('x')]) {
    assert.equal(isAccident(err), true, err.name);
  }
});

test('a network failure is not an accident — neither while connecting nor while the body is read', () => {
  // undici: `fetch failed` when no connection came about, `terminated` when it
  // broke while the body was read. Both are TypeErrors, and both are an outage.
  assert.equal(isAccident(new TypeError('fetch failed')), false);
  assert.equal(isAccident(new TypeError('terminated')), false);
  assert.equal(isAccident(new Error('HTTP 503')), false);
});

test('toolError: a connection lost mid-body stays an upstream failure the client may retry', () => {
  const answer = toolError('get_node_details', new TypeError('terminated')) as { structuredContent?: { error?: { code?: string } } };
  assert.notEqual(answer.structuredContent?.error?.code, 'internal_error');
  const accident = toolError('get_node_details', new TypeError('x is not a function')) as { structuredContent?: { error?: { code?: string } } };
  assert.equal(accident.structuredContent?.error?.code, 'internal_error');
});
