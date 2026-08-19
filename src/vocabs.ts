/**
 * vocabs.ts – WLO Vocabulary mappings
 *
 * Resolves human-readable labels (German) ↔ full URIs for
 * educational level, target audience, school subject, learning resource type
 * (aggregated), licenses, and topic-page target audiences.
 *
 * **Authoritative sources (official SKOS vocabularies):**
 *   - School subjects (this file's `discipline` map):
 *     https://vocabs.openeduhub.de/w3id.org/openeduhub/vocabs/discipline/index.json
 *   - Educational levels:
 *     https://vocabs.openeduhub.de/w3id.org/openeduhub/vocabs/educationalContext/index.json
 *   - Target audiences (intendedEndUserRole):
 *     https://vocabs.openeduhub.de/w3id.org/openeduhub/vocabs/intendedEndUserRole/index.json
 *   - Learning resource types (aggregated):
 *     https://vocabs.openeduhub.de/w3id.org/openeduhub/vocabs/new_lrt_aggregated/index.json
 *
 * **Deliberately NOT included:** university subject taxonomy (Hochschulfächersystematik)
 *     https://vocabs.openeduhub.de/w3id.org/openeduhub/vocabs/hochschulfaechersystematik/index.json
 *
 * Rationale: The vocabulary has ~100+ concepts with top-level areas
 * like "Mathematik, Naturwissenschaften" (n4) — terms collide with
 * the school-subjects vocabulary (e.g. "Mathematik" → discipline/380 vs.
 * university n4 = broad cluster). Local resolution would be ambiguous for
 * the *input side* (user filter) and could unintentionally filter too
 * broadly.
 *
 * Display (URI → label) is instead handled via the server-side
 * `<property>_DISPLAYNAME` field of the edu-sharing API in `formatter.ts`
 * — that covers both vocabularies automatically, without maintaining local
 * university mappings.
 */

import { universitySubjectLabel } from './vocabs-hochschule.js';

export type VocabKey = 'educationalContext' | 'discipline' | 'userRole' | 'lrt' | 'license'
  | 'targetGroup' | 'qualityFinding';

interface VocabEntry {
  id: string;
  /**
   * `labels[0]` is the DISPLAY form — the concept's official German prefLabel —
   * and every entry after it is a matching alias only.
   *
   * The two jobs share one array, which is why the display form used to be
   * wrong: the table was written all-lowercase for the matching half, and
   * `labelFromUri` only upper-cases the first character, so it rendered
   * "Sekundarstufe i", "Deutsch als zweitsprache" and "Mint" for MINT. 23 of 152
   * concepts across the six tables were affected (checked against the SKOS
   * sources of record on 2026-08-11).
   *
   * WHERE that shows: `formatNode` prefers the server's `<property>_DISPLAYNAME`
   * and only falls back here (`resolveLabels`), so a normal hit list usually
   * carries the repository's label, not ours. What has no DISPLAYNAME to fall
   * back on — and is therefore rendered from this table alone — is the facet
   * breakdown, the licence, `lookup_wlo_vocabulary`, and the topic-page fields
   * that come from raw URIs, `variantPreset.educationLevelLabels` among them.
   *
   * A test now fails any label whose continuation is lowercase, so this cannot
   * come back through a new entry; the concepts whose official prefLabel is not
   * simply the capitalised alias are pinned individually. Both in
   * `tests/vocabs.test.ts`.
   *
   * Casing costs the matching nothing: `resolveVocab` and `labelFromUri`
   * lowercase both sides. A display form that differs by more than casing —
   * "Umweltgefährdung, Umweltschutz" gained a comma — must KEEP the previous
   * spelling as an alias, or the exact-match path loses it.
   *
   * The AGGREGATED LRT table is the one that does not simply mirror its source:
   * 9 of its 48 display forms are shortened on purpose ("Tests" for "Tests /
   * Fragebögen"), and every dropped part exists as an alias. Only the casing was
   * fixed there. `vocabs-lrt.ts` is the opposite — 220 of 220 verbatim.
   */
  labels: string[];
}

// ── Educational level ────────────────────────────────────────────────────────
const EC_BASE = 'http://w3id.org/openeduhub/vocabs/educationalContext/';

/**
 * Grade-number aliases ("Klasse 5", "5. Klasse") for a Stufe — models often
 * carry the user's grade verbatim, which previously resolved to nothing and
 * produced no fuzzy suggestion either (numbers are unbridgeable by edit
 * distance). Grades 1–4 → Grundschule, 5–10 → Sek I, 11–13 → Sek II.
 */
function gradeAliases(from: number, to: number): string[] {
  const out: string[] = [];
  for (let g = from; g <= to; g++) out.push(`klasse ${g}`, `${g}. klasse`);
  return out;
}

