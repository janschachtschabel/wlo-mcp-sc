/**
 * auth-relay-limiter.test.ts – the credential limiter seen from a RELAY client.
 *
 * `authAbuseLimiter` bounds how many DISTINCT credentials one caller may present,
 * because `POST /mcp` forwards them upstream and would otherwise be a guessing
 * oracle with our address as the origin. Its bucket key used to be the client
 * address, on the stated assumption that a client is one person's machine.
 *
 * A chatbot backend is not that: it serves many people from one address and
 * forwards each person's own access block. The rule this file pins is the one
 * that makes both cases right at once — a `Basic` credential is bounded per
 * ADDRESS (a guesser presenting one has no identity to bound), a `wlo2.` block
 * per `jti` (under a valid access id there is exactly one correct password, so
 * rotating them is guessing no matter how many addresses it comes from).
 *
 * Do not "simplify" this to "blocks are already proven, do not count them":
 * `docs/AUTH.md` §4 — the public key is published, so anyone who learns a `jti`
 * can mint blocks carrying it and any password they like.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  abuseBucketKey,
  credentialFromHeader,
  setAccessSupport,
} from '../src/auth/credential.js';
import { encodeAccessToken, loadAuthKeys, type AccessPayload } from '../src/auth/access-token.js';
import { openRegistry, type AccessRegistry } from '../src/auth/access-registry.js';
import { createDistinctValueLimiter } from '../src/rate-limit.js';

const T0 = 1_000_000; // fixed base clock (ms); tests inject all timestamps
const WINDOW = 600_000;

function pkcs8(): string {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}
const KEY = pkcs8();

/** Install real key material and a real registry; torn down after each test. */
async function withSupport(t: { after: (fn: () => void) => void }): Promise<AccessRegistry> {
  const dir = mkdtempSync(join(tmpdir(), 'wlo-relay-'));
  const registry = await openRegistry(join(dir, 'registry.json'));
  assert.ok(registry);
  const keys = loadAuthKeys({ current: KEY });
  assert.ok(keys);
  setAccessSupport({ keys, registry });
  t.after(() => {
    setAccessSupport(null);
    rmSync(dir, { recursive: true, force: true });
  });
  return registry;
}

function blockHeader(p: AccessPayload): string {
  const keys = loadAuthKeys({ current: KEY });
  assert.ok(keys);
  return `Bearer ${encodeAccessToken(p, keys.publicKeyPem)}`;
}

/** A listed block for one person. Distinct labels: the registry evicts past
 *  MAX_BLOCKS_PER_LABEL, and ten different people is the case under test. */
async function listedBlock(
  registry: AccessRegistry, jti: string, user: string, secret: string,
): Promise<string> {
  await registry.add({ jti, label: user, iat: 1_754_300_000 });
  return blockHeader({ v: 2, jti, u: user, secret, iat: 1_754_300_000 });
}

const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;

test('ten signed-in people behind ONE relay address stay under the cap', async (t) => {
  const registry = await withSupport(t);
  const limiter = createDistinctValueLimiter(3, WINDOW);
  const relay = '10.0.0.1';

  for (let i = 0; i < 10; i++) {
    const header = await listedBlock(registry, `id-${i}`, `person-${i}`, `pw-${i}`);
    const cred = credentialFromHeader(header);
    assert.ok(cred, `block ${i} must authenticate`);
    assert.equal(
      limiter.check(abuseBucketKey(cred, relay), cred.header, T0 + i),
      false,
      `person ${i} was refused — a relay is not a guesser`,
    );
  }
});

test('passwords rotated under ONE access id hit the cap, from any address', async (t) => {
  const registry = await withSupport(t);
  const limiter = createDistinctValueLimiter(3, WINDOW);
  await registry.add({ jti: 'leaked', label: 'opfer', iat: 1_754_300_000 });

  // Same id, different guesses, each from its own address — address rotation is
  // exactly what defeated the address-keyed bucket.
  const addresses = ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4'];
  const refused = addresses.map((ip, i) => {
    const header = blockHeader({
      v: 2, jti: 'leaked', u: 'opfer', secret: `guess-${i}`, iat: 1_754_300_000,
    });
    const cred = credentialFromHeader(header);
    assert.ok(cred);
    return limiter.check(abuseBucketKey(cred, ip), cred.header, T0 + i);
  });

  assert.deepEqual(
    refused, [false, false, false, true],
    'the 4th guess under one access id must be refused despite a fresh address',
  );
});

test('a Basic credential keeps its ADDRESS bucket', () => {
  const limiter = createDistinctValueLimiter(2, WINDOW);
  const guesser = '9.9.9.9';

  const attempt = (pw: string, ip: string) => {
    const cred = credentialFromHeader(basic('opfer', pw));
    assert.ok(cred);
    return limiter.check(abuseBucketKey(cred, ip), cred.header, T0);
  };

  assert.equal(attempt('a', guesser), false);
  assert.equal(attempt('b', guesser), false);
  assert.equal(attempt('c', guesser), true, 'the guard for the guessable scheme must stay');
  assert.equal(attempt('d', '8.8.8.8'), false, 'a different address has its own budget');
});

test('a block and a Basic credential never share a bucket', async (t) => {
  const registry = await withSupport(t);
  const limiter = createDistinctValueLimiter(1, WINDOW);
  const ip = '10.0.0.1';

  const blockCred = credentialFromHeader(await listedBlock(registry, 'id-a', 'anna', 'pw-a'));
  assert.ok(blockCred);
  assert.equal(limiter.check(abuseBucketKey(blockCred, ip), blockCred.header, T0), false);

  // Cap is 1 and the block already spent one entry. If the two shared a bucket,
  // this legitimate Basic login from the same relay would be refused.
  const basicCred = credentialFromHeader(basic('bernd', 'pw-b'));
  assert.ok(basicCred);
  assert.equal(
    limiter.check(abuseBucketKey(basicCred, ip), basicCred.header, T0 + 1),
    false,
    'one scheme must not spend the other\'s budget',
  );
});
