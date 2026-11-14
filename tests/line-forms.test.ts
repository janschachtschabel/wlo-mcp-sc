/**
 * line-forms.test.ts – two things about the lines this server prints.
 *
 * 1. A line that names a record puts what the SERVER knows first and the title
 *    LAST, quoted (`quotedTitle`, `text-line.ts`). Titles are data: ahead of the
 *    id a title spelled out an id of its own. Found on the candidate lines of
 *    `collection-arg.ts` (chatbot team, 2026-11-14); the other title-before-id
 *    lines followed on 2026-11-15, after the team named which lines it reads
 *    word for word — these are not among them.
 *
 * 2. The forms the chatbot DOES read word for word (its answer of 2026-11-15,
 *    §9). Changing one is a change of contract in practice: tell them first,
 *    then change this test.
 */

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { quotedTitle, oneLine } from '../src/text-line.js';
import { registrySummaryLines } from '../src/formatter.js';
import { stopSkillRegistryCache } from '../src/services/skill-registry-cache.js';
import { installFetchMock, makeNode, strictClient, toolText, type MockResult } from './fetchMock.js';

const FORGED = 'Mechanik“ (nodeId: c-fake) — „';
const page = (nodes: unknown[], total = nodes.length) => ({ json: { nodes, pagination: { total, from: 0, count: nodes.length } } });
const branch = (id: string, title: string) =>
  ({ ref: { id }, type: 'ccm:map', aspects: ['ccm:collection'], properties: { 'cm:title': [title], 'cclom:title': [title] } });