const EDUCATIONAL_CONTEXT: VocabEntry[] = [
  // "elementary school" belongs to Grundschule below, not here: in English it is
  // primary school, and as an alias on both entries the first-wins exact match
  // silently sent an English filter to the pre-school concept.
  { id: EC_BASE + 'elementarbereich',  labels: ['elementarbereich', 'elementarstufe', 'elementary level', 'kita', 'kindergarten'] },
  { id: EC_BASE + 'schule',            labels: ['schule', 'school'] },
  { id: EC_BASE + 'grundschule',       labels: ['primarstufe', 'grundschule', 'primary school', 'elementary school', 'primär', ...gradeAliases(1, 4)] },
  { id: EC_BASE + 'sekundarstufe_1',   labels: ['Sekundarstufe I', 'sekundarstufe 1', 'secondary i', 'lower secondary school', 'sek i', 'sek1', 'sekundarstufe1', ...gradeAliases(5, 10)] },
  { id: EC_BASE + 'sekundarstufe_2',   labels: ['Sekundarstufe II', 'sekundarstufe 2', 'secondary ii', 'upper secondary school', 'sek ii', 'sek2', 'gymnasium', 'oberstufe', ...gradeAliases(11, 13)] },
  { id: EC_BASE + 'hochschule',        labels: ['hochschule', 'higher education', 'universität', 'uni', 'studium', 'hochschulbildung'] },
  { id: EC_BASE + 'berufliche_bildung',labels: ['Berufliche Bildung', 'vocational education', 'berufsausbildung', 'berufsschule', 'ausbildung'] },
  { id: EC_BASE + 'fortbildung',       labels: ['fortbildung', 'further education', 'weiterbildung', 'fortbildungen'] },
  { id: EC_BASE + 'erwachsenenbildung',labels: ['erwachsenenbildung', 'continuing education', 'erwachsene'] },
  { id: EC_BASE + 'foerderschule',     labels: ['förderschule', 'special education', 'sonderpädagogische förderung', 'förderung'] },
  { id: EC_BASE + 'fernunterricht',    labels: ['fernunterricht', 'distance learning', 'fernstudium', 'e-learning'] },
  { id: EC_BASE + 'informelles_lernen',labels: ['Informelles Lernen', 'informal learning'] },
];

// ── Target audience ──────────────────────────────────────────────────────────
const UR_BASE = 'http://w3id.org/openeduhub/vocabs/intendedEndUserRole/';

/**
 * The verdict of a quality check, shared by the five `ccm:oeh_quality_*` FINDINGS
 * fields (correctness, copyright_law, criminal_law, personal_law,
 * protection_of_minors).
 *
 * This is one of the two families the metadata set puts under `oeh_quality`, and
 * the only writable one. It says WHO checked and WHETHER anything was found —
 * which is exactly the shape an automatic check needs. The other family is the
 * star ratings (didactics, language, medial, …), and those stay closed: they are
 * an editorial judgement, and the corpus stores a bare digit where the widget
 * declares a URI.
 *
 * Labels are the repository's own captions, measured from `mds_oeh` on
 * 2026-08-18; the aliases are ours, so a model does not have to quote a caption
 * verbatim. `human_findings`/`no_human_findings` are listed because they ARE the
 * vocabulary — `lookup_wlo_vocabulary` must not misreport it — while the write
 * path refuses them separately (`services/write/fields.ts`).
 */
const QF_BASE = 'http://w3id.org/openeduhub/vocabs/quality/';
const QUALITY_FINDING: VocabEntry[] = [
  { id: QF_BASE + 'auto_findings',    labels: ['Auffälligkeiten gefunden (Maschine)', 'auto_findings', 'befund', 'auffälligkeiten', 'auffaelligkeiten', 'maschinell auffällig'] },
  { id: QF_BASE + 'no_auto_findings', labels: ['keine Auffälligkeiten gefunden (Maschine)', 'no_auto_findings', 'kein befund', 'keine auffälligkeiten', 'keine auffaelligkeiten', 'maschinell unauffällig'] },
  { id: QF_BASE + 'human_findings',    labels: ['Auffälligkeiten gefunden (Mensch)', 'human_findings'] },
  { id: QF_BASE + 'no_human_findings', labels: ['keine Auffälligkeiten gefunden (Mensch)', 'no_human_findings'] },
  { id: QF_BASE + 'unchecked',        labels: ['Ungeprüft', 'unchecked', 'ungeprüft', 'ungeprueft', 'nicht geprüft'] },
];

