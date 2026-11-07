/**
 * services/skill-for-task.ts – which APPROVED skill fits a task? (BOERDi
 * wishlist item 10, decision E2, 2026-11-06).
 *
 * The candidates are a registry's own entries, never a repository-wide search:
 * the question is "what may I use HERE for this", and a better-ranked skill the
 * collection does not approve is the wrong answer however well it matches.
 *
 * Ranked with the compendium's BM25 (`text-bm25.ts`), so a task phrased in
 * German compounds matches the way every other local match in this server does,
 * and the words that matched nothing are named rather than inferred.
 */

import { rankBm25 } from '../text-bm25.js';
import type { RegistryEntry } from './skill-registry.js';

export interface TaskRanking {
  /** Entries that share at least one term with the task, best first. Empty = none fits. */
  fitting: RegistryEntry[];
  /**
   * The entry the evidence clearly points at, or null. Only this one may have its
   * instruction handed over: measured on the Optik registry (2026-11-06), plain
   * ranking chose the wrong skill in 2 of 4 natural phrasings.
   */
  confident: RegistryEntry | null;
  /** Task words no entry carries. */
  unmatched: string[];
}

/** The lead the best candidate needs over the second before it counts as a choice. */
const CLEAR_LEAD = 1.5;

/** What an entry is matched on: everything the registry and the skill's head say about it. */
function entryText(e: RegistryEntry): string {
  return [e.title, e.description ?? '', ...(e.keywords ?? []), e.context ?? ''].join(' ');
}

/**
 * Two rules decide `confident`. A word more than half the candidates carry
 * tells them apart no better than chance ("Sammlung" was in all four Optik
 * entries, scores 0.51/0.48/0.46), so the best candidate must carry at least
 * one word that is NOT that common. And it must lead the second clearly — a
 * near-tie is a guess with decimals.
 */
export function rankEntriesForTask(entries: readonly RegistryEntry[], task: string): TaskRanking {
  const { hits, unmatched, docFreq } = rankBm25(entries.map(entryText), task);
  const fitting = hits.map(h => entries[h.index]!);
  const telling = (term: string) => entries.length < 2 || (docFreq[term] ?? 0) <= entries.length / 2;
  const [best, second] = hits;
  const confident = best && best.matched.some(telling) && (!second || best.score >= CLEAR_LEAD * second.score)
    ? entries[best.index]!
    : null;
  return { fitting, confident, unmatched };
}
