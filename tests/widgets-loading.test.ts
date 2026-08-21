/**
 * widgets-loading.test.ts – A widget that is still waiting must not report a
 * result.
 *
 * User report (ChatGPT, 2026-08-21): every widget showed "Keine Treffer
 * gefunden." while the tool call was still running. The cause is one line
 * repeated in all four shells — `render(host.toolOutput(), …)` painted at mount
 * time, and `toolOutput` is null until the host delivers the result, so the
 * renderers correctly rendered their EMPTY-payload state over a payload that
 * had not arrived.
 *
 * The reading widget was the worst of the four: its miss-reason fallback says
 * "Zu diesem Material ist kein Text hinterlegt." — a factual claim about the
 * material, made before anything was read.
 *
 * This is the same rule the server side already follows for `registryChecked`
 * and `content.licenseFilter`: "not answered yet" is its own term and is never
 * inferred from an empty value. Here the term is `host.awaitingOutput()`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createHost } from '../src/apps/widgets/shared/host.js';
import { renderLoading } from '../src/apps/widgets/shared/loading.js';
import { renderReading } from '../src/apps/widgets/reading/render.js';
import { renderSearchResults } from '../src/apps/widgets/search-results/render.js';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('renderLoading says it is loading — in both locales, never as a result', () => {
  const de = renderLoading('de');
  const en = renderLoading('en');

  assert.match(de, /geladen/i, 'German loading copy');
  assert.match(en, /loading/i, 'English loading copy');

  // The whole point: it must not read as an answer about the content.
  for (const html of [de, en]) {
    assert.doesNotMatch(html, /Keine Treffer|No results|kein Text|no text/i);
  }
});

test('renderLoading is announced politely and its skeleton is decorative', () => {
  const html = renderLoading('de');
  // A status region: screen readers announce the change without interrupting.
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  // The placeholder bars carry no information — announcing them would be noise.
  assert.match(html, /aria-hidden="true"/);
});

/**
 * The four shells that paint a widget. Each must consult `awaitingOutput()`
 * BEFORE handing anything to its renderer — `topic-page/main.ts` does it
 * through the shared `mount.ts`, which is why that file stands in for it.
 */
const SHELLS = [
  '../src/apps/widgets/search-results/main.ts',
  '../src/apps/widgets/browse/main.ts',
  '../src/apps/widgets/reading/main.ts',
  '../src/apps/widgets/shared/mount.ts',
];