const USER_ROLE: VocabEntry[] = [
  { id: UR_BASE + 'author',      labels: ['autor/in', 'autor', 'autorin', 'author'] },
  { id: UR_BASE + 'counsellor',  labels: ['berater/in', 'berater', 'beraterin', 'counsellor', 'ratgeber/in'] },
  { id: UR_BASE + 'learner',     labels: ['lerner/in', 'lernende', 'lernender', 'schüler', 'schülerin', 'learner', 'students'] },
  { id: UR_BASE + 'manager',     labels: ['verwaltung', 'manager', 'schulleitung', 'leitung'] },
  { id: UR_BASE + 'parent',      labels: ['eltern', 'parent', 'elter', 'elternteil', 'erziehungsberechtigter', 'sorgeberechtigter'] },
  { id: UR_BASE + 'teacher',     labels: ['lehrer/in', 'lehrer', 'lehrerin', 'lehrende', 'lehrender', 'teacher', 'lehrkraft', 'pädagoge', 'pädagogin'] },
  { id: UR_BASE + 'other',       labels: ['andere', 'other', 'sonstige'] },
];

// ── School subjects ──────────────────────────────────────────────────────────
const DISC_BASE = 'http://w3id.org/openeduhub/vocabs/discipline/';

const DISCIPLINE: VocabEntry[] = [
  { id: DISC_BASE + '720',    labels: ['allgemein', 'interdisciplinary media', 'fächerübergreifend'] },
  { id: DISC_BASE + '20003',  labels: ['Alt-Griechisch', 'ancient greek', 'griechisch'] },
  { id: DISC_BASE + '04001',  labels: ['agrarwirtschaft', 'agricultural economics', 'landwirtschaft'] },
  { id: DISC_BASE + 'oeh01',  labels: ['Arbeit, Ernährung, Soziales'] },
  { id: DISC_BASE + '020',    labels: ['arbeitslehre', 'career education', 'arbeit wirtschaft technik', 'awt', 'polytechnik'] },
  { id: DISC_BASE + '04014',  labels: ['arbeitssicherheit', 'work safety'] },
  { id: DISC_BASE + '46014',  labels: ['astronomie', 'astronomy'] },
  { id: DISC_BASE + '04002',  labels: ['bautechnik', 'construction engineering'] },
  { id: DISC_BASE + '040',    labels: ['Berufliche Bildung', 'vocational education', 'berufsausbildung'] },
  { id: DISC_BASE + '080',    labels: ['biologie', 'biology', 'bio'] },
  { id: DISC_BASE + '100',    labels: ['chemie', 'chemistry'] },
  { id: DISC_BASE + '20041',  labels: ['chinesisch', 'chinese'] },
  { id: DISC_BASE + '12002',  labels: ['Darstellendes Spiel', 'performing game', 'theater', 'theaterpädagogik'] },
  { id: DISC_BASE + '120',    labels: ['deutsch', 'german as mother tongue', 'muttersprache', 'german'] },
  { id: DISC_BASE + '28002',  labels: ['Deutsch als Zweitsprache', 'german as second language', 'daz', 'daf', 'deutsch als fremdsprache'] },
  { id: DISC_BASE + '04005',  labels: ['elektrotechnik', 'electrical engineering'] },
  { id: DISC_BASE + '04006',  labels: ['Ernährung und Hauswirtschaft', 'nutrition and home economics'] },
  { id: DISC_BASE + '20001',  labels: ['englisch', 'english'] },
  { id: DISC_BASE + '440',    labels: ['pädagogik', 'pedagogy', 'erziehungswissenschaften', 'erziehungswissenschaft'] },
  { id: DISC_BASE + '20090',  labels: ['esperanto'] },
  { id: DISC_BASE + '160',    labels: ['ethik', 'ethics', 'werte und normen'] },
  { id: DISC_BASE + '04007',  labels: ['Farbtechnik und Raumgestaltung', 'color technology and interior design', 'raumgestaltung'] },
  { id: DISC_BASE + '20002',  labels: ['französisch', 'french', 'franzoesisch'] },
  { id: DISC_BASE + '220',    labels: ['geografie', 'geography', 'erdkunde', 'geographie', 'geo'] },
  { id: DISC_BASE + '240',    labels: ['geschichte', 'history'] },
  { id: DISC_BASE + '48005',  labels: ['gesellschaftskunde', 'social studies', 'gesellschaftspolitische gegenwartsfragen'] },
  { id: DISC_BASE + '260',    labels: ['gesundheit', 'health education', 'gesundheitserziehung'] },
  { id: DISC_BASE + '50001',  labels: ['hauswirtschaft', 'home economics', 'verbraucherbildung'] },
  { id: DISC_BASE + '04009',  labels: ['holztechnik', 'wood engineering'] },
  { id: DISC_BASE + '320',    labels: ['informatik', 'ict', 'computer science', 'informationstechnologie', 'it', 'info'] },
  { id: DISC_BASE + '340',    labels: ['Interkulturelle Bildung', 'intercultural education'] },
  { id: DISC_BASE + '20004',  labels: ['italienisch', 'italian'] },
  { id: DISC_BASE + '060',    labels: ['kunst', 'art education', 'kunsterziehung', 'art'] },
  { id: DISC_BASE + '04010',  labels: ['körperpflege', 'body care'] },
  { id: DISC_BASE + '20005',  labels: ['latein', 'latin'] },
  { id: DISC_BASE + '380',    labels: ['mathematik', 'mathematics', 'mathe', 'math'] },
  { id: DISC_BASE + 'oeh04010', labels: ['mechatronik'] },
  { id: DISC_BASE + '900',    labels: ['medienbildung', 'media education'] },
  { id: DISC_BASE + '400',    labels: ['mediendidaktik', 'medienerziehung'] },
  { id: DISC_BASE + '04011',  labels: ['metalltechnik', 'metal engineering'] },
  { id: DISC_BASE + '04003',  labels: ['MINT', 'chemie physik biologie', 'naturwissenschaften', 'natural sciences', 'stem'] },
  { id: DISC_BASE + '420',    labels: ['musik', 'music'] },
  { id: DISC_BASE + '64018',  labels: ['nachhaltigkeit', 'sustainability', 'bne', 'bildung für nachhaltige entwicklung'] },
  { id: DISC_BASE + 'niederdeutsch', labels: ['niederdeutsch', 'platt german', 'platt'] },
  { id: DISC_BASE + '44099',  labels: ['Open Educational Resources', 'oer'] },
  { id: DISC_BASE + '450',    labels: ['philosophie', 'philosophy'] },
  { id: DISC_BASE + '460',    labels: ['physik', 'physics'] },
  { id: DISC_BASE + '480',    labels: ['politik', 'politics', 'politische bildung', 'sozialkunde'] },
  { id: DISC_BASE + '510',    labels: ['psychologie', 'psychology'] },
  { id: DISC_BASE + '520',    labels: ['religion', 'religious education', 'religionsunterricht', 'reli'] },
  { id: DISC_BASE + '20006',  labels: ['russisch', 'russian'] },
  { id: DISC_BASE + '28010',  labels: ['sachunterricht', 'homeland lessons', 'heimatunterricht', 'sachkunde'] },
  { id: DISC_BASE + '560',    labels: ['sexualerziehung', 'sex education'] },
  { id: DISC_BASE + '44006',  labels: ['sonderpädagogik', 'special needs education'] },
  { id: DISC_BASE + '20009',  labels: ['sorbisch', 'sorbian'] },
  { id: DISC_BASE + '44007',  labels: ['sozialpädagogik', 'social education'] },
  { id: DISC_BASE + '20007',  labels: ['spanisch', 'spanish'] },
  { id: DISC_BASE + '600',    labels: ['sport', 'physical education', 'sportunterricht'] },
  { id: DISC_BASE + '04012',  labels: ['Textiltechnik und Bekleidung', 'textile technology and clothing'] },
  { id: DISC_BASE + '20008',  labels: ['türkisch', 'turkish'] },
  { id: DISC_BASE + '04013',  labels: ['Wirtschaft und Verwaltung', 'business and administration'] },
  { id: DISC_BASE + '700',    labels: ['wirtschaftskunde', 'economics', 'wirtschaftswissenschaften', 'economy', 'vwl', 'bwl'] },
  { id: DISC_BASE + '640',    labels: ['Umweltgefährdung, Umweltschutz', 'umweltgefährdung umweltschutz', 'environmental education', 'umwelterziehung', 'umwelt'] },
  { id: DISC_BASE + '660',    labels: ['verkehrserziehung', 'road safety education'] },
  { id: DISC_BASE + '680',    labels: ['weiterbildung', 'further education'] },
  { id: DISC_BASE + '50005',  labels: ['werken', 'handicraft', 'textiles werken'] },
  { id: DISC_BASE + '72001',  labels: ['Zeitgemäße Bildung', 'modern education', 'digitale bildung'] },
  { id: DISC_BASE + '72002',  labels: ['projektmanagement', 'project management'] },
  { id: DISC_BASE + '72003',  labels: ['Evidenzbasierte Medizin', 'evidence-based medicine'] },
  { id: DISC_BASE + '999',    labels: ['sonstiges', 'other'] },
];

