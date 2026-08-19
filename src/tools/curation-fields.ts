/**
 * tools/curation-fields.ts – the write surface a conversation can reach.
 *
 * Extracted from `curation-content.ts` when the suggestion tools needed the same
 * thirteen fields. A second copy is precisely how a field gets added to one tool
 * and forgotten in the other, and the two would then disagree about what may be
 * written — with no test able to notice, because each would pass on its own.
 *
 * This module maps tool parameters to repository properties. What those
 * properties ACCEPT is decided in `services/write/fields.ts`; nothing here
 * validates.
 */

import { z } from 'zod';

import type { ParamMap } from './curation-shared.js';

/**
 * Tool parameter → repository property. The map is the whole write surface: a
 * property that is not named here cannot be reached from a conversation,
 * whatever the model asks for.
 */
export const CONTENT_FIELDS: ParamMap = {
  title: 'cclom:title',
  description: 'cclom:general_description',
  keywords: 'cclom:general_keyword',
  url: 'ccm:wwwurl',
  language: 'cclom:general_language',
  author: 'ccm:lifecyclecontributer_author',
  publisher: 'ccm:oeh_publisher_combined',
  licenseKey: 'ccm:commonlicense_key',
  licenseVersion: 'ccm:commonlicense_cc_version',
  contentType: 'ccm:oeh_lrt',
  educationalContext: 'ccm:educationalcontext',
  discipline: 'ccm:taxonid',
  userRole: 'ccm:educationalintendedenduserrole',
  // The five quality FINDINGS fields (2026-08-18). They take a MACHINE verdict
  // only; `services/write/fields.ts` refuses the human one and says why.
  qualityCorrectness: 'ccm:oeh_quality_correctness',
  qualityCopyrightLaw: 'ccm:oeh_quality_copyright_law',
  qualityCriminalLaw: 'ccm:oeh_quality_criminal_law',
  qualityPersonalLaw: 'ccm:oeh_quality_personal_law',
  qualityProtectionOfMinors: 'ccm:oeh_quality_protection_of_minors',
  // The seven 0–5 scales (2026-08-19). `login` and `relevancy_for_education`
  // are absent: they declare 0–1 and are yes/no questions, not scales.
  qualityDidactics: 'ccm:oeh_quality_didactics',
  qualityLanguage: 'ccm:oeh_quality_language',
  qualityMedial: 'ccm:oeh_quality_medial',
  qualityNeutralness: 'ccm:oeh_quality_neutralness',
  qualityTransparentness: 'ccm:oeh_quality_transparentness',
  qualityDataPrivacy: 'ccm:oeh_quality_data_privacy',
  qualityCurrentness: 'ccm:oeh_quality_currentness',
  // Binary, not 0–5: both declare exactly 0 and 1.
  qualityLogin: 'ccm:oeh_quality_login',
  qualityRelevance: 'ccm:oeh_quality_relevancy_for_education',
};

/**
 * One sentence for all seven scales. The digit is what a model will reach for;
 * the caption is accepted too, so a value just read back can be written again.
 */
const SCALE = ' Stufe 0–5 als Ziffer (0 = schlechteste, 5 = beste) oder als '
  + 'Beschriftung der Stufe. Welche Stufe wie heißt, nennt lookup_wlo_vocabulary '
  + 'mit vocabulary="qualityScale".';

/**
 * One sentence, five times — the verdict vocabulary is the same for every
 * findings field, and repeating it per parameter is what a model reads when it
 * picks a value.
 */
const VERDICT = ' Erlaubt: "keine Auffälligkeiten gefunden (Maschine)" · '
  + '"Auffälligkeiten gefunden (Maschine)" · "ungeprüft". Ein Ergebnis, das ein MENSCH '
  + 'geprüft hat, wird abgelehnt — das trägt die Redaktion selbst ein.';

