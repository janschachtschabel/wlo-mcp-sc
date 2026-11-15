#!/usr/bin/env node
/**
 * sync-vocabs.mjs — compare the checked-in vocabulary tables against what the
 * REPOSITORY actually offers, and report the differences.
 *
 *   node --import tsx scripts/sync-vocabs.mjs        (or: npm run sync:vocabs)
 *
 * Sibling of `generate-lrt-vocab.mjs`, and deliberately a different thing. That
 * one regenerates `src/vocabs-lrt.ts` from the published SKOS vocabulary — what
 * the vocabulary DEFINES. This one asks a live repository what it OFFERS, which
 * is the question our filters actually depend on: a concept that exists in SKOS
 * but not in this instance is unfilterable here, and a key this instance stores
 * but SKOS never defined (there are three) still has to get a readable label.
 *
 * It REPORTS and never writes. Labels need human judgement — measured 2026-08-11
 * and 2026-08-12, our tables are sometimes right where the repository is terse
 * (`PDM` "Public Domain Mark" against the official "PDM") and sometimes wrong in
 * a way no diff can see (`COPYRIGHT_FREE` read "urheberrechtsfrei", the opposite
 * of what the repository means by it). Exit status is always 0: this is a
 * maintenance report, not a gate.
 *
 * Two sources, because one does not cover both cases:
 *
 *  - `POST /mds/v1/metadatasets/-home-/mds_oeh/values` for the concept
 *    vocabularies. Note `pattern: ""` — `"-all-"` is documented for "all values"
 *    and measurably returns an EMPTY list.
 *  - `GET /config/v1/language/defaults` → `LICENSE.NAMES` for licences, because
 *    the `values` endpoint answers with the bare key as its own `displayString`
 *    for all 16 licence values, in every locale.
 */

import { BASE_URL } from '../src/wlo-config.ts';
import { listVocab } from '../src/vocabs.ts';
// Not bare `fetch`: `wloFetch` is documented as the one path to the repository,
// because it enforces the upstream timeout ("so no request can hang") and is the
// only place the operator's credential is attached — and attached to the
// repository host alone. Without it this script hangs silently on a stalled
// instance, and reports "NICHT GEPRÜFT" for every vocabulary on an instance
// whose metadata sets require authentication.
import { wloFetch } from '../src/wlo-fetch.ts';

/** Our six vocabularies and the repository property each mirrors. */
const VOCABS = [
  { key: 'educationalContext', property: 'ccm:educationalcontext' },
  // `ccm:taxonid` carries TWO vocabularies: 345 Hochschulfächer and 71
  // Schulfächer, separable by URI. We mirror the school subjects only — the
  // combined list is too large to hand to a model as filter values, and that is
  // a deliberate decision, not a gap.
  { key: 'discipline', property: 'ccm:taxonid', onlyUri: '/vocabs/discipline/' },
  { key: 'userRole', property: 'ccm:educationalintendedenduserrole' },
  { key: 'lrt', property: 'ccm:oeh_lrt_aggregated' },
  { key: 'targetGroup', property: 'ccm:page_variant_profiling_target_group' },
];

async function mdsValues(property) {
  const res = await wloFetch(`${BASE_URL}/mds/v1/metadatasets/-home-/mds_oeh/values`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ valueParameters: { query: 'ngsearch', property, pattern: '' }, criteria: [] }),
  });
  if (!res.ok) throw new Error(`${property}: HTTP ${res.status}`);
  const data = await res.json();
  return (data.values ?? []).map(v => ({ key: v.key, label: v.displayString }));
}

async function licenseNames() {
  const res = await wloFetch(`${BASE_URL}/config/v1/language/defaults`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`language/defaults: HTTP ${res.status}`);
  const data = await res.json();
  const names = data?.LICENSE?.NAMES;
  if (!names) throw new Error('language/defaults: LICENSE.NAMES not found — the resource changed shape');
  return Object.entries(names).map(([key, label]) => ({ key, label }));
}

/**
 * Server values we deliberately do not mirror. Without this the report carries
 * two permanent false positives, and a report with permanent noise stops being
 * read — which is the only way this script can fail.
 */
const NOT_MIRRORED = new Map([
  // The vocabulary's own group header, not a subject: the URI ends at the
  // namespace with no slug.
  ['http://w3id.org/openeduhub/vocabs/discipline/', 'Gruppenüberschrift des Vokabulars, kein Fach'],
  // Not a licence but a statement about a SET of them ("Unterschiedliche
  // Lizenzen."). Adding it would offer `lookup_wlo_vocabulary` a filter value
  // that can never match a record — no node carries it (facet over all 403 461,
  // 2026-08-12).
  ['MULTI', 'keine Lizenz, sondern "mehrere verschiedene" — nicht filterbar'],
]);

/** One vocabulary: what only the server has, what only we have, and where labels differ. */
function compare(name, server, local) {
  const byServer = new Map(server.map(v => [v.key, v.label]));
  const byLocal = new Map(local.map(v => [v.uri, v.label]));
  const onlyServer = server.filter(v => !byLocal.has(v.key) && !NOT_MIRRORED.has(v.key));
  const skipped = server.filter(v => NOT_MIRRORED.has(v.key));
  const onlyLocal = local.filter(v => !byServer.has(v.uri));
  const differing = local
    .filter(v => byServer.has(v.uri) && byServer.get(v.uri) !== v.label)
    .map(v => ({ key: v.uri, ours: v.label, theirs: byServer.get(v.uri) }));

  console.log(`\n── ${name}  (Server ${server.length}, lokal ${local.length})`);
  for (const v of skipped) console.log(`   bewusst ausgelassen  ${v.key}  — ${NOT_MIRRORED.get(v.key)}`);
  if (!onlyServer.length && !onlyLocal.length && !differing.length) {
    console.log('   im Übrigen deckungsgleich');
    return;
  }
  for (const v of onlyServer) console.log(`   FEHLT bei uns   ${v.key}  "${v.label}"`);
  for (const v of onlyLocal) console.log(`   nur bei uns     ${v.uri}  "${v.label}"`);
  for (const d of differing) console.log(`   Label weicht ab ${d.key}\n                     unser  "${d.ours}"\n                     Server "${d.theirs}"`);
}

console.log(`Vokabular-Abgleich gegen ${BASE_URL}`);

for (const { key, property, onlyUri } of VOCABS) {
  try {
    let server = await mdsValues(property);
    if (onlyUri) server = server.filter(v => String(v.key).includes(onlyUri));
    compare(`${key}  (${property}${onlyUri ? `, gefiltert auf ${onlyUri}` : ''})`, server, listVocab(key));
  } catch (err) {
    // Reported, not swallowed: a vocabulary that could not be read is unknown,
    // which is a different statement from "no differences".
    console.log(`\n── ${key}  (${property})\n   NICHT GEPRÜFT: ${err instanceof Error ? err.message : String(err)}`);
  }
}

try {
  compare('license  (config/v1/language/defaults → LICENSE.NAMES)', await licenseNames(), listVocab('license'));
} catch (err) {
  console.log(`\n── license\n   NICHT GEPRÜFT: ${err instanceof Error ? err.message : String(err)}`);
}

console.log(`
Label-Abweichungen sind keine Fehlerliste. Wo unsere Schreibweise die klarere
ist, bleibt sie — geprüft wird, ob die Bedeutung stimmt. Was hier als FEHLT
erscheint, kostet dagegen zweimal: labelFromUri zeigt den rohen Schlüssel, und
filterByExactLicense verwirft den Datensatz aus jedem gefilterten Ergebnis.`);
