/**
 * launcher-copy.test.ts – the launcher's clipboard helper copies what it is given.
 *
 * Written because it did not. `copyText(text)` had two callers with the same
 * shape and only one of them was right: the fallback branch ignored its `text`
 * argument entirely and always selected `#prompt`, then resolved. That was
 * invisible while the only caller copied the instructions — which is what
 * `#prompt` holds — and became a defect the moment a second caller passed the
 * MCP address.
 *
 * Reproduced in a browser on 2026-08-06: with `navigator.clipboard` removed,
 * pressing "Adresse kopieren" left the clipboard untouched (`#prompt` sits
 * inside a collapsed `<details>` and cannot even be focused) while the page
 * said "Adresse in die Zwischenablage kopiert." A person then pastes whatever
 * was already in their clipboard into their AI app's connector field.
 *
 * Two properties are pinned, and the second is the one that makes a failure
 * honest: `execCommand` REPORTS failure by returning false rather than throwing,
 * and the old code ignored the return value.
 *
 * Same technique as `launcher-safe-url.test.ts`: the shipped function is
 * extracted from `launcher.html` and exercised, so a rewrite that reintroduces
 * the bug fails here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../public/launcher.html', import.meta.url)), 'utf8');

/** Slice out a top-level `function <name>(…) { … }` by brace-matching its body. */
function extractFunction(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `function ${name}() not found in launcher.html — renamed or removed?`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces extracting ${name}() from launcher.html`);
}

const source = extractFunction(html, 'copyText');

interface Recorded {
  /** What the clipboard ended up holding, or null if nothing was copied. */
  clipboard: string | null;
  /** Elements still attached when the call finished — a leak shows up here. */
  leftInDom: number;
}

/**
 * Minimal DOM the helper touches. Deliberately not jsdom: the surface is four
 * calls, and a fake makes the assertion — "what did the copy actually take?" —
 * directly observable.
 */
function harness(opts: { clipboard: boolean; execSucceeds?: boolean }) {
  const rec: Recorded = { clipboard: null, leftInDom: 0 };
  const attached: unknown[] = [];

  const element = () => {
    const el = {
      value: '',
      style: {} as Record<string, string>,
      tabIndex: 0,
      setAttribute() { /* the helper sets readonly/aria-hidden; not under test */ },
      select() { selected = el; },
    };
    return el;
  };
  let selected: { value: string } | null = null;

  const doc = {
    createElement: () => element(),
    body: {
      appendChild(node: unknown) { attached.push(node); },
      removeChild(node: unknown) {
        const i = attached.indexOf(node);
        if (i >= 0) attached.splice(i, 1);
      },
    },
    execCommand(cmd: string) {
      if (cmd !== 'copy') return false;
      const ok = opts.execSucceeds !== false;
      // The clipboard takes whatever is SELECTED — which is the whole point:
      // a helper that selects the wrong element copies the wrong text.
      if (ok) rec.clipboard = selected ? selected.value : null;
      return ok;
    },
  };

  const nav = opts.clipboard
    ? { clipboard: { writeText: (t: string) => { rec.clipboard = t; return Promise.resolve(); } } }
    : {};

  const fn = new Function('document', 'navigator', `${source} return copyText;`)(doc, nav) as
    (text: string) => Promise<void>;

  return { fn, rec, done: () => { rec.leftInDom = attached.length; return rec; } };
}

const ADDRESS = 'https://wlo.example.org/mcp';

test('without the Clipboard API the given text is what gets copied', async () => {
  const h = harness({ clipboard: false });
  await h.fn(ADDRESS);
  assert.equal(h.done().clipboard, ADDRESS, 'the fallback must copy its argument, not a fixed element');
});

/**
 * The other half of the false "copied" message: a refused copy must reject, so
 * the caller shows its error text instead of reporting success.
 */
test('a copy the browser refuses is reported as a failure, not as success', async () => {
  const h = harness({ clipboard: false, execSucceeds: false });
  await assert.rejects(h.fn(ADDRESS), 'execCommand returning false must not resolve');
});

test('with the Clipboard API the given text is passed straight through', async () => {
  const h = harness({ clipboard: true });
  await h.fn(ADDRESS);
  assert.equal(h.rec.clipboard, ADDRESS);
});

test('the fallback leaves no element behind, on success or failure', async () => {
  const ok = harness({ clipboard: false });
  await ok.fn(ADDRESS);
  assert.equal(ok.done().leftInDom, 0, 'after a successful copy');

  const bad = harness({ clipboard: false, execSucceeds: false });
  await bad.fn(ADDRESS).catch(() => { /* the rejection is asserted above */ });
  assert.equal(bad.done().leftInDom, 0, 'and after a refused one');
});
