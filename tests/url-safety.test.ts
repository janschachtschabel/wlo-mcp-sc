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

/**
 * Ranges the audit of 2026-11-05 found passing — measured by EXECUTING
 * `isPrivateHost`, every one of these answered `false`. Hostnames go through
 * `new URL()` first where that is how a caller receives them, because the URL
 * parser rewrites IPv6 spellings before any check sees them.
 */
const hostOf = (url: string) => new URL(url).hostname;

test('shared address space 100.64.0.0/10 (CGNAT, cloud metadata) is private', () => {
  assert.equal(isPrivateHost('100.100.100.200'), true, 'Alibaba metadata');
  assert.equal(isPrivateHost('100.64.0.1'), true);
  assert.equal(isPrivateHost('100.127.255.254'), true);
  assert.equal(isPrivateHost('100.63.255.255'), false, 'just below the range');
  assert.equal(isPrivateHost('100.128.0.1'), false, 'just above the range');
});

test('reserved IPv4 ranges are private', () => {
  assert.equal(isPrivateHost('192.0.0.170'), true, 'IETF protocol assignments 192.0.0.0/24');
  assert.equal(isPrivateHost('198.18.0.1'), true, 'benchmarking 198.18.0.0/15');
  assert.equal(isPrivateHost('198.19.255.255'), true);
  assert.equal(isPrivateHost('198.20.0.1'), false, 'just above the benchmark range');
  assert.equal(isPrivateHost('224.0.0.1'), true, 'multicast');
  assert.equal(isPrivateHost('240.0.0.1'), true, 'reserved');
  assert.equal(isPrivateHost('255.255.255.255'), true, 'broadcast');
});

test('IPv6 forms that carry a private IPv4 are judged by that IPv4', () => {
  assert.equal(isPrivateHost(hostOf('http://[64:ff9b::7f00:1]/')), true, 'NAT64 → 127.0.0.1');
  assert.equal(isPrivateHost(hostOf('http://[64:ff9b::a00:1]/')), true, 'NAT64 → 10.0.0.1');
  assert.equal(isPrivateHost(hostOf('http://[64:ff9b::808:808]/')), false, 'NAT64 → 8.8.8.8 stays public');
  assert.equal(isPrivateHost(hostOf('http://[::127.0.0.1]/')), true, 'IPv4-compatible → 127.0.0.1');
});

test('the whole link-local block fe80::/10 is private, not just fe80', () => {
  for (const h of ['fe80::1', 'fe90::1', 'fea0::1', 'febf::1']) assert.equal(isPrivateHost(h), true, h);
  assert.equal(isPrivateHost('fec0::1'), false, 'fec0 is outside fe80::/10');
});

test('IPv6 multicast and the NAT64 local-use prefix are private', () => {
  assert.equal(isPrivateHost('ff02::1'), true, 'multicast');
  assert.equal(isPrivateHost(hostOf('http://[64:ff9b:1::1]/')), true, 'NAT64 local-use 64:ff9b:1::/48');
});

test('ordinary public addresses still pass after the wider rules', () => {
  for (const h of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '100.0.0.1', '2001:4860:4860::8888', 'example.org']) {
    assert.equal(isPrivateHost(h), false, h);
  }
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
