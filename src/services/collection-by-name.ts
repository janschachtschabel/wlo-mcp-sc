/**
 * collection-by-name.ts – a collection named by its TITLE instead of its nodeId
 * (chatbot team, Z3, 2026-11-13).
 *
 * Five read tools take a collection; "what is under Optik?" used to cost a
 * model round for `search_wlo_collections` first. This is the ONE place that
 * turns a title into a nodeId, and the rule is deliberately narrow: exactly one
 * collection with the SAME title, or no resolution at all. A prefix or a
 * substring is a guess, and a tool that then lists the wrong collection answers
 * a question nobody asked while looking exactly like the right answer.
 *
 * "Exactly one" is a statement about the CATALOGUE, so it is only made over a
 * search that answered in full and whose windows were not filled (review
 * 2026-11-13): a namesake may sit in the index that was down, or past the
 * window. Then the hit is offered as a candidate, never taken.
 */

import { sharedReadScope } from '../auth/credential.js';
import { mapPool } from '../concurrency.js';
import { buildFilterCriteria, type UnresolvedFilter } from '../filter-criteria.js';
import { collectionTitleFromProperties, nodeMatchesCriteria } from '../node-match.js';
import { rerankNodes } from '../reranker.js';
import { isClientGone } from '../request-scope.js';
import { shortCache } from '../short-cache.js';
import { WLO_ROOT_COLLECTION_ID } from '../wlo-config.js';
import { readNodeBreadcrumb } from '../wlo-node.js';
import type { WloNode } from '../wlo-types.js';
import { searchCollectionsResult } from './collection-search.js';

/** How many collections a refusal offers to choose from. */
export const CANDIDATES_MAX = 5;

/**
 * How many hits the search is asked for. Namesakes must ALL be in the window —
 * a second "Mechanik" outside it would make the first one look unique, which is
 * why a window that comes back FULL ends in a refusal.
 */
const SEARCH_WINDOW = 25;

/**
 * The windows of the one verification pass. Measured 2026-11-13 on staging: the
 * keyword index answers 100 as fast as 25 (0.4–0.6 s); the name index, asked
 * for 50, returned 7–22 hits for common titles in 0.9–1.4 s — 25 would sit
 * right at the largest of those and so refuse what it was built to verify.
 */
const VERIFY_KEYWORD_WINDOW = 100;
const VERIFY_NAME_WINDOW = 50;

export interface ResolvedCollection {
  nodeId: string;
  title: string;
  /** Ancestor titles from the subject portal down. Absent when the path could not be read — never invented. */
  path?: string[];
  /** Present when the title matched only by the loose rule (`looseCollectionTitle`) — the caller is told. */
  matched?: 'loose';
  /**
   * Namesakes that carry NO subject, beside the one taken because it carries
   * the subject asked for. They could be neither excluded nor confirmed — the
   * caller is told they exist (chatbot team, 2026-11-14). At most
   * `CANDIDATES_MAX`; `alsoFoundTotal` says how many there are when that cut.
   */
  alsoFound?: CollectionCandidate[];
  alsoFoundTotal?: number;
}

export interface CollectionCandidate {
  nodeId: string;
  title: string;
  path?: string[];
  /** Only where the search hit carried the number; no read is spent on it. */
  contentsCount?: number;
  /** A discipline was asked for and this hit carries none: it could be neither excluded nor confirmed. */
  disciplineUnknown?: true;
}

/** A `discipline` that named no subject: it narrowed nothing, and the caller is told. */
export type UnresolvedDiscipline = Pick<UnresolvedFilter, 'value' | 'suggestions'>;

export type CollectionByName =
  | { ok: true; collection: ResolvedCollection; unresolvedDiscipline?: UnresolvedDiscipline }
  | {
    ok: false;
    /**
     * `several`: more than one collection carries the title. `none`: no
     * collection carries exactly it. `unverified`: exactly one was FOUND, but
     * the search cannot say it is the only one (`incomplete`).
     */
    reason: 'several' | 'none' | 'unverified';
    candidates: CollectionCandidate[];
    /** The search did not see everything: neither "no such collection" nor "only this one" is a finding. */
    incomplete: boolean;
    /** Why: an index did not answer … */
    unreachable?: true;
    /** … and/or a search window came back full, so the index may hold more than was seen. */
    windowFull?: true;
    /**
     * `unverified` for another reason than an incomplete search: a subject was
     * asked for, and the one namesake found carries none — it is not taken.
     */
    disciplineUnverified?: true;
    unresolvedDiscipline?: UnresolvedDiscipline;
  };

