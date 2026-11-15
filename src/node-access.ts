/**
 * node-access.ts – what a record says about getting at it and reusing it.
 *
 * Five fields, opt-in, read-only, and chosen by measurement rather than by
 * category (staging, 590 209 records as of the second run — see
 * `docs/plans/2026-08-17-metadatenfelder-erhebung.md` and its 2026-08-18
 * follow-up `2026-08-18-vokabular-abgleich.md`):
 *
 *  - `ccm:price`                339 687 records — does it cost anything?
 *  - `ccm:conditionsOfAccess`   198 699 records — does it need a login?
 *  - `ccm:containsAdvertisement` 69 688 records — does it carry advertising?
 *  - `ccm:accessibilitySummary`   3 475 records — WCAG / BITV conformance
 *  - `ccm:license_oer`            1 121 records — is it OER at all
 *
 * The quality fields (`ccm:oeh_quality_*`) are read by `node-quality.ts`, not
 * here, and the split is what they ARE rather than where they came from: these
 * five say how to get at the material, those fourteen judge it.
 *
 * They were in NEITHER module until 2026-08-19, on a measurement that has since
 * been narrowed rather than overturned (2026-08-18): `_DISPLAYNAME` resolves
 * exactly what the field's WIDGET declares — not the URI form, not the published
 * vocabulary. One record carried seven of them and only `ccm:oeh_quality_login`
 * came back labelled, because its widget is the one that declares the bare digits
 * it stores. What was inferred from that, and was wrong, is that the rest could
 * not be labelled at all: a bare digit is the same position on the same scale, so
 * the caption existed and only the lookup was missing. `vocabs-quality-scale.ts`
 * supplies it, generated from the metadata set — and it is also what labels the
 * star-scale leftovers in `ccm:containsAdvertisement` below.
 *
 * **The repository labels four of the five itself** through
 * `<property>_DISPLAYNAME` — the same source `formatter.ts` prefers, and one
 * less table to keep in step with an instance. `ccm:containsAdvertisement` is
 * the measured exception and the only reason `VOCAB_FALLBACK` exists: its widget
 * declares the star scale `quality_advertisement/0…5` while 69 628 of its 69 688
 * stored values are `containsAdvertisement/yes|no`, so the repository answers
 * with no label at all. The table is a FALLBACK, never an override — if the
 * metadata set is ever pointed at the right vocabulary, it stops being consulted
 * without anyone editing it.
 *
 * Not filterable: all five answer HTTP 400 as an ngsearch criterion, so they can
 * be read off a record and never searched for. A caller that wants "material
 * without a login" cannot have it, and saying so is part of the field's meaning.
 */

/** What a record says; a field the record does not carry is absent, never empty. */
import { scaleLabel } from './vocabs-quality-scale.js';

export interface AccessInfo {
  /** Whether using it needs a login. */
  conditionsOfAccess?: string;
  /** Whether it costs anything, including "free but with paid extras". */
  price?: string;
  /** Whether it carries advertising. */
  advertising?: string;
  /** WCAG/BITV conformance claims — multi-valued in the metadata set. */
  accessibility?: string[];
  /** "alles OER" / "teils OER" / "kein OER". */
  oerStatus?: string;
}

/**
 * A slug that says nothing on its own, and so is worse than saying nothing.
 *
 * Two shapes, both measured against the whole corpus on 2026-08-18:
 *
 *  - **A bare number in a field this project has no scale for.** Where a scale
 *    IS declared, `scaleLabel` names the value and this rule never sees it —
 *    the usual case since 2026-08-18, and the better outcome:
 *    `ccm:containsAdvertisement = ["5"]` means "✰✰✰✰✰ ohne Werbung", so dropping
 *    it discarded a fact and printing "Werbung: 5" stated its opposite.
 *  - **A bare boolean.** `ccm:price` holds `false` ×3 and `true` ×1 among
 *    339 687 values; several quality fields hold a few more. Neither is in the
 *    declared vocabulary, so the repository does not label them, and
 *    "Kosten: false" is as unreadable as the line above.
 *
 * Deliberately narrow: only these two literal shapes. Dropping everything the
 * declaration does not name would need the declaration at runtime — a third
 * source that has to keep pace with an instance, which this module exists
 * without (see `VOCAB_FALLBACK`).
 */
const MEANINGLESS_SLUG = /^(?:\d+|true|false)$/i;

/**
 * Concept slug → label, for the one field the repository cannot resolve.
 *
 * The strings are the published vocabulary's own `prefLabel.de`
 * (`vocabs.openeduhub.de/…/containsAdvertisement/`), quoted rather than
 * paraphrased — a lower-case "ja" would read better beside `ccm:price`'s
 * repository label, but inventing a spelling is editing a vocabulary we do not
 * own. Two values, and a closed yes/no is not going to grow a third.
 */
