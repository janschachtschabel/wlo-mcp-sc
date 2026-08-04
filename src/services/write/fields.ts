/**
 * services/write/fields.ts – what may be written, and in what shape.
 *
 * The single source of truth for the write surface. A tool declares WHICH node
 * and WHICH values; it cannot widen the set of properties, because anything not
 * listed here is refused by name. That keeps the decision about what a
 * conversation may change in reviewed code rather than in a prompt.
 *
 * Two entries carry weight beyond tidiness:
 *
 *   - `ccm:commonlicense_key` is checked against a fixed key list. An invented
 *     licence on an OER record is a defect that outlives the conversation, and
 *     a model asked for "the licence" will happily answer with a university's
 *     name. Unknown keys are rejected WITH the value named, never dropped.
 *   - `ccm:oeh_lrt_aggregated` is deliberately absent. Measured evidence says
 *     the repository derives it from `ccm:oeh_lrt`; writing it ourselves would
 *     fight that derivation.
 *
 * Values are always arrays — edu-sharing's property model has no scalar case,
 * and a lone string reaching the API is one of the ways a write vanishes.
 */

import { resolveVocab, listVocab, type VocabKey } from '../../vocabs.js';
import { sanitizeText } from '../../text-sanitize.js';
import { validateContentTypes } from './fields-lrt.js';

/** Which endpoint can actually write a property. */
export type FieldRoute = 'mds' | 'property';

export interface FieldSpec {
  /** German label, used in the confirmation preview the user reads. */
  label: string;
  route: FieldRoute;
}

export type FieldValidation =
  | {
      ok: true;
      values: string[];
      /**
       * Something the curator should know although the value was accepted —
       * currently only the content types the repository cannot aggregate.
       * A tool surfaces this; it is not a soft rejection.
       */
      note?: string;
    }
  | { ok: false; reason: string };

/**
 * Licence keys edu-sharing accepts. Both the underscore and the space spelling
 * occur in live data, so both are allowed through rather than normalised — we
 * do not know which one a given record already uses, and rewriting it would be
 * an unrequested change.
 */
const LICENCE_KEYS: readonly string[] = [
  'NONE',
  'CC_0', 'CC0',
  'CC_BY', 'CC BY',
  'CC_BY_SA', 'CC BY-SA',
  'CC_BY_ND', 'CC BY-ND',
  'CC_BY_NC', 'CC BY-NC',
  'CC_BY_NC_SA', 'CC BY-NC-SA',
  'CC_BY_NC_ND', 'CC BY-NC-ND',
  'PDM', 'CUSTOM', 'SCHULFUNK', 'UNTERRICHTS_UND_LEHRMEDIEN',
  'COPYRIGHT_FREE', 'COPYRIGHT_LICENSE',
];

/** The CC licences that carry a version number. CC0 is excluded on purpose. */
const CC_VERSIONED = /^CC[_ ]BY([_ -](SA|ND|NC|NC[_ -]SA|NC[_ -]ND))?$/i;

export const WRITABLE_FIELDS: Record<string, FieldSpec> = {
  'cclom:title': { label: 'Titel', route: 'mds' },
  'cclom:general_description': { label: 'Beschreibung', route: 'mds' },
  'cclom:general_keyword': { label: 'Schlagwörter', route: 'mds' },
  'ccm:wwwurl': { label: 'Quell-URL', route: 'mds' },
  'cclom:general_language': { label: 'Sprache', route: 'mds' },
  'ccm:lifecyclecontributer_author': { label: 'Autor', route: 'mds' },
  'ccm:oeh_publisher_combined': { label: 'Herausgeber', route: 'mds' },
  'ccm:commonlicense_key': { label: 'Lizenz', route: 'mds' },
  'ccm:commonlicense_cc_version': { label: 'Lizenzversion', route: 'mds' },
  'ccm:oeh_lrt': { label: 'Inhaltstyp', route: 'mds' },
  'ccm:educationalcontext': { label: 'Bildungsstufe', route: 'mds' },
  'ccm:taxonid': { label: 'Fach', route: 'mds' },
  'ccm:educationalintendedenduserrole': { label: 'Zielgruppe', route: 'mds' },
  'ccm:oeh_collection_compendium_text': { label: 'Kompendialtext', route: 'property' },
  // A COLLECTION's own title and description. Listed because this server
  // already writes both — `collectionBody` sends `cm:title`, `writeDescription`
  // sends `cm:description` — and a write surface that does not name what it
  // writes cannot bound it or put it in a confirmation preview. Materials use
  // the `cclom:` pair above; these two are reachable only from the collection
  // tools, which is what `CONTENT_FIELDS` decides.
  'cm:title': { label: 'Titel', route: 'mds' },
  'cm:description': { label: 'Beschreibung', route: 'mds' },
};

