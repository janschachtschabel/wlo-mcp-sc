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
};

/** The 13 metadata parameters, shared by the update and the create tool. */
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
};

/** The confirmation key every two-step curation tool takes. */
export const CONFIRM_TOKEN = z.string().optional()
  .describe('Bestätigungsschlüssel aus der Vorschau. Ohne ihn wird ausschließlich die Vorschau erzeugt.');