/**
 * Pass 1, strict: two titles are the same when they differ only in case and in
 * how words are separated — a run of spaces or hyphens is ONE separator, and it
 * stays one ("Bruch-Rechnung" = "bruch  rechnung", but not "Bruchrechnung").
 */
export function normalizeCollectionTitle(title: string): string {
  return title.normalize('NFC').toLocaleLowerCase('de').replace(/[\s\p{Pd}]+/gu, ' ').trim();
}

/**
 * Pass 2, loose — asked only when pass 1 found NOTHING, and said in the answer:
 * umlauts and "ß" spelled out, separators dropped ("Größen" = "Groessen",
 * "Bruch-Rechnung" = "Bruchrechnung"). As the only rule it merged different
 * words: "Masse" = "Maße", "Wach Stube" = "Wachs Tube", "Klasse 1 0" = "Klasse 10".
 */
export function looseCollectionTitle(title: string): string {
  return normalizeCollectionTitle(title)
    .replace(/ß/g, 'ss').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/ /g, '');
}

/**
 * A name spelled out put back into umlauts — a SEARCH word only, never compared
 * with anything: "Saeuren" → "Säuren". Not "ss" → "ß" (most "ss" are just "ss").
 */
function withUmlauts(name: string): string {
  // "ue" after q, a, e or ä is never an ü (Quelle, Frauen, Feuer, neue) — and
  // respelled it would spoil the search for the word beside it. What is left
  // over ("Poesie" → "Pösie", "aktuell" → "aktüll") costs one search that finds
  // nothing. The case of the first letter is kept, so "SAEUREN" works too.
  const upper = (m: string) => m[0] === m[0]!.toUpperCase();
  return name
    .replace(/ae/gi, m => (upper(m) ? 'Ä' : 'ä'))
    .replace(/oe/gi, m => (upper(m) ? 'Ö' : 'ö'))
    .replace(/(?<![qaeä])ue/gi, m => (upper(m) ? 'Ü' : 'ü'));
}

const idOf = (n: WloNode): string => n.ref?.id ?? '';
const titleOf = (n: WloNode): string => collectionTitleFromProperties(n.properties) || n.title || '';

// Keyed by whose rights read it; only a resolution is kept — a refusal may be
// an index that had not answered, and is asked again.
const resolved = shortCache<ResolvedCollection>(200);

/**
 * The ancestors of a collection, portal first, without the collection itself
 * and without the WLO root above the portals. `undefined` when `/parents` did
 * not answer.
 */
async function pathOf(nodeId: string): Promise<string[] | undefined> {
  // The path decorates the answer: a read that THREW costs the path, not the resolution.
  const { ok, chain } = await readNodeBreadcrumb(nodeId).catch((err: unknown) => {
    if (isClientGone(err)) throw err;
    return { ok: false, chain: [] };
  });
  if (!ok) return undefined;
  const root = chain.findIndex(c => c.nodeId === WLO_ROOT_COLLECTION_ID);
  return chain.slice(root + 1).filter(c => c.nodeId !== nodeId).map(c => c.title);
}

