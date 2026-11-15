/**
 * ticket-origins.test.ts – which browser origins may exchange a ticket
 * (plan 2026-11-07, R4). No list keeps today's behaviour; a request with
 * no `Origin` is server-to-server and never refused.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseAllowedOrigins, resolveTicketOrigins, ticketOriginAllowed } from '../src/auth/ticket-origins.js';

test('entries are normalised to their origin — case, trailing slash, path', () => {
  const { origins, rejected } = parseAllowedOrigins(' https://Redaktion.Example.org/ , https://chat.example.org/widget');
  assert.deepEqual([...origins].sort(), ['https://chat.example.org', 'https://redaktion.example.org']);
  assert.deepEqual(rejected, []);
});

test('a wildcard, an unreadable entry and a non-web scheme are rejected and named', () => {
  const { origins, rejected } = parseAllowedOrigins('*,nonsense,ftp://files.example.org,https://ok.example.org');
  assert.deepEqual([...origins], ['https://ok.example.org']);
  assert.deepEqual(rejected, ['*', 'nonsense', 'ftp://files.example.org']);
});

test('unset or blank → an empty list', () => {
  assert.equal(parseAllowedOrigins(undefined).origins.size, 0);
  assert.equal(parseAllowedOrigins(' , ').origins.size, 0);
});

test('no list allows every origin — today’s behaviour', () => {
  assert.equal(ticketOriginAllowed('https://anywhere.example', undefined), true);
});

test('a list that is configured but EMPTY allows no browser origin — a typo must not open the door', () => {
  assert.equal(ticketOriginAllowed('https://anywhere.example', new Set()), false);
  assert.equal(ticketOriginAllowed(undefined, new Set()), true, 'servers are never refused');
});

test('resolveTicketOrigins: unset → no list; every entry unusable → an empty, closed list, flagged', () => {
  assert.equal(resolveTicketOrigins(undefined).origins, undefined);
  assert.equal(resolveTicketOrigins('  ').origins, undefined);
  const typo = resolveTicketOrigins('chatbot.example.org');
  assert.equal(typo.origins?.size, 0);
  assert.equal(typo.allRejected, true);
  assert.deepEqual([...resolveTicketOrigins('https://a.example').origins!], ['https://a.example']);
});

test('with a list: listed yes, foreign no, the opaque "null" origin no', () => {
  const list = parseAllowedOrigins('https://redaktion.example.org').origins;
  assert.equal(ticketOriginAllowed('https://redaktion.example.org', list), true);
  assert.equal(ticketOriginAllowed('https://REDAKTION.example.org', list), true, 'compared as an origin');
  assert.equal(ticketOriginAllowed('https://evil.example', list), false);
  assert.equal(ticketOriginAllowed('null', list), false);
});

test('no Origin header is server-to-server and stays allowed', () => {
  const list = parseAllowedOrigins('https://redaktion.example.org').origins;
  assert.equal(ticketOriginAllowed(undefined, list), true);
});
