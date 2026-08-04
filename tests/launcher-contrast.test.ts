/**
 * launcher-contrast.test.ts – the launcher's interactive controls must be
 * visible, not just its text.
 *
 * WCAG 2.2 SC 1.4.11 asks for 3:1 on the boundary of a UI component — a field,
 * a chip, a button. It is the criterion that decides whether someone can see
 * *where the input is* on a bright screen or with reduced contrast vision, and
 * it is easy to miss because the TEXT ratios pass and the page looks fine to
 * whoever built it. Measured against the running page (2026-08-04): the border
 * on `#q`, `#educationalContext`, `#prompt` and the buttons came out at
 * **1.90:1** in dark mode.
 *
 * The rule tested here is the property, not a token name: for each interactive
 * rule, take the border colour and the background it actually sits on, resolve
 * both in each scheme, and compare. Renaming a token or changing a hex keeps the
 * test meaningful; only a real regression turns it red.
 *
 * Decorative borders (cards, dividers, `details`) are deliberately NOT covered —
 * `--border` keeps its job there, where no criterion applies.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('../public/launcher.html', import.meta.url)), 'utf8');

/** Selectors whose border IS the visible edge of something a person operates. */
const CONTROLS = [
  '.lang',
  '.chip span',
  'button.btn, a.btn',
  'input[type="text"], input[type="search"], select, textarea',
];

/** Relative luminance per WCAG 2.x, from a `#rrggbb` literal. */
function luminance(hex: string): number {
  const v = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  assert.ok(v, `expected a 6-digit hex colour, got ${hex}`);
  const channels = [0, 2, 4].map((i) => parseInt(v[1]!.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** The custom properties declared in one `:root` block. */
function declarations(block: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const m of block.matchAll(/(--[\w-]+):\s*([^;]+);/g)) map[m[1]!] = m[2]!.trim();
  return map;
}

function tokens(scheme: 'light' | 'dark'): Record<string, string> {
  const rootStart = css.indexOf(':root {');
  const light = declarations(css.slice(rootStart, css.indexOf('}', rootStart)));
  if (scheme === 'light') return light;
  // The dark block overrides a subset; anything it leaves out keeps its light value.
  const darkStart = css.indexOf(':root {', css.indexOf('@media (prefers-color-scheme: dark)'));
  return { ...light, ...declarations(css.slice(darkStart, css.indexOf('}', darkStart))) };
}

/** The declaration body of one rule, by its exact selector text. */
function ruleBody(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `selector not found in launcher.html: ${selector}`);
  return css.slice(at, css.indexOf('}', at));
}

for (const scheme of ['light', 'dark'] as const) {
  test(`every interactive control on the launcher has a visible border (${scheme})`, () => {
    const t = tokens(scheme);
    for (const selector of CONTROLS) {
      const body = ruleBody(selector);
      const borderVar = /border:[^;]*var\((--[\w-]+)\)/.exec(body)?.[1];
      assert.ok(borderVar, `${selector} declares its border through a token`);
      // Its own background where the rule states one; otherwise the surface it
      // is drawn on. `.lang` has none of its own and sits on a card.
      const bgVar = /background:\s*var\((--[\w-]+)\)/.exec(body)?.[1] ?? '--surface';

      const ratio = contrast(t[borderVar]!, t[bgVar]!);
      assert.ok(
        ratio >= 3,
        `${selector} in ${scheme}: border ${borderVar} (${t[borderVar]}) on ${bgVar} ` +
        `(${t[bgVar]}) is ${ratio.toFixed(2)}:1 — WCAG 1.4.11 wants 3:1`,
      );
    }
  });
}
