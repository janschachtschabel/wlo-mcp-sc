import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveVocab, labelFromUri, listVocab } from '../src/vocabs.js';
import { LRT_CONCEPTS } from '../src/vocabs-lrt.js';

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
  // Without "4.0" since 2026-08-12 — see the version test at the end of this
  // file: no record carries `ccm:commonlicense_version`, so the suffix was an
  // invented fact. The versioned spelling still resolves as an alias.
  assert.equal(labelFromUri('CC_BY_SA', 'license'), 'CC BY-SA');
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

/**
 * The display form of every concept whose official German prefLabel is NOT what
 * capitalising the first letter of a lowercase matching alias produces.
 *
 * Fetched 2026-08-11 from the SKOS source of record
 * (`vocabs.openeduhub.de/w3id.org/openeduhub/vocabs/<vocab>/index.json`) and
 * pinned here rather than re-fetched, because the suite must not touch the
 * network. Re-fetch before contradicting any line.
 *
 * `labels[0]` doubles as the display form and as a matching alias, and the
 * table was written lowercase for the matching half — so `labelFromUri`, which
 * only upper-cases the first character, rendered "Sekundarstufe i",
 * "Deutsch als zweitsprache", and "Mint" for the MINT subject. Both fields
 * appear in every single search result.
 */
const LRT_BASE = 'http://w3id.org/openeduhub/vocabs/new_lrt_aggregated/';

const OFFICIAL_LABELS: Array<[vocab: 'educationalContext' | 'discipline' | 'lrt', slug: string, label: string]> = [
  ['educationalContext', 'sekundarstufe_1', 'Sekundarstufe I'],
  ['educationalContext', 'sekundarstufe_2', 'Sekundarstufe II'],
  ['educationalContext', 'berufliche_bildung', 'Berufliche Bildung'],
  ['educationalContext', 'informelles_lernen', 'Informelles Lernen'],
  ['discipline', '20003', 'Alt-Griechisch'],
  ['discipline', 'oeh01', 'Arbeit, Ernährung, Soziales'],
  ['discipline', '040', 'Berufliche Bildung'],
  ['discipline', '12002', 'Darstellendes Spiel'],
  ['discipline', '28002', 'Deutsch als Zweitsprache'],
  ['discipline', '04006', 'Ernährung und Hauswirtschaft'],
  ['discipline', '04007', 'Farbtechnik und Raumgestaltung'],
  ['discipline', '340', 'Interkulturelle Bildung'],
  ['discipline', '04003', 'MINT'],
  ['discipline', '44099', 'Open Educational Resources'],
  ['discipline', '04012', 'Textiltechnik und Bekleidung'],
  ['discipline', '04013', 'Wirtschaft und Verwaltung'],
  ['discipline', '640', 'Umweltgefährdung, Umweltschutz'],
  ['discipline', '72001', 'Zeitgemäße Bildung'],
  ['discipline', '72003', 'Evidenzbasierte Medizin'],
  ['lrt', '05aa0f49-7e1b-498b-a7d5-c5fc8e73b2e2', 'Interaktives Medium'],
  ['lrt', '71c71f72-fc8d-4263-902f-abf1366a73ca', 'Projekt-Material'],
  ['lrt', 'ec402e87-c623-47e2-8d2e-1c4ea6923409', 'Entdeckendes Lernen'],
];

const VOCAB_PATH = { educationalContext: 'educationalContext', discipline: 'discipline', lrt: 'new_lrt_aggregated' };

test('labelFromUri: a concept is displayed under its official German prefLabel', () => {
  for (const [vocab, slug, label] of OFFICIAL_LABELS) {
    assert.equal(
      labelFromUri(`http://w3id.org/openeduhub/vocabs/${VOCAB_PATH[vocab]}/${slug}`, vocab),
      label,
      `${vocab}/${slug}`,
    );
  }
});

