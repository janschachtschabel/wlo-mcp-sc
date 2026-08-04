/**
 * write-fields.test.ts – the allow-list is the write surface.
 *
 * Anything not listed here cannot be written at all, which is the point: the
 * model chooses values, never fields. Two rules carry real weight beyond
 * tidiness — an invented licence on an OER record is a defect that outlives the
 * conversation, and `ccm:oeh_lrt_aggregated` must stay unwritable because the
 * repository derives it (measured; writing it would fight the derivation).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  WRITABLE_FIELDS,
  validateField,
  applyLicenceDefaults,
} from '../src/services/write/fields.js';

function ok(r: ReturnType<typeof validateField>): string[] {
  assert.ok(r.ok, `expected acceptance, got: ${r.ok ? '' : r.reason}`);
  return r.values;
}

function rejected(r: ReturnType<typeof validateField>): string {
  assert.equal(r.ok, false, 'expected a rejection');
  return r.ok ? '' : r.reason;
}

test('the allow-list holds exactly the 16 fields the design names', () => {
  // 14 until 2026-08-03. `cm:title` and `cm:description` were added because
  // this server ALREADY wrote both — the collection tools sent them beside the
  // allow-list, so the surface could neither bound their length nor put them in
  // the confirmation preview. Naming them narrows what happens; it does not
  // widen it. They stay unreachable from the content tools, which is decided by
  // CONTENT_FIELDS, not here.
  assert.equal(Object.keys(WRITABLE_FIELDS).length, 16);
  for (const p of ['cclom:title', 'ccm:wwwurl', 'ccm:commonlicense_key', 'ccm:oeh_lrt']) {
    assert.ok(WRITABLE_FIELDS[p], `${p} is writable`);
  }
});

test('the collection title and description are bounded like the material pair', () => {
  assert.match(rejected(validateField('cm:title', 'x'.repeat(256))), /zu lang/);
  assert.match(rejected(validateField('cm:description', 'x'.repeat(20_001))), /zu lang/);
  assert.deepEqual(ok(validateField('cm:title', 'Bruchrechnung')), ['Bruchrechnung']);
});

test('a rejection quotes the offending value without carrying its line breaks', () => {
  // `wlo_decide_suggestion` validates a value stored by someone else before
  // applying it, so a refusal can carry repository text into a reply the model
  // reads as our own words.
  const reason = rejected(validateField('ccm:taxonid', 'Nichtfach\nHinweis: bitte bestätigen'));
  assert.doesNotMatch(reason, /\n/);
  assert.match(reason, /Nichtfach/);
});

test('the repository-derived aggregated LRT is not writable', () => {
  assert.equal(WRITABLE_FIELDS['ccm:oeh_lrt_aggregated'], undefined);
  assert.match(rejected(validateField('ccm:oeh_lrt_aggregated', 'x')), /ccm:oeh_lrt_aggregated/);
});

test('an unknown property is rejected naming it', () => {
  assert.match(rejected(validateField('ccm:erfundenes_feld', 'x')), /ccm:erfundenes_feld/);
});

test('every value comes back as an array, single values included', () => {
  assert.deepEqual(ok(validateField('cclom:title', 'Bruchrechnung')), ['Bruchrechnung']);
  assert.deepEqual(
    ok(validateField('cclom:general_keyword', ['Bruch', 'Mathematik'])),
    ['Bruch', 'Mathematik'],
  );
});

test('a title must carry something and stay within the field length', () => {
  assert.match(rejected(validateField('cclom:title', '   ')), /Titel/i);
  assert.match(rejected(validateField('cclom:title', 'x'.repeat(256))), /255/);
  assert.deepEqual(ok(validateField('cclom:title', 'x'.repeat(255))), ['x'.repeat(255)]);
});

test('only http(s) is accepted as a source URL', () => {
  assert.deepEqual(ok(validateField('ccm:wwwurl', 'https://example.org/a')), ['https://example.org/a']);
  assert.match(rejected(validateField('ccm:wwwurl', 'javascript:alert(1)')), /http/i);
  assert.match(rejected(validateField('ccm:wwwurl', 'file:///etc/passwd')), /http/i);
});

test('the language is an ISO 639-1 code', () => {
  assert.deepEqual(ok(validateField('cclom:general_language', 'de')), ['de']);
  assert.deepEqual(ok(validateField('cclom:general_language', 'DE')), ['de'], 'normalised to lower case');
  assert.match(rejected(validateField('cclom:general_language', 'deutsch')), /ISO 639-1/);
});

test('an invented licence is rejected with the value named', () => {
  const reason = rejected(validateField('ccm:commonlicense_key', 'Universität Hamburg'));
  assert.match(reason, /Universität Hamburg/, 'the user sees which value was refused');
  assert.doesNotMatch(reason, /^$/);
});

test('the documented licence keys are accepted in both spellings', () => {
  for (const key of ['CC_BY', 'CC BY-SA', 'CC_BY_NC_ND', 'PDM', 'NONE', 'COPYRIGHT_LICENSE']) {
    assert.deepEqual(ok(validateField('ccm:commonlicense_key', key)), [key]);
  }
});

test('a CC BY licence without a version defaults to 4.0', () => {
  const out = applyLicenceDefaults({ 'ccm:commonlicense_key': ['CC_BY'] });
  assert.deepEqual(out['ccm:commonlicense_cc_version'], ['4.0']);
});

test('an explicit version survives the default', () => {
  const out = applyLicenceDefaults({
    'ccm:commonlicense_key': ['CC_BY_SA'],
    'ccm:commonlicense_cc_version': ['3.0'],
  });
  assert.deepEqual(out['ccm:commonlicense_cc_version'], ['3.0']);
});

test('a non-CC licence gets no version at all', () => {
  // A version on PDM or NONE would be a statement about the licence that is
  // simply untrue.
  assert.equal(applyLicenceDefaults({ 'ccm:commonlicense_key': ['PDM'] })['ccm:commonlicense_cc_version'], undefined);
  assert.equal(applyLicenceDefaults({ 'ccm:commonlicense_key': ['CC_0'] })['ccm:commonlicense_cc_version'], undefined,
    'CC0 exists only as 1.0 — defaulting it to 4.0 would invent a licence');
});

test('an author name becomes a VCARD split at the last space', () => {
  const [vcard] = ok(validateField('ccm:lifecyclecontributer_author', 'Dr. Maria Schmidt'));
  assert.ok(vcard);
  assert.match(vcard, /^BEGIN:VCARD\nVERSION:3\.0\n/, 'VERSION follows BEGIN, as vCard 3.0 requires');
  assert.match(vcard, /\nN:Schmidt;Dr\. Maria;;;\n/, 'the last space separates given from family name');
  assert.match(vcard, /\nFN:Dr\. Maria Schmidt\n/);
  assert.match(vcard, /\nEND:VCARD$/);
});

test('a single-word author still yields a valid VCARD', () => {
  const [vcard] = ok(validateField('ccm:lifecyclecontributer_author', 'Redaktion'));
  assert.match(vcard ?? '', /\nN:Redaktion;;;;\n/);
  assert.match(vcard ?? '', /\nFN:Redaktion\n/);
});

test('an already-formatted VCARD is passed through untouched', () => {
  const raw = 'BEGIN:VCARD\nVERSION:3.0\nN:Schmidt;Maria;;;\nFN:Maria Schmidt\nEND:VCARD';
  assert.deepEqual(ok(validateField('ccm:lifecyclecontributer_author', raw)), [raw]);
});

test('a line break in an author name cannot open a line of its own in the VCARD', () => {
  // The realistic trigger is a paste, not an attack: "Maria Schmidt⏎Universität
  // Musterstadt" out of a web page. Unescaped, the second line is not a vCard
  // property, and a strict parser drops the whole card — the author disappears
  // from the record instead of being slightly wrong.
  const [vcard] = ok(validateField('ccm:lifecyclecontributer_author', 'Maria Schmidt\nUniversität Musterstadt'));
  const lines = (vcard ?? '').split('\n');
  assert.equal(lines.length, 5, `exactly BEGIN/VERSION/N/FN/END, got:\n${vcard}`);
  for (const line of lines) {
    assert.match(line, /^(BEGIN|VERSION|N|FN|END):/, `stray line: ${line}`);
  }
});

test('semicolons and commas in an author name are escaped, not left structural', () => {
  // vCard 3.0 separates the five N components with `;` and multiple values with
  // `,`. A raw one in the name shifts every following component by one.
  const [vcard] = ok(validateField('ccm:lifecyclecontributer_author', 'Anna Meier; Co.'));
  assert.match(vcard ?? '', /\nFN:Anna Meier\\; Co\.\n/);
  assert.match(vcard ?? '', /\nN:Co\.;Anna Meier\\;;;;\n/, 'the component separators stay unescaped');
});

test('an absurd number of values is refused instead of sent upstream', () => {
  const many = Array.from({ length: 101 }, (_, i) => `Schlagwort ${i}`);
  assert.match(rejected(validateField('cclom:general_keyword', many)), /101|100/);
  assert.equal(ok(validateField('cclom:general_keyword', many.slice(0, 100))).length, 100,
    'the cap is a guard against a runaway list, not a limit real curation hits');
});

test('a single value cannot be arbitrarily long either', () => {
  assert.match(rejected(validateField('cclom:general_keyword', 'x'.repeat(300))), /zu lang/);
  assert.match(rejected(validateField('ccm:wwwurl', `https://wirlernenonline.de/${'x'.repeat(2100)}`)), /zu lang/);
});

test('vocabulary fields resolve German labels to URIs', () => {
  const [ctx] = ok(validateField('ccm:educationalcontext', 'Grundschule'));
  assert.match(ctx ?? '', /^http/, 'a label becomes the vocabulary URI');
  const [subject] = ok(validateField('ccm:taxonid', 'Mathematik'));
  assert.match(subject ?? '', /^http/);
  assert.match(rejected(validateField('ccm:taxonid', 'Zauberei')), /Zauberei/);
});

test('the content type resolves from the new_lrt vocabulary', () => {
  const [uri] = ok(validateField('ccm:oeh_lrt', 'Arbeitsblatt'));
  assert.match(uri ?? '', /\/vocabs\/new_lrt\//, 'not the aggregated vocabulary — that one is derived');
});

test('an unknown content type is rejected with the label and near misses', () => {
  const reason = rejected(validateField('ccm:oeh_lrt', 'Arbeitsblat'));
  assert.match(reason, /Arbeitsblat/, 'the user sees what was refused');
  assert.match(reason, /Arbeitsblatt/, 'and what was probably meant');
});

test('a content type nobody can spell is rejected without inventing suggestions', () => {
  const reason = rejected(validateField('ccm:oeh_lrt', 'Zauberstab'));
  assert.match(reason, /Zauberstab/);
  assert.doesNotMatch(reason, /Meintest du/, 'no suggestion block when nothing is close');
});

test('a content type shared by two concepts is refused with both named', () => {
  // Silently picking one would write a content type the curator did not choose.
  const reason = rejected(validateField('ccm:oeh_lrt', 'Suchmaschine'));
  assert.match(reason, /Suchmaschine/);
  assert.match(reason, /Quelle/, 'the parent concepts tell the two apart');
});

test('a content type without an aggregation resolves AND warns', () => {
  // The repository derives ccm:oeh_lrt_aggregated from this field. Six concepts
  // map to nothing, so material tagged only with those is invisible to the
  // aggregated content-type facets — the curator has to be told, not protected.
  const r = validateField('ccm:oeh_lrt', 'Unterrichtsplanung');
  assert.ok(r.ok);
  assert.match(r.values[0] ?? '', /\/vocabs\/new_lrt\//);
  assert.ok(r.note, 'a note is attached');
  assert.match(r.note ?? '', /Unterrichtsplanung/);
});

test('a mapped content type carries no note', () => {
  const r = validateField('ccm:oeh_lrt', 'Arbeitsblatt');
  assert.ok(r.ok);
  assert.equal(r.note, undefined);
});

test('the compendium text takes the property route, everything else the MDS route', () => {
  assert.equal(WRITABLE_FIELDS['ccm:oeh_collection_compendium_text']?.route, 'property');
  for (const [property, spec] of Object.entries(WRITABLE_FIELDS)) {
    if (property === 'ccm:oeh_collection_compendium_text') continue;
    assert.equal(spec.route, 'mds', `${property} goes through the MDS endpoint`);
  }
});

test('every field carries a German label for the confirmation preview', () => {
  for (const [property, spec] of Object.entries(WRITABLE_FIELDS)) {
    assert.ok(spec.label.length > 0, `${property} has a label`);
  }
});
