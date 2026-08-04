/**
 * access-setup.test.ts – switching the access-block feature on at boot (P6).
 *
 * `http.ts` starts listening on import and therefore cannot be imported by a
 * test, which is exactly how five raw `parseInt` calls once survived in it (see
 * env-parsing-discipline.test.ts). So the decision "is this feature on, and with
 * what" lives in a pure function here, and the entry point only calls it.
 *
 * Both ways of being off must be distinguishable in the log but identical in
 * effect: nothing configured (the ordinary deployment) and misconfigured (a
 * corrupt registry, an unusable key) both yield null — never a half-enabled
 * state where the pages issue blocks the header path would refuse.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveAccessSupport } from '../src/auth/access-setup.js';

const KEY = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

function dir(t: { after: (fn: () => void) => void }): string {
  const d = mkdtempSync(join(tmpdir(), 'wlo-setup-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

test('no key material means the feature is off and nothing is written', async (t) => {
  const d = dir(t);
  const registryPath = join(d, 'registry.json');
  assert.equal(await resolveAccessSupport({ registryPath }), null);
  assert.equal(
    existsSync(registryPath), false,
    'a deployment that does not use the feature must not gain a registry file',
  );
});

test('a key plus a fresh path switches the feature on', async (t) => {
  const support = await resolveAccessSupport({ key: KEY, registryPath: join(dir(t), 'registry.json') });
  assert.ok(support);
  assert.match(support.keys.publicKeyPem, /BEGIN PUBLIC KEY/);
  assert.equal(support.registry.has('anything'), false);
});

test('a corrupt registry leaves the feature off rather than half on', async (t) => {
  const registryPath = join(dir(t), 'registry.json');
  writeFileSync(registryPath, 'not json at all', 'utf8');
  assert.equal(await resolveAccessSupport({ key: KEY, registryPath }), null);
});

test('an unusable key leaves the feature off', async (t) => {
  const registryPath = join(dir(t), 'registry.json');
  assert.equal(await resolveAccessSupport({ key: 'nonsense', registryPath }), null);
  assert.equal(await resolveAccessSupport({ key: KEY, previousKey: 'nonsense', registryPath }), null);
});

test('the rotation window is carried through', async (t) => {
  const previous = generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const support = await resolveAccessSupport({
    key: KEY, previousKey: previous, registryPath: join(dir(t), 'registry.json'),
  });
  assert.ok(support);
  assert.equal(support.keys.privateKeys.length, 2, 'both keys must be available for decryption');
});
