/**
 * services/compendium-view.ts — which part of one editorial compendium text
 * answers the caller, and what its outline is. Pure, no I/O.
 *
 * Separate from `services/compendium.ts`, which FETCHES the text: selecting from
 * it is a different reason to change, and the fetch is shared with
 * `services/search.ts` and `/api/compendium`, neither of which wants a view.
 *
 * Two modes, one function, because the caller picks between them with one
 * argument:
 *
 *  - no query → every top-level section, each capped on its own.
 *  - a query  → the best-scoring passages, with their heading path.
 *
 * The outline comes back either way. A model handed excerpts otherwise cannot
 * tell what it did NOT see, and so cannot ask the second, narrower question —
 * which is the whole point of answering in excerpts.
 *
 * Measured on staging 2026-08-18 over the 11 collections that carry a
 * compendium text; the numbers are in
 * `docs/plans/2026-08-18-kompendium-bm25-design.md`.
 */

import { parseSections, type MarkdownSection } from './markdown-sections.js';
import { rankBm25 } from '../text-bm25.js';
import { capText } from '../text-cap.js';

/**
 * Smallest passage handed to the ranking.
 *
 * 329 of 972 real paragraphs are under 40 characters — table rows, list items,
 * bold intertitles. BM25 normalises on document length, so each of those alone
 * outranks the paragraph that explains it. Consecutive paragraphs are therefore
 * accumulated up to this size before a passage is closed.
 */
const MIN_PASSAGE_CHARS = 200;

/** How many passages a query answer carries. Not configurable: see the design doc. */
const DEFAULT_MAX_PASSAGES = 8;

/** Default per-section cap; the operator value arrives through `maxSectionChars`. */
const DEFAULT_MAX_SECTION_CHARS = 2000;

export interface OutlineEntry {
  /** Heading text, verbatim. The caller renders it — and must flatten it first. */
  title: string;
  /** 0 for a top-level section, 1 for its children, and so on. */
  depth: number;
}

export interface CompendiumSection {
  /** Heading text, or '' for the text before the first top-level heading. */
  title: string;
  /** The section INCLUDING its heading line, capped. */
  text: string;
  truncated: boolean;
}

export interface CompendiumPassage {
  /** Heading titles from the top-level section down to the one owning this text. */
  path: string[];
  text: string;
}

export interface CompendiumView {
  /** The headings from the top-level section down. Empty for a text without any. */
  outline: OutlineEntry[];
  /** Every top-level section, capped — only without a query. */
  sections: CompendiumSection[];
  /** The passages that answered, best first — only with a query. */
  passages: CompendiumPassage[];
  /** Query terms that occur nowhere in this text. */
  unmatchedTerms: string[];
  /** Length of the whole compendium text, before anything was cut. */
  charCount: number;
  /** Whether the answer holds less than the text does. */
  truncated: boolean;
}

export interface CompendiumViewOptions {
  query?: string;
  maxSectionChars?: number;
  maxPassages?: number;
}

/**
 * The heading level whose sections the cap and the outline are about.
 *
 * The shallowest level that occurs at least TWICE, because a level used once at
 * the top of a document is its title, not a section: measured on staging
 * 2026-08-18, 10 of 10 compendium texts carry exactly one H1 and put their 11–18
 * content sections in H2. Capping "per H1" would have capped each document as a
 * whole, which is the opposite of keeping every section.
 *
 * Falls back to the shallowest level present (a document with one H1 and one H2
 * is capped at its H1 — safe, and it has no repeated structure to preserve), and
 * to `undefined` for a text without headings.
 */
function topLevelOf(sections: readonly MarkdownSection[]): number | undefined {
  if (!sections.length) return undefined;
  const counts = new Map<number, number>();
  for (const s of sections) counts.set(s.level, (counts.get(s.level) ?? 0) + 1);
  const levels = [...counts.keys()].sort((a, b) => a - b);
  return levels.find(l => counts.get(l)! >= 2) ?? levels[0];
}

/** One span of document under a single heading path — the unit a passage may not cross. */
interface Span {
  path: string[];
  from: number;
  to: number;
}

/**
 * The document as spans of OWN body text: what stands before the first heading,
 * then each heading own text down to the next heading of any level. A nested
 * section is its own span rather than part of its parent, so a passage is never
 * labelled with a path its text does not sit under.
 */