/**
 * Which controlled vocabulary a property draws its values from.
 *
 * `ccm:oeh_lrt` is deliberately absent: it draws from `new_lrt`, a 220-concept
 * hierarchy that is a different axis from the flat `lrt` table these keys point
 * at, and it needs its own handling for shared labels and missing aggregations.
 */
const FIELD_VOCAB: Record<string, VocabKey> = {
  'ccm:educationalcontext': 'educationalContext',
  'ccm:taxonid': 'discipline',
  'ccm:educationalintendedenduserrole': 'userRole',
};

/**
 * Upper bounds per property. Where the design names one, it is that number; the
 * rest are guards — an unbounded string out of a conversation should not reach
 * the repository unchecked, whether or not edu-sharing would take it.
 */
const MAX_LENGTH: Record<string, number> = {
  'cclom:title': 255,
  'cclom:general_description': 20_000,
  // Same bounds as the material pair above — a collection's title and
  // description are the same kind of text with the same kind of author.
  'cm:title': 255,
  'cm:description': 20_000,
  'ccm:oeh_collection_compendium_text': 100_000,
  'ccm:oeh_publisher_combined': 255,
  'cclom:general_keyword': 255,
  'ccm:lifecyclecontributer_author': 1_000,
  // Longer than any URL a browser will follow; short enough that a pasted
  // document body is refused rather than stored as a "source".
  'ccm:wwwurl': 2_048,
};

/**
 * How many values one property may carry. No repository limit is known; this
 * bounds the request, which the length cap alone does not — a thousand short
 * keywords pass every per-value check. The HTTP transport caps the body
 * (`read-body.ts`), stdio does not, so the guard belongs here.
 */
const MAX_VALUES = 100;

/**
 * Escape one value for a vCard 3.0 property (RFC 2426 §2.4.2).
 *
 * The realistic trigger is a paste, not an attack: an author copied out of a web
 * page arrives as "Maria Schmidt⏎Universität Musterstadt", and an unescaped line
 * break makes the following text a line that is not a vCard property at all. A
 * strict parser drops the whole card then — the author vanishes from the record
 * rather than being merely wrong.
 */
