/**
 * write-vocab-review.test.ts – what the review of 2026-11-13 found in the
 * vocabulary refusals of the write path: candidates that named one entry twice
 * or offered a value the write refuses, a list that reported only its first
 * refused value, an alias written without a word, and the same URI stored twice.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { validateField, QUALITY_FINDING_FIELDS } from '../src/services/write/fields.js';
import { displayValue } from '../src/services/write/change-set.js';
import { listVocab, resolveVocab } from '../src/vocabs.js';
import { LRT_CONCEPTS } from '../src/vocabs-lrt.js';
import { registerCurationContentTools } from '../src/tools/curation-content.js';
import { registerCurationUpdateManyTool } from '../src/tools/curation-update-many.js';
import { registerCurationSuggestionTools } from '../src/tools/curation-suggestions.js';
import { registerCurationCollectionTools } from '../src/tools/curation-collections.js';
import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { connectedClient, installFetchMock, toolText, type MockResult } from './fetchMock.js';

const DISCIPLINE = 'ccm:taxonid';
const LEVEL = 'ccm:educationalcontext';
const ROLE = 'ccm:educationalintendedenduserrole';
const FINDING = 'ccm:oeh_quality_correctness';

type Refused = Array<{ value: string; suggestions: string[] }>;
function refusedOf(property: string, input: string | string[]): Refused {
  const out = validateField(property, input);
  assert.equal(out.ok, false, `${property} ${JSON.stringify(input)} should be refused`);
  return (out as { refused?: Refused }).refused ?? [];
}

// ── 1: candidates are entries, each once, the likeliest first ────────────────

test('candidates name each entry once, by its label — never by an alias of an entry already named', () => {
  for (const input of ['Erdkundeunterricht', 'Wirtschaft', 'Technik', 'Sozialkundeunterricht', 'Mathematik und Physik']) {
    const [first] = refusedOf(DISCIPLINE, input);
    assert.ok(first, input);
    const labels = new Set(listVocab('discipline').map(e => e.label));
    for (const s of first.suggestions) assert.ok(labels.has(s), `${input}: „${s}“ is not a label`);
    const uris = first.suggestions.map(s => resolveVocab(s, 'discipline'));
    assert.equal(new Set(uris).size, uris.length, `${input}: ${first.suggestions.join(', ')}`);
    assert.ok(first.suggestions.length <= 5);
  }
});

test('an entry whose label holds the input as a whole word is offered — right after the guess', () => {
  const [w] = refusedOf(DISCIPLINE, 'Wirtschaft');
  assert.deepEqual(w!.suggestions.slice(0, 2), ['Agrarwirtschaft', 'Wirtschaft und Verwaltung']);
  const [t] = refusedOf(DISCIPLINE, 'Technik');
  assert.ok(t!.suggestions.filter(s => /technik/i.test(s)).length >= 3, t!.suggestions.join(', '));
});

// ── 3: quality findings ──────────────────────────────────────────────────────

test('a quality finding is never offered a human verdict, and the opposite does not lead', () => {
  const [r] = refusedOf(FINDING, 'keine Auffälligkeiten gefunden');
  assert.equal(r!.suggestions[0], 'keine Auffälligkeiten gefunden (Maschine)');
  for (const input of ['keine Auffälligkeiten gefunden', 'Auffälligkeiten gefunden (Mensh)', 'human_finding', 'geprüft']) {
    for (const field of QUALITY_FINDING_FIELDS) {
      const out = validateField(field, input);
      if (out.ok) continue;
      for (const { suggestions } of (out as { refused?: Refused }).refused ?? []) {
        for (const s of suggestions) {
          assert.doesNotMatch(s, /Mensch/, `${input}: ${s}`);
          assert.equal(validateField(field, s).ok, true, `a suggestion must itself be accepted: ${s}`);
        }
      }
    }
  }
});

// ── 2: content type ──────────────────────────────────────────────────────────

test('a refused content type carries candidates the write accepts — URIs where a name stands for two', () => {
  const [typo] = refusedOf('ccm:oeh_lrt', 'Arbeitsblat');
  assert.equal(typo!.value, 'Arbeitsblat');
  assert.ok(typo!.suggestions.includes('Arbeitsblatt'));

  const [twice] = refusedOf('ccm:oeh_lrt', 'Suchmaschine');
  const uris = LRT_CONCEPTS.filter(c => c.label === 'Suchmaschine').map(c => c.uri);
  assert.deepEqual(twice!.suggestions, uris);

  // Near a shared name: the candidate is still something the write takes.
  for (const input of ['Arbeitsblat', 'Suchmaschine', 'Suchmaschinen', 'Stationenlernen', 'Stationlernen', 'Video']) {
    for (const { suggestions } of refusedOf('ccm:oeh_lrt', input)) {
      assert.ok(suggestions.length > 0, input);
      for (const s of suggestions) assert.equal(validateField('ccm:oeh_lrt', s).ok, true, `${input}: ${s}`);
    }
  }
});

// ── 4: one URI, once ─────────────────────────────────────────────────────────

test('two spellings of one entry are written once, first-seen order kept', () => {
  const subject = validateField(DISCIPLINE, ['Physik', 'Mathe', 'Mathematik', 'physik']);
  assert.ok(subject.ok);
  assert.deepEqual(subject.values, [resolveVocab('Physik', 'discipline'), resolveVocab('Mathematik', 'discipline')]);

  const sheet = LRT_CONCEPTS.find(c => c.label === 'Arbeitsblatt')!;
  const type = validateField('ccm:oeh_lrt', ['Arbeitsblatt', sheet.uri]);
  assert.ok(type.ok);
  assert.deepEqual(type.values, [sheet.uri]);
});

// ── 5: every refused value of a list ─────────────────────────────────────────

test('a list with several refused values reports every one, with its own candidates', () => {
  const refused = refusedOf(DISCIPLINE, ['Wirtschaft', 'Physik', 'Technik']);
  assert.deepEqual(refused.map(r => r.value), ['Wirtschaft', 'Technik']);
  assert.ok(refused[0]!.suggestions.includes('Agrarwirtschaft'));
  assert.ok(refused[1]!.suggestions.includes('Bautechnik'));
  const out = validateField(DISCIPLINE, ['Wirtschaft', 'Physik', 'Technik']);
  assert.ok(!out.ok);
  assert.match(out.reason, /„Wirtschaft“ kommt im Vokabular/);
  assert.match(out.reason, /„Technik“ kommt im Vokabular/);

  const types = refusedOf('ccm:oeh_lrt', ['Arbeitsblat', 'Audio', 'Suchmaschine']);
  assert.deepEqual(types.map(r => r.value), ['Arbeitsblat', 'Suchmaschine']);
});

// ── 9: an alias is said ──────────────────────────────────────────────────────

test('a value resolved through an alias is named with what it is written as — the label and the URI are not', () => {
  const alias = validateField(LEVEL, 'Gymnasium');
  assert.ok(alias.ok);
  assert.equal(alias.note, '„Gymnasium“ wird als „Sekundarstufe II“ geschrieben.');

  const two = validateField(DISCIPLINE, ['Griechisch', 'Physik', 'IT']);
  assert.ok(two.ok);
  assert.match(two.note ?? '', /„Griechisch“ wird als „Alt-Griechisch“ geschrieben\./);
  assert.match(two.note ?? '', /„IT“ wird als „Informatik“ geschrieben\./);
  assert.doesNotMatch(two.note ?? '', /Physik/);

  for (const [property, value] of [
    [LEVEL, 'Sekundarstufe II'], [LEVEL, 'sekundarstufe ii'], [LEVEL, 'SEKUNDARSTUFE II'],
    [LEVEL, 'http://w3id.org/openeduhub/vocabs/educationalContext/sekundarstufe_2'],
    [DISCIPLINE, 'mathematik'], [ROLE, 'Lehrer/in'], [FINDING, 'ungeprüft'],
  ] as const) {
    const out = validateField(property, value);
    assert.ok(out.ok, value);
    assert.equal(out.note, undefined, value);
  }
});

// ── through the tools ────────────────────────────────────────────────────────

const MARIA: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };
const PHYSIK = 'http://w3id.org/openeduhub/vocabs/discipline/460';

async function curation(): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerCurationContentTools(server, 'Bearer error="invalid_request"');
  registerCurationUpdateManyTool(server, 'Bearer error="invalid_request"');
  registerCurationSuggestionTools(server, 'Bearer error="invalid_request"');
  registerCurationCollectionTools(server, 'Bearer error="invalid_request"');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  return c;
}

interface Candidate { field: string; value: string; suggestions: string[] }
const candidatesOf = (r: unknown) =>
  ((r as { structuredContent?: { error?: { candidates?: Candidate[] } } }).structuredContent?.error?.candidates ?? []);
const token = (r: unknown) => String(((r as { structuredContent?: { confirm?: { token?: string } } }).structuredContent?.confirm)?.token ?? '');
const isError = (r: unknown) => (r as { isError?: boolean }).isError === true;

/** One record `n1` (Physik); a collection `col`; searches find nothing. */
function repository() {
  return installFetchMock((url, init): MockResult => {
    if ((init?.method ?? 'GET') !== 'GET' && !url.includes('/ngsearch') && !url.includes('/search/')) return { json: {} };
    if (url.includes('/search/')) return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
    if (url.includes('/suggestions/')) return { json: { suggestions: {} } };
    if (url.includes('/col/')) {
      return { json: { node: { ref: { id: 'col', repo: '-home-' }, type: 'ccm:map', aspects: ['ccm:collection'],
        properties: { 'cm:title': ['Optik'], 'cm:description': ['alt'] } } } };
    }
    return { json: { node: { ref: { id: 'n1', repo: '-home-' }, type: 'ccm:io',
      properties: { 'cclom:title': ['Licht'], 'ccm:taxonid': [PHYSIK] } } } };
  });
}

