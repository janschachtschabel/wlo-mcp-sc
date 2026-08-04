import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveVocab, labelFromUri, listVocab } from '../src/vocabs.js';

test('resolveVocab: duplicate aliases resolve to the intended concept (regression L11)', () => {
  // "sonstiges" is the primary label of 999 (Sonstiges); it must not be shadowed
  // by 720 (Allgemein/fächerübergreifend), which listed it only as a stray alias.
  assert.equal(resolveVocab('sonstiges', 'discipline'), 'http://w3id.org/openeduhub/vocabs/discipline/999');
  // "media education" stays on Medienbildung (900); the dead alias on 400 is removed.
  assert.equal(resolveVocab('media education', 'discipline'), 'http://w3id.org/openeduhub/vocabs/discipline/900');
});

test('resolveVocab: German grade numbers map to their Bildungsstufe (audit ergonomics)', () => {
  const EC = 'http://w3id.org/openeduhub/vocabs/educationalContext/';
  assert.equal(resolveVocab('Klasse 3', 'educationalContext'), EC + 'grundschule');
  assert.equal(resolveVocab('Klasse 5', 'educationalContext'), EC + 'sekundarstufe_1');
  assert.equal(resolveVocab('5. Klasse', 'educationalContext'), EC + 'sekundarstufe_1');
  assert.equal(resolveVocab('12. Klasse', 'educationalContext'), EC + 'sekundarstufe_2');
});

test('resolveVocab: exact German label → URI', () => {
  assert.equal(
    resolveVocab('Mathematik', 'discipline'),
    'http://w3id.org/openeduhub/vocabs/discipline/380',
  );
  assert.equal(
    resolveVocab('Primarstufe', 'educationalContext'),
    'http://w3id.org/openeduhub/vocabs/educationalContext/grundschule',
  );
  assert.equal(
    resolveVocab('Lehrer/in', 'userRole'),
    'http://w3id.org/openeduhub/vocabs/intendedEndUserRole/teacher',
  );
});

test('resolveVocab: URI input passes through unchanged', () => {
  const uri = 'http://w3id.org/openeduhub/vocabs/discipline/380';
  assert.equal(resolveVocab(uri, 'discipline'), uri);
});

test('resolveVocab: alias match', () => {
  assert.equal(
    resolveVocab('mathe', 'discipline'),
    'http://w3id.org/openeduhub/vocabs/discipline/380',
  );
  assert.equal(
    resolveVocab('sek i', 'educationalContext'),
    'http://w3id.org/openeduhub/vocabs/educationalContext/sekundarstufe_1',
  );
});

test('resolveVocab: short tokens do not fuzzy-match', () => {
  // "it" must resolve via exact alias (informatik), never via fuzzy
  // substring into e.g. "arbeit".
  assert.equal(
    resolveVocab('it', 'discipline'),
    'http://w3id.org/openeduhub/vocabs/discipline/320',
  );
  assert.equal(resolveVocab('xy', 'discipline'), null);
});

test('resolveVocab: empty/whitespace input → null', () => {
  assert.equal(resolveVocab('', 'discipline'), null);
  assert.equal(resolveVocab('   ', 'discipline'), null);
});

test('labelFromUri: URI → capitalized German label', () => {
  assert.equal(
    labelFromUri('http://w3id.org/openeduhub/vocabs/discipline/380', 'discipline'),
    'Mathematik',
  );
});

test('labelFromUri: license keys keep their display form', () => {
  assert.equal(labelFromUri('CC_BY_SA', 'license'), 'CC BY-SA 4.0');
});

test('labelFromUri: trailing-slug match for namespaced values', () => {
  assert.equal(labelFromUri('ccrep://repo/teacher', 'targetGroup'), 'Lehrkräfte');
});

test('labelFromUri: unknown URI falls back to the input', () => {
  assert.equal(labelFromUri('http://example.org/unknown', 'discipline'), 'http://example.org/unknown');
});

