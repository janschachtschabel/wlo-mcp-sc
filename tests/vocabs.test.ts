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
