import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolvePositiveInt,
  resolveNonNegativeInt,
  resolveRootCollectionId,
  DEFAULT_FETCH_TIMEOUT_MS,
  DEFAULT_TEXT_TIMEOUT_MS,
} from '../src/wlo-config.js';

/**
 * The slowest legitimate upstream call measured (staging, 2026-08-02): creating
 * a `ccm:io` took 4.2–8.0 s over 18 samples. Reads stayed under 2.5 s on
 * staging and under 1.2 s on production. The old 10 s default left as little as
 * 1.26× headroom over that worst case — and tripped in real use, reporting a
 * create as failed while the record existed upstream.
 */
const SLOWEST_MEASURED_CALL_MS = 7_952;

// The WLO root ("Portale") — live-verified identical on prod and staging
// (2026-07-17): both hosts resolve this id to the same level-0 collection.
const WLO_ROOT = '5e40e372-735c-4b17-bbf7-e827a5702b57';

test('resolveRootCollectionId: explicit env value wins regardless of host', () => {
  const r = resolveRootCollectionId('my-custom-root', 'https://edu.example.org/edu-sharing');
  assert.deepEqual(r, { id: 'my-custom-root', source: 'env' });
});

test('resolveRootCollectionId: known WLO prod host defaults to the WLO root', () => {
  const r = resolveRootCollectionId(undefined, 'https://redaktion.openeduhub.net/edu-sharing');
  assert.deepEqual(r, { id: WLO_ROOT, source: 'known-host' });
});

test('resolveRootCollectionId: known WLO staging host defaults to the WLO root', () => {
  const r = resolveRootCollectionId('', 'https://repository.staging.openeduhub.net/edu-sharing');
  assert.deepEqual(r, { id: WLO_ROOT, source: 'known-host' });
});

test('resolveRootCollectionId: unknown repository host falls back and says so', () => {
  const r = resolveRootCollectionId(undefined, 'https://edu.example.org/edu-sharing');
  assert.equal(r.id, WLO_ROOT);
  assert.equal(r.source, 'fallback');
});

test('resolveRootCollectionId: whitespace-only env value is treated as unset', () => {
  const r = resolveRootCollectionId('   ', 'https://redaktion.openeduhub.net/edu-sharing');
  assert.deepEqual(r, { id: WLO_ROOT, source: 'known-host' });
});

test('the fetch timeout clears the slowest measured call with real headroom', () => {
  // Not "is it 20000" — that would only restate the code. The property that
  // matters is the margin over what the repository actually needs, so a future
  // change that quietly narrows it fails here.
  assert.ok(
    DEFAULT_FETCH_TIMEOUT_MS >= 2 * SLOWEST_MEASURED_CALL_MS,
    `${DEFAULT_FETCH_TIMEOUT_MS} ms leaves too little room over ${SLOWEST_MEASURED_CALL_MS} ms`,
  );
});

test('full-text reads still get the longer timeout of the two', () => {
  // /textContent was measured at a 9.2 s maximum and is the deliberate outlier.
  // If the general timeout ever grew past it, that distinction would be gone.
  assert.ok(DEFAULT_TEXT_TIMEOUT_MS > DEFAULT_FETCH_TIMEOUT_MS);
});

/** Capture the structured log lines a call writes to stderr. */
function captureLog(fn: () => void): Record<string, unknown>[] {
  const real = process.stderr.write.bind(process.stderr);
  const lines: string[] = [];
  process.stderr.write = ((chunk: unknown) => { lines.push(String(chunk)); return true; }) as typeof process.stderr.write;
  try { fn(); } finally { process.stderr.write = real; }
  return lines.map(l => JSON.parse(l) as Record<string, unknown>);
}

test('resolvePositiveInt: unset, empty and non-numeric values keep the default', () => {
  assert.equal(resolvePositiveInt(undefined, 10, 'X'), 10);
  assert.equal(resolvePositiveInt('', 10, 'X'), 10);
  assert.equal(resolvePositiveInt('abc', 10, 'X'), 10);
});

