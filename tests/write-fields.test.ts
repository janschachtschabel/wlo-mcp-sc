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

test('the allow-list holds exactly the 30 fields the design names', () => {
  // 14 until 2026-08-03. `cm:title` and `cm:description` were added because
  // this server ALREADY wrote both — the collection tools sent them beside the
  // allow-list, so the surface could neither bound their length nor put them in
  // the confirmation preview. Naming them narrows what happens; it does not
  // widen it. They stay unreachable from the content tools, which is decided by
  // CONTENT_FIELDS, not here.
  // 16 until 2026-08-18, when the five quality FINDINGS fields were added. The
  // 2026-08-17 survey had refused all 14 quality fields together, on the measured
  // ground that 11 of them store values outside the vocabulary they declare.
  // That is true of the seven STAR fields and false of these five: they declare
  // one fully labelled vocabulary (`human_findings` … `unchecked`), and four of
  // the five are already used with it in the corpus (37/52 in copyright_law,
  // 38/54 criminal_law, 35/50 personal_law). Re-measured 2026-08-18.
  // 21 until the seven 0–5 quality SCALES were added on 2026-08-19: didactics,
  // language, medial, neutralness, transparentness, data privacy, currentness.
  // `login` and `relevancy_for_education` are NOT among them — measured, they
  // declare 0–1 and are genuine yes/no questions ("Ohne Login zugänglich",
  // "Ja - geeignet"), not truncated scales. `ccm:containsAdvertisement` declares
  // 0–5 too and stays read-only: 69 628 of its 69 688 values are `yes`/`no`, so
  // writing a star there would introduce a third spelling into the one field
  // that already has two.
  assert.equal(Object.keys(WRITABLE_FIELDS).length, 30);
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


// ── Quality findings: the slot an automatic check writes into (2026-08-18) ──

const QUALITY_FIELDS = [
  'ccm:oeh_quality_correctness',
  'ccm:oeh_quality_copyright_law',
  'ccm:oeh_quality_criminal_law',
  'ccm:oeh_quality_personal_law',
  'ccm:oeh_quality_protection_of_minors',
];

test('every quality findings field takes the machine verdicts', () => {
  for (const field of QUALITY_FIELDS) {
    const QF = 'http://w3id.org/openeduhub/vocabs/quality/';
    assert.deepEqual(validateField(field, 'Auffälligkeiten gefunden (Maschine)'),
      { ok: true, values: [`${QF}auto_findings`] }, `${field} accepts a finding`);
    assert.deepEqual(validateField(field, 'keine Auffälligkeiten gefunden (Maschine)'),
      { ok: true, values: [`${QF}no_auto_findings`] });
    assert.deepEqual(validateField(field, 'ungeprüft'), { ok: true, values: [`${QF}unchecked`] });
  }
});

/** The accepted values of a validation, or a failure that names itself. */
function accepted(property: string, input: string): string[] {
  const r = validateField(property, input);
  assert.ok(r.ok, `„${input}“ sollte angenommen werden: ${r.ok ? '' : r.reason}`);
  return r.values;
}

test('short aliases work — a model should not have to quote the caption', () => {
  const QF = 'http://w3id.org/openeduhub/vocabs/quality/';
  assert.deepEqual(accepted('ccm:oeh_quality_correctness', 'auto_findings'), [`${QF}auto_findings`]);
  assert.deepEqual(accepted('ccm:oeh_quality_correctness', 'Befund'), [`${QF}auto_findings`]);
  assert.deepEqual(accepted('ccm:oeh_quality_correctness', 'kein Befund'), [`${QF}no_auto_findings`]);
});

test('the vocabulary URI is accepted as written', () => {
  const uri = 'http://w3id.org/openeduhub/vocabs/quality/no_auto_findings';
  assert.deepEqual(accepted('ccm:oeh_quality_correctness', uri), [uri]);
});

test('a HUMAN verdict is refused, and the refusal says whose it is', () => {
  // The value names who did the CHECK, and this tool is called by a model. A
  // model recording "geprüft (Mensch)" would put an editorial seal on a record
  // that no person looked at — the one claim in this vocabulary that cannot be
  // corrected by reading the record.
  for (const input of ['human_findings', 'no_human_findings',
                       'http://w3id.org/openeduhub/vocabs/quality/human_findings',
                       'Auffälligkeiten gefunden (Mensch)']) {
    const r = validateField('ccm:oeh_quality_correctness', input);
    assert.equal(r.ok, false, `${input} must be refused`);
    assert.match(r.ok ? '' : r.reason, /Mensch|manuell/i, 'the refusal names whose verdict it is');
  }
});

test('a value from another vocabulary is refused naming it', () => {
  const r = validateField('ccm:oeh_quality_correctness', 'Sekundarstufe I');
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /Sekundarstufe I/);
});

test('a star rating is refused — that is the other family of fields', () => {
  // The seven star fields stay unwritable; a digit in a findings field is what
  // 41 of 41 records in `correctness` wrongly hold today.
  const r = validateField('ccm:oeh_quality_correctness', '4');
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /4/);
});

