#!/usr/bin/env node
/**
 * generate-lrt-vocab.mjs — regenerate `src/vocabs-lrt.ts` from the published
 * SKOS vocabulary.
 *
 * `new_lrt` has 220 concepts in a hierarchy; hand-maintaining that table would
 * drift from the source within a release. The file this writes is checked in so
 * the server needs no network at start-up, and this script is how it is brought
 * back in step when the vocabulary changes.
 *
 *   node scripts/generate-lrt-vocab.mjs
 *
 * The counts it prints are pinned in `tests/vocabs-lrt.test.ts`. If they move,
 * the vocabulary changed — look at the diff before updating the test.
 */

import { writeFileSync } from 'node:fs';

const SOURCE = 'https://vocabs.openeduhub.de/w3id.org/openeduhub/vocabs/new_lrt/index.json';
const LRT_BASE = 'http://w3id.org/openeduhub/vocabs/new_lrt/';
const AGG_BASE = 'http://w3id.org/openeduhub/vocabs/new_lrt_aggregated/';
const OUT = new URL('../src/vocabs-lrt.ts', import.meta.url);

/**
 * The aggregated concept a term maps to, or null.
 *
 * All three SKOS match kinds are consulted and filtered by namespace: the
 * vocabulary also carries `exactMatch` links into an unrelated `contentTypes`
 * vocabulary, and taking the first match blindly would map a concept to a URI
 * the repository never uses. Measured 2026-08-01: broadMatch 153,
 * relatedMatch 58, exactMatch 3, and no concept has more than one target.
 */
function aggregationOf(concept) {
  const hits = [];
  for (const kind of ['broadMatch', 'relatedMatch', 'exactMatch', 'closeMatch', 'narrowMatch']) {
    for (const m of concept[kind] ?? []) {
      if (String(m.id).startsWith(AGG_BASE)) hits.push(String(m.id));
    }
  }
  if (hits.length > 1) throw new Error(`ambiguous aggregation for ${concept.id}: ${hits.join(', ')}`);
  return hits[0] ?? null;
}

function flatten(nodes, parentLabel, out) {
  for (const n of nodes ?? []) {
    const label = n.prefLabel?.de?.trim();
    if (!label) throw new Error(`concept without a German label: ${n.id}`);
    if (!String(n.id).startsWith(LRT_BASE)) throw new Error(`unexpected namespace: ${n.id}`);
    out.push({
      uuid: String(n.id).slice(LRT_BASE.length),
      label,
      aggUuid: (aggregationOf(n) ?? '').slice(AGG_BASE.length),
      path: parentLabel ?? '',
      aliases: (n.altLabel?.de ?? []).map(a => a.trim()).filter(Boolean),
    });
    flatten(n.narrower, label, out);
  }
}

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`${SOURCE} answered ${res.status}`);
const doc = await res.json();

const concepts = [];
flatten(doc.hasTopConcept, null, concepts);

const mapped = concepts.filter(c => c.aggUuid).length;
const unmapped = concepts.filter(c => !c.aggUuid).map(c => c.label);
const byLabel = new Map();
for (const c of concepts) {
  const key = c.label.toLowerCase();
  byLabel.set(key, (byLabel.get(key) ?? 0) + 1);
}
const ambiguous = [...byLabel].filter(([, n]) => n > 1).map(([l]) => l);

const esc = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const rows = concepts.map(c => {
  const base = `['${esc(c.label)}', '${c.uuid}', '${c.aggUuid}', '${esc(c.path)}'`;
  return c.aliases.length
    ? `  ${base}, [${c.aliases.map(a => `'${esc(a)}'`).join(', ')}]],`
    : `  ${base}],`;
});

