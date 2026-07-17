/**
 * text-distance.ts — pure string-distance primitives, no project imports.
 *
 * Extracted from `vocab-suggest.ts` so both the vocab suggester and the
 * university-subject fuzzy lookup (`vocabs-hochschule.ts`) can share it without
 * a circular import: `vocabs.ts → vocabs-hochschule.ts → text-distance` stays
 * acyclic because this module is a leaf.
 */

/**
 * Levenshtein edit distance (insertion/deletion/substitution each cost 1).
 * Iterative two-row DP: O(a.length · b.length) time, O(b.length) space.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,        // deletion
        curr[j - 1] + 1,    // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}
