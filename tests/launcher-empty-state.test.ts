/**
 * The launcher's test search printed "Keine Treffer für …" over an envelope
 * whose buckets said `incomplete` (a source did not answer) or `more` (the page
 * is exhausted, the catalogue is not). "No results" is a statement about the
 * catalogue; over those two it is false.
 *
 * The launcher is a self-contained page, so the shipped functions are taken out
 * of its source and run here (same approach as `launcher-safe-url.test.ts`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = ['../public/launcher.html', '../public/launcher.js']
  .map(rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')).join('\n');

function extractFunction(name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `function ${name}() not found in the launcher`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces extracting ${name}()`);
}

/** The string table, as the page ships it. */
function stringTable(): Record<'de' | 'en', Record<string, string>> {
  const start = source.indexOf('var I18N = ');
  assert.notEqual(start, -1, 'I18N table not found');
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) {
      return new Function(`return (${source.slice(bodyStart, i + 1)});`)() as Record<'de' | 'en', Record<string, string>>;
    }
  }
  throw new Error('unbalanced I18N table');
}

/** `renderRaw` with the page around it replaced by recorders. */
function harness(lang: 'de' | 'en') {
  const I18N = stringTable();
  const status: { msg: string; kind: string | null }[] = [];
  const list = { textContent: '', hidden: false, appendChild() { /* not looked at */ } };
  const make = new Function('I18N', 'lang', 'setStatus', '$', 'document', `
    function t(key) { return (I18N[lang] && I18N[lang][key]) || I18N.de[key] || key; }
    ${extractFunction('bucketCount')}
    ${extractFunction('safeUrl')}
    ${extractFunction('emptyStatusKey')}
    ${extractFunction('renderRaw')}
    return renderRaw;`);
  const renderRaw = make(I18N, lang, (_node: string, msg: string, kind: string | null) => status.push({ msg, kind }),
    () => list, { createElement: () => ({ appendChild() { /* unused */ } }) }) as (data: unknown, q: string) => void;
  return { renderRaw, status };
}

const empty = { total: 0, count: 0, results: [] };
const envelope = (over: Record<string, unknown> = {}) => ({ query: 'optik', content: empty, collections: empty, topicPages: empty, ...over });

test('launcher: an empty answer with nothing withheld still says "no results"', () => {
  for (const [lang, expected] of [['de', /Keine Treffer für „optik“/], ['en', /No results for “optik”/]] as const) {
    const { renderRaw, status } = harness(lang);
    renderRaw(envelope(), 'optik');
    assert.match(status.at(-1)!.msg, expected);
  }
});

for (const bucket of ['content', 'collections', 'topicPages']) {
  test(`launcher: an empty answer whose ${bucket} bucket is incomplete is not "no results"`, () => {
    for (const [lang, expected] of [['de', /nicht vollständig geantwortet/], ['en', /did not answer in full/]] as const) {
      const { renderRaw, status } = harness(lang);
      renderRaw(envelope({ [bucket]: { ...empty, incomplete: true } }), 'optik');
      const said = status.at(-1)!;
      assert.match(said.msg, expected);
      assert.doesNotMatch(said.msg, /Keine Treffer für|No results for/);
      assert.match(said.msg, /optik/, 'the query is still named');
    }
  });
}

test('launcher: an exhausted page (`more`) says the catalogue holds more, not "no results"', () => {
  for (const [lang, expected] of [['de', /der Katalog hält mehr/], ['en', /the catalogue holds more/]] as const) {
    const { renderRaw, status } = harness(lang);
    renderRaw(envelope({ content: { ...empty, more: { nextSkipCount: 100 } } }), 'optik');
    assert.match(status.at(-1)!.msg, expected);
    assert.doesNotMatch(status.at(-1)!.msg, /Keine Treffer für|No results for/);
  }
});

test('launcher: an outage outranks "there is more" — it is the one a retry can change', () => {
  const { renderRaw, status } = harness('de');
  renderRaw(envelope({ content: { ...empty, more: { nextSkipCount: 100 } }, collections: { ...empty, incomplete: true } }), 'optik');
  assert.match(status.at(-1)!.msg, /nicht vollständig geantwortet/);
});

test('launcher: with hits on screen, an incomplete bucket is said beside the counts', () => {
  for (const [lang, expected] of [['de', /Suche unvollständig/], ['en', /search incomplete/i]] as const) {
    const { renderRaw, status } = harness(lang);
    const hits = { total: 1, count: 1, results: [{ nodeId: 'a', title: 'A', url: 'https://example.org/a' }] };
    renderRaw(envelope({ content: hits, collections: { ...empty, incomplete: true } }), 'optik');
    assert.match(status.at(-1)!.msg, expected);
    const { renderRaw: plain, status: plainStatus } = harness(lang);
    plain(envelope({ content: hits }), 'optik');
    assert.doesNotMatch(plainStatus.at(-1)!.msg, expected);
  }
});

test('launcher: every new sentence exists in both languages', () => {
  const table = stringTable();
  for (const key of ['search_incomplete', 'no_hits_more', 'incomplete_suffix']) {
    assert.ok(table.de[key], `de.${key}`);
    assert.ok(table.en[key], `en.${key}`);
  }
});
