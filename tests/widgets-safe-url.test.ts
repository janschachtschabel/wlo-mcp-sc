import { test } from 'node:test';
import assert from 'node:assert/strict';

import { safeHref } from '../src/apps/widgets/shared/safe-url.js';

test('safeHref keeps http/https/mailto URLs unchanged', () => {
  for (const u of ['https://example.org/x', 'http://a.b/c?d=e#f', 'mailto:info@example.org']) {
    assert.equal(safeHref(u), u);
  }
});

test('safeHref drops dangerous URL schemes (case-insensitive)', () => {
  for (const u of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    '  javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
  ]) {
    assert.equal(safeHref(u), '', `expected empty for ${JSON.stringify(u)}`);
  }
});

test('safeHref returns empty for missing/blank input', () => {
  assert.equal(safeHref(undefined), '');
  assert.equal(safeHref(null), '');
  assert.equal(safeHref(''), '');
  assert.equal(safeHref('   '), '');
});

test('safeHref keeps relative and protocol-relative http(s) links', () => {
  assert.equal(safeHref('/foo/bar'), '/foo/bar');
  assert.equal(safeHref('//example.org/x'), '//example.org/x');
});
