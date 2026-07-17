import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveRootCollectionId } from '../src/wlo-config.js';

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
