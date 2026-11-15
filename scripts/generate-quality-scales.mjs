#!/usr/bin/env node
/**
 * generate-quality-scales.mjs — regenerate `src/vocabs-quality-scale.ts` from
 * the metadata set of a live repository.
 *
 *   node --import tsx --env-file-if-exists=.env scripts/generate-quality-scales.mjs
 *
 * **Why a table at all, when this project's rule is that the repository labels
 * its own values.** It does — for the values it DECLARES. Measured 2026-08-18,
 * the ten quality scales are declared with full captions, and the corpus stores
 * two forms side by side in the same field:
 *
 *   ccm:oeh_quality_didactics: ".../quality_didactics/1"=13  "4"=12  "3"=5  ".../0"=1
 *
 * A record holding the URI comes back with a `<property>_DISPLAYNAME`; a record
 * holding the bare digit comes back with an empty one, because the widget knows
 * the URI and not the digit. The digit is not a broken value — it is the same
 * position on the same fixed scale — so the label exists and only the lookup is
 * missing. That is what this table supplies, for the digit form only; wherever
 * the repository answers, it still wins.
 *
 * The one value that shows why it matters: `ccm:containsAdvertisement = 5` means
 * "✰✰✰✰✰ ohne Werbung". Rendered as a bare "5" beside "Kosten: nein", a reader
 * takes it for *much* advertising — the exact opposite.
 *
 * The counts this prints are pinned in `tests/vocabs-quality-scale.test.ts`. If
 * they move, the metadata set changed — read the diff before updating the test.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { BASE_URL } from '../src/wlo-config.ts';
import { wloFetch } from '../src/wlo-fetch.ts';

/**
 * The properties whose values are a fixed ordinal scale.
 *
 * Named explicitly rather than matched by prefix: `ccm:containsAdvertisement`
 * does not carry the `oeh_quality` prefix and belongs, while the five FINDINGS
 * fields do carry it and do not — their values are a verdict, not a position.
 */
const SCALE_PROPERTIES = [
  'ccm:oeh_quality_didactics',
  'ccm:oeh_quality_language',
  'ccm:oeh_quality_medial',
  'ccm:oeh_quality_neutralness',
  'ccm:oeh_quality_transparentness',
  'ccm:oeh_quality_data_privacy',
  'ccm:oeh_quality_currentness',
  'ccm:oeh_quality_login',
  'ccm:oeh_quality_relevancy_for_education',
  'ccm:containsAdvertisement',
];

const res = await wloFetch(`${BASE_URL}/mds/v1/metadatasets/-home-/mds_oeh`, {}, { timeoutMs: 120_000 });
if (!res.ok) {
  console.error(`Metadatensatz nicht lesbar: HTTP ${res.status}`);
  process.exit(1);
}
const mds = await res.json();

/**
 * Union the value lists across widget copies: a field appears once per view, and
 * first-wins reports "no vocabulary" for a field that has one (the same trap
 * `scripts/survey-metadata.mjs` documents).
 */
const byProperty = new Map();
for (const w of mds.widgets ?? []) {
  if (!w?.id || !SCALE_PROPERTIES.includes(w.id)) continue;
  const seen = byProperty.get(w.id) ?? new Map();
  for (const v of w.values ?? []) if (v?.id) seen.set(String(v.id), String(v.caption ?? ''));
  byProperty.set(w.id, seen);
}

const lines = [];
let total = 0;
const missing = [];
for (const property of SCALE_PROPERTIES) {
  const values = byProperty.get(property);
  if (!values?.size) { missing.push(property); continue; }

  // Key by the trailing segment: that is the digit a record may store bare, and
  // it is identical for the URI form. One entry serves both.
  // `id` is kept beside the caption because WRITING has to produce the form the
  // widget declares, and the two families differ: six scales declare the full
  // URI, `currentness`/`login`/`relevancy_for_education` declare the bare digit.
  // Deriving it from the key would guess.
  const entries = [...values]
    .map(([id, caption]) => [id.split('/').filter(Boolean).pop() ?? id, id, caption])
    .filter(([, , caption]) => caption.trim());
  if (!entries.length) { missing.push(property); continue; }

  total += entries.length;
  lines.push(`  '${property}': {`);
  for (const [key, id, caption] of entries.sort((a, b) => a[0].localeCompare(b[0], 'en'))) {
    // Trimmed: the repository's caption for `quality_currentness/0` carries a
    // leading space, which leaked into every rendered line and — because
    // `validateField` trims its input — made that one caption unwritable,
    // although both the parameter description and the refusal offer it.
    lines.push(`    '${key}': { id: ${JSON.stringify(id)}, caption: ${JSON.stringify(caption.trim())} },`);
  }
  lines.push('  },');
}

if (missing.length) {
  console.error(`Ohne deklarierte Werte und deshalb NICHT in der Tabelle: ${missing.join(', ')}`);
}

const file = `/**
 * vocabs-quality-scale.ts — GENERATED, do not edit by hand.
 *
 * Regenerate with:
 *   node --import tsx --env-file-if-exists=.env scripts/generate-quality-scales.mjs
 *
 * The captions the metadata set declares for the ten ordinal quality scales,
 * keyed by the value's trailing segment — which is exactly what a record stores
 * when it stores the bare digit instead of the full URI. Both forms occur in the
 * same field, and only the URI form comes back with a \`_DISPLAYNAME\`; this
 * table is what labels the other half. Where the repository answers, it wins.
 *
 * See the generator's header for the measurement.
 */

export interface ScaleValue {
  /** The value exactly as the metadata set declares it — a URI or a bare digit. */
  id: string;
  /** The repository's own caption for that position. */
  caption: string;
}

/** property → (value segment → what the metadata set declares for it). */
export const QUALITY_SCALES: Record<string, Record<string, ScaleValue>> = {
${lines.join('\n')}
};

/**
 * One position of a scale, looked up by whatever form the caller has: the bare
 * digit, the full URI, or the caption.
 *
 * \`Object.hasOwn\`, not a bare index: the key comes from the repository or from
 * a conversation, neither of which validates anything, and a plain object
 * answers \`toString\` with a function.
 */
export function scaleEntry(property: string, value: string): ScaleValue | undefined {
  const scale = QUALITY_SCALES[property];
  if (!scale) return undefined;
  const raw = value.trim();
  const key = raw.split('/').filter(Boolean).pop() ?? raw;
  if (Object.hasOwn(scale, key)) return scale[key];
  const wanted = raw.toLocaleLowerCase('de');
  return Object.values(scale).find(v => v.caption.toLocaleLowerCase('de') === wanted);
}

/** The caption for one stored value, or '' when the scale does not name it. */
export function scaleLabel(property: string, value: string): string {
  return scaleEntry(property, value)?.caption ?? '';
}

/** The positions this scale offers, ascending — what a rejection lists. */
export function scaleKeys(property: string): string[] {
  return Object.keys(QUALITY_SCALES[property] ?? {}).sort((a, b) => a.localeCompare(b, 'en'));
}
`;

const out = fileURLToPath(new URL('../src/vocabs-quality-scale.ts', import.meta.url));
writeFileSync(out, file, 'utf8');
console.log(`geschrieben: src/vocabs-quality-scale.ts — ${byProperty.size} Skalen, ${total} beschriftete Werte`);
