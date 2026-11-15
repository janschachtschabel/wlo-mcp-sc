import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Regression (live 2026-07-17): the browse tree flickered and the viewport
// jumped on every expand in ChatGPT. Root cause — paint() re-focuses the
// toggle with element.focus(), which scroll-into-views the element by default,
// jerking the host iframe. Fix: focus({ preventScroll: true }) keeps the a11y
// focus (WCAG 2.4.3) without scrolling. Same pattern + fix in the
// search-results detail view. These main.ts files are DOM/host glue (excluded
// from tsc, verified live), so pin the fix at source level.
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

for (const rel of ['../src/apps/widgets/browse/main.ts', '../src/apps/widgets/search-results/main.ts']) {
  test(`${rel}: focus() passes preventScroll (no viewport jump on repaint)`, () => {
    const src = read(rel);
    assert.match(src, /\.focus\(\{\s*preventScroll:\s*true\s*\}\)/, 'focus must pass { preventScroll: true }');
    assert.doesNotMatch(src, /\.focus\(\)/, 'no bare .focus() (default scroll-into-view jerks the iframe)');
  });
}
