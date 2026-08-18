#!/usr/bin/env node
/**
 * survey-metadata.mjs — ask a live repository which metadata fields it OFFERS in
 * four areas next to the metadata we already read (quality, rights,
 * accessibility, cost & advertising), how the corpus actually fills them, and
 * report. Two of them ARE covered since 2026-08-18 — the group stays because
 * the point is to keep measuring what the corpus does with them.
 *
 *   node --import tsx --env-file-if-exists=.env scripts/survey-metadata.mjs
 *   (or: npm run survey:metadata)
 *
 * Sibling of `sync-vocabs.mjs` and deliberately the same kind of thing: it
 * REPORTS and never writes, and its exit status is always 0. What it produces is
 * an input to a human decision — which fields are worth reading, and the much
 * narrower question of which are safe to write.
 *
 * Two legs, because neither question answers the other:
 *
 *  - **Definition** — `GET /mds/v1/metadatasets/-home-/mds_oeh`, the whole
 *    metadata set (17.3 MB, ~1 s — measured 2026-08-17). This says which fields
 *    EXIST and which of them carry a value list. Nothing smaller answers it: the
 *    `values` endpoint takes one property at a time and cannot enumerate them.
 *  - **Corpus** — one ngsearch facet per field, counted server-side over the
 *    whole index. A field that exists in the metadata set and that nobody fills
 *    is not a field worth surfacing, and only the corpus can tell the two apart.
 *
 * Three things this leans on, each measured on staging 2026-08-17:
 *
 *  1. A facet over EMPTY criteria counts the whole corpus (590 186 files).
 *  2. An unknown property answers **HTTP 400** rather than an empty facet, so a
 *     field this script cannot count says so instead of reporting a quiet 0.
 *  3. `facetLimit` is NOT a bucket cap. `ngsearch` sends 20 and staging answers
 *     23 buckets for `ccm:commonlicense_key` and 47 for `ccm:license_to`; at 5 it
 *     answers 25. Raising it past 20 changes nothing (100/1000/10000 all agree),
 *     so a list from the standard call is complete for every field surveyed here
 *     — but the count is printed so a reader can see when one gets close.
 *
 * The sum of the buckets counts VALUE OCCURRENCES, not records: a multi-valued
 * field counts a record once per value. It is an upper bound on the number of
 * records, and the report says so rather than calling it a record count.
 */

import { BASE_URL, DISPLAY_PROPS } from '../src/wlo-config.ts';
import { wloFetch } from '../src/wlo-fetch.ts';
import { ngsearch } from '../src/wlo-search.ts';
import { WRITABLE_FIELDS } from '../src/services/write/fields.ts';
import { mapPool } from '../src/concurrency.ts';

/**
 * The metadata set is 17.3 MB. `wloFetch`'s default 20 s is for request-path
 * calls and is not the right budget for a one-off bulk read — a survey that
 * dies on a slow day reports nothing, which is worse than being slow.
 */
const MDS_TIMEOUT_MS = 180_000;

/** Bounded fan-out for the corpus leg — a survey must not hammer the instance. */
const CONCURRENCY = 4;

/**
 * The areas, each derived from the metadata set by PATTERN rather than
 * hand-listed. The pattern is printed with the group so a reader can challenge
 * the grouping instead of having to trust it, and so a field the repository adds
 * later shows up without anyone editing this file.
 */
const GROUPS = [
  { name: 'Qualität', match: /^ccm:oeh_quality_/ },
  { name: 'Zugänglichkeit', match: /accessib|conditionsOfAccess|restricted_access/i },
  { name: 'Recht', match: /licen[sc]|copyright|urheb/i },
  // Added 2026-08-18. The three patterns above matched NEITHER `ccm:price`
  // (339 687 Belegungen, 58 % of the corpus) nor `ccm:containsAdvertisement`
  // (69 688) — the two best-maintained readable fields nobody had looked at.
  // That is what the "übrige Felder" list at the end of this report is for, and
  // it took a second survey to actually read it.
  { name: 'Kosten & Werbung', match: /price|advertisement/i },
];

// ── Leg 1: what the repository OFFERS ────────────────────────────────────────