const header = `/**
 * vocabs-lrt.ts – the \`new_lrt\` vocabulary (educational object types).
 *
 * GENERATED — do not edit by hand. Run \`node scripts/generate-lrt-vocab.mjs\`
 * to regenerate from ${SOURCE}
 *
 * This is the vocabulary a curator picks from when setting \`ccm:oeh_lrt\`. It is
 * NOT the same axis as \`new_lrt_aggregated\` (which \`src/vocabs.ts\` carries for
 * search filters): that one is a flat list of media types, this one a hierarchy
 * of educational object types.
 *
 * We never write \`ccm:oeh_lrt_aggregated\` — the repository derives it, and the
 * derivation rule is published in this vocabulary itself. \`AGGREGATION\` carries
 * that rule so a tool can tell a curator, before they choose, that ${unmapped.length}
 * of the concepts map to nothing and material tagged only with those stays
 * invisible to aggregated content-type facets.
 *
 * Generated ${concepts.length} concepts · ${mapped} with an aggregation · ${unmapped.length} without.
 */

export const LRT_BASE = '${LRT_BASE}';
export const LRT_AGGREGATED_BASE = '${AGG_BASE}';

export interface LrtConcept {
  /** Full URI, written to \`ccm:oeh_lrt\`. */
  uri: string;
  /** German prefLabel. */
  label: string;
  /** The aggregated concept the repository derives, or null for the ${unmapped.length} without one. */
  aggregatedUri: string | null;
  /** Label of the parent concept — what tells two same-named concepts apart. */
  path: string;
  /** German altLabels, if any. */
  aliases: string[];
}

/** [label, uuid, aggregatedUuid | '', parentLabel, aliases?] */
type Row = [string, string, string, string, string[]?];

const ROWS: Row[] = [
${rows.join('\n')}
];

export const LRT_CONCEPTS: LrtConcept[] = ROWS.map(([label, uuid, aggUuid, path, aliases]) => ({
  uri: LRT_BASE + uuid,
  label,
  aggregatedUri: aggUuid ? LRT_AGGREGATED_BASE + aggUuid : null,
  path,
  aliases: aliases ?? [],
}));

/**
 * Concept URI → the aggregated URI the repository derives from it. Published by
 * the vocabulary, not inferred by us.
 */
export const AGGREGATION: Record<string, string> = Object.fromEntries(
  LRT_CONCEPTS.filter(c => c.aggregatedUri).map(c => [c.uri, c.aggregatedUri as string]),
);

/**
 * Labels of the concepts the vocabulary maps to no aggregated concept. Material
 * tagged only with one of these carries no \`ccm:oeh_lrt_aggregated\`, so it does
 * not appear under the aggregated content-type facets — measured on live nodes,
 * and the reason a tool surfaces this rather than hiding it.
 */
export const UNMAPPED: string[] = LRT_CONCEPTS.filter(c => c.aggregatedUri === null).map(c => c.label);

export type LrtResolution =
  | { status: 'ok'; uri: string }
  | { status: 'ambiguous'; candidates: { uri: string; label: string; path: string }[] }
  | { status: 'unknown' };

const BY_TERM = (() => {
  const index = new Map<string, LrtConcept[]>();
  for (const c of LRT_CONCEPTS) {
    for (const term of [c.label, ...c.aliases]) {
      const key = term.toLowerCase();
      const list = index.get(key);
      if (list) list.push(c);
      else index.set(key, [c]);
    }
  }
  return index;
})();

/**
 * Resolve a label, alias or URI to a concept URI.
 *
 * A label two concepts share comes back as \`ambiguous\` with both candidates
 * rather than resolved to whichever sits earlier in the hierarchy. Two of the
 * ${concepts.length} labels are shared${ambiguous.length ? ` (${ambiguous.join(', ')})` : ''}, and they mean genuinely different
 * things — silently picking one would write a content type the curator did not
 * choose, which is the same class of defect as an invented licence.
 *
 * A URI from another vocabulary is \`unknown\`, not passed through: for a write,
 * an unverified URI is a value nobody chose.
 */
export function resolveLrt(input: string): LrtResolution {
  const trimmed = (input ?? '').trim();
  if (!trimmed) return { status: 'unknown' };

  if (trimmed.startsWith('http')) {
    return LRT_CONCEPTS.some(c => c.uri === trimmed)
      ? { status: 'ok', uri: trimmed }
      : { status: 'unknown' };
  }

  const hits = BY_TERM.get(trimmed.toLowerCase());
  if (!hits || hits.length === 0) return { status: 'unknown' };
  if (hits.length === 1) return { status: 'ok', uri: hits[0]!.uri };
  return {
    status: 'ambiguous',
    candidates: hits.map(c => ({ uri: c.uri, label: c.label, path: c.path })),
  };
}
`;

writeFileSync(OUT, header, 'utf8');
console.log(`wrote ${OUT.pathname}`);
console.log(`concepts: ${concepts.length} · mapped: ${mapped} · unmapped: ${unmapped.length}`);
console.log(`unmapped: ${unmapped.join(', ')}`);
console.log(`shared labels: ${ambiguous.join(', ') || '(none)'}`);