const VOCAB_FALLBACK: Record<string, Record<string, string>> = {
  'ccm:containsAdvertisement': { yes: 'Ja', no: 'Nein' },
};

/**
 * Prefer the repository's label, then the published vocabulary, then the slug.
 *
 * The bare URI is never shown: it is noise in a rendered line, and it is not a
 * value any caller of ours can act on. Dropping the field instead would be
 * worse — it would say the record is silent where it is not. The slug survives
 * as the last rung because a field may hold a value neither source knows: this
 * one still carries 50 star-scale leftovers, and guessing at them would be
 * worse than showing what is there.
 *
 * Deliberately NOT `formatter.ts`'s `resolveLabels`, which shares the first
 * half: its fallback resolves through a local vocabulary keyed by `VocabKey`,
 * and these fields have none — `VOCAB_FALLBACK` is keyed by property, because
 * exactly one property needs it and a `VocabKey` would imply a table the rest of
 * the codebase shares.
 */
function labels(props: Record<string, string[]>, property: string): string[] {
  const names = props[`${property}_DISPLAYNAME`] ?? [];
  const uris = props[property] ?? [];
  const fallback = VOCAB_FALLBACK[property];
  return uris
    .map((uri, i) => {
      const slug = uri.split('/').filter(Boolean).pop() ?? '';
      // `Object.hasOwn`, not a bare index: the key comes from the repository,
      // which validates nothing, and a plain object answers `toString` with a
      // function. `labelFromUri` (`vocabs.ts`) has no such hole because it
      // searches an array — this table is the only lookup of its shape here.
      const known = fallback && Object.hasOwn(fallback, slug) ? fallback[slug] : '';
      // The declared ordinal scale, for the half of the corpus that stores the
      // bare digit. Only the URI form comes back with a `_DISPLAYNAME`, and both
      // forms occur in the same field — so the caption existed all along and
      // only the lookup was missing. Below the repository's own answer and above
      // the fallback table, because it IS the repository's caption, read once
      // from the metadata set (`scripts/generate-quality-scales.mjs`).
      const label = names[i]?.trim() || scaleLabel(property, uri) || known;
      if (label) return label;
      // A slug that is nothing but a number carries no meaning on its own, and
      // handing one over is worse than saying nothing: measured 2026-08-18,
      // `7affb314-3f66-4a86-955d-161239ec63b2` stores
      // `ccm:containsAdvertisement = ["5"]` with an EMPTY `_DISPLAYNAME` —
      // the widget's star scale rather than the yes/no vocabulary that 69 628
      // of 69 688 records use. It rendered as "Werbung: 5", a value whose
      // DIRECTION a reader cannot know, on the one field where reading it
      // backwards turns "werbefrei" into "voller Werbung". This is the same
      // reason the quality fields are not read at all; the rule simply had a
      // hole where a clean field occasionally holds a dirty value.
      return MEANINGLESS_SLUG.test(slug) ? '' : slug;
    })
    .filter(Boolean);
}

export function accessInfo(props: Record<string, string[]>): AccessInfo {
  const conditions = labels(props, 'ccm:conditionsOfAccess');
  const price = labels(props, 'ccm:price');
  const ads = labels(props, 'ccm:containsAdvertisement');
  const accessibility = labels(props, 'ccm:accessibilitySummary');
  const oer = labels(props, 'ccm:license_oer');
  return {
    // Single-valued in the metadata set (`singleoption`), so the first value is
    // the value — but a record carrying two would lose the second silently, and
    // that is the right trade only because the field cannot hold two.
    ...(conditions[0] ? { conditionsOfAccess: conditions[0] } : {}),
    ...(price[0] ? { price: price[0] } : {}),
    ...(ads[0] ? { advertising: ads[0] } : {}),
    ...(accessibility.length ? { accessibility } : {}),
    ...(oer[0] ? { oerStatus: oer[0] } : {}),
  };
}

/**
 * The same `Key: value` shape the rest of a record's detail view uses, so the
 * lines read as part of it rather than as an appended block. Order is coverage
 * first, not alphabetical: the two a reader is most likely to get an answer for
 * lead.
 */
export function accessInfoLines(info: AccessInfo): string[] {
  const lines: string[] = [];
  if (info.conditionsOfAccess) lines.push(`Zugang: ${info.conditionsOfAccess}`);
  if (info.price) lines.push(`Kosten: ${info.price}`);
  if (info.advertising) lines.push(`Werbung: ${info.advertising}`);
  if (info.accessibility?.length) lines.push(`Barrierefreiheit: ${info.accessibility.join(', ')}`);
  if (info.oerStatus) lines.push(`OER-Status: ${info.oerStatus}`);
  return lines;
}
