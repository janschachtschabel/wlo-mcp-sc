/**
 * client-budget.test.ts – the chatbot's own budget (plan 2026-11-07, S1/S2).
 *
 * The chatbot is ONE address for all its users, so an address budget throttles
 * every person at once. A trusted client presents a secret key and is counted
 * in its own bucket at its own rate; the key itself is never kept or returned.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  budgetBucket, countToolCalls, parseTrustedClientKeys, rateLimitedBody,
} from '../src/client-budget.js';

const KEY = 'k'.repeat(40);

test('a well-formed entry becomes a client with its own rate; the key is only hashed', () => {
  const { clients, rejected } = parseTrustedClientKeys(`boerdi:360:${KEY}`);
  assert.deepEqual(rejected, []);
  assert.equal(clients.size, 1);
  assert.deepEqual([...clients.values()], [{ name: 'boerdi', rpm: 360 }]);
  assert.ok(![...clients.keys()].includes(KEY), 'stored as a hash, never the key');
});

test('short keys, bad rates and broken entries are refused by NAME, never echoing the key', () => {
  const { clients, rejected } = parseTrustedClientKeys(
    `kurz:100:abc, nullrate:0:${KEY}, keinezahl:x:${KEY},  , ohnefeld`);
  assert.equal(clients.size, 0);
  // An entry with no colon may be a pasted KEY — it is named by its position, never its text.
  assert.deepEqual(rejected, ['kurz', 'nullrate', 'keinezahl', 'entry #4']);
});

test('a second entry with the same name is refused, not merged into the first bucket', () => {
  const other = 'f'.repeat(64);
  const { clients, rejected } = parseTrustedClientKeys(`boerdi:360:${KEY},boerdi:9999:${other}`);
  assert.equal(clients.size, 1);
  assert.deepEqual([...clients.values()], [{ name: 'boerdi', rpm: 360 }]);
  assert.deepEqual(rejected, ['boerdi (duplicate name)']);
});

test('a key may contain colons — only the first two separate fields', () => {
  const { clients } = parseTrustedClientKeys(`app:50:${KEY}:mit:doppelpunkt`);
  assert.equal(budgetBucket(`${KEY}:mit:doppelpunkt`, '1.2.3.4', clients).key, 'client:app');
});

test('the bucket is the client for a known key, the address otherwise', () => {
  const { clients } = parseTrustedClientKeys(`boerdi:360:${KEY}`);
  assert.deepEqual(budgetBucket(KEY, '1.2.3.4', clients), { key: 'client:boerdi', rpm: 360, kind: 'client' });
  assert.deepEqual(budgetBucket('falsch', '1.2.3.4', clients), { key: '1.2.3.4', kind: 'address' });
  assert.deepEqual(budgetBucket(undefined, '1.2.3.4', clients), { key: '1.2.3.4', kind: 'address' });
  assert.deepEqual(budgetBucket([KEY, 'x'], '1.2.3.4', clients), { key: '1.2.3.4', kind: 'address' },
    'a repeated header is not a key');
});

test('only tools/call counts — initialize and notifications never reach edu-sharing', () => {
  assert.equal(countToolCalls({ jsonrpc: '2.0', id: 1, method: 'initialize' }), 0);
  assert.equal(countToolCalls({ jsonrpc: '2.0', method: 'notifications/initialized' }), 0);
  assert.equal(countToolCalls({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: {} }), 1);
  assert.equal(countToolCalls([
    { jsonrpc: '2.0', id: 1, method: 'tools/call' },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call' },
  ]), 2);
  assert.equal(countToolCalls(undefined), 0);
  assert.equal(countToolCalls('tools/call'), 0);
});

test('a 429 body is a JSON-RPC error a program can branch on', () => {
  const body = JSON.parse(rateLimitedBody(17, 'Zu viele Anfragen.')) as {
    jsonrpc: string; id: null; error: { code: number; message: string; data: { code: string; retryAfter: number } };
  };
  assert.equal(body.jsonrpc, '2.0');
  assert.equal(body.id, null);
  assert.equal(body.error.code, -32029);
  assert.equal(body.error.message, 'Zu viele Anfragen.');
  assert.deepEqual(body.error.data, { code: 'rate_limited', retryAfter: 17 });
});

test('the 429 body carries the code it is given (the login guard uses too_many_logins)', () => {
  const body = JSON.parse(rateLimitedBody(300, 'Zu viele Anmeldungen.', 'too_many_logins')) as {
    error: { data: { code: string; retryAfter: number } };
  };
  assert.deepEqual(body.error.data, { code: 'too_many_logins', retryAfter: 300 });
});
