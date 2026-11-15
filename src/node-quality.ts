/**
 * node-quality.ts – what a record says about its own QUALITY, opt-in and
 * read-only.
 *
 * Fourteen fields in two families, and the split is the metadata set's own:
 *
 *  - **Nine ordinal scales** — seven that run 0–5 (didactics, language, medial,
 *    neutralness, transparentness, data privacy, currentness) and two that run
 *    0–1 (relevance, login). Their values are a fixed position with a caption the
 *    repository declares: `quality_didactics/3` is "✰✰✰ gute Methodik", and
 *    `login` `1` is "Ohne Login zugänglich". The range is read off the scale, not
 *    assumed, which is why the same resolver serves both lengths.
 *  - **Five verdicts** (correctness, copyright, criminal law, personal rights,
 *    protection of minors). Their values say WHO checked and whether anything
 *    was found; this server writes the machine ones (`services/write/fields.ts`).
 *
 * **Why this is readable at all, when the 2026-08-17 survey said it was not.**
 * That survey found the corpus storing values outside the declared vocabulary
 * and stopped there. Re-measured on 2026-08-18, the corpus stores TWO FORMS side
 * by side in the same field — `.../quality_didactics/1` and a bare `"4"` — and
 * only the URI form comes back with a `_DISPLAYNAME`. The bare digit is not a
 * broken value; it is the same position on the same scale, so the caption exists
 * and only the lookup was missing. `vocabs-quality-scale.ts` supplies it,
 * generated from the metadata set rather than invented here.
 *
 * `ccm:oeh_quality_login` was deliberately absent until 2026-08-19, because
 * `ccm:conditionsOfAccess` states the same fact three-valued instead of
 * two-valued and on 198 699 records instead of 72 787 (`node-access.ts`), and
 * printing one fact twice invites a contradiction. Making it WRITABLE changed
 * the balance: a field a caller can set and cannot read back cannot be checked,
 * and if the two ever do disagree, showing only one of them is the worse
 * outcome rather than the tidier one. It appears under `Login:` while the access
 * surface says `Zugang:`, so a reader can see that these are two fields.
 */

import { scaleLabel } from './vocabs-quality-scale.js';

/** Property → the German word the rendered line opens with. */
const FIELDS: ReadonlyArray<readonly [property: string, key: keyof QualityInfo, line: string]> = [
  ['ccm:oeh_quality_correctness', 'correctness', 'Sachrichtigkeit'],
  ['ccm:oeh_quality_didactics', 'didactics', 'Didaktik'],
  ['ccm:oeh_quality_language', 'language', 'Sprache'],
  ['ccm:oeh_quality_medial', 'medial', 'Medien'],
  ['ccm:oeh_quality_neutralness', 'neutralness', 'Neutralität'],
  ['ccm:oeh_quality_transparentness', 'transparentness', 'Transparenz'],
  ['ccm:oeh_quality_currentness', 'currentness', 'Aktualität'],
  ['ccm:oeh_quality_data_privacy', 'dataPrivacy', 'Datenschutz'],
  ['ccm:oeh_quality_relevancy_for_education', 'relevance', 'Bildungsrelevanz'],
  ['ccm:oeh_quality_login', 'login', 'Login'],
  ['ccm:oeh_quality_copyright_law', 'copyrightLaw', 'Urheberrecht'],
  ['ccm:oeh_quality_criminal_law', 'criminalLaw', 'Strafrecht'],
  ['ccm:oeh_quality_personal_law', 'personalLaw', 'Persönlichkeitsrecht'],
  ['ccm:oeh_quality_protection_of_minors', 'protectionOfMinors', 'Jugendschutz'],
];

/**
 * The verdict vocabulary, for the five findings fields.
 *
 * A second table beside `vocabs.ts` would drift, so this reads the captions the
 * repository declares — the same source `vocabs-quality-scale.ts` is generated
 * from. It is only reached when the record itself came back without a
 * `_DISPLAYNAME`.
 */
const VERDICTS: Record<string, string> = {
  human_findings: 'Auffälligkeiten gefunden (Mensch)',
  no_human_findings: 'keine Auffälligkeiten gefunden (Mensch)',
  auto_findings: 'Auffälligkeiten gefunden (Maschine)',
  no_auto_findings: 'keine Auffälligkeiten gefunden (Maschine)',
  unchecked: 'Ungeprüft',
};

export interface QualityInfo {
  correctness?: string;
  didactics?: string;
  language?: string;
  medial?: string;
  neutralness?: string;
  transparentness?: string;
  currentness?: string;
  dataPrivacy?: string;
  relevance?: string;
  login?: string;
  copyrightLaw?: string;
  criminalLaw?: string;
  personalLaw?: string;
  protectionOfMinors?: string;
}

/**
 * One value, named the way the repository names it.
 *
 * Order: the record's own `_DISPLAYNAME` (it knows its instance), then the
 * declared scale, then the verdict vocabulary. A value none of the three names
 * is DROPPED rather than printed raw — a bare "4" beside "✰✰✰ gute Methodik"
 * reads as a rating on some other scale, and the direction is unrecoverable.
 */
function label(props: Record<string, string[]>, property: string): string {
  const value = (props[property] ?? [])[0]?.trim();
  if (!value) return '';
  const own = (props[`${property}_DISPLAYNAME`] ?? [])[0]?.trim();
  if (own) return own;
  const scale = scaleLabel(property, value);
  if (scale) return scale;
  const slug = value.split('/').filter(Boolean).pop() ?? '';
  return Object.hasOwn(VERDICTS, slug) ? VERDICTS[slug]! : '';
}

/** The quality fields this record carries, absent keys for the ones it does not. */
export function qualityInfo(props: Record<string, string[]>): QualityInfo {
  const out: QualityInfo = {};
  for (const [property, key, ] of FIELDS) {
    const text = label(props, property);
    if (text) out[key] = text;
  }
  return out;
}

/** The rendered lines, in the order of {@link FIELDS} — verdicts and scales interleaved as declared. */
export function qualityLines(info: QualityInfo): string[] {
  return FIELDS
    .filter(([, key]) => info[key])
    .map(([, key, line]) => `${line}: ${info[key]!}`);
}
