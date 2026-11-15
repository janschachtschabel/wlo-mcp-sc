/**
 * The three scans every repository-supplied text passes through must be LINEAR.
 *
 * Each used a regular expression in which two adjacent quantifiers could split
 * one run of characters between them; a value of 40 000 spaces took seconds,
 * and `oneLine` runs over nearly every output line. The old expressions are
 * kept HERE as the reference: the rewrite must agree with them on ordinary
 * input, and must stay fast on the inputs that made them slow.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oneLine } from '../src/text-line.js';
import { parseSections } from '../src/services/markdown-sections.js';
import { parseSkillReferences } from '../src/services/skill-references.js';

const ID_A = '11111111-2222-3333-4444-555555555555';
const ID_B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function timed<T>(fn: () => T): { ms: number; value: T } {
  const t0 = performance.now();
  const value = fn();
  return { ms: performance.now() - t0, value };
}

/** Generous: the old forms needed seconds; a linear scan of 200 000 characters needs a few ms. */
const BOUND_MS = 300;

// ── oneLine ──────────────────────────────────────────────────────────────

const oldOneLine = (v: string) => v.replace(/\s*[\r\n\u0085\u2028\u2029]+\s*/g, ' ');

test('oneLine: same result as the old expression on ordinary values', () => {
  const table = [
    '', 'Titel', 'zwei  Leerzeichen bleiben', ' führend und folgend ',
    'a\nb', 'a\r\nb', 'a \n b', 'a\n\n\nb', '\nvorn', 'hinten\n', 'a\tb\n\tc',
    'a\u2028b', 'a \u2029 b', 'a\u0085b', 'a\r\rb', 'Zeile 1\n## Gefälscht\nnodeId: x',
    'a \nb', 'nur\tTab', '\n', ' \n ', 'a\n \n \nb',
  ];
  for (const v of table) assert.equal(oneLine(v), oldOneLine(v), JSON.stringify(v));
});

test('oneLine: no line break survives, whatever surrounds it', () => {
  for (const v of ['a \u0085 \u0085 b', 'a\u0085 \n\u0085b', 'x\r\u2028\ny']) {
    assert.doesNotMatch(oneLine(v), /[\r\n\u0085\u2028\u2029]/);
  }
});

test('oneLine: a long run of spaces is not quadratic', () => {
  const spaces = ' '.repeat(200_000);
  for (const v of [`a${spaces}b`, `${spaces}b`, `a${spaces}`, `a\n${spaces}b${spaces}c`]) {
    const { ms, value } = timed(() => oneLine(v));
    assert.ok(ms < BOUND_MS, `took ${ms.toFixed(0)} ms`);
    assert.doesNotMatch(value, /\n/);
  }
});

// ── parseSections ────────────────────────────────────────────────────────

const OLD_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const OLD_CLOSING = /(^|[ \t])#+[ \t]*$/;
/** What the old expression made of ONE line: level and title, or null. */
function oldHeading(line: string): { level: number; title: string } | null {
  const m = OLD_HEADING.exec(line);
  return m ? { level: m[1]!.length, title: (m[2] ?? '').replace(OLD_CLOSING, '$1').trim() } : null;
}

test('parseSections: same headings as the old expression on ordinary lines', () => {
  const lines = [
    '# Titel', '## Material', '### Unter  kontext ', '#', '##', '#   ', '#\tTab', '#kein Titel',
    '####### sieben', '   ### drei Leerzeichen', '    # vier', '## Material ##', '## C#', '## a # b',
    '## #', '# \t x \t ', 'Text', '', '## Über schrift mit ä', '# nbsp', '## a\rb', '## a\u2028b',
    '## ', '# #', '##  ##  ',
  ];
  for (const line of lines) {
    const got = parseSections(line);
    const want = oldHeading(line);
    assert.deepEqual(
      got[0] ? { level: got[0].level, title: got[0].title } : null,
      want,
      JSON.stringify(line),
    );
  }
});

test('parseSections: a heading line with a long run of spaces is not quadratic', () => {
  const spaces = ' '.repeat(200_000);
  for (const doc of [`# a${spaces}b`, `#${spaces}b`, `# a${spaces}`, `## a${spaces}#${spaces}x`, `#${spaces}`]) {
    const { ms, value } = timed(() => parseSections(doc));
    assert.ok(ms < BOUND_MS, `took ${ms.toFixed(0)} ms`);
    assert.equal(value.length, 1);
  }
  assert.equal(parseSections(`# a${spaces}b`)[0]!.title, `a${spaces}b`);
  assert.equal(parseSections(`#${spaces}`)[0]!.title, '');
});

