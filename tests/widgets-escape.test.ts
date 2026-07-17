import { test } from 'node:test';
import assert from 'node:assert/strict';

import { escapeHtml } from '../src/apps/widgets/shared/escape.js';

test('escapeHtml neutralizes every HTML-significant character', () => {
  assert.equal(
    escapeHtml('<script>alert("x")</script>'),
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
  );
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
  assert.equal(escapeHtml("it's"), 'it&#39;s');
});

test('escapeHtml leaves safe unicode text unchanged', () => {
  assert.equal(escapeHtml('Photosynthese – Grundlagen (Biologie)'), 'Photosynthese – Grundlagen (Biologie)');
});

test('escapeHtml coerces non-string input to a safe empty string', () => {
  // Widget payloads come from an external backend; a missing field must not throw.
  assert.equal(escapeHtml(undefined as unknown as string), '');
  assert.equal(escapeHtml(null as unknown as string), '');
});
