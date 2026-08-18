/**
 * text-bm25.ts — Okapi BM25 over a small in-memory corpus. Pure, no I/O.
 *
 * Written for `services/compendium-view.ts`, which has to pick the passages of
 * one editorial text that answer a question. It is a module of its own because
 * a ranking formula and a Markdown chunker change for different reasons, and
 * because the arithmetic is only testable against corpora small enough to check
 * by hand — `tests/text-bm25.test.ts` carries none of the surrounding Markdown.
 *
 * **The term frequency counts through `termMatches`, not through equality.**
 * That is the one deliberate departure from the textbook formula, and it is the
 * measured rule `node-match.ts` exists for: German carries a query word inside
 * compounds ("Brechung" in "Lichtbrechung"), which token equality misses, while
 * a SHORT term matched anywhere lands in the middle of unrelated words. Both
 * halves of that rule come along for free by reusing the predicate rather than
 * writing a second, drifting one.
 */

import { queryTerms, termMatches } from './node-match.js';

/**
 * Saturation of the term frequency. The standard 1.2: past a handful of
 * occurrences a further one says little, which is what keeps a heading repeated
 * down a table from outranking the paragraph that explains it.
 */
const K1 = 1.2;
/**
 * How strongly length normalisation acts. The standard 0.75 — and the reason
 * passages are accumulated to a minimum size before they get here: at this
 * value a four-character table row would outrank the prose around it.
 */
const B = 0.75;

/** Letters and digits; everything else separates. Unicode-aware, so umlauts stay inside their word. */
const TOKEN = /[\p{L}\p{N}]+/gu;

export interface Bm25Hit {
  /** Index into the `documents` array the caller passed in. */
  index: number;
  score: number;
}

export interface Bm25Result {
  /** The documents that scored, best first; equal scores keep document order. */
  hits: Bm25Hit[];
  /**
   * Query terms that occur in NO document — normalised, so a caller printing
   * them shows what was actually searched for.
   *
   * Returned rather than left to the caller because the corpus is what decides
   * it, and a caller that re-derives it needs a second copy of the matching
   * rule. It is the difference between "here is your answer" and "here is the
   * answer to the third of your question that this text covers".
   *
   * There is deliberately no `matched` counterpart: it had no reader, and the
   * ranking already says which documents carried something.
   */
  unmatched: string[];
}

const tokenize = (text: string): string[] => text.toLowerCase().match(TOKEN) ?? [];

/**
 * The query, cut by the SAME rule the documents are cut by, then reduced to the
 * words that carry a signal, then to one entry each.
 *
 * Both steps are repairs of a measured defect. `queryTerms` splits on
 * whitespace alone, so punctuation stays glued to the word — and once the
 * documents are compared TOKEN by token, such a term can match nothing at all:
 * "Rheinland-Pfalz" came back as NOT FOUND over a text that names it on every
 * page, and a natural question lost its last word to the "?". Running the query
 * through `TOKEN` first makes the two sides agree; `queryTerms` still owns
 * which words count, so the stopword rule keeps exactly one home.
 *
 * The `Set` is the second repair: a word said twice doubled its contribution to
 * the score and appeared twice in `unmatched`, which reads as two different
 * misses.
 */
function normalizedTerms(query: string): string[] {
  return [...new Set(queryTerms(tokenize(query).join(' ')))];
}

/** Rank `documents` against `query`. Documents that carry no term are left out. */
export function rankBm25(documents: readonly string[], query: string): Bm25Result {
  const terms = normalizedTerms(query);
  if (!terms.length || !documents.length) return { hits: [], unmatched: [] };

  const lengths: number[] = [];
  // freqs[docIndex][termIndex] — how many of the document's tokens the term matches.
  const freqs = documents.map(doc => {
    const tokens = tokenize(doc);
    lengths.push(tokens.length);
    return terms.map(term => tokens.reduce((n, tok) => n + (termMatches(term, tok) ? 1 : 0), 0));
  });

  const total = documents.length;
  const avgLength = lengths.reduce((sum, n) => sum + n, 0) / total;
  const docFreq = terms.map((_, ti) => freqs.reduce((n, f) => n + (f[ti]! > 0 ? 1 : 0), 0));
  // The Lucene variant of the IDF, which stays positive for a term more than
  // half the corpus carries. The textbook one goes negative there, so a common
  // word would SUBTRACT from the score of a document that has it.
  const idf = docFreq.map(df => Math.log(1 + (total - df + 0.5) / (df + 0.5)));

  const hits: Bm25Hit[] = [];
  documents.forEach((_, di) => {
    // avgLength is 0 only when every document tokenizes to nothing, and then no
    // term matched either, so this loop adds nothing and the division is unreachable.
    const norm = K1 * (1 - B + (avgLength ? B * lengths[di]! / avgLength : 0));
    let score = 0;
    terms.forEach((_term, ti) => {
      const tf = freqs[di]![ti]!;
      if (tf > 0) score += idf[ti]! * (tf * (K1 + 1)) / (tf + norm);
    });
    if (score > 0) hits.push({ index: di, score });
  });

  // Stable: `sort` preserves the insertion order of equal elements, and the
  // documents were pushed in order — so an arbitrary tie-break never decides
  // which of two equally relevant passages a caller sees first.
  hits.sort((a, b) => b.score - a.score);

  return { hits, unmatched: terms.filter((_, ti) => docFreq[ti]! === 0) };
}