async function loadMds() {
  const t0 = Date.now();
  const res = await wloFetch(`${BASE_URL}/mds/v1/metadatasets/-home-/mds_oeh`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(MDS_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`mds_oeh: HTTP ${res.status} ${res.statusText}`);
  const text = await res.text();
  const mds = JSON.parse(text);
  return { mds, megabytes: text.length / 1e6, seconds: (Date.now() - t0) / 1000 };
}

/**
 * Collapse the widget list to one entry per field.
 *
 * A field appears several times (234 widgets, 208 distinct ids on staging) —
 * once per view/template. The value lists are UNIONED rather than first-wins:
 * if one copy declares a vocabulary and another does not, taking whichever came
 * first would report "kein Vokabular" for a field that has one.
 */
function collapseWidgets(widgets) {
  const byId = new Map();
  for (const w of widgets) {
    if (!w?.id) continue;
    const seen = byId.get(w.id) ?? { id: w.id, caption: w.caption, types: new Set(), values: new Map(), copies: 0 };
    seen.copies += 1;
    if (w.type) seen.types.add(w.type);
    if (!seen.caption && w.caption) seen.caption = w.caption;
    for (const v of w.values ?? []) if (v?.id) seen.values.set(v.id, v.caption ?? '');
    byId.set(w.id, seen);
  }
  return byId;
}

// ── Leg 2: what the CORPUS actually carries ──────────────────────────────────

/**
 * Facet-count one property over the whole index. Returns a result object in
 * every case, including failure: "this field cannot be counted" is a finding
 * about the field, not an error in the survey, and must not disappear into a
 * rejected promise.
 */
async function corpusFacet(property) {
  try {
    const resp = await ngsearch([], 'FILES', 1, 0, undefined, [property]);
    const buckets = resp.facets?.find(f => f.property === property)?.values ?? [];
    return {
      total: resp.pagination.total,
      buckets,
      occurrences: buckets.reduce((sum, b) => sum + (b.count ?? 0), 0),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Report ───────────────────────────────────────────────────────────────────

const readToday = new Set(DISPLAY_PROPS);
const writeToday = new Set(Object.keys(WRITABLE_FIELDS));

/**
 * How many records the counts are counts OF. Every facet call carries it, so it
 * is picked up from the first that answers rather than paid for separately —
 * without it "3 432 Belegungen" is a number with no denominator.
 */
let corpusSize = null;

/** What the two legs together say about one field — facts only, no advice. */
function verdict(widget, corpus) {
  if (corpus.error) return 'nicht zählbar';
  if (!corpus.occurrences) return 'im Korpus ungenutzt';
  if (!widget.values.size) return 'gepflegt, ohne Vokabular';
  return corpus.unknownValues.length ? 'gepflegt, Werte außerhalb des Vokabulars' : 'gepflegt, vokabular-konform';
}

function pad(s, n) {
  const t = String(s);
  return t.length > n ? `${t.slice(0, n - 1)}…` : t.padEnd(n);
}

/** Every value URI in these vocabularies shares this prefix; printing it 80 times says nothing. */
const VOCAB_PREFIX = 'http://w3id.org/openeduhub/vocabs/';

/**
 * The declared value space of a field, as label↔id pairs. Printed for fields the
 * corpus actually uses, because that is precisely the table a vocabulary module
 * needs — without it whoever writes one has to fetch 17 MB again to get it.
 */
function declaredValues(widget) {
  return [...widget.values.entries()]
    .map(([id, caption]) => `${id.startsWith(VOCAB_PREFIX) ? id.slice(VOCAB_PREFIX.length) : id}=${caption || '?'}`);
}

console.log(`Metadaten-Erhebung gegen ${BASE_URL}`);

const { mds, megabytes, seconds } = await loadMds();
const widgets = collapseWidgets(mds.widgets ?? []);
console.log(`Metadatensatz „${mds.name ?? mds.id}": ${mds.widgets?.length ?? 0} Widgets, `
  + `${widgets.size} verschiedene Felder (${megabytes.toFixed(1)} MB in ${seconds.toFixed(1)} s)`);

const all = [...widgets.values()];
const grouped = GROUPS.map(g => ({ ...g, fields: all.filter(w => g.match.test(w.id)) }));
const inAGroup = new Set(grouped.flatMap(g => g.fields.map(f => f.id)));

for (const group of grouped) {
  console.log(`\n══ ${group.name}  (${group.fields.length} Felder, Muster ${group.match})`);
  if (!group.fields.length) {
    console.log('   kein Feld passt — das Muster oder die Annahme dahinter ist falsch');
    continue;
  }

  const rows = await mapPool(group.fields, CONCURRENCY, async widget => {
    const corpus = await corpusFacet(widget.id);
    // Values the corpus carries that the metadata set does not declare. This is
    // the column that decides writability: a field whose stored values include
    // shapes the vocabulary never mentions (legacy scalars beside concept URIs)
    // cannot be written from a vocabulary alone without silently converting what
    // is already there.
    //
    // Only asked of a field that HAS a vocabulary. Without one every stored
    // value is trivially "outside" it, which is a tautology dressed as a
    // finding — it printed 47 dates under `ccm:license_to`, and a report with
    // permanent noise stops being read.
    if (!corpus.error) {
      corpusSize ??= corpus.total;
      if (widget.values.size) {
        corpus.unknownValues = corpus.buckets.filter(b => !widget.values.has(b.value));
      }
    }
    return { widget, corpus };
  });

  console.log(`   ${pad('Feld', 40)} ${pad('Vokab.', 7)} ${pad('Belegungen', 11)} ${pad('Buckets', 8)} Befund`);
  for (const row of rows) {
    if (!row) continue; // mapPool's slot for a thrown mapper — corpusFacet never throws
    const { widget, corpus } = row;
    const vocab = widget.values.size ? `${widget.values.size}` : '—';
    const occ = corpus.error ? '—' : corpus.occurrences.toLocaleString('de-DE');
    const buckets = corpus.error ? '—' : String(corpus.buckets.length);
    console.log(`   ${pad(widget.id, 40)} ${pad(vocab, 7)} ${pad(occ, 11)} ${pad(buckets, 8)} ${verdict(widget, corpus)}`);
    console.log(`     ${widget.caption ?? '(ohne Beschriftung)'}`
      + `  [${[...widget.types].join('/') || 'ohne Typ'}]`
      + `${readToday.has(widget.id) ? ' · lesen wir schon' : ''}`
      + `${writeToday.has(widget.id) ? ' · schreiben wir schon' : ''}`);
    if (widget.values.size && corpus.occurrences) {
      console.log(`     Vokabular: ${declaredValues(widget).join(' · ')}`);
    }
    if (corpus.error) {
      console.log(`     NICHT GEZÄHLT: ${corpus.error}`);
    } else if (corpus.unknownValues?.length) {
      // With their counts: "three values are off-vocabulary" and "all but 32 of
      // 3 432 records carry one" are different facts, and only the second says
      // whether the field can be shown to anyone at all.
      const off = corpus.unknownValues.reduce((sum, b) => sum + (b.count ?? 0), 0);
      console.log(`     außerhalb des Vokabulars: ${off.toLocaleString('de-DE')} von `
        + `${corpus.occurrences.toLocaleString('de-DE')} Belegungen — `
        + corpus.unknownValues.slice(0, 6).map(b => `"${b.value}"×${b.count}`).join(', '));
    }
  }
}

// The groups are lenses, not a partition — `ccm:oeh_quality_copyright_law` is a
// quality field AND a rights field, and hiding it from one of them would
// misrepresent that area. Said out loud because the group sizes otherwise sum to
// more fields than exist.
const overlapping = [...inAGroup].filter(id => grouped.filter(g => g.fields.some(f => f.id === id)).length > 1);
if (overlapping.length) {
  console.log(`\n   In mehreren Gruppen (die Gruppen überschneiden sich): ${overlapping.join(', ')}`);
}

// The full field list costs no request and is the only way a reader can tell
// whether a group's pattern missed something. Without it the three groups above
// are a claim about the metadata set that nobody can check.
console.log(`\n══ Übrige Felder des Metadatensatzes (${all.length - inAGroup.size}, nicht gezählt)`);
// Two per line, wide enough for the longest id there is: this list exists to be
// looked things up in, and a truncated property name cannot be looked up.
const rest = all.map(w => w.id).filter(id => !inAGroup.has(id)).sort();
for (let i = 0; i < rest.length; i += 2) console.log(`   ${rest.slice(i, i + 2).map(id => pad(id, 52)).join('')}`);

console.log(`
Bezugsgröße: ${corpusSize === null ? 'unbekannt — keine Facette hat geantwortet' : `${corpusSize.toLocaleString('de-DE')} Datensätze (contentType=FILES)`}.

„Belegungen" sind Wert-Vorkommen, keine Datensätze: ein mehrwertiges Feld zählt
einen Datensatz je Wert. Die Zahl ist also eine Obergrenze für die Zahl der
Datensätze — für die Frage „pflegt das überhaupt jemand" genügt sie, für eine
Aussage über Abdeckung nicht.

Der Befund ist eine Messung, keine Empfehlung. Ob ein gepflegtes Feld GELESEN
werden soll, entscheidet sein Nutzen; ob es GESCHRIEBEN werden darf, entscheidet
zusätzlich, was ein falscher Wert anrichtet — ein Qualitätsfeld ist ein
redaktionelles Prüfsiegel, und wer es setzt, behauptet eine Prüfung.`);
