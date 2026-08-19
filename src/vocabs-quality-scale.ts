/**
 * vocabs-quality-scale.ts — GENERATED, do not edit by hand.
 *
 * Regenerate with:
 *   node --import tsx --env-file-if-exists=.env scripts/generate-quality-scales.mjs
 *
 * The captions the metadata set declares for the ten ordinal quality scales,
 * keyed by the value's trailing segment — which is exactly what a record stores
 * when it stores the bare digit instead of the full URI. Both forms occur in the
 * same field, and only the URI form comes back with a `_DISPLAYNAME`; this
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
  'ccm:oeh_quality_didactics': {
    '0': { id: "http://w3id.org/openeduhub/vocabs/quality_didactics/0", caption: "Methodik unangemessen" },
    '1': { id: "http://w3id.org/openeduhub/vocabs/quality_didactics/1", caption: "✰ Methodik ausreichend" },
    '2': { id: "http://w3id.org/openeduhub/vocabs/quality_didactics/2", caption: "✰✰ angemessene Methodik" },
    '3': { id: "http://w3id.org/openeduhub/vocabs/quality_didactics/3", caption: "✰✰✰ gute Methodik" },
    '4': { id: "http://w3id.org/openeduhub/vocabs/quality_didactics/4", caption: "✰✰✰✰ moderne, gute Methodik" },
    '5': { id: "http://w3id.org/openeduhub/vocabs/quality_didactics/5", caption: "✰✰✰✰✰ moderne, sehr gute Methodik" },
  },
  'ccm:oeh_quality_language': {
    '0': { id: "http://w3id.org/openeduhub/vocabs/quality_language/0", caption: "unangemessen" },
    '1': { id: "http://w3id.org/openeduhub/vocabs/quality_language/1", caption: "✰ schwierige Sprache" },
    '2': { id: "http://w3id.org/openeduhub/vocabs/quality_language/2", caption: "✰✰ ausreichend verständlich" },
    '3': { id: "http://w3id.org/openeduhub/vocabs/quality_language/3", caption: "✰✰✰ angemessen" },
    '4': { id: "http://w3id.org/openeduhub/vocabs/quality_language/4", caption: "✰✰✰✰ leicht verständlich, sprachlich korrekt" },
    '5': { id: "http://w3id.org/openeduhub/vocabs/quality_language/5", caption: "✰✰✰✰✰ Zielgruppengerechte Sprache" },
  },
  'ccm:oeh_quality_medial': {
    '0': { id: "http://w3id.org/openeduhub/vocabs/quality_media/0", caption: "Medial unpassend" },
    '1': { id: "http://w3id.org/openeduhub/vocabs/quality_media/1", caption: "✰ Medial schwierig" },
    '2': { id: "http://w3id.org/openeduhub/vocabs/quality_media/2", caption: "✰✰ Medial ausreichend, aber suboptimal" },
    '3': { id: "http://w3id.org/openeduhub/vocabs/quality_media/3", caption: "✰✰✰ Medial passend" },
    '4': { id: "http://w3id.org/openeduhub/vocabs/quality_media/4", caption: "✰✰✰✰ Medial gut" },
    '5': { id: "http://w3id.org/openeduhub/vocabs/quality_media/5", caption: "✰✰✰✰✰ Medial hervorragend" },
  },
  'ccm:oeh_quality_neutralness': {
    '0': { id: "http://w3id.org/openeduhub/vocabs/quality_neutrality/0", caption: "manipulativ" },
    '1': { id: "http://w3id.org/openeduhub/vocabs/quality_neutrality/1", caption: "✰ unneutral" },
    '2': { id: "http://w3id.org/openeduhub/vocabs/quality_neutrality/2", caption: "✰✰ ideologisch eingefärbt, aber korrekter Inhalt" },
    '3': { id: "http://w3id.org/openeduhub/vocabs/quality_neutrality/3", caption: "✰✰✰ ideologisch eingefärbt, aber transparent" },
    '4': { id: "http://w3id.org/openeduhub/vocabs/quality_neutrality/4", caption: "✰✰✰✰ neutrale Formulierung" },
    '5': { id: "http://w3id.org/openeduhub/vocabs/quality_neutrality/5", caption: "✰✰✰✰✰ neutrale Formulierung, unabhängiger Ersteller" },
  },
  'ccm:oeh_quality_transparentness': {
    '0': { id: "http://w3id.org/openeduhub/vocabs/quality_transparency/0", caption: "keine Angabe oder unseriös" },
    '1': { id: "http://w3id.org/openeduhub/vocabs/quality_transparency/1", caption: "✰ Anbieter benannt, keine Kontaktangaben" },
    '2': { id: "http://w3id.org/openeduhub/vocabs/quality_transparency/2", caption: "✰✰ Anbieter benannt, Kontaktangaben vorhanden" },
    '3': { id: "http://w3id.org/openeduhub/vocabs/quality_transparency/3", caption: "✰✰✰ Anbieter benannt, umfangreiche Kontaktangaben" },
    '4': { id: "http://w3id.org/openeduhub/vocabs/quality_transparency/4", caption: "✰✰✰✰ Anbieter bekannt, umfangreiche Kontaktangaben" },
    '5': { id: "http://w3id.org/openeduhub/vocabs/quality_transparency/5", caption: "✰✰✰✰✰ renommierter Anbieter, korrekte Kontaktangaben" },
  },
  'ccm:oeh_quality_data_privacy': {
    '0': { id: "http://w3id.org/openeduhub/vocabs/quality_data_privacy/0", caption: "heimlich unangemessen datensaugend" },
    '1': { id: "http://w3id.org/openeduhub/vocabs/quality_data_privacy/1", caption: "✰ intransparent unangemessen viel datensaugend" },
    '2': { id: "http://w3id.org/openeduhub/vocabs/quality_data_privacy/2", caption: "✰✰ intransparent Daten saugend" },
    '3': { id: "http://w3id.org/openeduhub/vocabs/quality_data_privacy/3", caption: "✰✰✰ transparent unangemessen viel datensaugend" },
    '4': { id: "http://w3id.org/openeduhub/vocabs/quality_data_privacy/4", caption: "✰✰✰✰ angemessen viele Daten mit Einverständis" },
    '5': { id: "http://w3id.org/openeduhub/vocabs/quality_data_privacy/5", caption: "✰✰✰✰✰ keinerlei Datenweitergabe" },
  },
  'ccm:oeh_quality_currentness': {
    '0': { id: "0", caption: "0-A veralteter Inhalt" },
    '1': { id: "1", caption: "✰ 1-A veraltet, aber teils noch relevant" },
    '2': { id: "2", caption: "✰✰ 2-A veraltete Darstellung, inhaltlich noch aktuell" },
    '3': { id: "3", caption: "✰✰✰ 3-A zeitlos aktuell" },
    '4': { id: "4", caption: "✰✰✰✰ 4- aktueller Wissensstand" },
    '5': { id: "5", caption: "✰✰✰✰✰ 5 - hochaktuell/neuester Wissensstand" },
  },
  'ccm:oeh_quality_login': {
    '0': { id: "0", caption: "Zugang nur mit Login" },
    '1': { id: "1", caption: "Ohne Login zugänglich" },
  },
  'ccm:oeh_quality_relevancy_for_education': {
    '0': { id: "0", caption: "Nein - ungeeignet" },
    '1': { id: "1", caption: "Ja - geeignet" },
  },
  'ccm:containsAdvertisement': {
    '0': { id: "http://w3id.org/openeduhub/vocabs/quality_advertisement/0", caption: "Inhalt ist kaum von Werbung unterscheidbar" },
    '1': { id: "http://w3id.org/openeduhub/vocabs/quality_advertisement/1", caption: "✰ enthält unangemessene störende Werbung" },
    '2': { id: "http://w3id.org/openeduhub/vocabs/quality_advertisement/2", caption: "✰✰ enthält störende Werbung" },
    '3': { id: "http://w3id.org/openeduhub/vocabs/quality_advertisement/3", caption: "✰✰✰ enthält zurückhaltend Werbung" },
    '4': { id: "http://w3id.org/openeduhub/vocabs/quality_advertisement/4", caption: "✰✰✰✰ zurückhaltende für Zielgruppe geeignete Werbung" },
    '5': { id: "http://w3id.org/openeduhub/vocabs/quality_advertisement/5", caption: "✰✰✰✰✰ ohne Werbung" },
  },
};

/**
 * One position of a scale, looked up by whatever form the caller has: the bare
 * digit, the full URI, or the caption.
 *
 * `Object.hasOwn`, not a bare index: the key comes from the repository or from
 * a conversation, neither of which validates anything, and a plain object
 * answers `toString` with a function.
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
