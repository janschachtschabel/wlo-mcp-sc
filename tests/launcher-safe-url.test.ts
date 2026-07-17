import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The prompt launcher is a self-contained static page (no build step, no
 * imports), so its `safeUrl()` scheme-guard lives inline in `launcher.html`
 * rather than in a module the harness can import. This test covers the SHIPPED
 * guard by extracting the function from the page source and exercising it — a
 * weakened guard (or a rename/removal) then fails here. Behaviour is pinned to
 * the widgets' `safeHref` (`src/apps/widgets/shared/safe-url.ts`), which the
 * launcher's `safeUrl` mirrors; keep both in sync.
 */

const html = readFileSync(fileURLToPath(new URL('../public/launcher.html', import.meta.url)), 'utf8');

/** Slice out a top-level `function <name>(…) { … }` by brace-matching its body. */
function extractFunction(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `function ${name}() not found in launcher.html — guard renamed or removed?`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces extracting ${name}() from launcher.html`);
}

const source = extractFunction(html, 'safeUrl');
// Guard against extraction silently grabbing the wrong body: the real guard
// tests for the http(s)/mailto scheme allow-list.
assert.match(source, /https\?\|mailto/, 'extracted safeUrl() does not contain the scheme allow-list');

const safeUrl = new Function(`${source} return safeUrl;`)() as (u: unknown) => string;

test('launcher safeUrl keeps http/https/mailto URLs unchanged', () => {
  for (const u of ['https://example.org/x', 'http://a.b/c?d=e#f', 'mailto:info@example.org']) {
    assert.equal(safeUrl(u), u);
  }
});

test('launcher safeUrl drops dangerous URL schemes (case-insensitive)', () => {
  for (const u of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    '  javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
  ]) {
    assert.equal(safeUrl(u), '', `expected empty for ${JSON.stringify(u)}`);
  }
});

test('launcher safeUrl returns empty for missing/blank input', () => {
  assert.equal(safeUrl(undefined), '');
  assert.equal(safeUrl(null), '');
  assert.equal(safeUrl(''), '');
  assert.equal(safeUrl('   '), '');
});

test('launcher safeUrl keeps relative and protocol-relative http(s) links', () => {
  assert.equal(safeUrl('/foo/bar'), '/foo/bar');
  assert.equal(safeUrl('//example.org/x'), '//example.org/x');
});
