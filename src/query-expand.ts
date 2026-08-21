/**
 * query-expand.ts – Query expansion for the enhanced search: turns one user
 * query into a small, weight-capped set of backend query variants (full text,
 * title, keywords, stopword-free, synonyms). Extracted from reranker.ts so the
 * most-edited data (synonym table, stopwords) lives apart from the scoring/
 * merge algorithm that consumes the variants.
 */

import type { SearchCriterion } from './wlo-types.js';

// O4: Upper bound for parallel query variants (= parallel ngsearch calls).
// Variants are sorted by weight and trimmed to the best MAX_VARIANTS, so a
// synonym-/term-rich query does not trigger double-digit numbers of backend
// calls. ``full:`` (weight 1.0) therefore always stays included.
const MAX_VARIANTS = 5;

/** Shared with the reranker's scoring: stopwords must not act as relevance signals either. */
export const DE_STOPWORDS = new Set([
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'einem', 'einen', 'eines',
  'und', 'oder', 'aber', 'als', 'auch', 'auf', 'aus', 'bei', 'bis', 'für', 'mit', 'nach',
  'von', 'vor', 'wie', 'über', 'unter', 'durch', 'gegen', 'ohne', 'zwischen',
  'ich', 'du', 'er', 'sie', 'wir', 'ihr', 'uns', 'sich',
  'ist', 'sind', 'war', 'hat', 'wird', 'kann', 'soll', 'zum', 'zur', 'vom',
  'nicht', 'noch', 'nur', 'sehr', 'schon', 'dann', 'wenn', 'dass', 'weil',
  'im', 'am', 'an', 'in', 'zu', 'so', 'es', 'ob',
]);

/**
 * Nouns that FRAME a request instead of naming its subject.
 *
 * The repository ANDs every word of a query, and these words are absent from
 * virtually every record — so one of them empties the result set. Measured
 * against staging on 2026-08-21: "Französische Revolution" answers 480 records,
 * "Unterrichtsstunde Französische Revolution" answers **zero**; "Optik" 825
 * against "Bildungsinhalte zur Optik" 4; "Photosynthese" 211 against
 * "Erklärvideo Photosynthese" 1. Inflection is not the cause — "Französischen
 * Revolution" still answers 450 — a single framing noun is enough.
 *
 * The list is not invented: it is the vocabulary this server's OWN server
 * instructions and tool descriptions put in the user's mouth ("ein Video zu
 * Bruchrechnung", "ein Arbeitsblatt zur Zellteilung", "Material für Klasse 7",
 * "eine Unterrichtsstunde zu …", "Übungen zu Photosynthese", "ein Erklärvideo",
 * "ein Bild/eine Grafik/eine Simulation zu …"), plus their plurals. Where a word
 * is also a real filter value (Video → learningResourceType, Sekundarstufe →
 * educationalContext), that filter is where it belongs anyway.
 *
 * The stopword list above cannot do this job: it holds function words, and
 * every entry here is a noun.
 */
const REQUEST_FRAMING = new Set([
  // medium — belongs in `learningResourceType`
  'video', 'videos', 'erklärvideo', 'erklärvideos', 'lernvideo', 'lernvideos',
  'film', 'filme', 'podcast', 'bild', 'bilder', 'grafik', 'grafiken',
  'simulation', 'simulationen', 'arbeitsblatt', 'arbeitsblätter',
  'übung', 'übungen', 'aufgabe', 'aufgaben',
  // the generic word for "anything at all"
  'material', 'materialien', 'unterrichtsmaterial', 'unterrichtsmaterialien',
  'medien', 'medium', 'bildungsinhalt', 'bildungsinhalte', 'inhalt', 'inhalte',
  'beispiel', 'beispiele',
  // teaching frame
  'unterricht', 'unterrichtsstunde', 'unterrichtsstunden', 'unterrichtseinheit',
  'stunde', 'lerneinheit',
  // level — belongs in `educationalContext`
  'klasse', 'klassenstufe', 'jahrgangsstufe', 'sekundarstufe',
  // the act of asking. Same source as the nouns: `docs/TOOLS.md` offers
  // "Ich suche Bildungsinhalte für eine Mathestunde zur Bruchrechnung" and
  // "Zeig mir ein Video zur Eiszeit" as the phrasing to type. Measured: with
  // `suche` left in, the Optik request narrows to a single record — worse than
  // the framing nouns alone achieved.
  'suche', 'suchen', 'brauche', 'benötige', 'finde', 'finden',
  'zeig', 'zeige', 'gib', 'möchte', 'hätte',
  // `mir` and `bitte` are function words and would sit naturally in
  // DE_STOPWORDS — but that set is shared with the reranker's SCORING, so
  // moving them there would change how every result is ranked. They stay here,
  // where they only shape this one query variant.
  'mir', 'bitte',
]);