function bodySpans(text: string, sections: readonly MarkdownSection[], topLevel: number | undefined): Span[] {
  if (topLevel === undefined) return [{ path: [], from: 0, to: text.length }];

  const spans: Span[] = [];
  const first = sections.find(s => s.level >= topLevel);
  if (first && first.headingStart > 0) spans.push({ path: [], from: 0, to: first.headingStart });

  sections.forEach((section, i) => {
    if (section.level < topLevel) return;
    const next = sections[i + 1];
    const ownEnd = next ? Math.min(section.end, next.headingStart) : section.end;

    // Walk back for the ancestors: the nearest preceding heading of each
    // shallower level, down to the top level. Nameless ones are skipped rather
    // than pushed as '' — the same rule the outline follows, so a passage under
    // an unnamed section is labelled with the named one that encloses it
    // instead of with an empty heading.
    const path = section.title ? [section.title] : [];
    let level = section.level;
    for (let j = i - 1; j >= 0 && level > topLevel; j--) {
      const candidate = sections[j]!;
      if (candidate.level < level) {
        level = candidate.level;
        if (level >= topLevel && candidate.title) path.unshift(candidate.title);
      }
    }
    spans.push({ path, from: section.bodyStart, to: ownEnd });
  });
  return spans;
}

/** Split one span into passages: paragraph runs, accumulated to {@link MIN_PASSAGE_CHARS}. */
function passagesOf(text: string, span: Span): CompendiumPassage[] {
  const paragraphs = text.slice(span.from, span.to).split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const out: CompendiumPassage[] = [];
  let buffer: string[] = [];
  for (const paragraph of paragraphs) {
    buffer.push(paragraph);
    if (buffer.join('\n\n').length >= MIN_PASSAGE_CHARS) {
      out.push({ path: span.path, text: buffer.join('\n\n') });
      buffer = [];
    }
  }
  // The tail is kept even when it is short: it is the end of a section, and
  // there is nothing after it to merge it with. Dropping it would lose text.
  if (buffer.length) out.push({ path: span.path, text: buffer.join('\n\n') });
  return out;
}

export function buildCompendiumView(text: string, opts: CompendiumViewOptions): CompendiumView {
  const maxSectionChars = opts.maxSectionChars ?? DEFAULT_MAX_SECTION_CHARS;
  const found = parseSections(text);
  const topLevel = topLevelOf(found);

  // A heading without a title is legal Markdown and carries no name to show:
  // listed, it renders as a bare "- ", which reads as an entry that went
  // missing rather than as one that never had a name. Its text is unaffected —
  // the section keeps its own span either way.
  const outline: OutlineEntry[] = topLevel === undefined
    ? []
    : found
      .filter(s => s.level >= topLevel && s.title)
      .map(s => ({ title: s.title, depth: s.level - topLevel }));

  const query = (opts.query ?? '').trim();

  if (query) {
    const all = bodySpans(text, found, topLevel).flatMap(span => passagesOf(text, span));
    // The heading path is scored with the body: a section called "Lehrpläne und
    // Bildungsstandards" IS the answer to a curriculum question even where its
    // paragraphs never repeat the word. It cannot flood the ranking either —
    // every passage under that heading carries it, so its document frequency
    // rises and its IDF falls.
    const ranked = rankBm25(all.map(p => `${p.path.join(' ')}\n${p.text}`), query);
    const passages = ranked.hits
      .slice(0, opts.maxPassages ?? DEFAULT_MAX_PASSAGES)
      .map(hit => ({ path: all[hit.index]!.path, text: capText(all[hit.index]!.text, maxSectionChars).text }));
    return {
      outline,
      sections: [],
      passages,
      unmatchedTerms: ranked.unmatched,
      charCount: text.length,
      // A selection, whatever it selected — including when it selected nothing.
      // This is what tells a caller that "absent from the answer" is not
      // "absent from the text".
      truncated: true,
    };
  }

  const tops = topLevel === undefined ? [] : found.filter(s => s.level === topLevel);
  const ranges: { title: string; from: number; to: number }[] = [];
  const firstStart = tops[0]?.headingStart ?? text.length;
  if (firstStart > 0) ranges.push({ title: '', from: 0, to: firstStart });
  for (const top of tops) ranges.push({ title: top.title, from: top.headingStart, to: top.end });

  const sections = ranges
    .map(range => {
      const capped = capText(text.slice(range.from, range.to), maxSectionChars);
      return { title: range.title, text: capped.text, truncated: capped.truncated };
    })
    .filter(section => section.text);

  return {
    outline,
    sections,
    passages: [],
    unmatchedTerms: [],
    charCount: text.length,
    truncated: sections.some(s => s.truncated),
  };
}
