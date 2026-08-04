import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRateLimiter, createDistinctValueLimiter, clientKey } from '../src/rate-limit.js';

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

// ── Credential-stuffing relay guard ──────────────────────────────────────────
// The MCP endpoint forwards a client-supplied Basic header upstream, which
// makes it usable as a relay for guessing WLO logins behind OUR ip. A plain
// requests-per-minute cap is the wrong tool: a legitimate per-user client sends
// a header on EVERY call and would be throttled, while an attacker rotating
// credentials stays under any per-credential cap. The distinguishing signal is
// the number of DISTINCT credentials one address presents.

test('distinct-credential limiter: one client using one login is never limited', () => {
  const lim = createDistinctValueLimiter(3, 60_000);
  for (let i = 0; i < 500; i++) {
    assert.equal(lim.check('1.2.3.4', 'anna:pw', 1000 + i), false, `call ${i}`);
  }
});

test('distinct-credential limiter: rotating credentials trips it', () => {
  const lim = createDistinctValueLimiter(3, 60_000);
  assert.equal(lim.check('1.2.3.4', 'a:1', 1000), false);
  assert.equal(lim.check('1.2.3.4', 'b:2', 1000), false);
  assert.equal(lim.check('1.2.3.4', 'c:3', 1000), false);
  assert.equal(lim.check('1.2.3.4', 'd:4', 1000), true, 'the fourth distinct login is refused');
});

test('distinct-credential limiter: separate addresses have separate budgets', () => {
  const lim = createDistinctValueLimiter(1, 60_000);
  assert.equal(lim.check('1.1.1.1', 'a:1', 1000), false);
  assert.equal(lim.check('2.2.2.2', 'b:2', 1000), false, 'another client is unaffected');
  assert.equal(lim.check('1.1.1.1', 'z:9', 1000), true);
});

test('distinct-credential limiter: the window resets', () => {
  const lim = createDistinctValueLimiter(1, 60_000);
  assert.equal(lim.check('1.2.3.4', 'a:1', 1000), false);
  assert.equal(lim.check('1.2.3.4', 'b:2', 2000), true);
  assert.equal(lim.check('1.2.3.4', 'b:2', 1000 + 60_001), false, 'a new window starts clean');
});

test('distinct-credential limiter: a limit of 0 disables it', () => {
  const lim = createDistinctValueLimiter(0, 60_000);
  for (const v of ['a:1', 'b:2', 'c:3', 'd:4']) {
    assert.equal(lim.check('1.2.3.4', v, 1000), false);
  }
});

test('distinct-credential limiter: the raw credential is never retained', () => {
  // Whatever this holds sits in memory for a whole window, so it must be a
  // digest — a password in a long-lived Set is a needless liability.
  const lim = createDistinctValueLimiter(5, 60_000);
  lim.check('1.2.3.4', 'anna:sehr-geheimes-passwort', 1000);
  assert.ok(
    !JSON.stringify(lim.inspectForTest()).includes('sehr-geheimes-passwort'),
    'the credential must not be recoverable from the limiter state',
  );
});