const SYNONYM_MAP: Record<string, string[]> = {
  'ki':                     ['künstliche intelligenz', 'artificial intelligence'],
  'künstliche intelligenz': ['ki'],
  'oer':                    ['open educational resources', 'freie bildungsmaterialien'],
  'mathe':                  ['mathematik'],
  'mathematik':             ['mathe'],
  'bio':                    ['biologie'],
  'biologie':               ['bio'],
  'physik':                 ['physics'],
  'chemie':                 ['chemistry'],
  'geo':                    ['geographie', 'erdkunde'],
  'geographie':             ['erdkunde', 'geo'],
  'erdkunde':               ['geographie', 'geo'],
  'info':                   ['informatik'],
  'informatik':             ['info', 'computer science'],
  'grundschule':            ['primarstufe'],
  'primarstufe':            ['grundschule'],
  'klima':                  ['klimawandel', 'klimaschutz'],
  'klimawandel':            ['klima', 'klimaschutz', 'climate change'],
  'nachhaltigkeit':         ['nachhaltige entwicklung', 'bne', 'sustainability'],
  'bne':                    ['bildung für nachhaltige entwicklung', 'nachhaltigkeit'],
};

export interface QueryVariant {
  label: string;
  weight: number;
  criteria: SearchCriterion[];
}

export function expandQuery(query: string): QueryVariant[] {
  const trimmed = query.trim();
  if (!trimmed) return [{ label: 'all', weight: 1, criteria: [{ property: 'ngsearchword', values: ['*'] }] }];

  const terms = trimmed.split(/\s+/).filter(t => t.length >= 2);
  const significantTerms = terms.filter(t => t.length >= 3);
  const contentTerms = terms.filter(t => !DE_STOPWORDS.has(t.toLowerCase()));
  const variants: QueryVariant[] = [];

  variants.push({ label: `full:"${trimmed}"`, weight: 1.0, criteria: [{ property: 'ngsearchword', values: [trimmed] }] });
  variants.push({ label: `title:"${trimmed}"`, weight: 0.95, criteria: [{ property: 'cclom:title', values: [trimmed] }] });

  if (significantTerms.length > 0) {
    variants.push({ label: `kw:${significantTerms.join(',')}`, weight: 0.9, criteria: [{ property: 'cclom:general_keyword', values: significantTerms }] });
  }

  if (contentTerms.length > 0 && contentTerms.length < terms.length) {
    variants.push({ label: `nostop:"${contentTerms.join(' ')}"`, weight: 0.85, criteria: [{ property: 'ngsearchword', values: [contentTerms.join(' ')] }] });
  }

  // The SUBJECT alone, once the request framing is dropped. Emitted only when
  // something was actually removed AND something is left: an unchanged query
  // would merely repeat `full`, and an emptied one would match everything,
  // which is a worse answer than the honest handful of hits.
  //
  // Weight 0.92 — above `kw`, below the exact-phrase variants. Both halves
  // matter: a record matching the full phrasing still ranks first, and the
  // variant cannot be trimmed by MAX_VARIANTS, which would make it useless
  // precisely when it is the only variant returning anything at all.
  //
  // It does take the last slot from the synonym variant whenever framing words
  // are present ("Arbeitsblatt zu KI" no longer expands KI). That trade is
  // deliberate and measured: the synonym variant is built from the WHOLE query,
  // so in exactly this case it would have read `syn:"arbeitsblatt zu künstliche
  // intelligenz"` — still carrying the framing noun, still answering nothing.
  // A dead variant is exchanged for one that recovers 0 → 9 records. Raising
  // MAX_VARIANTS instead would cost every search another upstream call.
  const topicTerms = contentTerms.filter(t => !REQUEST_FRAMING.has(t.toLowerCase()));
  if (topicTerms.length > 0 && topicTerms.length < contentTerms.length) {
    const topic = topicTerms.join(' ');
    variants.push({ label: `topic:"${topic}"`, weight: 0.92, criteria: [{ property: 'ngsearchword', values: [topic] }] });
  }

  const queryLower = trimmed.toLowerCase();
  const synonymQueries = new Set<string>();
  for (const [term, synonyms] of Object.entries(SYNONYM_MAP)) {
    // Match on word boundaries (umlaut-aware) so a key like "klima" does NOT
    // fire inside "klimawandel", and the replace can't corrupt a substring
    // (the old `.replace(term, syn)` turned "geographie" → "geographiegrafie").
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![\\wäöüß])${esc}(?![\\wäöüß])`, 'i');
    if (re.test(queryLower)) {
      for (const syn of synonyms) {
        const expanded = queryLower.replace(re, syn);
        if (expanded !== queryLower) synonymQueries.add(expanded);
      }
    }
  }
  for (const synQuery of synonymQueries) {
    variants.push({ label: `syn:"${synQuery}"`, weight: 0.6, criteria: [{ property: 'ngsearchword', values: [synQuery] }] });
  }

  // O4: The former single-term variants (term:"X", weight 0.5) have been
  // removed — they produced 1 ngsearch call PER term for minimal added value,
  // since the keyword variant (kw:) already covers the individual terms via
  // cclom:general_keyword. Instead: sort by weight and cap at the best
  // MAX_VARIANTS.
  variants.sort((a, b) => b.weight - a.weight);
  return variants.slice(0, MAX_VARIANTS);
}
