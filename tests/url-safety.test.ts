/**
 * url-safety.test.ts – Characterisation tests for the private-host rule moved
 * out of text-extraction-api.ts (P0/Task 2).
 *
 * The rule had no tests of its own: it was a private function exercised only
 * indirectly, through a tool that degrades to `null` on refusal — so a hole in
 * it looked exactly like a service that was simply switched off. It gets its own
 * file here because a second caller is about to ask the same question with a far
 * more hostile input.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isPrivateHost, resolvesToPrivateAddress } from '../src/url-safety.js';

/** A fake resolver — the real one would make the suite depend on DNS. */
const answering = (...addresses: string[]) => async () => addresses.map(address => ({ address }));

test('loopback and the localhost name are private', () => {
  for (const h of ['localhost', 'LOCALHOST', 'api.localhost', '127.0.0.1', '127.1.1.1']) {
    assert.equal(isPrivateHost(h), true, h);
  }
});

test('the RFC 1918 ranges are private', () => {
  for (const h of ['10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.1.1']) {
    assert.equal(isPrivateHost(h), true, h);
  }
});

test('link-local — including the cloud metadata address — is private', () => {
  // 169.254.169.254 is the credential endpoint on AWS/GCP/Azure. A fetching
  // service that can be pointed at it hands out instance credentials.
  assert.equal(isPrivateHost('169.254.169.254'), true);
  assert.equal(isPrivateHost('169.254.0.1'), true);
});

test('"this network" (0.x) is private', () => {
  assert.equal(isPrivateHost('0.0.0.0'), true);
});

test('IPv6 loopback, unique-local and link-local are private, brackets and all', () => {
  for (const h of ['::1', '[::1]', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'FE80::1']) {
    assert.equal(isPrivateHost(h), true, h);
  }
});

test('public names and addresses are not private', () => {
  for (const h of ['example.com', 'de.wikipedia.org', '8.8.8.8', '93.184.216.34', '2001:4860:4860::8888']) {
    assert.equal(isPrivateHost(h), false, h);
  }
});

test('an IPv4-mapped IPv6 address is judged by the IPv4 inside it', () => {
  // Found by measurement 2026-08-03, and it was live: `new URL()` rewrites
  // `http://[::ffff:127.0.0.1]/` to hostname `[::ffff:7f00:1]` — the dotted
  // quad is gone by the time this function sees it, and the IPv6 branch has no
  // idea that `7f00:1` is 127.0.0.1. The existing ccm:wwwurl path was already
  // exposed: anyone who can set that field could point the extraction service
  // at its own loopback.
  for (const h of ['::ffff:7f00:1', '[::ffff:7f00:1]', '::ffff:a00:1', '::ffff:c0a8:1']) {
    assert.equal(isPrivateHost(h), true, h);
  }
  // The dotted spelling must keep working — that is what DNS hands back.
  for (const h of ['::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
    assert.equal(isPrivateHost(h), true, h);
  }
});

test('a mapped PUBLIC IPv4 stays public', () => {
  // 8.8.8.8 → 0808:0808. The unwrap must judge the address, not merely react to
  // the ::ffff: prefix.
  assert.equal(isPrivateHost('::ffff:808:808'), false);
  assert.equal(isPrivateHost('::ffff:8.8.8.8'), false);
});

test('the 172 range is bounded on both sides', () => {
  // 172.16.0.0–172.31.255.255 is private; the neighbours are public and a
  // sloppy `a === 172` test would swallow both.
  assert.equal(isPrivateHost('172.15.255.255'), false);
  assert.equal(isPrivateHost('172.32.0.1'), false);
});

// ── resolvesToPrivateAddress ────────────────────────────────────────────────
// The check the literal test cannot do: a perfectly ordinary-looking name whose
// A record points inside. `internal.example.com → 10.0.0.5` is a one-line DNS
// entry away, and nothing about the string gives it away.

test('a name resolving into a private range is private', async () => {
  assert.equal(await resolvesToPrivateAddress('internal.example.com', answering('10.0.0.5')), 'private');
});

test('a name resolving to a public address is public', async () => {
  assert.equal(await resolvesToPrivateAddress('example.com', answering('93.184.216.34')), 'public');
});

test('ONE private answer among several is enough to refuse', async () => {
  // A name with both a public and a private record is the shape a rebinding
  // attempt takes. Accepting it because the first answer looked fine would
  // defeat the whole check.
  assert.equal(
    await resolvesToPrivateAddress('mixed.example.com', answering('93.184.216.34', '10.0.0.5')),
    'private',
  );
});

test('a mapped IPv4 in the DNS answer is unwrapped too', async () => {
  assert.equal(await resolvesToPrivateAddress('v6.example.com', answering('::ffff:10.0.0.1')), 'private');
});

test('an empty answer is unresolvable, not public', async () => {
  assert.equal(await resolvesToPrivateAddress('void.example.com', answering()), 'unresolvable');
});

test('a failing lookup is unresolvable, not public', async () => {
  // A name we cannot judge must not be waved through: the fetching service may
  // well resolve it, and differently than we would.
  const boom = async () => { throw Object.assign(new Error('nope'), { code: 'ENOTFOUND' }); };
  assert.equal(await resolvesToPrivateAddress('gone.example.com', boom), 'unresolvable');
});
