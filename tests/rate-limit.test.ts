import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRateLimiter, clientKey } from '../src/rate-limit.js';

const T0 = 1_000_000; // fixed base clock (ms); tests inject all timestamps

test('allows up to the limit, blocks beyond it within a window', () => {
  const rl = createRateLimiter(3, 60_000);
  assert.equal(rl.check('a', T0), false);       // 1
  assert.equal(rl.check('a', T0 + 1), false);   // 2
  assert.equal(rl.check('a', T0 + 2), false);   // 3
  assert.equal(rl.check('a', T0 + 3), true);    // 4 → over
  assert.equal(rl.check('a', T0 + 4), true);    // 5 → over
});

test('resets after the window elapses', () => {
  const rl = createRateLimiter(2, 60_000);
  assert.equal(rl.check('a', T0), false);
  assert.equal(rl.check('a', T0 + 1), false);
  assert.equal(rl.check('a', T0 + 2), true);          // over within window
  assert.equal(rl.check('a', T0 + 60_001), false);    // new window → allowed again
});

test('limit <= 0 disables limiting entirely', () => {
  const rl = createRateLimiter(0);
  for (let i = 0; i < 1000; i++) assert.equal(rl.check('a', T0 + i), false);
});

test('separate IPs have independent budgets', () => {
  const rl = createRateLimiter(1, 60_000);
  assert.equal(rl.check('a', T0), false);
  assert.equal(rl.check('b', T0), false);   // different IP, own budget
  assert.equal(rl.check('a', T0 + 1), true); // a is now over
  assert.equal(rl.check('b', T0 + 1), true); // b is now over
});

test('sweep removes only expired buckets, active ones survive', () => {
  const rl = createRateLimiter(3, 60_000);
  // 'old' is used once at T0, then never again → it expires.
  rl.check('old', T0);
  // Advance past the window so the next check triggers a sweep that deletes
  // 'old'. 'fresh' starts its bucket in this same call and must NOT be swept.
  rl.check('fresh', T0 + 60_001);            // count 1
  rl.check('fresh', T0 + 60_002);            // count 2
  rl.check('fresh', T0 + 60_003);            // count 3
  // If 'fresh' had wrongly been swept, its count would have reset and this
  // 4th hit would still be allowed. It being over-limit proves survival.
  assert.equal(rl.check('fresh', T0 + 60_004), true, 'fresh reached its 4th hit → over limit 3');
});

test('clientKey: uses remoteAddress when proxy is not trusted', () => {
  assert.equal(clientKey('1.2.3.4', '10.0.0.1', false), '10.0.0.1');
  assert.equal(clientKey(undefined, '10.0.0.1', false), '10.0.0.1');
});

test('clientKey: uses the RIGHTMOST X-Forwarded-For hop (proxy-appended) when trusted', () => {
  // The trusted proxy appends the real client IP as the LAST hop; the leftmost
  // value is client-supplied and spoofable, so it must NOT be the key.
  assert.equal(clientKey('1.2.3.4, 203.0.113.5', '10.0.0.1', true), '203.0.113.5');
  assert.equal(clientKey(['9.9.9.9, 203.0.113.5'], '10.0.0.1', true), '203.0.113.5');
  // A forged leftmost value is ignored.
  assert.notEqual(clientKey('1.2.3.4, 203.0.113.5', '10.0.0.1', true), '1.2.3.4');
});

test('clientKey: falls back to remoteAddress when trusted but no header', () => {
  assert.equal(clientKey(undefined, '10.0.0.1', true), '10.0.0.1');
  assert.equal(clientKey('', '10.0.0.1', true), '10.0.0.1');
});

test('clientKey: returns "unknown" when nothing identifies the client', () => {
  assert.equal(clientKey(undefined, undefined, false), 'unknown');
});
