/**
 * vocab-suggest.ts — fuzzy suggestions for unresolved vocabulary filter values.
 *
 * When a user-supplied filter label (e.g. "Grundshule") does not resolve to a
 * known vocabulary URI, this offers up to three near-miss labels so a tool can
 * print "Meintest du: Grundschule?". Pure and I/O-free — it reads the local
 * vocab tables through `listVocab`, the same source `resolveVocab` matches against.
 */

import { listVocab, type VocabKey } from './vocabs.js';
import { levenshtein } from './text-distance.js';

// Re-exported for back-compat: `levenshtein` used to live here.
export { levenshtein } from './text-distance.js';

const MAX_SUGGESTIONS = 3;
const MAX_EDIT_DISTANCE = 2;
// Substring matching is guarded to tokens of length ≥ 4 on both sides — the
// same guard resolveVocab uses to avoid short-token false positives.
const MIN_SUBSTRING_LEN = 4;

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

interface Candidate<E> {
  entry: E;
  display: string;
  distance: number;
}

type Entry = { label: string; aliases: string[] };

/**
 * Suggest up to three vocabulary labels close to `input` for the given vocab.
 * Near edit-distance matches (≤ 2) rank first (closest first), then substring
 * matches. Each suggestion is the entry's *best-matching* term — label or alias
 * — capitalized, so a typo of an alias echoes the alias the user meant rather
 * than the entry's primary label. Returns [] when nothing is close enough.
 */
export function suggestVocab(input: string, vocab: VocabKey): string[] {
  return suggestFromEntries(input, listVocab(vocab), MAX_SUGGESTIONS);
}

/**
 * Every entry near `input`, each with its closest term, nearest first: fuzzy
 * hits (within edit distance) before substring-only hits, then by distance.
 */
function nearEntries<E extends Entry>(input: string, entries: ReadonlyArray<E>): Candidate<E>[] {
  const needle = input?.trim().toLowerCase();
  if (!needle) return [];

  const matches: Candidate<E>[] = [];
  for (const entry of entries) {
    let best: Candidate<E> | null = null;
    for (const term of [entry.label, ...entry.aliases]) {
      const hay = term.toLowerCase();
      const distance = levenshtein(needle, hay);
      const isSubstring =
        needle.length >= MIN_SUBSTRING_LEN &&
        hay.length >= MIN_SUBSTRING_LEN &&
        (hay.includes(needle) || needle.includes(hay));
      if (distance > MAX_EDIT_DISTANCE && !isSubstring) continue;
      // Keep the entry's closest term (a true fuzzy hit beats a substring-only one).
      if (!best || distance < best.distance) best = { entry, display: capitalize(term), distance };
    }
    if (best) matches.push(best);
  }

  return matches.sort((a, b) => {
    const aTier = a.distance <= MAX_EDIT_DISTANCE ? 0 : 1;
    const bTier = b.distance <= MAX_EDIT_DISTANCE ? 0 : 1;
    return aTier !== bTier ? aTier - bTier : a.distance - b.distance;
  });
}

/**
 * The matching itself, over any label/alias table.
 *
 * Split out unchanged from `suggestVocab` when the `new_lrt` vocabulary needed
 * the same near-miss help: it has 220 concepts and does not live in the
 * `VocabKey` tables, and a second fuzzy matcher would have been one more thing
 * to keep in step.
 */
export function suggestFromEntries(
  input: string,
  entries: ReadonlyArray<Entry>,
  max: number = MAX_SUGGESTIONS,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of nearEntries(input, entries)) {
    if (seen.has(m.display)) continue;
    seen.add(m.display);
    out.push(m.display);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The same matching, answering with the ENTRIES instead of the term that
 * matched. For a caller that must name something a write accepts: the matched
 * term may be an alias, and two terms may belong to one entry — or, in
 * `new_lrt`, one label to two.
 *
 * Entries whose LABEL holds the input as a whole word come first ("Wirtschaft"
 * → "Wirtschaft und Verwaltung", "Video" → "Video (Material)"): that is
 * likelier what was meant than a neighbour by edit distance. Each entry once.
 */
export function suggestEntries<E extends Entry>(input: string, entries: ReadonlyArray<E>): E[] {
  const needle = input?.trim();
  if (!needle) return [];
  const word = new RegExp(`(^|[^\\p{L}\\p{N}])${needle.replace(SPECIAL, '\\$&')}($|[^\\p{L}\\p{N}])`, 'iu');
  return [...new Set([
    ...entries.filter(e => word.test(e.label)),
    ...nearEntries(needle, entries).map(m => m.entry),
  ])];
}

/** Characters with a meaning in a regular expression. */
const SPECIAL = /[.*+?^${}()|[\]\\]/g;
