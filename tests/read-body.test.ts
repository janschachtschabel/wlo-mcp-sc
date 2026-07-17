import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readBodyWithLimit } from '../src/read-body.js';

/** Build a fake request stream that yields the given chunks and records how
 * many it actually emitted (to prove the body was fully drained). */
function fakeReq(chunks: Buffer[]): AsyncIterable<Buffer> & { emitted: number } {
  const state = { emitted: 0 } as { emitted: number };
  const iterable: any = {
    emitted: 0,
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) {
        state.emitted++;
        iterable.emitted = state.emitted;
        yield c;
      }
    },
  };
  return iterable;
}

test('readBodyWithLimit: small body is returned intact', async () => {
  const req = fakeReq([Buffer.from('{"a":1}')]);
  const res = await readBodyWithLimit(req, 1024);
  assert.equal(res.tooLarge, false);
  assert.equal(res.text, '{"a":1}');
});

test('readBodyWithLimit: multi-chunk body is concatenated in order', async () => {
  const req = fakeReq([Buffer.from('{"a"'), Buffer.from(':'), Buffer.from('1}')]);
  const res = await readBodyWithLimit(req, 1024);
  assert.equal(res.text, '{"a":1}');
});

test('readBodyWithLimit: body exactly at the limit is allowed', async () => {
  const req = fakeReq([Buffer.from('12345')]); // 5 bytes
  const res = await readBodyWithLimit(req, 5);
  assert.equal(res.tooLarge, false);
  assert.equal(res.text, '12345');
});

test('readBodyWithLimit: over-limit body flags tooLarge, discards content, drains fully', async () => {
  const req = fakeReq([Buffer.from('123'), Buffer.from('456'), Buffer.from('789')]); // 9 bytes, limit 5
  const res = await readBodyWithLimit(req, 5);
  assert.equal(res.tooLarge, true);
  assert.equal(res.text, '');
  // All chunks consumed → the underlying stream is fully drained (so the HTTP
  // layer can respond 413 cleanly instead of resetting the connection).
  assert.equal(req.emitted, 3);
});

test('readBodyWithLimit: empty body → empty string, not tooLarge', async () => {
  const req = fakeReq([]);
  const res = await readBodyWithLimit(req, 10);
  assert.equal(res.tooLarge, false);
  assert.equal(res.text, '');
});