test('through the tools: a refused content type and two refused values of one field arrive as candidates', async () => {
  setServiceCredentialForTest(MARIA);
  const mock = repository();
  try {
    const c = await curation();
    const r = await c.callTool({ name: 'wlo_update_content', arguments: {
      nodeId: 'n1', contentType: 'Suchmaschine', discipline: ['Wirtschaft', 'Technik'] } });
    assert.ok(isError(r), toolText(r));
    const found = candidatesOf(r);
    const type = found.filter(x => x.field === 'contentType');
    assert.equal(type.length, 1, JSON.stringify(found));
    assert.ok(type[0]!.suggestions.every(s => s.startsWith('http')));
    assert.deepEqual(found.filter(x => x.field === 'discipline').map(x => x.value), ['Wirtschaft', 'Technik']);

    const s = await c.callTool({ name: 'wlo_suggest_metadata', arguments: { nodeId: 'n1',
      suggestions: [{ field: 'contentType', value: 'Arbeitsblat', reason: 'x' }] } });
    assert.ok(candidatesOf(s).some(x => x.field === 'contentType' && x.suggestions.includes('Arbeitsblatt')), toolText(s));
    assert.equal(mock.calls.filter(k => (k.init?.method ?? 'GET') !== 'GET').length, 0, 'nothing was sent');
  } finally { setServiceCredentialForTest(null); mock.restore(); }
});

