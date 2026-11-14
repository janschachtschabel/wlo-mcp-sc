/**
 * widgets-error.test.ts – A widget whose tool call FAILED must say so.
 *
 * A failed call delivers `structuredContent: { error: { code, message } }`
 * (`toolError` / `codedErrorResult`) or, from a host that forwards the bare
 * result, `isError: true` — and a host that never delivers anything ends the
 * wait through the grace timer. All three used to reach the renderers, which
 * found no results in the payload and answered "Keine Treffer gefunden.": an
 * outage read as "nothing in the catalogue".
 *
 * Same rule as the loading state: "failed" is a term of its own, decided by the
 * shell before the renderer runs, never inferred from an empty payload.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createHost } from '../src/apps/widgets/shared/host.js';
import { failureOf, failureMessage, renderError } from '../src/apps/widgets/shared/failure.js';
import { renderSearchResults } from '../src/apps/widgets/search-results/render.js';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('failureOf: a coded error result is a failure and keeps its code and wait', () => {
  assert.deepEqual(
    failureOf({ error: { code: 'upstream_busy', message: 'x', retryAfter: 12 } }, false),
    { kind: 'error', code: 'upstream_busy', retryAfter: 12 },
  );
  assert.deepEqual(failureOf({ error: { code: 'timeout', message: 'x' } }, false), { kind: 'error', code: 'timeout' });
});

test('failureOf: a bare isError result is a failure too', () => {
  // The standard bridge hands over the whole params object when the result
  // carries no structuredContent (see host-bridge.ts `parseInbound`).
  assert.deepEqual(failureOf({ isError: true, content: [] }, false), { kind: 'error' });
});

test('failureOf: an expired wait with nothing delivered is a timeout', () => {
  assert.deepEqual(failureOf(undefined, true), { kind: 'timeout' });
  assert.deepEqual(failureOf(null, true), { kind: 'timeout' });
});

test('failureOf: an ordinary or empty result is NOT a failure', () => {
  assert.equal(failureOf({ query: 'x', results: [] }, false), null);
  assert.equal(failureOf(undefined, false), null, 'nothing yet is the loading state, not an error');
  // Shapes that only look similar must not flip a good answer into an error.
  assert.equal(failureOf({ error: null, results: [] }, false), null);
  assert.equal(failureOf({ error: 'text', results: [] }, false), null);
  assert.equal(failureOf({ isError: false, results: [] }, false), null);
  // A result that arrived wins over an expired timer.
  assert.equal(failureOf({ results: [] }, true), null);
});

test('failureOf: a caller-shaped code or wait is not trusted as-is', () => {
  const f = failureOf({ error: { code: 42, retryAfter: 'soon' } }, false);
  assert.deepEqual(f, { kind: 'error' });
  assert.deepEqual(failureOf({ error: { code: 'x', retryAfter: -3 } }, false), { kind: 'error', code: 'x' });
});

test('renderError says the call failed — in both locales, never as an empty result', () => {
  const de = renderError('de', { kind: 'error', code: 'upstream_error' });
  const en = renderError('en', { kind: 'error', code: 'upstream_error' });
  assert.match(de, /konnten nicht geladen werden/);
  assert.match(en, /could not be loaded/);
  for (const html of [de, en, renderError('de', { kind: 'timeout' })]) {
    assert.doesNotMatch(html, /Keine Treffer gefunden|No results found|kein Text hinterlegt/);
    assert.match(html, /class="wlo-error"/);
  }
});

test('renderError: a timeout has its own sentence, and a known wait is named', () => {
  assert.match(renderError('de', { kind: 'timeout' }), /keine Antwort/i);
  assert.match(renderError('en', { kind: 'timeout' }), /no answer/i);
  assert.match(renderError('de', { kind: 'error', code: 'upstream_busy', retryAfter: 12 }), /12/);
  assert.doesNotMatch(renderError('de', { kind: 'error', code: 'upstream_busy' }), /\d/);
});

test('renderError escapes — nothing from the payload reaches the markup raw', () => {
  const failure = failureOf({ error: { code: '<img src=x onerror=alert(1)>', message: '<script>x</script>' } }, false);
  const html = renderError('de', failure!);
  assert.doesNotMatch(html, /<img|<script/);
});

test('a refusal is not called a failed request', () => {
  for (const code of ['not_found', 'forbidden', 'access_denied', 'node_not_found']) {
    assert.match(failureMessage('de', { kind: 'error', code }), /nicht vorhanden oder mit dieser Anmeldung nicht lesbar/, code);
    assert.match(failureMessage('en', { kind: 'error', code }), /does not exist or cannot be read/, code);
  }
  // An outage keeps the sentence that says "this is not 'nothing there'".
  assert.match(failureMessage('de', { kind: 'error', code: 'upstream_error' }), /Abruf ist fehlgeschlagen/);
  assert.match(failureMessage('de', { kind: 'timeout', code: 'not_found' }), /./);
});

test('failureMessage is the sentence the live region speaks', () => {
  assert.match(failureMessage('de', { kind: 'error' }), /konnten nicht geladen werden/);
  assert.ok(renderError('de', { kind: 'error' }).includes(failureMessage('de', { kind: 'error' })));
});

// ── host: the expired wait is its own term ──────────────────────────────────

function stubHostEnv(openai?: unknown): { timers: Array<() => void>; restore: () => void } {
  const g = globalThis as any;
  const hadWindow = 'window' in g;
  const previousWindow = g.window;
  const previousSetTimeout = g.setTimeout;
  const timers: Array<() => void> = [];
  const win: any = { ...(openai ? { openai } : {}), addEventListener: () => {}, postMessage: () => {} };
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

test('host.timedOut: false while waiting, true once the wait expired with nothing', () => {
  const env = stubHostEnv({ toolOutput: null });
  try {
    const host = createHost();
    assert.equal(host.timedOut(), false, 'still inside the grace window');
    env.timers[0]!();
    assert.equal(host.timedOut(), true);
  } finally { env.restore(); }
});

test('host.timedOut: stays false for a widget that has its result', () => {
  const openai: any = { toolOutput: null };
  const env = stubHostEnv(openai);
  try {
    const host = createHost();
    openai.toolOutput = { results: [] };
    env.timers[0]!();
    assert.equal(host.timedOut(), false, 'an EMPTY result has still arrived');
  } finally { env.restore(); }
});

// ── every shell decides "failed" before its renderer runs ───────────────────

const SHELLS = [
  '../src/apps/widgets/search-results/main.ts',
  '../src/apps/widgets/browse/main.ts',
  '../src/apps/widgets/reading/main.ts',
  '../src/apps/widgets/shared/mount.ts',
];

for (const rel of SHELLS) {
  test(`${rel}: renders the error state for a failed or unanswered call`, () => {
    const src = read(rel);
    assert.match(src, /failureOf\s*\(/, 'must ask whether the result is a failure');
    assert.match(src, /timedOut\s*\(\s*\)/, 'must count an expired wait as one');
    assert.match(src, /renderError\s*\(/, 'must render the error state');
    assert.match(src, /failureMessage\s*\(/, 'must hand the sentence to the live region');
  });
}

// ── the live region speaks the failure ──────────────────────────────────────

function fakeAnnounceDom(): { byId: Map<string, any>; restore: () => void } {
  const g = globalThis as any;
  const had = 'document' in g;
  const previous = g.document;
  const byId = new Map<string, any>();
  g.document = {
    getElementById: (id: string) => byId.get(id) ?? null,
    createElement: () => ({
      id: '', className: '', textContent: '',
      attrs: {} as Record<string, string>,
      setAttribute(key: string, value: string) { this.attrs[key] = value; },
    }),
    body: { appendChild: (el: any) => { byId.set(el.id, el); } },
  };
  return { byId, restore: () => { if (had) g.document = previous; else delete g.document; } };
}

test('a failed call is announced as a failure, never as "geladen"', async () => {
  const dom = fakeAnnounceDom();
  try {
    const { announceArrival } = await import('../src/apps/widgets/shared/announce.js');
    announceArrival(true, false, 'de');
    // The error result HAS output (structuredContent.error) — it must not be
    // taken for an arrival.
    announceArrival(false, true, 'de', 'Fehlgeschlagen.');
    const region = dom.byId.get('wlo-live');
    assert.equal(region.textContent, 'Fehlgeschlagen.');

    // A later repaint of the same failure does not speak again …
    region.textContent = '';
    announceArrival(false, true, 'de', 'Fehlgeschlagen.');
    assert.equal(region.textContent, '');

    // … and a result that follows a failure is not announced as an arrival
    // of a wait that ended long ago.
    announceArrival(false, true, 'de');
    assert.equal(region.textContent, '');
  } finally { dom.restore(); }
});

test('an expired wait is announced through the same region', async () => {
  const dom = fakeAnnounceDom();
  try {
    const { announceArrival } = await import('../src/apps/widgets/shared/announce.js');
    announceArrival(true, false, 'de');
    announceArrival(false, false, 'de', 'Keine Antwort.');
    assert.equal(dom.byId.get('wlo-live').textContent, 'Keine Antwort.');
  } finally { dom.restore(); }
});

// The renderers keep their job: an empty payload is still an empty result.
test('an empty payload still renders the empty result, not an error', () => {
  assert.match(renderSearchResults({ query: 'x', total: 0, count: 0, results: [] }, 'de'), /Keine Treffer gefunden/);
});