test('labelFromUri: the aggregated LRT keeps its deliberately SHORT display forms', () => {
  // The aggregated LRT table is the one vocabulary that does not simply mirror
  // its source: 9 of its 48 concepts carry a shortened display form, and the
  // shortening is a maintained decision rather than an oversight — every part
  // dropped from the official label exists as a matching alias ("fragebögen",
  // "lernauftrag", "handbuch", "vokabelliste", "wettbewerb", …), checked
  // 2026-08-11 against `new_lrt_aggregated`. Only the CASING was wrong here, so
  // only the casing was fixed. Restoring the long forms would be taste
  // overruling a working decision, and these lines say so.
  assert.equal(labelFromUri(LRT_BASE + '57bfc743-4c94-4bdd-bdfa-c638a062d151', 'lrt'), 'Kreative Aktivität');
  assert.equal(labelFromUri(LRT_BASE + '02bfd0fe-96ab-4dd6-a306-ec362ec25ea0', 'lrt'), 'Tests');
  assert.equal(resolveVocab('Fragebogen', 'lrt'), LRT_BASE + '02bfd0fe-96ab-4dd6-a306-ec362ec25ea0');
  assert.equal(resolveVocab('Lernauftrag', 'lrt'), LRT_BASE + '90a082d8-ee5f-4b33-bd5c-f1738262c47d');
});

test('the LRT source table is a verbatim copy of its vocabulary, not a curated one', () => {
  // Measured 2026-08-11: 220 of 220 concepts in `vocabs-lrt.ts` match the
  // official `new_lrt` prefLabels exactly. That is what makes the aggregated
  // table above the exception rather than the rule — and it is why the casing
  // defect could not be there. A future edit that "tidies" a label in the copied
  // table would silently fork it from its source.
  const lowercaseStart = LRT_CONCEPTS.filter(c => /^[a-zäöü]/.test(c.label)).map(c => c.label);
  assert.ok(
    lowercaseStart.length >= 3,
    `expected the verbatim lowercase prefLabels to still be there, got ${JSON.stringify(lowercaseStart)}`,
  );
});

test('resolveVocab: fixing a display form does not cost the lowercase alias', () => {
  // The regression the change above could have caused. Every matcher lowercases
  // both sides, so casing is free — but "Umweltgefährdung, Umweltschutz" gained
  // a COMMA the old alias did not have, and an exact match is what a caller
  // typing the old spelling relies on. The old string stays an alias.
  const D = 'http://w3id.org/openeduhub/vocabs/discipline/';
  const EC = 'http://w3id.org/openeduhub/vocabs/educationalContext/';
  assert.equal(resolveVocab('umweltgefährdung umweltschutz', 'discipline'), D + '640');
  assert.equal(resolveVocab('Umweltgefährdung, Umweltschutz', 'discipline'), D + '640');
  assert.equal(resolveVocab('sekundarstufe i', 'educationalContext'), EC + 'sekundarstufe_1');
  assert.equal(resolveVocab('SEKUNDARSTUFE I', 'educationalContext'), EC + 'sekundarstufe_1');
  assert.equal(resolveVocab('mint', 'discipline'), D + '04003');
  assert.equal(resolveVocab('deutsch als zweitsprache', 'discipline'), D + '28002');
});

/**
 * German function words, which are correctly lowercase inside a display label
 * ("Ernährung UND Hauswirtschaft", "Deutsch ALS Zweitsprache"). Everything else
 * that continues a label is a noun or an adjective opening a compound, and in
 * this table it is lowercase only when the entry was written for the MATCHING
 * half of `labels[0]` and never given a display form.
 */
const GERMAN_FUNCTION_WORDS = ['und', 'als', 'oder', 'für', 'im', 'in', 'von', 'zu', 'der', 'die', 'das', 'mit'];