function escapeVcard(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

/**
 * Turn a plain name into the VCARD string edu-sharing stores for an author.
 * Split at the LAST space, so "Dr. Maria Schmidt" keeps the title with the
 * given name and yields the family name alone — the same rule the WLO metadata
 * agent applies, which is what the existing records were written with.
 *
 * The split runs on the RAW name and the escaping on the parts, so a `;` inside
 * a name never becomes one of the five component separators of `N:`.
 */
export function toVcard(name: string): string {
  const trimmed = name.trim();
  const cut = trimmed.lastIndexOf(' ');
  const family = escapeVcard(cut > 0 ? trimmed.slice(cut + 1) : trimmed);
  const given = cut > 0 ? escapeVcard(trimmed.slice(0, cut)) : '';
  return `BEGIN:VCARD\nVERSION:3.0\nN:${family};${given};;;\nFN:${escapeVcard(trimmed)}\nEND:VCARD`;
}

function reject(reason: string): FieldValidation {
  return { ok: false, reason };
}

/**
 * A value quoted back into a rejection.
 *
 * The reason names the offending value so the user can correct it, and that
 * value is not always theirs: `wlo_decide_suggestion` validates a value stored
 * by someone else before applying it, so a refusal can carry repository text
 * into a reply the model reads as our own words. Sanitizing here rather than at
 * each call site keeps the fixed German prose out of the 120-character cap.
 */
function quote(value: string): string {
  return sanitizeText(value);
}

/**
 * Validate and normalise one property's values.
 *
 * Accepts a single value or an array and always answers with an array.
 * A rejection names the offending value, because the user has to be able to
 * correct it — "ungültiger Wert" tells them nothing.
 */
export function validateField(property: string, input: string | string[]): FieldValidation {
  const spec = WRITABLE_FIELDS[property];
  if (!spec) {
    return reject(
      `Das Feld „${quote(property)}“ kann über dieses Werkzeug nicht geschrieben werden.` +
        (property === 'ccm:oeh_lrt_aggregated'
          ? ' Der aggregierte Inhaltstyp wird vom Repository aus „ccm:oeh_lrt“ abgeleitet — bitte diesen setzen.'
          : ''),
    );
  }

  const raw = (Array.isArray(input) ? input : [input]).map(v => String(v ?? '').trim());
  const values = raw.filter(v => v.length > 0);
  if (values.length === 0) {
    return reject(`Für „${spec.label}“ wurde kein Wert angegeben.`);
  }
  if (values.length > MAX_VALUES) {
    return reject(
      `„${spec.label}“ hat ${values.length} Werte — erlaubt sind höchstens ${MAX_VALUES}. ` +
        'Bitte auf die tatsächlich zutreffenden beschränken.',
    );
  }

  const max = MAX_LENGTH[property];
  if (max !== undefined) {
    const tooLong = values.find(v => v.length > max);
    if (tooLong !== undefined) {
      return reject(`„${spec.label}“ ist zu lang (${tooLong.length} Zeichen, erlaubt sind ${max}).`);
    }
  }

  switch (property) {
    case 'ccm:wwwurl':
      return allHttpUrls(values, spec.label);
    case 'cclom:general_language':
      return languageCodes(values);
    case 'ccm:commonlicense_key':
      return licenceKeys(values);
    case 'ccm:commonlicense_cc_version':
      return licenceVersions(values);
    case 'ccm:lifecyclecontributer_author':
      return { ok: true, values: values.map(v => (v.startsWith('BEGIN:VCARD') ? v : toVcard(v))) };
    case 'ccm:oeh_lrt':
      return validateContentTypes(values);
    default:
      break;
  }

  const vocab = FIELD_VOCAB[property];
  if (vocab) return vocabularyUris(values, vocab, spec.label);

  return { ok: true, values };
}

function allHttpUrls(values: string[], label: string): FieldValidation {
  for (const v of values) {
    let url: URL;
    try {
      url = new URL(v);
    } catch {
      return reject(`„${label}“: „${quote(v)}“ ist keine gültige URL. Erwartet wird eine http(s)-Adresse.`);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return reject(`„${label}“: nur http- und https-Adressen sind erlaubt, „${quote(v)}“ ist keine.`);
    }
  }
  return { ok: true, values };
}

function languageCodes(values: string[]): FieldValidation {
  const out: string[] = [];
  for (const v of values) {
    if (!/^[a-z]{2}$/i.test(v)) {
      return reject(`„${quote(v)}“ ist kein Sprachcode nach ISO 639-1 (zwei Buchstaben, z. B. „de“ oder „en“).`);
    }
    out.push(v.toLowerCase());
  }
  return { ok: true, values: out };
}

function licenceKeys(values: string[]): FieldValidation {
  for (const v of values) {
    if (!LICENCE_KEYS.includes(v)) {
      return reject(
        `„${quote(v)}“ ist kein gültiger Lizenzschlüssel. Erlaubt sind unter anderem: ` +
          'CC_BY, CC_BY_SA, CC_BY_NC, CC_BY_NC_SA, CC_BY_ND, CC_0, PDM, COPYRIGHT_LICENSE, NONE.',
      );
    }
  }
  return { ok: true, values };
}

function licenceVersions(values: string[]): FieldValidation {
  for (const v of values) {
    if (!/^\d\.\d$/.test(v)) {
      return reject(`„${quote(v)}“ ist keine Lizenzversion. Erwartet wird z. B. „4.0“ oder „3.0“.`);
    }
  }
  return { ok: true, values };
}

/**
 * Resolve labels to vocabulary URIs and refuse anything the vocabulary does not
 * contain — including a well-formed URI from somewhere else. `resolveVocab`
 * passes unknown `http…` inputs through, which is right for search (a filter
 * that matches nothing is harmless) and wrong for a write.
 */
function vocabularyUris(values: string[], vocab: VocabKey, label: string): FieldValidation {
  const known = new Set(listVocab(vocab).map(e => e.uri));
  const out: string[] = [];
  for (const v of values) {
    const uri = resolveVocab(v, vocab);
    if (!uri || !known.has(uri)) {
      return reject(`„${quote(v)}“ kommt im Vokabular für „${label}“ nicht vor.`);
    }
    out.push(uri);
  }
  return { ok: true, values: out };
}

/**
 * Fill in the licence version when a CC BY-family key was chosen without one.
 * 4.0 is the current CC version and what new WLO records carry.
 *
 * CC0 is excluded deliberately: it exists only as 1.0, so defaulting it to 4.0
 * would state something untrue about the licence. It is left without a version
 * rather than guessed.
 */
export function applyLicenceDefaults(desired: Record<string, string[]>): Record<string, string[]> {
  const key = desired['ccm:commonlicense_key']?.[0];
  if (!key || !CC_VERSIONED.test(key)) return desired;
  if (desired['ccm:commonlicense_cc_version']?.length) return desired;
  return { ...desired, 'ccm:commonlicense_cc_version': ['4.0'] };
}