test('listVocab: returns capitalized labels with aliases', () => {
  const entries = listVocab('targetGroup');
  assert.equal(entries.length, 3);
  const teacher = entries.find(e => e.uri === 'teacher');
  assert.ok(teacher);
  assert.equal(teacher.label, 'Lehrkräfte');
  assert.ok(teacher.aliases.includes('teacher'));
});

test('resolveVocab: "elementary school" is Grundschule, not Elementarbereich', () => {
  // The alias sat on BOTH entries, and first-wins handed the English term for
  // primary school to the pre-school concept — a silently wrong filter, with no
  // "did you mean" hint because a URI came back.
  const EC = 'http://w3id.org/openeduhub/vocabs/educationalContext/';
  assert.equal(resolveVocab('elementary school', 'educationalContext'), EC + 'grundschule');
  assert.equal(resolveVocab('elementary level', 'educationalContext'), EC + 'elementarbereich');
  assert.equal(resolveVocab('Kindergarten', 'educationalContext'), EC + 'elementarbereich');
});

test('resolveVocab: only a real http(s) URI passes through, not any "http…" word', () => {
  // A typo starting with "http" used to be handed to the search as a filter
  // value: guaranteed zero hits, and no suggestion either, because a non-null
  // result means "resolved" to every caller.
  assert.equal(resolveVocab('httpfoo', 'discipline'), null);
  assert.equal(resolveVocab('https://w3id.org/x', 'discipline'), 'https://w3id.org/x');
  assert.equal(resolveVocab('http://w3id.org/x', 'discipline'), 'http://w3id.org/x');
});

test('labelFromUri: the aggregated LRT concepts a facet can carry all have labels', () => {
  // Facet values arrive as bare URIs — resolveFacetCounts has no _DISPLAYNAME to
  // fall back on — so a concept missing here renders as a raw UUID URI.
  const B = 'http://w3id.org/openeduhub/vocabs/new_lrt_aggregated/';
  assert.equal(labelFromUri(B + '2c151a4e-556e-42db-9e44-3a581deb5834', 'lrt'), 'Textbausteine');
  assert.equal(labelFromUri(B + 'b1e25325-d403-44f0-814a-ff2f5d866931', 'lrt'), 'Persönlichkeit');
  assert.equal(labelFromUri(B + '620a3fee-ac87-40e6-8408-20b48b430eca', 'lrt'), 'Daten');
  assert.equal(labelFromUri(B + 'a0b83e5a-eaa4-4df8-9eec-3678abd60c25', 'lrt'), 'Tabellen');
  assert.equal(labelFromUri(B + 'c2fc554c-a7ae-4af7-a785-d727c5a8d0db', 'lrt'), 'Formel');
  assert.equal(labelFromUri(B + '25957b6b-338e-4379-ba4f-67fc7654ef34', 'lrt'), 'Modell / 3D');
  assert.equal(labelFromUri(B + '0d1f8d25-7a81-44d5-b250-1c42bb71c167', 'lrt'), 'Regelungsintrumente');
  assert.equal(labelFromUri(B + '9c2acd39-7207-4e28-87a5-06e60d59c9e1', 'lrt'), 'Orientierungsinstrumente');
});

test('listVocab: no label or alias resolves to two different concepts of one vocabulary', () => {
  // resolveVocab takes the first exact hit, so a shared alias silently decides
  // for the entry that happens to sit earlier in the table.
  for (const vocab of ['educationalContext', 'discipline', 'userRole', 'lrt', 'license', 'targetGroup'] as const) {
    const owners = new Map<string, string[]>();
    for (const e of listVocab(vocab)) {
      for (const term of [e.label, ...e.aliases]) {
        const key = term.toLowerCase();
        owners.set(key, [...(owners.get(key) ?? []), e.uri]);
      }
    }
    const shared = [...owners].filter(([, uris]) => new Set(uris).size > 1);
    assert.deepEqual(shared, [], `${vocab}: alias shared by several concepts`);
  }
});