test('resolvePositiveInt: zero and negative values keep the default', () => {
  // A pool size of 0 would stall every fan-out — never accept it from env.
  assert.equal(resolvePositiveInt('0', 10, 'X'), 10);
  assert.equal(resolvePositiveInt('-5', 10, 'X'), 10);
});

test('resolvePositiveInt: a valid value wins', () => {
  assert.equal(resolvePositiveInt('20', 10, 'X'), 20);
  assert.equal(resolvePositiveInt(' 25 ', 10, 'X'), 25);
});

test('resolvePositiveInt: a unit suffix is refused, not half-accepted', () => {
  // `parseInt` stops at the first non-digit, which is how `MAX_BODY_BYTES=1MB`
  // becomes a one-byte cap that rejects every request with 413 — and nothing in
  // the log points at the cause.
  assert.equal(resolvePositiveInt('1MB', 1_048_576, 'MAX_BODY_BYTES'), 1_048_576);
  assert.equal(resolvePositiveInt('20s', 20_000, 'X'), 20_000);
  assert.equal(resolvePositiveInt('120/min', 120, 'X'), 120);
});

// The rate limits differ from every other integer here in one respect: `0` is a
// documented, meaningful value (disable the limiter when a WAF sits in front).
// They therefore need their own floor — reusing the positive parser would
// silently turn "off" back into the default.

test('resolveNonNegativeInt: zero is a real value, not a mistake', () => {
  assert.equal(resolveNonNegativeInt('0', 120, 'RATE_LIMIT_RPM'), 0);
});

test('resolveNonNegativeInt: negatives and unparseable values keep the default', () => {
  assert.equal(resolveNonNegativeInt('-1', 120, 'X'), 120);
  assert.equal(resolveNonNegativeInt('120/min', 120, 'X'), 120);
  assert.equal(resolveNonNegativeInt('abc', 120, 'X'), 120);
});

test('resolveNonNegativeInt: unset and empty keep the default', () => {
  assert.equal(resolveNonNegativeInt(undefined, 120, 'X'), 120);
  assert.equal(resolveNonNegativeInt('', 120, 'X'), 120);
  assert.equal(resolveNonNegativeInt('  30 ', 120, 'X'), 30);
});

/**
 * `parseInt` stops at the first non-digit, so a unit suffix used to become a
 * plausible-looking number: `WLO_FETCH_TIMEOUT_MS=20s` resolved to a 20 ms
 * timeout and made every upstream call fail, with nothing in the log to say
 * why. A value we do not fully understand must not be half-accepted.
 */
test('resolvePositiveInt: a unit suffix is rejected, not truncated to its digits', () => {
  assert.equal(resolvePositiveInt('20s', 10, 'WLO_FETCH_TIMEOUT_MS'), 10);
  assert.equal(resolvePositiveInt('30000ms', 10, 'WLO_FETCH_TIMEOUT_MS'), 10);
  assert.equal(resolvePositiveInt('1e3', 10, 'WLO_TOPIC_POOL'), 10);
  assert.equal(resolvePositiveInt('7.5', 10, 'WLO_TOPIC_POOL'), 10);
});

test('resolvePositiveInt: a rejected value warns and names the variable', () => {
  const lines = captureLog(() => resolvePositiveInt('20s', 10, 'WLO_FETCH_TIMEOUT_MS'));
  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.['level'], 'warn');
  assert.equal(lines[0]?.['variable'], 'WLO_FETCH_TIMEOUT_MS');
  assert.equal(lines[0]?.['value'], '20s');
  assert.equal(lines[0]?.['fallback'], 10);
});

test('resolvePositiveInt: an unset variable is normal and stays silent', () => {
  assert.deepEqual(captureLog(() => resolvePositiveInt(undefined, 10, 'WLO_TOPIC_POOL')), []);
  assert.deepEqual(captureLog(() => resolvePositiveInt('  ', 10, 'WLO_TOPIC_POOL')), []);
  assert.deepEqual(captureLog(() => resolvePositiveInt('25', 10, 'WLO_TOPIC_POOL')), []);
});