test('wlo_update_contents: one refused value over two records is one candidate, two different values are two', async () => {
  setServiceCredentialForTest(MARIA);
  const mock = repository();
  try {
    const c = await curation();
    const r = await c.callTool({ name: 'wlo_update_contents', arguments: { items: [
      { nodeId: 'n1', discipline: 'Wirtschaft' },
      { nodeId: 'n2', discipline: ['Wirtschaft', 'Technik'] },
    ] } });
    assert.ok(isError(r), toolText(r));
    assert.deepEqual(candidatesOf(r).map(x => `${x.field}:${x.value}`), ['discipline:Wirtschaft', 'discipline:Technik']);
    assert.match(toolText(r), /Eintrag 1 .*Wirtschaft/);
    assert.match(toolText(r), /Eintrag 2 .*Technik/);
  } finally { setServiceCredentialForTest(null); mock.restore(); }
});

test('every tool that validates shows the alias note with its preview — and still offers the key', async () => {
  setServiceCredentialForTest(MARIA);
  const mock = repository();
  try {
    const c = await curation();
    const calls: Array<[string, Record<string, unknown>]> = [
      ['wlo_update_content', { nodeId: 'n1', educationalContext: 'Gymnasium' }],
      ['wlo_create_content', { title: 'Neu', url: 'https://example.org/x', educationalContext: 'Gymnasium' }],
      ['wlo_update_contents', { items: [{ nodeId: 'n1', educationalContext: 'Gymnasium' }] }],
      ['wlo_suggest_metadata', { nodeId: 'n1', suggestions: [{ field: 'educationalContext', value: 'Gymnasium', reason: 'passt' }] }],
    ];
    for (const [name, args] of calls) {
      const r = await c.callTool({ name, arguments: args });
      assert.ok(!isError(r), `${name}: ${toolText(r)}`);
      assert.match(toolText(r), /„Gymnasium“ wird als „Sekundarstufe II“ geschrieben\./, name);
      assert.ok(token(r), name);
    }
  } finally { setServiceCredentialForTest(null); mock.restore(); }
});