for (const rel of SHELLS) {
  test(`${rel}: renders the loading state while no tool output has arrived`, () => {
    const src = read(rel);
    assert.match(src, /renderLoading\s*\(/, 'must render the loading state');
    assert.match(src, /awaitingOutput\s*\(\s*\)/, 'must ask the host whether a result is still expected');
  });
}

/**
 * Enough of a browser to construct the real host. `host.ts` is DOM glue, but
 * `createHost` touches only `window` (globals + two listeners) and one
 * `setTimeout` — capturing that timer beats a fake-timer API, which is still
 * experimental in Node and would tie the suite to a runtime detail.
 */
function stubHostEnv(openai?: unknown): {
  timers: Array<() => void>;
  restore: () => void;
} {
  const g = globalThis as any;
  const hadWindow = 'window' in g;
  const previousWindow = g.window;
  const previousSetTimeout = g.setTimeout;
  const timers: Array<() => void> = [];

  const win: any = {
    ...(openai ? { openai } : {}),
    addEventListener: () => {},
    postMessage: () => {},
  };
  win.parent = win;
  g.window = win;
  g.setTimeout = (fn: () => void) => { timers.push(fn); return 0; };

  return {
    timers,
    restore: () => {
      g.setTimeout = previousSetTimeout;
      if (hadWindow) g.window = previousWindow; else delete g.window;
    },
  };
}

test('awaitingOutput: pending while nothing has arrived, done once it has', () => {
  const pending = stubHostEnv({ toolOutput: null });
  try {
    assert.equal(createHost().awaitingOutput(), true, 'ChatGPT reports a running call as null');
  } finally { pending.restore(); }

  // An EMPTY result has still arrived — that is the whole distinction, and it
  // is why arrival is a term of its own rather than "the payload looks empty".
  const answered = stubHostEnv({ toolOutput: { content: { results: [] } } });
  try {
    assert.equal(createHost().awaitingOutput(), false);
  } finally { answered.restore(); }
});

test('the grace window ends a wait nothing answered, and tells the shells once', () => {
  const env = stubHostEnv({ toolOutput: null });
  try {
    const host = createHost();
    let paints = 0;
    host.onUpdate(() => { paints++; });

    assert.equal(env.timers.length, 1, 'exactly one timer bounds the wait');
    env.timers[0]!();

    assert.equal(host.awaitingOutput(), false, 'the widget must not sit in a skeleton for ever');
    assert.equal(paints, 1, 'without the repaint the skeleton stays on screen regardless');
  } finally { env.restore(); }
});

test('the grace window does NOT repaint a widget that already has its result', () => {
  // Review finding (2026-08-21): the timer notified unconditionally, so 30 s
  // after EVERY successful mount every widget rebuilt its DOM via innerHTML —
  // destroying keyboard focus (WCAG 2.4.3) and any selection on a screen that
  // had long since rendered its results.
  const openai: any = { toolOutput: null };
  const env = stubHostEnv(openai);
  try {
    const host = createHost();
    let paints = 0;
    host.onUpdate(() => { paints++; });

    openai.toolOutput = { content: { results: [] } }; // the host delivered
    env.timers[0]!();

    assert.equal(paints, 0, 'a rendered widget must not be rebuilt by the timer');
    assert.equal(host.awaitingOutput(), false);
  } finally { env.restore(); }
});

/**
 * The other half of the status story: `role="status"` announces "wird geladen…"
 * once — and then `root.innerHTML` replaces the region wholesale, so the
 * ARRIVAL was never announced (WCAG 4.1.3): a screen-reader user heard
 * "loading" and then silence for ever. The live region therefore lives OUTSIDE
 * the repainted root, is created EMPTY on the first paint (a region inserted
 * together with its text is unreliable in AT), and only the loading→result
 * transition writes into it.
 */
function fakeAnnounceDom(): { byId: Map<string, any>; created: () => number; restore: () => void } {
  const g = globalThis as any;
  const had = 'document' in g;
  const previous = g.document;
  const byId = new Map<string, any>();
  let created = 0;
  g.document = {
    getElementById: (id: string) => byId.get(id) ?? null,
    createElement: () => {
      created += 1;
      return {
        id: '', className: '', textContent: '',
        attrs: {} as Record<string, string>,
        setAttribute(key: string, value: string) { this.attrs[key] = value; },
      };
    },
    body: { appendChild: (el: any) => { byId.set(el.id, el); } },
  };
  return { byId, created: () => created, restore: () => { if (had) g.document = previous; else delete g.document; } };
}

test('the arrival of a result is announced — once, into a persistent region', async () => {
  const dom = fakeAnnounceDom();
  try {
    const { announceArrival } = await import('../src/apps/widgets/shared/announce.js');

    // First paint, still loading: the region exists EMPTY, ready to fire later.
    announceArrival(true, false, 'de');
    const region = dom.byId.get('wlo-live');
    assert.ok(region, 'region is created before it is needed');
    assert.equal(region.attrs['role'], 'status');
    assert.equal(region.attrs['aria-live'], 'polite');
    assert.equal(region.textContent, '', 'nothing to say yet');

    // The result arrives: exactly this transition is announced.
    announceArrival(false, true, 'de');
    assert.match(region.textContent, /geladen/i);

    // Later repaints (theme, selection) must not re-announce or duplicate.
    announceArrival(false, true, 'de');
    assert.equal(dom.created(), 1, 'one region for the lifetime of the mount');
  } finally {
    dom.restore();
  }
});

test('a wait that expires with NOTHING announces nothing', async () => {
  const dom = fakeAnnounceDom();
  try {
    const { announceArrival } = await import('../src/apps/widgets/shared/announce.js');
    // The module keeps its transition state across the previous test — a fresh
    // pending phase resets it, exactly as a fresh mount would.
    announceArrival(true, false, 'de');
    announceArrival(false, false, 'de'); // grace expired, no output
    assert.equal(dom.byId.get('wlo-live')?.textContent, '', '"Inhalte geladen" over an empty view would be false');
  } finally {
    dom.restore();
  }
});

for (const rel of SHELLS) {
  test(`${rel}: reports the loading→result transition to the live region`, () => {
    assert.match(read(rel), /announceArrival\s*\(/, 'every shell must feed the announcer');
  });
}

/**
 * The renderers keep their old behaviour: an EMPTY payload is still an empty
 * result. Only the shell decides which of the two situations it is in — so
 * these two pins guard against "fixing" the wrong layer.
 */
test('an empty payload still renders the empty result, not a loading state', () => {
  assert.match(renderSearchResults({ query: 'x', total: 0, count: 0, results: [] }, 'de'), /Keine Treffer gefunden/);
  assert.match(renderReading({ reason: 'no_text_no_url' }, 'de'), /kein Text hinterlegt/);
});
