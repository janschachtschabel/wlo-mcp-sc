/**
 * write-refusal-status.test.ts – what the HTTP status of a refused WRITE means
 * (audit 2026-11-14, W3/W4).
 *
 * One rule, said once (`wroteNothing`): a 4xx other than 429 is the repository
 * saying no — nothing was written. A 5xx, a 429 or no status at all is no
 * verdict. `reportMutation` turns that into the code and `outcomeOpen` a
 * program reads; it used to answer every refused single mutation as
 * `upstream_error`, which a spent key then called "open".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { wroteNothing } from '../src/upstream-error.js';
import { reportMutation, reportWithUpload } from '../src/tools/curation-report.js';
import { deleteContentNode } from '../src/services/write/nodes-lifecycle.js';
import { renameCollection } from '../src/services/write/collections.js';
import { installFetchMock } from './fetchMock.js';

const errorOf = (r: unknown) => (r as { structuredContent?: { error?: Record<string, unknown> } }).structuredContent?.error;

test('wroteNothing: a 4xx except 429 is a refusal; 5xx, 429 and "no status" are not', () => {
  for (const s of [400, 401, 403, 404, 409, 422]) assert.equal(wroteNothing(s), true, String(s));
  for (const s of [0, 200, 302, 429, 500, 502, 503, 504]) assert.equal(wroteNothing(s), false, String(s));
});

for (const [status, code] of [[401, 'forbidden'], [403, 'forbidden'], [404, 'not_found'], [409, 'refused'], [400, 'refused']] as const) {
  test(`reportMutation: a write refused with ${status} is ${code} and wrote nothing`, () => {
    const error = errorOf(reportMutation({ status: 'failed', detail: `HTTP ${status}`, httpStatus: status }, 'done', 'Kontext'));
    assert.equal(error?.['code'], code);
    assert.equal(error?.['outcomeOpen'], false);
  });
}

for (const status of [500, 502]) {
  test(`reportMutation: a write answered ${status} stays upstream_error and is not called "nothing written"`, () => {
    const error = errorOf(reportMutation({ status: 'failed', detail: `HTTP ${status}`, httpStatus: status }, 'done', 'Kontext'));
    assert.equal(error?.['code'], 'upstream_error');
    assert.equal(error?.['outcomeOpen'], true);
    assert.equal('retryAfter' in (error ?? {}), false);
  });
}

// Review 2026-11-14, finding 7: the plan steps answer a busy repository as
// `upstream_busy` + `retryAfter`; the single tools called the same answer an error.
for (const status of [429, 503]) {
  test(`reportMutation: a write answered ${status} is upstream_busy with a wait — and still open`, () => {
    // The detail is deliberately NOT what the code is read from: the status in hand is.
    const error = errorOf(reportMutation({ status: 'failed', detail: 'Impl.java:500 kaputt', httpStatus: status }, 'done', 'Kontext'));
    assert.deepEqual([error?.['code'], error?.['outcomeOpen'], typeof error?.['retryAfter']], ['upstream_busy', true, 'number']);
  });

  test(`reportWithUpload: an upload answered ${status} is upstream_busy with a wait — and still open`, () => {
    const error = errorOf(reportWithUpload(null, { status: 'failed', detail: 'voll', httpStatus: status }));
    assert.deepEqual([error?.['code'], error?.['outcomeOpen'], typeof error?.['retryAfter'], error?.['upload']],
      ['upstream_busy', true, 'number', 'failed']);
  });
}

test('reportWithUpload: an upload answered 500 stays upstream_error, without a wait', () => {
  const error = errorOf(reportWithUpload(null, { status: 'failed', detail: 'kaputt', httpStatus: 500 }));
  assert.deepEqual([error?.['code'], error?.['outcomeOpen'], 'retryAfter' in (error ?? {})], ['upstream_error', true, false]);
});

test('reportMutation: a failure without any status stays upstream_error', () => {
  const error = errorOf(reportMutation({ status: 'failed', detail: 'kaputt' }, 'done', 'Kontext'));
  assert.equal(error?.['code'], 'upstream_error');
  assert.notEqual(error?.['outcomeOpen'], false);
});

test('reportMutation: our own refusal keeps its code', () => {
  const error = errorOf(reportMutation({ status: 'failed', detail: 'x', code: 'is_original' }, 'done', 'Kontext'));
  assert.deepEqual([error?.['code'], error?.['outcomeOpen']], ['is_original', false]);
});

test('the producers hand the status on: delete of a record, rename of a collection', async () => {
  const mock = installFetchMock(() => ({ status: 403, json: { message: 'nein' } }));
  try {
    const deleted = await deleteContentNode('n1');
    assert.deepEqual([deleted.status, deleted.status === 'failed' && deleted.httpStatus], ['failed', 403]);
    const renamed = await renameCollection('c1', { title: 'Neu' });
    assert.deepEqual([renamed.status, renamed.status === 'failed' && renamed.httpStatus], ['failed', 403]);
  } finally {
    mock.restore();
  }
});