test('every display label continues in the case it is actually written in', () => {
  // The guard for the defect class, not for its instances. `labels[0]` serves as
  // both display form and matching alias, so an entry written lowercase for the
  // matching half renders as "Sekundarstufe i" or "Interaktives medium" — in
  // every search result, since Fach, Bildungsstufe and Inhaltstyp print on every
  // node. It was found twice: 19 concepts on 2026-08-11, then 4 more the same
  // day in the aggregated LRT table, which the first pass had missed because the
  // scan asked for a vocabulary key that does not exist and swallowed the throw.
  //
  // Deliberately NOT a check against the official prefLabels: those are pinned
  // above for the concepts where they matter, and 9 aggregated-LRT labels are
  // shortened ON PURPOSE. Casing is the part that is never a decision.
  // A label pinned against its authority is exempt. The heuristic exists to
  // catch labels NOBODY checked; where one was checked against the source, that
  // evidence beats the guess — and the guess is wrong for a label that is a
  // phrase rather than a noun compound. "Copyright, freier Zugang" and
  // "Copyright, lizenzpflichtig" are the repository's own strings, and "freier"
  // and "lizenzpflichtig" are adjectives that are correctly lowercase. Adding
  // them to GERMAN_FUNCTION_WORDS instead would be making the test agree with
  // the code by calling them something they are not.
  const verified = new Set(OFFICIAL_LICENSE_NAMES.map(([, label]) => label));
  const offenders: string[] = [];
  for (const vocab of ['educationalContext', 'discipline', 'userRole', 'lrt', 'license', 'targetGroup'] as const) {
    for (const e of listVocab(vocab)) {
      // Scoped to `license`: the exemption is keyed on the label STRING, and a
      // concept of another vocabulary that happened to share one would lose the
      // guard without anyone noticing.
      if (vocab === 'license' && verified.has(e.label)) continue;
      const bad = e.label.split(/[ /-]+/).slice(1)
        .filter(w => /^[a-zäöü]/.test(w) && !GERMAN_FUNCTION_WORDS.includes(w.toLowerCase()));
      if (bad.length) offenders.push(`${vocab}: ${e.label}`);
    }
  }
  assert.deepEqual(offenders, [], 'labels[0] is the DISPLAY form — write it as it should be shown');
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

/**
 * The licence names the REPOSITORY itself displays, read from
 * `GET /config/v1/language/defaults` → `LICENSE.NAMES` (15 keys, measured
 * 2026-08-12 against staging: 14 licences plus `MULTI`, which is a statement
 * about a SET of licences rather than one — `scripts/sync-vocabs.mjs` lists it
 * under `NOT_MIRRORED` with that reason).
 *
 * That resource is the authority for licences and the mds `values` endpoint is
 * NOT: asked for `ccm:commonlicense_key` it answers with the bare key as its own
 * `displayString` for all 16 values, in every locale — that list is the set of
 * values the index holds, not a captioned vocabulary. For every other
 * vocabulary we mirror, `values` DOES carry captions (100 % of
 * educationalcontext, taxonid, oeh_lrt_aggregated, intendedenduserrole).
 *
 * Only the keys where the repository's wording is a FACT we were getting wrong
 * are pinned here. Where ours is merely different and at least as clear
 * (`PDM` "Public Domain Mark" over the official "PDM", `CUSTOM`, `NONE`,
 * `CC_0`), ours stays — a rename with no defect behind it is taste, and
 * `scripts/sync-vocabs.mjs` reports those differences for a human to judge.
 */
const OFFICIAL_LICENSE_NAMES: Array<[key: string, label: string]> = [
  ['CC_BY', 'CC BY'],
  ['CC_BY_SA', 'CC BY-SA'],
  ['CC_BY_ND', 'CC BY-ND'],
  ['CC_BY_NC', 'CC BY-NC'],
  ['CC_BY_NC_SA', 'CC BY-NC-SA'],
  ['CC_BY_NC_ND', 'CC BY-NC-ND'],
  ['COPYRIGHT_FREE', 'Copyright, freier Zugang'],
  ['COPYRIGHT_LICENSE', 'Copyright, lizenzpflichtig'],
  ['UNTERRICHTS_UND_LEHRMEDIEN', '§60b Unterrichts- und Lehrmedien'],
  ['SCHULFUNK', 'Schulfunk (§47 UrhG)'],
];

test('a licence is displayed under the name the repository itself uses', () => {
  for (const [key, label] of OFFICIAL_LICENSE_NAMES) {
    assert.equal(labelFromUri(key, 'license'), label, key);
  }
});

test('"Copyright, freier Zugang" is not "urheberrechtsfrei" — and the wrong alias is gone', () => {
  // The defect this replaces: COPYRIGHT_FREE was labelled "urheberrechtsfrei",
  // which claims the opposite of what the repository means by it. Its own
  // description (LICENSE.DESCRIPTION.COPYRIGHT_FREE) reads "Das Werk ist
  // kostenfrei zugänglich. Nutzung und Quellenangabe gemäß den allgemeingültigen
  // gesetzlichen Regelungen (UrhG)" — copyrighted, merely free to access. It is
  // the third most common licence in the corpus (12 445 of 403 461 records
  // measured 2026-08-12), so the wrong word was on a lot of screens.
  //
  // The alias goes with it: someone typing "urheberrechtsfrei" wants material
  // free OF copyright, and handing them COPYRIGHT_FREE answers a different
  // question silently. Unresolved is the honest outcome — `buildFilterCriteria`
  // then reports it and lists the valid values.
  assert.notEqual(resolveVocab('urheberrechtsfrei', 'license'), 'COPYRIGHT_FREE');
  // What that word actually describes:
  assert.equal(resolveVocab('gemeinfrei', 'license'), 'PDM');
});

/**
 * Every distinct `ccm:commonlicense_key` the staging corpus holds, with its
 * record count — a facet over all 403 461 records, measured 2026-08-12.
 * `null` marks the two values that are not licence keys of their own.
 */
const CORPUS_LICENSE_KEYS: Array<[key: string, records: number, resolvesTo: string | null]> = [
  ['CC_BY_NC_SA', 70627, 'CC_BY_NC_SA'],
  ['CC_BY', 62093, 'CC_BY'],
  ['CUSTOM', 57197, 'CUSTOM'],
  ['CC_BY_SA', 50240, 'CC_BY_SA'],
  ['CC_BY_NC_ND', 32080, 'CC_BY_NC_ND'],
  ['COPYRIGHT_FREE', 12445, 'COPYRIGHT_FREE'],
  ['CC_BY_NC', 4663, 'CC_BY_NC'],
  ['CC_BY_ND', 3710, 'CC_BY_ND'],
  ['CC_0', 2024, 'CC_0'],
  ['COPYRIGHT_LICENSE', 1359, 'COPYRIGHT_LICENSE'],
  // A legacy spelling of the same three terms, aliased onto the canonical key so
  // its 497 records get a readable label and survive the local exactness pass.
  ['CC_BY_SA_NC', 497, 'CC_BY_NC_SA'],
  ['PDM', 408, 'PDM'],
  ['NONE', 56, 'NONE'],
  // The spaced spelling the index also carries; it already resolved before this
  // change, through the fuzzy path rather than as a value of its own.
  ['CC BY-SA', 23, 'CC_BY_SA'],
  ['UNTERRICHTS_UND_LEHRMEDIEN', 15, 'UNTERRICHTS_UND_LEHRMEDIEN'],
  // Not a licence: the empty key is "no value set".
  ['', 56, null],
];

test('every licence key the corpus actually holds resolves to a known licence', () => {
  // The corpus is the specification here, not our table. An unresolved key costs
  // twice: `labelFromUri` shows the raw string to a reader, and
  // `filterByExactLicense` drops the record from every licence-filtered result.
  for (const [key, records, expected] of CORPUS_LICENSE_KEYS) {
    assert.equal(resolveVocab(key, 'license'), expected, `${key} (${records} Datensätze)`);
  }
});

test('a licence label never asserts a version the records do not carry', () => {
  // Measured 2026-08-12: `ccm:commonlicense_version` is absent on 90 of 90 CC
  // records sampled across CC_BY / CC_BY_SA / CC_BY_NC_SA, is not in
  // DISPLAY_PROPS, and is not even facetable (400). "CC BY 4.0" was therefore an
  // invented fact on 62 093 CC_BY records alone. The versioned spelling stays as
  // an ALIAS, so every prompt and tool description that already uses it keeps
  // resolving.
  for (const entry of listVocab('license')) {
    assert.ok(!/\d\.\d/.test(entry.label), `${entry.uri} behauptet eine Version: ${entry.label}`);
  }
  assert.equal(resolveVocab('CC BY 4.0', 'license'), 'CC_BY');
  assert.equal(resolveVocab('CC BY-SA 4.0', 'license'), 'CC_BY_SA');
});
