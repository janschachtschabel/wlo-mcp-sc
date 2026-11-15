import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mapPool } from '../src/concurrency.js';

test('mapPool: keeps order and caps concurrency', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const items = Array.from({ length: 20 }, (_, i) => i);
  const results = await mapPool(items, 3, async (i) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise(r => setTimeout(r, 5));
    inFlight--;
    return i * 2;
  });
  assert.deepEqual(results, items.map(i => i * 2));
  assert.ok(maxInFlight <= 3, `max in-flight was ${maxInFlight}`);
});

test('mapPool: one failing item becomes null and does not abort the batch', async () => {
  const items = [0, 1, 2, 3, 4];
  const results = await mapPool(items, 2, async (i) => {
    if (i === 2) throw new Error('boom on item 2');
    return i * 10;
  });
  assert.deepEqual(results, [0, 10, null, 30, 40]);
});