test('B1: ONE string is still taken by the tool, and replaces', async () => {
  setServiceCredentialForTest(MARIA);
  const mock = repository();
  try {
    const c = await curation();
    const r = await c.callTool({ name: 'wlo_update_content', arguments: { nodeId: 'n1', discipline: 'Mathematik' } });
    assert.ok(!isError(r), toolText(r));
    assert.match(toolText(r), /Fach: „Physik“ → „Mathematik“/);
    // Both spellings of one subject: one value in the preview, not two.
    const twice = await c.callTool({ name: 'wlo_update_content', arguments: { nodeId: 'n1', discipline: ['Mathe', 'Mathematik'] } });
    assert.match(toolText(twice), /Fach: „Physik“ → „Mathematik“/);
  } finally { setServiceCredentialForTest(null); mock.restore(); }
});

test('the collection tools, which collect with their own field map, still preview and still refuse', async () => {
  setServiceCredentialForTest(MARIA);
  const mock = repository();
  try {
    const c = await curation();
    const created = await c.callTool({ name: 'wlo_create_collection', arguments: { title: 'Akustik', description: 'Schall' } });
    assert.ok(!isError(created), toolText(created));
    assert.match(toolText(created), /Akustik/);
    assert.match(toolText(created), /Schall/);
    assert.ok(token(created));

    const renamed = await c.callTool({ name: 'wlo_rename_collection', arguments: { nodeId: 'col', title: 'Wellenoptik' } });
    assert.ok(!isError(renamed), toolText(renamed));
    assert.match(toolText(renamed), /„Optik“ → „Wellenoptik“/);
    assert.ok(token(renamed));

    const tooLong = await c.callTool({ name: 'wlo_create_collection', arguments: { title: 'x'.repeat(300) } });
    assert.ok(isError(tooLong));
    assert.match(toolText(tooLong), /zu lang/);
    assert.deepEqual(candidatesOf(tooLong), [], 'a length refusal has nothing to choose from');
    assert.equal(mock.calls.filter(k => (k.init?.method ?? 'GET') !== 'GET').length, 0, 'nothing was sent');
  } finally { setServiceCredentialForTest(null); mock.restore(); }
});

// ── 8/10: fixed lists — they can fail for a reason ───────────────────────────