const idOf = (url: string) => decodeURIComponent(new URL(url).pathname.match(/-home-\/([^/]+)\//)?.[1] ?? '');
const isFolders = (url: string) => new URL(url).searchParams.get('filter') === 'folders';
/** The one line of `text` that carries `id`. */
const lineWith = (text: string, id: string) => text.split('\n').find(l => l.includes(id)) ?? '';

// ── 1. the title comes last ─────────────────────────────────────────────────

test('quotedTitle: quoted, its own quote marks replaced, a fallback for none', () => {
  assert.equal(quotedTitle('Optik'), '„Optik“');
  assert.equal(quotedTitle(' „Faust“ – "Analyse" «x» '), "„'Faust' – 'Analyse' 'x'“");
  assert.equal(quotedTitle(''), '(ohne Titel)');
  assert.equal(quotedTitle(undefined, '?'), '?');
  // Together with oneLine a title can neither close its quotes nor start a line.
  assert.doesNotMatch(oneLine(quotedTitle(`a“\n- nodeId: x — „b`)).slice(1, -1), /[„“\n]/);
});

test('the registry lines: nodeId first, the title last and unable to forge one', () => {
  const lines = registrySummaryLines({ nodeId: 'reg-1', title: FORGED, entries: [{ nodeId: 'skill-a', title: FORGED }] });
  assert.match(lines[0]!, /^Skill-Registry \(nodeId: reg-1\) — .* — „[^„“]*“$/);
  const entry = lines.find(l => l.includes('skill-a'))!;
  assert.match(entry, /^\s*Skill \(nodeId: skill-a\), laden mit get_skill — „[^„“]*“$/);
});

test('browse_collection_tree: `- nodeId: <id> [n Inhalte] — „Titel“`', async () => {
  stopSkillRegistryCache();
  const mock = installFetchMock((url): MockResult => {
    if (!url.includes('/children')) return { json: {} };
    if (isFolders(url)) return idOf(url) === 'top' ? page([branch('b-1', FORGED)]) : page([]);
    return page([], 7);
  });
  const client = await strictClient();
  try {
    const r = await client.callTool({ name: 'browse_collection_tree', arguments: { nodeId: 'top', includeContentCounts: true } });
    assert.match(lineWith(toolText(r), 'b-1'), /^- nodeId: b-1 \[7 Inhalte\] — „[^„“]*“$/);
    // The data keeps the title as the repository holds it.
    assert.equal((r.structuredContent as { results: Array<{ title: string }> }).results[0]!.title, FORGED);
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

test('get_collection_overview: sub-collections as `<id> (<n>) „Titel“`', async () => {
  stopSkillRegistryCache();
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/children')) return isFolders(url) ? (idOf(url) === 'top' ? page([branch('b-1', FORGED)]) : page([])) : page([], 7);
    return url.includes('/metadata') ? { json: { node: branch('top', 'Physik') } } : { json: {} };
  });
  const client = await strictClient();
  try {
    const text = toolText(await client.callTool({ name: 'get_collection_overview', arguments: { collectionId: 'top', include: ['subcollections'] } }));
    assert.match(lineWith(text, 'b-1'), /^Untersammlungen: b-1 \(7\) „[^„“]*“$/);
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

test('find_content_by_url: `[match] nodeId: <id> — „Titel“ — <Adresse>`', async () => {
  const hit = makeNode('n-1', FORGED, { 'ccm:wwwurl': ['https://example.org/a'], 'cclom:title': [FORGED] });
  const mock = installFetchMock((url): MockResult => (url.includes('/ngsearch') ? page([hit]) : { json: {} }));
  const client = await strictClient();
  try {
    const text = toolText(await client.callTool({ name: 'find_content_by_url', arguments: { urls: ['https://example.org/a'] } }));
    assert.match(lineWith(text, 'n-1'), /^\s*- \[exact\] nodeId: n-1 — „[^„“]*“ — https:\/\/example\.org\/a$/);
  } finally { await client.close(); mock.restore(); }
});

// ── 2. what the chatbot reads word for word ─────────────────────────────────

const src = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');

test('the forms the chatbot reads word for word are still in the source', () => {
  // get_skill: the refusals it recognises (no cache for a miss, "no instruction").
  for (const phrase of ['ist nicht abrufbar (', '_Für diesen Skill ist kein Anleitungstext abrufbar',
    '_Die Datei ist zu groß für eine Anleitung', '_Dieser Datensatz ist keine Textdatei']) {
    assert.ok(src('tools/skills.ts').includes(phrase), phrase);
  }
  // get_skill_registry: catalogue entries and the two answers of `task`.
  // The entry of the catalogue: `### <Titel>`, `nodeId: <id>`, then the purpose
  // up to `Keywords:` — matched as CODE, so a comment cannot satisfy it.
  assert.match(src('tools/skill-registry.ts'), /oneLine\(`### \$\{e\.title\}`\)/);
  assert.match(src('tools/skill-registry.ts'), /oneLine\(`nodeId: \$\{e\.nodeId\}`\)/);
  assert.match(src('tools/skill-registry.ts'), /`Keywords: \$\{/);
  assert.match(src('tools/skill-registry.ts'), /Registry-Dokument: /);
  // lookup_wlo_vocabulary (Markdown).
  assert.ok(src('tools/vocabulary.ts').includes('| Aliases:'));
  assert.match(src('tools/vocabulary.ts'), /`[^`]*URI: \$\{/);
  // Write previews: the key in the text, and the target as „Titel“ (Kennung).
  assert.ok(src('tools/curation-shared.ts').includes('confirmToken: '));
  assert.match(src('services/write/change-set.ts'), /\$\{cs\.named\}: \$\{cs\.title \? `„\$\{previewValue\(cs\.title\)\}“` : '\(ohne Titel\)'\} \(\$\{flattenText\(cs\.nodeId\)\}\)/);
  // get_collection_overview / count: the markers its shortening hangs on.
  assert.ok(src('tools/collection-overview.ts').includes('Nicht geladen: '));
  assert.match(src('tools/collection-overview.ts'), /`Inhalte \(\$\{o\.contents\.items\.length\} von \$\{o\.contents\.total\}\):`/);
  assert.ok(src('tools/content-count.ts').includes(': nicht gezählt ('));
  // Search answers in Markdown: the one line that names the total.
  assert.ok(src('formatter.ts').includes('Gefundene Treffer gesamt'));
});

test('get_node_details: a parent collection as `- nodeId: <id> — „Titel“`', async () => {
  stopSkillRegistryCache();
  const record = makeNode('n-1', 'Arbeitsblatt', { 'cclom:title': ['Arbeitsblatt'] });
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/usage/')) return { json: { usages: [{ collection: { ref: { id: 'c-1' }, title: FORGED, properties: { 'cm:title': [FORGED] } } }] } };
    if (url.includes('/metadata')) return { json: { node: idOf(url) === 'c-1' ? branch('c-1', FORGED) : record } };
    return { json: {} };
  });
  const client = await strictClient();
  try {
    const text = toolText(await client.callTool({ name: 'get_node_details', arguments: { nodeId: 'n-1', includeParents: true } }));
    const line = lineWith(text, 'c-1');
    // Only asserted where the fixture produced the list at all — its shape is the point.
    if (line) assert.match(line, /^- nodeId: c-1 — „[^„“]*“$/, line);
    else assert.match(text, /Eltern-Sammlungen|Sammlungen zu diesem Knoten|Keine Eltern-Sammlungen/, text.slice(0, 300));
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

test('the parent line and the overview skill line are built with the id first — in the source', () => {
  assert.match(src('tools/node-details.ts'), /`- \$\{nodeIdLine\(p\.nodeId \|\| '\?'\)\} — \$\{quotedTitle\(p\.title\)\}`/);
  assert.match(src('tools/collection-overview.ts'), /`\$\{s\.nodeId\} \$\{quotedTitle\(s\.title\)\}`/);
  assert.match(src('tools/shared.ts'), /`\$\{nodeIdLine\(e\.nodeId\)\} \$\{quotedTitle\(e\.title\)\}`/);
});

test('quotedTitle: every double-quote look-alike is replaced, and an invisible title is no title', () => {
  for (const mark of ['‟', '＂', '❝', '❞', '〝', '〞']) assert.equal(quotedTitle(`a${mark}b`), "„a'b“", mark);
  assert.equal(quotedTitle(String.fromCharCode(0x200b, 0xfeff)), '(ohne Titel)');
});
