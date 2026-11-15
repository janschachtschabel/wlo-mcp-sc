/**
 * write-429-is-open.test.ts – a 429 on a write is NO verdict (review 2026-11-14).
 *
 * `wroteNothing` says it once: a 4xx except 429 proves nothing was written; a
 * 429 is "busy", like a 5xx. Five producers still decided with their own
 * `status >= 500` and so read a 429 as a refusal — a create answered `refused`
 * with `outcomeOpen: false`, and a batch released its manifest claim over a
 * folder that may exist.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installFetchMock } from './fetchMock.js';
import { createContentNode } from '../src/services/write/nodes-lifecycle.js';
import { createBatchFolder, fileBatchEntry } from '../src/services/write/batch-filing.js';
import { createSuggestions, setSuggestionStatus } from '../src/services/write/suggestions.js';

const DESIRED = { 'cclom:title': ['Brüche'], 'ccm:wwwurl': ['https://example.org/neu'] };

/** Every search is empty (no duplicate); every write answers `status`. */
function busy(status: number) {
  return installFetchMock((url) => {
    if (url.includes('/search/v1/')) return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
    return { status, json: { message: 'busy' } };
  });
}

for (const [status, open] of [[429, true], [503, true], [400, false], [409, false]] as const) {
  test(`createContentNode: a create answered ${status} is ${open ? 'open' : 'a refusal'}`, async () => {
    const mock = busy(status);
    try {
      const out = await createContentNode(DESIRED, { mode: 'user' });
      assert.equal(out.status, 'failed');
      assert.equal(out.status === 'failed' && Boolean(out.open), open);
    } finally { mock.restore(); }
  });

  test(`createBatchFolder: a folder create answered ${status} is ${open ? 'open' : 'a refusal'}`, async () => {
    const mock = busy(status);
    try {
      const out = await createBatchFolder('Ablage');
      assert.equal(out.status, 'failed');
      assert.equal(out.status === 'failed' && Boolean(out.open), open);
    } finally { mock.restore(); }
  });

  test(`createSuggestions: a POST answered ${status} is ${open ? 'open' : 'a refusal'}`, async () => {
    const mock = busy(status);
    try {
      const out = await createSuggestions('n1', [{ propertyId: 'cclom:title', value: 'x', description: 'r' }]);
      assert.equal(out.ok, false);
      assert.equal(!out.ok && Boolean(out.open), open);
    } finally { mock.restore(); }
  });

  test(`setSuggestionStatus: a decision answered ${status} is ${open ? 'open' : 'a refusal'}`, async () => {
    const mock = busy(status);
    try {
      const out = await setSuggestionStatus('n1', 's-1', 'ACCEPTED');
      assert.equal(out.ok, false);
      assert.equal(!out.ok && out.open, open);
    } finally { mock.restore(); }
  });
}

test('a batch file whose create answered 429 is open — the manifest claim must not be released over it', async () => {
  const mock = busy(429);
  try {
    const entry = { index: 0, title: 'Mechanik', sha256: 'a'.repeat(64), size: 5, ext: 'pdf', fileName: 'm.pdf', role: 'content' as const };
    const slot = { data: Buffer.from('%PDF-'), sha256: 'a'.repeat(64), type: { mimeType: 'application/pdf', ext: 'pdf' } };
    const out = await fileBatchEntry('ordner-1', entry, slot);
    assert.deepEqual([out.status, (out as { open?: boolean }).open], ['failed', true]);
  } finally { mock.restore(); }
});