const ACCEPTED: Array<[string, string, string]> = [
  [LEVEL, 'Sek 1', 'Sekundarstufe I'], [LEVEL, 'Sek. I', 'Sekundarstufe I'], [LEVEL, 'Sek-I', 'Sekundarstufe I'],
  [LEVEL, 'SekI', 'Sekundarstufe I'], [LEVEL, 'Sekundarstufe-I', 'Sekundarstufe I'],
  [LEVEL, 'Sekundarbereich I', 'Sekundarstufe I'], [LEVEL, 'lower secondary', 'Sekundarstufe I'],
  [LEVEL, 'Sek 2', 'Sekundarstufe II'], [LEVEL, 'Sek. II', 'Sekundarstufe II'], [LEVEL, 'Sek-II', 'Sekundarstufe II'],
  [LEVEL, 'SekII', 'Sekundarstufe II'], [LEVEL, 'Sekundarstufe-II', 'Sekundarstufe II'],
  [LEVEL, 'Sekundarbereich II', 'Sekundarstufe II'], [LEVEL, 'upper secondary', 'Sekundarstufe II'],
  [LEVEL, 'Gymnasiale Oberstufe', 'Sekundarstufe II'],
  [LEVEL, 'Klassenstufe 3', 'Primarstufe'], [LEVEL, 'Jahrgangsstufe 7', 'Sekundarstufe I'], [LEVEL, 'Jahrgang 12', 'Sekundarstufe II'],
  [LEVEL, 'Klasse 10', 'Sekundarstufe I'], [LEVEL, 'Jahrgang 1', 'Primarstufe'], [LEVEL, 'Jahrgang 10', 'Sekundarstufe I'],
  [LEVEL, 'Primarbereich', 'Primarstufe'], [LEVEL, 'Frühkindliche Bildung', 'Elementarbereich'],
  [LEVEL, 'Berufsbildung', 'Berufliche Bildung'], [LEVEL, 'University', 'Hochschule'],
  [LEVEL, 'Adult Education', 'Erwachsenenbildung'], [LEVEL, 'Lehrerfortbildung', 'Fortbildung'],
  [ROLE, 'Lehrkräfte', 'Lehrer/in'], [ROLE, 'Lehrkraefte', 'Lehrer/in'], [ROLE, 'Lehrer/innen', 'Lehrer/in'],
  [ROLE, 'Lehrer*innen', 'Lehrer/in'], [ROLE, 'Lehrerinnen und Lehrer', 'Lehrer/in'], [ROLE, 'Lehrpersonen', 'Lehrer/in'],
  [ROLE, 'Teachers', 'Lehrer/in'],
  [ROLE, 'Schueler', 'Lerner/in'], [ROLE, 'Schüler/innen', 'Lerner/in'], [ROLE, 'Schüler*innen', 'Lerner/in'],
  [ROLE, 'Schülerinnen und Schüler', 'Lerner/in'], [ROLE, 'SuS', 'Lerner/in'], [ROLE, 'Lerner', 'Lerner/in'],
  [ROLE, 'Learners', 'Lerner/in'], [ROLE, 'Student', 'Lerner/in'],
  [ROLE, 'Parents', 'Eltern'], [ROLE, 'Autoren', 'Autor/in'],
  [DISCIPLINE, 'Maths', 'Mathematik'], [DISCIPLINE, 'Altgriechisch', 'Alt-Griechisch'], [DISCIPLINE, 'Bildende Kunst', 'Kunst'],
  [DISCIPLINE, 'Paedagogik', 'Pädagogik'], [DISCIPLINE, 'Tuerkisch', 'Türkisch'],
  [DISCIPLINE, 'Heimat- und Sachunterricht', 'Sachunterricht'], [DISCIPLINE, 'HSU', 'Sachunterricht'],
  [DISCIPLINE, 'Religionslehre', 'Religion'], [DISCIPLINE, 'Evangelische Religion', 'Religion'],
  [DISCIPLINE, 'Katholische Religion', 'Religion'], [DISCIPLINE, 'Sexualkunde', 'Sexualerziehung'],
  [DISCIPLINE, 'Gemeinschaftskunde', 'Politik'], [DISCIPLINE, 'Wirtschaftslehre', 'Wirtschaftskunde'],
  // Punctuation and spacing around an exact name (11).
  [DISCIPLINE, 'Mathematik.', 'Mathematik'], [DISCIPLINE, '„Mathematik“', 'Mathematik'], [LEVEL, 'Sekundarstufe  I', 'Sekundarstufe I'],
];