// ── Learning resource type (aggregated) ──────────────────────────────────────
const LRT_BASE = 'http://w3id.org/openeduhub/vocabs/new_lrt_aggregated/';

const LRT: VocabEntry[] = [
  { id: LRT_BASE + 'b8fb5fb2-d8bf-4bbe-ab68-358b65a26bed', labels: ['bild', 'image'] },
  { id: LRT_BASE + '38774279-af36-4ec2-8e70-811d5a51a6a1', labels: ['video'] },
  { id: LRT_BASE + '39197d6f-dfb1-4e82-92e5-79f906e9d2a9', labels: ['audio', 'podcast'] },
  { id: LRT_BASE + '05aa0f49-7e1b-498b-a7d5-c5fc8e73b2e2', labels: ['Interaktives Medium', 'interactive media', 'interaktiv', 'simulation'] },
  { id: LRT_BASE + '11f438d7-cb11-49c2-8e67-2dd7df677092', labels: ['unterrichtsidee', 'lesson idea'] },
  { id: LRT_BASE + '8526273b-2b21-46f2-ac8d-bbf362c8a690', labels: ['unterrichtsplan', 'lesson plan'] },
  { id: LRT_BASE + 'f1341358-3f91-449b-b6eb-f58636f756a0', labels: ['unterrichtsbaustein', 'unterrichtsreihe', 'lesson unit'] },
  { id: LRT_BASE + '101c0c66-5202-4eba-9ebf-79f4903752b9', labels: ['methoden', 'methods'] },
  { id: LRT_BASE + '02bfd0fe-96ab-4dd6-a306-ec362ec25ea0', labels: ['tests', 'fragebögen', 'test', 'fragebogen', 'quiz'] },
  { id: LRT_BASE + 'e10e9add-700e-4b57-a9c5-8f1088bb0545', labels: ['kurs', 'course'] },
  { id: LRT_BASE + '3469a5e7-86d1-4376-bd3d-1f2b183ed94a', labels: ['lernobjekt', 'lernpfad', 'learning path'] },
  { id: LRT_BASE + '1e300ea3-a687-45a3-b215-9c240c1666dc', labels: ['präsentation', 'presentation', 'folien', 'slides'] },
  { id: LRT_BASE + 'ded96854-280a-45ac-ad3a-f5b9b8dd0a03', labels: ['lernspiel', 'learning game', 'spiel', 'game'] },
  { id: LRT_BASE + 'c8e52242-361b-4a2a-b95d-25e516b28b45', labels: ['arbeitsblatt', 'worksheet'] },
  { id: LRT_BASE + '0b2d7dec-8eb1-4a28-9cf2-4f3a4f5a511b', labels: ['übungsmaterial', 'exercise material', 'übung'] },
  { id: LRT_BASE + '90a082d8-ee5f-4b33-bd5c-f1738262c47d', labels: ['recherche', 'lernauftrag', 'research task'] },
  { id: LRT_BASE + 'ffe4d8e8-3cfd-4e9a-b025-83f129eb5c9d', labels: ['experiment'] },
  { id: LRT_BASE + '71c71f72-fc8d-4263-902f-abf1366a73ca', labels: ['Projekt-Material', 'project material', 'projekt'] },
  { id: LRT_BASE + '57bfc743-4c94-4bdd-bdfa-c638a062d151', labels: ['Kreative Aktivität', 'kreativ', 'creative activity'] },
  { id: LRT_BASE + 'ec402e87-c623-47e2-8d2e-1c4ea6923409', labels: ['Entdeckendes Lernen', 'discovery learning'] },
  { id: LRT_BASE + 'd0c115e4-848d-4aea-8e31-23869e9add3e', labels: ['rollenspiel', 'role play'] },
  { id: LRT_BASE + '41eaccae-899b-4209-8a54-c793a3cdf538', labels: ['fallstudie', 'case study'] },
  { id: LRT_BASE + 'c77df53a-2611-4029-9712-f9c0eeb032a3', labels: ['artikel', 'article'] },
  { id: LRT_BASE + '3927fdb6-0477-422c-9f5a-6285948aeaf4', labels: ['buch', 'lehrbuch', 'book', 'textbook'] },
  { id: LRT_BASE + '9abf6ace-85bc-44e2-af4f-93a6bd255a21', labels: ['handout'] },
  { id: LRT_BASE + 'fece0442-c686-4496-b97e-06d87782009b', labels: ['schülerarbeit', 'student work'] },
  { id: LRT_BASE + '854e5bcf-d898-43ca-bc70-caf2a7e33673', labels: ['noten', 'sheet music', 'musiknoten'] },
  { id: LRT_BASE + '99f3bb30-22c0-4b46-871c-43ab4b6baf6f', labels: ['checkliste', 'checklist'] },
  { id: LRT_BASE + 'ac925aae-1f3c-4817-a9dd-b9b24c336b0d', labels: ['regularien', 'handbuch', 'manual'] },
  { id: LRT_BASE + '55761ec6-0cd4-4677-86ee-6f395934dae7', labels: ['webseite', 'website', 'webpage'] },
  { id: LRT_BASE + 'ac4987d7-5d09-4a21-82c6-268ed6cdc7eb', labels: ['webblog', 'blog'] },
  { id: LRT_BASE + '6f669beb-273a-4153-bdb6-4c6d59b2366d', labels: ['wiki'] },
  { id: LRT_BASE + '9337a93e-777d-4d76-99a5-51f5e9935e63', labels: ['wortliste', 'vokabelliste', 'vocabulary list'] },
  { id: LRT_BASE + 'cf8929a7-d521-4f17-bbe3-96748c862486', labels: ['nachschlagewerk', 'reference work', 'lexikon'] },
  { id: LRT_BASE + '1c610f61-9bf0-4d77-8536-b713a3733510', labels: ['primärmaterial', 'primary source'] },
  { id: LRT_BASE + '37a3ad9c-727f-4b74-bbab-27d59015c695', labels: ['tool', 'werkzeug', 'app'] },
  { id: LRT_BASE + '6b6786df-9ce9-44bf-8a04-caebd4456fcf', labels: ['bildungsangebot', 'educational offer'] },
  { id: LRT_BASE + 'b06c5816-60c7-4f1b-bcd7-95d70aaa4740', labels: ['event', 'wettbewerb', 'competition'] },
  { id: LRT_BASE + '9bbb50a2-10c5-4a8b-9e0e-6a5fc86c40fe', labels: ['news', 'nachricht'] },
  { id: LRT_BASE + '2e678af3-1026-4171-b88e-3b3a915d1673', labels: ['quelle', 'source'] },
  // The eight concepts below complete the vocabulary (48 in total). They carry no
  // entry in the media-type-oriented part above, but the repository derives them
  // from `new_lrt` all the same (see `AGGREGATION` in vocabs-lrt.ts), so they do
  // appear as facet values — and a facet value has no server-side _DISPLAYNAME to
  // fall back on, which rendered them as bare UUID URIs. Labels are the official
  // prefLabels, including the vocabulary's own spelling of "Regelungsintrumente".
  { id: LRT_BASE + '2c151a4e-556e-42db-9e44-3a581deb5834', labels: ['textbausteine', 'textbaustein'] },
  { id: LRT_BASE + 'b1e25325-d403-44f0-814a-ff2f5d866931', labels: ['persönlichkeit', 'bekannte persönlichkeit'] },
  { id: LRT_BASE + '620a3fee-ac87-40e6-8408-20b48b430eca', labels: ['daten'] },
  { id: LRT_BASE + 'a0b83e5a-eaa4-4df8-9eec-3678abd60c25', labels: ['tabellen'] },
  { id: LRT_BASE + 'c2fc554c-a7ae-4af7-a785-d727c5a8d0db', labels: ['formel'] },
  { id: LRT_BASE + '25957b6b-338e-4379-ba4f-67fc7654ef34', labels: ['Modell / 3D', 'modell', '3d-druck'] },
  { id: LRT_BASE + '0d1f8d25-7a81-44d5-b250-1c42bb71c167', labels: ['regelungsintrumente', 'regelungsinstrumente'] },
  { id: LRT_BASE + '9c2acd39-7207-4e28-87a5-06e60d59c9e1', labels: ['orientierungsinstrumente'] },
];

