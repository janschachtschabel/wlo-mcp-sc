/**
 * csrf-write-verdict.test.ts – the judgement half of the E1 measurement.
 *
 * E1 asks one question: does edu-sharing demand a CSRF token for a write that
 * carries nothing but the session cookie? The answer decides whether the widget
 * can write from inside the repository page at all, and it will be quoted to the
 * repository's operators — so the classifier that turns a status code into that
 * answer is pinned here rather than trusted.
 *
 * The trap it guards against is the one that runs through this whole repository:
 * a `403` can mean "no CSRF token" or "this account may not write", and those
 * lead to opposite conclusions. Whatever the evidence does not settle has to
 * come out as unclear, never as the convenient answer.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyResponse, overallVerdict } from '../scripts/csrf-write-verdict.mjs';

const REPO_ERROR = JSON.stringify({
  error: 'DAOMissingException',
  message: 'Node does not exist: 0c9f2d1e-0000-0000-0000-000000000000',
});

test('a 2xx means the write was let through', () => {
  assert.equal(classifyResponse(200, '{}'), 'passed');
});

test('a 401 means the session was not accepted at all', () => {
  // Not a CSRF finding: the request never got as far as a token check.
  assert.equal(classifyResponse(401, ''), 'unauthenticated');
});

test('a 403 naming a token is the CSRF gate', () => {
  assert.equal(classifyResponse(403, 'Invalid CSRF token found for /edu-sharing/rest'), 'csrf-gate');
  assert.equal(classifyResponse(403, '{"message":"XSRF-TOKEN missing"}'), 'csrf-gate');
});

test('a 403 without a token word stays forbidden — not a CSRF finding', () => {
  // The likely real case with a read-only service account. Reading this as a
  // CSRF gate would invent a blocker that is not there.
  assert.equal(classifyResponse(403, '{"error":"AccessDeniedException","message":"no permission"}'), 'forbidden');
});

test('a repository error object proves the request reached the handler', () => {
  // The load-bearing case: rejected on its own merits, behind whatever filters
  // exist — so no filter refused it first.
  assert.equal(classifyResponse(404, REPO_ERROR), 'handler');
  assert.equal(classifyResponse(400, REPO_ERROR), 'handler');
  assert.equal(classifyResponse(500, REPO_ERROR), 'handler');
});

test('a rejection without a repository error object proves nothing', () => {
  assert.equal(classifyResponse(400, '<html><body>Bad Request</body></html>'), 'unclear');
  assert.equal(classifyResponse(502, ''), 'unclear');
});

test('a failed request is its own answer, not a rejection', () => {
  assert.equal(classifyResponse(0, ''), 'error');
});

test('reaching the handler from our own origin means no token is needed', () => {
  const v = overallVerdict({ ownOrigin: 'handler', foreignOrigin: 'handler' });
  assert.equal(v.result, 'no-token');
  // Both origins fare the same, so the server does not look at the header.
  assert.equal(v.originChecked, false);
});

test('a foreign origin turned away while ours passes is an origin check', () => {
  const v = overallVerdict({ ownOrigin: 'passed', foreignOrigin: 'csrf-gate' });
  assert.equal(v.result, 'no-token');
  assert.equal(v.originChecked, true);
});

test('a token demanded on our own origin is the blocking answer', () => {
  assert.equal(overallVerdict({ ownOrigin: 'csrf-gate', foreignOrigin: 'csrf-gate' }).result, 'token-required');
});

test('a bare 403 on our own origin leaves the question open', () => {
  const v = overallVerdict({ ownOrigin: 'forbidden', foreignOrigin: 'forbidden' });
  assert.equal(v.result, 'unclear-rights');
  assert.equal(v.originChecked, null);
});

test('a session that did not carry leaves the question open', () => {
  const v = overallVerdict({ ownOrigin: 'unauthenticated', foreignOrigin: 'unauthenticated' });
  assert.equal(v.result, 'unclear-auth');
  assert.equal(v.originChecked, null);
});

test('an unreadable rejection is reported as unresolved', () => {
  assert.equal(overallVerdict({ ownOrigin: 'unclear', foreignOrigin: 'unclear' }).result, 'unclear');
  assert.equal(overallVerdict({ ownOrigin: 'error', foreignOrigin: 'error' }).result, 'unclear');
});
