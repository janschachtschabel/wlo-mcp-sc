/**
 * vocabs-quality-scale.test.ts – invariants of the GENERATED scale table.
 *
 * The table mirrors the metadata set, so its content is not asserted here — a
 * caption is whatever the repository declares. What is asserted is the shape a
 * consumer relies on, because the file is rewritten by
 * `scripts/generate-quality-scales.mjs` and a regeneration is the one moment
 * these properties can quietly change.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { QUALITY_SCALES } from '../src/vocabs-quality-scale.js';

test('no caption carries surrounding whitespace', () => {
  // Measured 2026-08-19: the repository declares `quality_currentness/0` as
  // " 0-A veralteter Inhalt", with a leading space. `validateField` trims every
  // incoming value while the caption lookup compares untrimmed, so that one
  // position could not be written back by its own caption — the input form both
  // the parameter description and the refusal promise. It also rendered as
  // "Aktualität:  0-A …".
  //
  // The fix is in the generator, which is why the guard is on the DATA and not
  // on one rendered example: the next caption to arrive with a space would be a
  // different field, and a test pinning `currentness/0` would stay green.
  const offenders: string[] = [];
  for (const [property, scale] of Object.entries(QUALITY_SCALES)) {
    for (const [key, value] of Object.entries(scale)) {
      if (value.caption !== value.caption.trim()) offenders.push(`${property}/${key}`);
    }
  }
  assert.deepEqual(offenders, [],
    'regenerate with scripts/generate-quality-scales.mjs — it trims');
});