/** The 27 metadata parameters, shared by the update and the create tool. */
export const FIELD_SCHEMA = {
  title: z.string().optional().describe('Titel (cclom:title), max. 255 Zeichen.'),
  description: z.string().optional().describe('Beschreibung (cclom:general_description).'),
  keywords: z.array(z.string()).optional()
    .describe('Schlagwörter. Werden zu den vorhandenen HINZUGEFÜGT, nicht ersetzt.'),
  url: z.string().optional().describe('Quell-URL (ccm:wwwurl); nur http/https.'),
  language: z.string().optional().describe('Sprachcode nach ISO 639-1, z. B. "de".'),
  author: z.string().optional().describe('Autor als Klartextname, z. B. "Maria Schmidt".'),
  publisher: z.string().optional().describe('Herausgeber.'),
  licenseKey: z.string().optional()
    .describe('Lizenzschlüssel, z. B. CC_BY, CC_BY_SA, CC_0, PDM. Erfundene Werte werden abgelehnt.'),
  licenseVersion: z.string().optional().describe('Lizenzversion, z. B. "4.0". Bei CC-BY-Lizenzen sonst automatisch 4.0.'),
  contentType: z.string().optional().describe('Inhaltstyp als Label, z. B. "Arbeitsblatt" oder "Video".'),
  educationalContext: z.string().optional().describe('Bildungsstufe als Label, z. B. "Grundschule".'),
  discipline: z.string().optional().describe('Fach als Label, z. B. "Mathematik".'),
  userRole: z.string().optional().describe('Zielgruppe als Label, z. B. "Lehrer" oder "Lernende".'),

  qualityCorrectness: z.string().optional().describe(
    'Prüfergebnis Sachrichtigkeit (ccm:oeh_quality_correctness) aus einer MASCHINELLEN Prüfung.'
    + VERDICT),
  qualityCopyrightLaw: z.string().optional().describe(
    'Prüfergebnis Urheberrecht (ccm:oeh_quality_copyright_law) aus einer MASCHINELLEN Prüfung.'
    + VERDICT),
  qualityCriminalLaw: z.string().optional().describe(
    'Prüfergebnis Strafrecht (ccm:oeh_quality_criminal_law) aus einer MASCHINELLEN Prüfung.'
    + VERDICT),
  qualityPersonalLaw: z.string().optional().describe(
    'Prüfergebnis Persönlichkeitsrecht (ccm:oeh_quality_personal_law) aus einer MASCHINELLEN Prüfung.'
    + VERDICT),
  qualityProtectionOfMinors: z.string().optional().describe(
    'Prüfergebnis Jugendschutz (ccm:oeh_quality_protection_of_minors) aus einer MASCHINELLEN Prüfung.'
    + VERDICT),
  qualityDidactics: z.string().optional().describe(
    'Bewertung der Didaktik/Methodik (ccm:oeh_quality_didactics).' + SCALE),
  qualityLanguage: z.string().optional().describe(
    'Bewertung der Sprache/Verständlichkeit (ccm:oeh_quality_language).' + SCALE),
  qualityMedial: z.string().optional().describe(
    'Bewertung der medialen Aufbereitung (ccm:oeh_quality_medial).' + SCALE),
  qualityNeutralness: z.string().optional().describe(
    'Bewertung der Neutralität (ccm:oeh_quality_neutralness).' + SCALE),
  qualityTransparentness: z.string().optional().describe(
    'Bewertung der Anbieter-Transparenz (ccm:oeh_quality_transparentness).' + SCALE),
  qualityDataPrivacy: z.string().optional().describe(
    'Bewertung des Datenschutzes (ccm:oeh_quality_data_privacy).' + SCALE),
  qualityCurrentness: z.string().optional().describe(
    'Bewertung der Aktualität (ccm:oeh_quality_currentness).' + SCALE),
  qualityLogin: z.string().optional().describe(
    'Ist der Inhalt ohne Anmeldung zugänglich (ccm:oeh_quality_login)? "1" = ohne Login '
    + 'zugänglich, "0" = Zugang nur mit Login — oder die Beschriftung. Achtung: '
    + 'ccm:conditionsOfAccess sagt dasselbe dreiwertig und auf deutlich mehr Datensätzen; '
    + 'beide zu setzen kann sich widersprechen.'),
  qualityRelevance: z.string().optional().describe(
    'Ist der Inhalt für Bildung geeignet (ccm:oeh_quality_relevancy_for_education)? '
    + '"1" = Ja - geeignet, "0" = Nein - ungeeignet — oder die Beschriftung.'),
};

/** The confirmation key every two-step curation tool takes. */
export const CONFIRM_TOKEN = z.string().optional()
  .describe('Bestätigungsschlüssel aus der Vorschau. Ohne ihn wird ausschließlich die Vorschau erzeugt.');
