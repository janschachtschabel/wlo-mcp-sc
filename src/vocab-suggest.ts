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

interface Candidate {
  display: string;
  distance: number;
}

/**
 * Suggest up to three vocabulary labels close to `input` for the given vocab.
 * Near edit-distance matches (≤ 2) rank first (closest first), then substring
 * matches. Each suggestion is the entry's *best-matching* term — label or alias
 * — capitalized, so a typo of an alias echoes the alias the user meant rather
 * than the entry's primary label. Returns [] when nothing is close enough.
 */
export function suggestVocab(input: string, vocab: VocabKey): string[] {
  const needle = input?.trim().toLowerCase();
  if (!needle) return [];

  const matches: Candidate[] = [];
  for (const entry of listVocab(vocab)) {
    let best: Candidate | null = null;
    for (const term of [entry.label, ...entry.aliases]) {
      const hay = term.toLowerCase();
      const distance = levenshtein(needle, hay);
      const isSubstring =
        needle.length >= MIN_SUBSTRING_LEN &&
        hay.length >= MIN_SUBSTRING_LEN &&
        (hay.includes(needle) || needle.includes(hay));
      if (distance > MAX_EDIT_DISTANCE && !isSubstring) continue;
      // Keep the entry's closest term (a true fuzzy hit beats a substring-only one).
      if (!best || distance < best.distance) best = { display: capitalize(term), distance };
    }
    if (best) matches.push(best);
  }

  // Fuzzy hits (within edit distance) before substring-only hits, then closest first.
  matches.sort((a, b) => {
    const aTier = a.distance <= MAX_EDIT_DISTANCE ? 0 : 1;
    const bTier = b.distance <= MAX_EDIT_DISTANCE ? 0 : 1;
    return aTier !== bTier ? aTier - bTier : a.distance - b.distance;
  });

  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of matches) {
    if (seen.has(m.display)) continue;
    seen.add(m.display);
    out.push(m.display);
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}