export async function resolveCollectionByName(name: string, discipline?: string): Promise<CollectionByName> {
  const wanted = normalizeCollectionTitle(name);
  // Resolved through the same filter resolution `search_wlo_collections` uses,
  // and applied the same way: locally, on the hit's own `ccm:taxonid`.
  const { criteria, unresolved } = buildFilterCriteria({ discipline: discipline?.trim() || undefined });
  const unresolvedDiscipline = unresolved[0]
    ? { unresolvedDiscipline: { value: unresolved[0].value, ...(unresolved[0].suggestions ? { suggestions: unresolved[0].suggestions } : {}) } }
    : {};
  if (!wanted) return { ok: false, reason: 'none', candidates: [], incomplete: false, ...unresolvedDiscipline };

  const scope = sharedReadScope();
  const key = `${scope}:${wanted}:${criteria[0]?.values[0] ?? ''}`;
  const kept = scope ? resolved.get(key) : undefined;
  if (kept) return { ok: true, collection: kept, ...unresolvedDiscipline };

  // A subject asked for decides in three steps (chatbot team, measured
  // 2026-11-14 on 24 real titles). A hit that carries NO subject is not
  // EXCLUDED by one — it may be the collection meant. But it is not CONFIRMED
  // either: with exactly one namesake that carries the subject, that one is
  // taken and the unknown ones are named (a community's empty "Mechanik" used
  // to refuse the subject's own, 305 contents); with none that carries it, an
  // unknown one is never taken — it passed for unique once its namesakes of
  // other subjects had fallen away ("Klimawandel" + "Geografie").
  const narrowing = criteria.length > 0;
  const subjectUnknown = (n: WloNode) => criteria.some(c => !(n.properties?.[c.property] ?? []).some(Boolean));
  const inSubject = (n: WloNode) => subjectUnknown(n) || nodeMatchesCriteria(n, criteria);
  const wantedLoose = looseCollectionTitle(name);
  const strict = (n: WloNode) => normalizeCollectionTitle(titleOf(n)) === wanted;
  const loose = (n: WloNode) => looseCollectionTitle(titleOf(n)) === wantedLoose;

  type Search = Awaited<ReturnType<typeof searchCollectionsResult>>;
  const judge = (nodes: WloNode[], search: Search, window: number) => {
    const hits = rerankNodes(nodes.filter(n => idOf(n)), name);
    const strictHits = hits.filter(n => strict(n) && inSubject(n));
    // The loose rule only where the strict one found nothing at all.
    const equal = strictHits.length ? strictHits : hits.filter(n => loose(n) && inSubject(n));
    // With a subject: who carries it, and who carries none. Without: all alike.
    const confirmed = narrowing ? equal.filter(n => !subjectUnknown(n)) : equal;
    const unknown = narrowing ? equal.filter(subjectUnknown) : [];
    return {
      hits, strictHits, equal, confirmed, unknown,
      // A full window — of either index, or of the merged list — may hide a namesake.
      windowFull: search.full.length > 0 || search.nodes.length >= window,
      unreachable: search.unreachable.length > 0,
    };
  };

  let first = await searchCollectionsResult(name, SEARCH_WINDOW);
  let searched = name;
  let seen = judge(first.nodes, first, SEARCH_WINDOW);
  // Nothing equal, and the name is spelled without umlauts: the indexes do not
  // return "Säuren und Basen" for "Saeuren und Basen" (chatbot team,
  // 2026-11-14), so the loose rule had nothing to compare. ONE more search with
  // the umlauts put back; the comparison stays the loose rule's, so a respelling
  // that is no word ("Poesie" → "Pösie") finds nothing and changes nothing.
  //
  // What the FIRST search could not rule out stays unruled: its full window may
  // hide a strictly equal title, and no later window of the OTHER spelling can
  // look there (review 2026-11-15 — a loose match was taken as the only one).
  let firstWindowFull = false;
  const respelled = withUmlauts(name);
  if (seen.equal.length === 0 && !seen.unreachable && respelled !== name) {
    const second = await searchCollectionsResult(respelled, SEARCH_WINDOW);
    const again = judge([...first.nodes, ...second.nodes.filter(n => !first.nodes.some(f => idOf(f) === idOf(n)))], second, SEARCH_WINDOW);
    if (again.equal.length > 0) {
      firstWindowFull = seen.windowFull;
      first = { ...second, nodes: again.hits };
      searched = respelled;
      seen = again;
    } else if (again.unreachable) {
      // The one search that could have found the umlaut spelling did not answer.
      seen = { ...seen, unreachable: true };
    }
  }
  // One equal title behind a full window is VERIFIED rather than refused: the
  // name index alone fills its 5 for almost any common word, and measured
  // 2026-11-13 the refusal hit 9 of 24 real titles that had exactly one
  // equal-titled collection. Cost: at most two more requests, plus one re-read
  // per equal-titled name hit the keyword index did not return — the name
  // index's own nodes carry the title, so the rest of its window is not read.
  // Not asked for several (more hits cannot make that "one"). Not asked for
  // none either, though it COULD help in principle — an equal title past rank 5
  // of the name index that the keyword index lacks: measured 2026-11-13 on
  // staging (24 titles, 9 of them none + full window), the wide windows found 0
  // equal titles in all 9, at +0.4–2.4 s each. The answer stays honest without
  // it (`incomplete`, `windowFull`). Re-measure before changing.
  if (seen.confirmed.length === 1 && seen.windowFull && !seen.unreachable && !firstWindowFull) {
    const wide = await searchCollectionsResult(searched, VERIFY_KEYWORD_WINDOW, undefined,
      { nameLegMax: VERIFY_NAME_WINDOW, adoptNameHit: loose });
    // What the first pass saw stays in view: a namesake counts wherever it was seen.
    const inWide = new Set(wide.nodes.map(idOf));
    seen = judge([...wide.nodes, ...first.nodes.filter(n => !inWide.has(idOf(n)))], wide, VERIFY_KEYWORD_WINDOW);
  }
  const { hits, strictHits, confirmed, unknown, unreachable } = seen;
  const windowFull = seen.windowFull || firstWindowFull;
  const incomplete = unreachable || windowFull;

  const candidateOf = (node: WloNode, path: string[] | undefined): CollectionCandidate => {
    const count = node.collection?.childReferencesCount;
    return {
      nodeId: idOf(node), title: titleOf(node),
      ...(path ? { path } : {}),
      ...(typeof count === 'number' ? { contentsCount: count } : {}),
      ...(subjectUnknown(node) ? { disciplineUnknown: true as const } : {}),
    };
  };

  if (confirmed.length === 1 && !incomplete) {
    const node = confirmed[0]!;
    const beside = unknown.slice(0, CANDIDATES_MAX);
    const [path, ...besidePaths] = await Promise.all([pathOf(idOf(node)), ...beside.map(n => pathOf(idOf(n)))]);
    const collection: ResolvedCollection = {
      nodeId: idOf(node), title: titleOf(node),
      ...(path ? { path } : {}),
      ...(strictHits.length ? {} : { matched: 'loose' as const }),
      ...(beside.length ? { alsoFound: beside.map((n, i) => candidateOf(n, besidePaths[i])) } : {}),
      ...(unknown.length > beside.length ? { alsoFoundTotal: unknown.length } : {}),
    };
    // Not kept without its path (the next caller would never get one).
    if (scope && path) resolved.set(key, collection);
    return { ok: true, collection, ...unresolvedDiscipline };
  }

  // Same title first (strictly, then loosely), then what the search ranked
  // best; within each, the caller's subject before the rest — a wrong subject
  // must not leave the caller with nothing to choose from.
  const rank = (n: WloNode) => (strict(n) ? 0 : loose(n) ? 2 : 4) + (inSubject(n) ? 0 : 1);
  const shown = hits
    .map((node, order) => ({ node, order }))
    .sort((a, b) => rank(a.node) - rank(b.node) || a.order - b.order)
    .slice(0, CANDIDATES_MAX)
    .map(({ node }) => node);
  const paths = await mapPool(shown, CANDIDATES_MAX, n => pathOf(idOf(n)));
  const candidates = shown.map((node, i) => candidateOf(node, paths[i] ?? undefined));
  // Who decides: the namesakes that carry the subject, and only where there is
  // none of them the ones that carry no subject at all.
  const deciding = confirmed.length ? confirmed : unknown;
  const reason = deciding.length > 1 ? 'several' as const : deciding.length === 1 ? 'unverified' as const : 'none' as const;
  return {
    ok: false, reason, candidates, incomplete,
    ...(unreachable ? { unreachable: true as const } : {}),
    ...(windowFull ? { windowFull: true as const } : {}),
    ...(reason === 'unverified' && confirmed.length === 0 ? { disciplineUnverified: true as const } : {}),
    ...unresolvedDiscipline,
  };
}