// ── Licenses ─────────────────────────────────────────────────────────────────
// edu-sharing stores license keys (ccm:commonlicense_key) like "CC_BY_SA".
// We map them to human-readable labels here for consistent output.

// NOTE: For licenses we store the *display form* as the primary label
// (e.g. "CC BY-SA" instead of "cc by-sa"). Capitalize-logic in
// labelFromUri only kicks in for fully-lowercase primary labels — otherwise
// "cc by-sa" would render as the unhelpful "Cc by-sa".
//
// The display forms come from the REPOSITORY's own UI strings —
// `GET /config/v1/language/defaults` → `LICENSE.NAMES`, 15 keys, read
// 2026-08-12 — 14 licences plus `MULTI`, which is not one (see below). The mds `values` endpoint is deliberately NOT the source here:
// asked for `ccm:commonlicense_key` it returns the bare key as its own
// `displayString` for all 16 values in every locale, i.e. the set of values the
// index holds rather than a captioned vocabulary. (For every other vocabulary we
// mirror it DOES carry captions, which is why `scripts/sync-vocabs.mjs` uses it
// for those and this resource for licences.)
//
// Where the repository's wording is merely different and ours is at least as
// clear — `PDM` ("Public Domain Mark" vs the official "PDM"), `CUSTOM`, `NONE`,
// `CC_0` — ours stays. A rename with no defect behind it is taste.
//
// No primary label carries a version. Measured 2026-08-12:
// `ccm:commonlicense_version` is absent on 90 of 90 sampled CC records, is not
// in DISPLAY_PROPS and is not facetable, so the former "CC BY 4.0" asserted a
// fact nothing in the data supports — on 62 093 CC_BY records alone. The
// versioned spellings are kept as ALIASES so prompts and tool descriptions that
// already use them keep resolving.
const LICENSE: VocabEntry[] = [
  { id: 'CC_0',         labels: ['CC 0', 'cc0', 'cc-0', 'public domain dedication'] },
  { id: 'PDM',          labels: ['Public Domain Mark', 'gemeinfrei'] },
  { id: 'CC_BY',        labels: ['CC BY', 'CC BY 4.0', 'creative commons by'] },
  { id: 'CC_BY_SA',     labels: ['CC BY-SA', 'CC BY-SA 4.0', 'creative commons by-sa'] },
  { id: 'CC_BY_ND',     labels: ['CC BY-ND', 'CC BY-ND 4.0', 'creative commons by-nd'] },
  { id: 'CC_BY_NC',     labels: ['CC BY-NC', 'CC BY-NC 4.0', 'creative commons by-nc'] },
  // `CC_BY_SA_NC` is a legacy spelling of the same three terms carried by 497
  // records. As an alias rather than an entry of its own, those records get a
  // readable label and are not dropped by `filterByExactLicense` when a caller
  // asks for CC BY-NC-SA — two keys for one licence must not read as two.
  { id: 'CC_BY_NC_SA',  labels: ['CC BY-NC-SA', 'CC BY-NC-SA 4.0', 'creative commons by-nc-sa', 'cc_by_sa_nc'] },
  { id: 'CC_BY_NC_ND',  labels: ['CC BY-NC-ND', 'CC BY-NC-ND 4.0', 'creative commons by-nc-nd'] },
  // NOT "urheberrechtsfrei", which claims the opposite. The repository's own
  // description: "Das Werk ist kostenfrei zugänglich. Nutzung und Quellenangabe
  // gemäß den allgemeingültigen gesetzlichen Regelungen (UrhG)" — copyrighted,
  // merely free to access. Third most common licence in the corpus (12 445
  // records), so the wrong word was on a lot of screens. The alias is gone with
  // it: someone typing "urheberrechtsfrei" is asking for material free OF
  // copyright, and `gemeinfrei` → PDM is the answer to that question.
  { id: 'COPYRIGHT_FREE', labels: ['Copyright, freier Zugang', 'copyright free'] },
  { id: 'COPYRIGHT_LICENSE', labels: ['Copyright, lizenzpflichtig', 'copyright license'] },
  { id: 'UNTERRICHTS_UND_LEHRMEDIEN', labels: ['§60b Unterrichts- und Lehrmedien', 'unterrichts- und lehrmedien'] },
  { id: 'CUSTOM',       labels: ['Individuelle Lizenz', 'custom', 'andere lizenz'] },
  { id: 'NONE',         labels: ['Keine Angabe', 'no license info'] },
  // Kept although the staging index holds zero records with it: the repository
  // lists it as a current licence, so a record carrying it must still get a
  // label rather than the raw key.
  { id: 'SCHULFUNK',    labels: ['Schulfunk (§47 UrhG)', 'schulfunk'] },
];