// ── parseSkillReferences ─────────────────────────────────────────────────

const OLD_BLOCK = /^:::[ \t]*(wlo-material|ki-skill)[ \t]*\r?$([\s\S]*?)^:::[ \t]*\r?$/gm;
const OLD_TITLE_LINK = /(^|[^!])\[([^\]]+)\]\(([^)\s]+)/;
const OLD_NODE_ID = /(?:[?&]nodeId=|\/components\/render\/)([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/;
/** The old parser, minus the title clean-up (which did not change). */
function oldRefs(markdown: string): { kind: string; rawTitle: string; url: string; nodeId: string; offset: number }[] {
  const out = [];
  const blocks = new RegExp(OLD_BLOCK.source, OLD_BLOCK.flags);
  for (let m = blocks.exec(markdown); m; m = blocks.exec(markdown)) {
    const body = m[2] ?? '';
    const link = OLD_TITLE_LINK.exec(body);
    if (!link) continue;
    out.push({ kind: m[1]!, rawTitle: link[2]!, url: link[3]!, nodeId: OLD_NODE_ID.exec(body)?.[1] ?? '', offset: m.index });
  }
  return out;
}

test('parseSkillReferences: same blocks as the old expression on ordinary documents', () => {
  const skill = `::: ki-skill\n[Skill\\_A](https://x/components/render/${ID_A})\n:::`;
  const material = `::: wlo-material\n![Bild](https://x/preview?nodeId=${ID_B})\n[**Titel**](https://quelle.example/a) — Lizenz: [CC BY](https://l)\n:::`;
  const docs = [
    '', 'nur Text', skill, material, `# Titel\n\nProsa\n\n${skill}\n\n## Kontext\n\n${material}\n\nEnde`,
    skill.replace(/\n/g, '\r\n'), `${skill}\n${skill}`, `:::ki-skill  \n[a](b)\n:::  `,
    `::: ki-skill\n[a](b)\n`,                               // unclosed
    `::: ki-skill\n[a](b)\n::: ki-skill\n[c](d)\n:::`,      // an opener inside an open block
    `::: ki-skill\nkein Link\n:::\n${skill}`,
    `::: anderes\n[a](b)\n:::\n${skill}`,
    `::: ki-skill\n![nur Bild](x)\n:::`, `::: ki-skill\n[]( x)\n[ok](y)\n:::`,
    `::: ki-skill\n[a[b](c)\n:::`, `::: ki-skill\n![[x](y)\n:::`, `::: ki-skill\n[leer]()\n[zwei](z)\n:::`,
    `  ::: ki-skill\n[a](b)\n:::`, `::: ki-skill x\n[a](b)\n:::`, `::: ki-skill\n[a](b) :::\n:::`,
    `::: ki-skill\n[a\nb](c)\n:::`, `::: ki-skill\n[a](b c)\n:::`,
  ];
  for (const doc of docs) {
    const got = parseSkillReferences(doc);
    const want = oldRefs(doc);
    assert.deepEqual(
      got.map(r => ({ kind: r.kind, url: r.url, nodeId: r.nodeId, offset: r.offset })),
      want.map(r => ({ kind: r.kind, url: r.url, nodeId: r.nodeId, offset: r.offset })),
      JSON.stringify(doc),
    );
  }
});

test('parseSkillReferences: many unclosed openers are not quadratic', () => {
  const unclosed = '::: ki-skill\n[a](b)\n'.repeat(10_000);          // 200 000 characters
  const first = timed(() => parseSkillReferences(unclosed));
  assert.ok(first.ms < BOUND_MS, `took ${first.ms.toFixed(0)} ms`);
  assert.deepEqual(first.value, []);

  // The same shape one level down: a body of opening brackets that never close.
  const brackets = `::: ki-skill\n${'['.repeat(200_000)}\n:::`;
  const second = timed(() => parseSkillReferences(brackets));
  assert.ok(second.ms < BOUND_MS, `took ${second.ms.toFixed(0)} ms`);
  assert.deepEqual(second.value, []);
});