const VOCAB_OF = { [LEVEL]: 'educationalContext', [ROLE]: 'userRole', [DISCIPLINE]: 'discipline' } as const;

test('the spellings a person reasonably writes are accepted, as the entry they mean', () => {
  for (const [property, spelling, label] of ACCEPTED) {
    const out = validateField(property, spelling);
    assert.ok(out.ok, `${spelling}: ${out.ok ? '' : out.reason}`);
    const vocab = VOCAB_OF[property as keyof typeof VOCAB_OF];
    assert.equal(listVocab(vocab).find(e => e.uri === out.values[0])?.label, label, spelling);
  }
});

const STAYS_REFUSED: Array<[string, string]> = [
  [LEVEL, 'Sekundarstufe'], [LEVEL, 'Realschule'], [LEVEL, 'Hauptschule'], [LEVEL, 'Gesamtschule'], [LEVEL, 'Mittelstufe'],
  [DISCIPLINE, 'Wirtschaft'], [DISCIPLINE, 'Technik'], [DISCIPLINE, 'Recht'], [DISCIPLINE, 'Sowi'],
  [ROLE, 'Studierende'], [ROLE, 'Erzieher'],
  // Deliberately not aliases: neither names ONE entry.
  [DISCIPLINE, 'Nawi'], [DISCIPLINE, 'Umweltbildung'],
];

test('a word that does not name ONE entry stays refused by the write', () => {
  for (const [property, word] of STAYS_REFUSED) {
    assert.equal(validateField(property, word).ok, false, `${word} must not be written as a guess`);
  }
});

// ── NITs ─────────────────────────────────────────────────────────────────────

test('a content type whose name stands for two concepts is shown with its parent', () => {
  const [a, b] = LRT_CONCEPTS.filter(c => c.label === 'Suchmaschine');
  assert.equal(displayValue('ccm:oeh_lrt', a!.uri), `Suchmaschine (unter: ${a!.path})`);
  assert.notEqual(displayValue('ccm:oeh_lrt', a!.uri), displayValue('ccm:oeh_lrt', b!.uri));
  const sheet = LRT_CONCEPTS.find(c => c.label === 'Arbeitsblatt')!;
  assert.equal(displayValue('ccm:oeh_lrt', sheet.uri), 'Arbeitsblatt');
});

test('lookup_wlo_vocabulary: a content type near the query through its ALIAS is listed', async () => {
  const client = await connectedClient();
  try {
    // "Edu-Breakout" is the alias of „EduBreakout“; the typo is near the alias only.
    const text = toolText(await client.callTool({ name: 'lookup_wlo_vocabulary', arguments: { vocabulary: 'contentType', query: 'Edu-Braekout' } }));
    assert.match(text, /\*\*EduBreakout\*\*/, text.slice(0, 300));
  } finally { await client.close(); }
});

test('lookup_wlo_vocabulary says what `query` does for contentType, and names contentType at all', async () => {
  const client = await connectedClient();
  try {
    const tool = (await client.listTools()).tools.find(t => t.name === 'lookup_wlo_vocabulary')!;
    assert.match(String(tool.description), /contentType/);
    const query = String((tool.inputSchema as { properties: Record<string, { description?: string }> }).properties['query']!.description);
    assert.match(query, /contentType/);
    // The sentence about Hochschulfächer must not read as if it covered contentType.
    assert.doesNotMatch(query, /"universitySubject" and "contentType": a free-text term[^.]*Hochschulfächer/);
    assert.match(query, /wlo_create_content|contentType.*(name|Name)/);
  } finally { await client.close(); }
});