// ── Topic-page target audience ───────────────────────────────────────────────
// `ccm:page_variant_profiling_target_group` is sometimes a slug,
// sometimes a URI. Map both to readable German labels.

const TARGET_GROUP: VocabEntry[] = [
  { id: 'teacher',  labels: ['lehrkräfte', 'lehrkraefte', 'lehrer', 'lehrerinnen', 'teacher'] },
  { id: 'learner',  labels: ['lernende', 'schüler', 'schueler', 'schülerinnen', 'learner', 'students'] },
  { id: 'general',  labels: ['allgemein', 'general', 'public'] },
];

// ── Generic resolver ─────────────────────────────────────────────────────────

const VOCAB_MAP: Record<VocabKey, VocabEntry[]> = {
  educationalContext: EDUCATIONAL_CONTEXT,
  discipline: DISCIPLINE,
  userRole: USER_ROLE,
  lrt: LRT,
  license: LICENSE,
  targetGroup: TARGET_GROUP,
  qualityFinding: QUALITY_FINDING,
};

/** Resolve a label or URI to a full URI. Returns null if nothing matches. */
export function resolveVocab(input: string, vocab: VocabKey): string | null {
  if (!input?.trim()) return null;
  const trimmed = input.trim();

  // Already a URI. The scheme is required: a plain word merely starting with
  // "http" is a typo, and passing it through as a filter value produced a
  // guaranteed empty result with no "did you mean" hint — a non-null return
  // means "resolved" to every caller.
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  const lower = trimmed.toLowerCase();
  const entries = VOCAB_MAP[vocab];
  // 0) Already the repository's own value. For most vocabularies the id IS a
  //    URI and the branch above caught it; licences are the exception, where
  //    edu-sharing stores bare keys (`CC_BY`). Without this, "label or the raw
  //    repository value" — what every filter description promises — would hold
  //    for every vocabulary except that one.
  for (const entry of entries) {
    if (entry.id.toLowerCase() === lower) return entry.id;
  }
  // 1) Exact label/alias match wins — precise and order-independent.
  for (const entry of entries) {
    if (entry.labels.some(l => l.toLowerCase() === lower)) return entry.id;
  }
  // 2) Fuzzy fallback, but ONLY between tokens of length >= 4 on both sides.
  //    The old unbounded bidirectional `includes` mis-resolved short inputs
  //    (e.g. "it" → "arbeit", "uni" → "kommunikation") and was order-
  //    dependent. The length guard kills the short-token false positives
  //    while keeping legitimate fuzzy matches for longer terms.
  for (const entry of entries) {
    if (entry.labels.some(l => {
      const ll = l.toLowerCase();
      if (ll.length < 4 || lower.length < 4) return false;
      return ll.includes(lower) || lower.includes(ll);
    })) {
      return entry.id;
    }
  }
  return null;
}