test('the star fields themselves are still not writable at all', () => {
  for (const field of ['ccm:oeh_quality_didactics', 'ccm:oeh_quality_neutralness',
                       'ccm:oeh_quality_language', 'ccm:oeh_quality_login']) {
    const r = validateField(field, 'unchecked');
    assert.equal(r.ok, false, `${field} must stay closed`);
  }
});

test('each quality field carries a German label for the confirmation preview', () => {
  for (const field of QUALITY_FIELDS) {
    assert.ok(WRITABLE_FIELDS[field]?.label, `${field} has a label`);
    assert.match(WRITABLE_FIELDS[field].label, /[A-Za-zÄÖÜäöüß]/);
  }
});


// ── The 0–5 quality scales (2026-08-19) ────────────────────────────────────

const SCALE_FIELDS = [
  'ccm:oeh_quality_didactics',
  'ccm:oeh_quality_language',
  'ccm:oeh_quality_medial',
  'ccm:oeh_quality_neutralness',
  'ccm:oeh_quality_transparentness',
  'ccm:oeh_quality_data_privacy',
  'ccm:oeh_quality_currentness',
];

test('every 0–5 scale takes a digit and stores the form the widget declares', () => {
  // Six scales declare the full URI, `currentness` declares the bare digit.
  // Writing "4" everywhere would be right in one field and wrong in six.
  assert.deepEqual(accepted('ccm:oeh_quality_didactics', '4'),
    ['http://w3id.org/openeduhub/vocabs/quality_didactics/4']);
  assert.deepEqual(accepted('ccm:oeh_quality_neutralness', '0'),
    ['http://w3id.org/openeduhub/vocabs/quality_neutrality/0']);
  assert.deepEqual(accepted('ccm:oeh_quality_currentness', '3'), ['3']);
});

test('all seven fields accept the whole range 0 to 5', () => {
  for (const field of SCALE_FIELDS) {
    for (const digit of ['0', '1', '2', '3', '4', '5']) {
      const r = validateField(field, digit);
      assert.ok(r.ok, `${field} muss ${digit} annehmen: ${r.ok ? '' : r.reason}`);
    }
  }
});

test('the caption is accepted too, so a model may write what it read', () => {
  assert.deepEqual(accepted('ccm:oeh_quality_didactics', '✰✰✰ gute Methodik'),
    ['http://w3id.org/openeduhub/vocabs/quality_didactics/3']);
});

test('a position outside the scale is refused with the range named', () => {
  for (const bad of ['6', '-1', '10', 'sehr gut']) {
    const r = validateField('ccm:oeh_quality_didactics', bad);
    assert.equal(r.ok, false, `${bad} must be refused`);
    assert.match(r.ok ? '' : r.reason, /0.*5|0 bis 5/,
      'the refusal names what the scale offers');
  }
});

test('the two binary fields take 0 and 1, in the declared bare form', () => {
  // Re-measured 2026-08-19: both declare exactly 0 and 1 as BARE digits, and
  // `ccm:oeh_quality_login` is the cleanest field of all fourteen — 71 459 × "1",
  // 1 328 × "0", nothing outside its declaration.
  for (const field of ['ccm:oeh_quality_login', 'ccm:oeh_quality_relevancy_for_education']) {
    assert.deepEqual(accepted(field, '1'), ['1'], `${field} takes 1`);
    assert.deepEqual(accepted(field, '0'), ['0'], `${field} takes 0`);
  }
});

test('a binary field refuses 2 and names the range it has', () => {
  const r = validateField('ccm:oeh_quality_login', '2');
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /0 bis 1/,
    'the range comes from the scale, not from an assumption that every scale is 0–5');
});

test('the binary captions are accepted as input too', () => {
  assert.deepEqual(accepted('ccm:oeh_quality_login', 'Ohne Login zugänglich'), ['1']);
  assert.deepEqual(accepted('ccm:oeh_quality_relevancy_for_education', 'Ja - geeignet'), ['1']);
});

test('advertising stays read-only although its scale is 0–5', () => {
  assert.equal(validateField('ccm:containsAdvertisement', '5').ok, false);
});

test('each scale field carries a German label for the confirmation preview', () => {
  for (const field of SCALE_FIELDS) {
    assert.ok(WRITABLE_FIELDS[field]?.label, `${field} has a label`);
  }
});

test('a caption can be written back exactly as a record rendered it', () => {
  // Regression, found 2026-08-19 by review. `validateField` trims every incoming
  // value while the scale table compares against the caption UNTRIMMED, and the
  // repository's own caption for this one position carries a leading space
  // (" 0-A veralteter Inhalt"). So the one input form both the parameter
  // description and the refusal message promise — "oder die Beschriftung" —
  // was refused for it, by the same sentence that had just printed it.
  assert.deepEqual(accepted('ccm:oeh_quality_currentness', '0-A veralteter Inhalt'), ['0']);
  assert.deepEqual(accepted('ccm:oeh_quality_currentness', ' 0-A veralteter Inhalt '), ['0']);
});