/** Extract the trailing slug from a URI: ".../teacher" → "teacher" */
function trailingSlug(uri: string): string {
  if (!uri) return '';
  const cleaned = uri.split(/[#?]/, 1)[0]!.replace(/\/+$/, '');
  const idx = Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf(':'));
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

/** Get German label for a URI/key, or the original input as fallback. */
export function labelFromUri(uri: string, vocab: VocabKey): string {
  if (!uri) return uri;
  const entries = VOCAB_MAP[vocab];

  // Direct match (full URI or simple key)
  let entry = entries.find(e => e.id === uri);

  // Trailing-slug match for namespaced values like "ccrep://.../teacher"
  if (!entry) {
    const slug = trailingSlug(uri).toLowerCase();
    if (slug) {
      entry = entries.find(e => {
        const eSlug = trailingSlug(e.id).toLowerCase();
        return eSlug === slug;
      });
    }
  }

  // Label/alias match (case-insensitive) for inputs that are already labels
  if (!entry) {
    const lower = uri.toLowerCase();
    entry = entries.find(e => e.labels.some(l => l.toLowerCase() === lower));
  }

  // University subjects are display-only: a discipline URI from the
  // Hochschulfächersystematik is absent from the local (school) table, but a
  // facet or result can surface it. Resolve it to a readable label here — for
  // DISPLAY only. It is deliberately NOT in resolveVocab (input), so a filter
  // like discipline="Mathematik" is never ambiguous between the two vocabularies.
  if (!entry) {
    if (vocab === 'discipline') {
      const uni = universitySubjectLabel(uri);
      if (uni) return uni;
    }
    return uri;
  }
  return displayLabel(entry.labels[0]);
}

/**
 * `labels[0]` as it should be shown.
 *
 * If it carries any uppercase already ("CC BY-SA 4.0", "MINT", "Sekundarstufe
 * I"), the table author chose the display form deliberately — leave it alone.
 * Otherwise upper-case the first character, which is all a one-word lowercase
 * entry like "mathematik" needs.
 *
 * One function rather than two: `labelFromUri` had the uppercase guard and
 * `listVocab` did not, so the two could disagree on any label that STARTS
 * lowercase and contains capitals ("eLearning" → "eLearning" vs "ELearning").
 * No such entry exists today (measured 2026-08-11), which is exactly why the
 * divergence would have gone unnoticed until one was added.
 */
function displayLabel(raw: string): string {
  if (/[A-ZÄÖÜ]/.test(raw)) return raw;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** Return all entries of a vocabulary (for lookup tool). */
export function listVocab(vocab: VocabKey): Array<{ uri: string; label: string; aliases: string[] }> {
  return VOCAB_MAP[vocab].map(e => ({
    uri: e.id,
    label: displayLabel(e.labels[0]),
    aliases: e.labels.slice(1),
  }));
}
