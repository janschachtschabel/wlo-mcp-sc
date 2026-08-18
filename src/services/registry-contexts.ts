/**
 * services/registry-contexts.ts – how a registry document's headings group its
 * skills, and which prose is the editorial instruction for each group.
 *
 * Pure: it takes the document text and the `::: ki-skill` blocks that
 * `skill-references.ts` already found, and answers three questions — which
 * contexts exist, which block belongs to which, and what the editors wrote about
 * each. No I/O, no knowledge of the repository.
 *
 * Split out of `skill-registry.ts` rather than added to it: that module already
 * owns finding the registry record, reading it, resolving heads and capping the
 * catalogue. "What does the document's outline mean" is a separate reason to
 * change — the outline convention is editorial and moves independently of how a
 * registry is located.
 *
 * ── The one rule that decides everything ────────────────────────────────────
 *
 * A CONTEXT is a section of level 2 or 3 **with a non-empty title**. Anything
 * else is TRANSPARENT: what sits in it belongs to the nearest NAMED context
 * above it, and if there is none, to the general part.
 *
 * One rule, two right answers. An untitled `##` at top level lands in the
 * general part; an untitled `###` inside a named H2 lands in that H2 — which is
 * in both cases where the editor put it. The alternative, dropping untitled
 * sections, would have swallowed their skills without a trace.
 *
 * A non-empty title is required because the title IS the address:
 * `get_skill_registry` is called with `context: "…"`. Offering a nameless group
 * would promise a drill-down nobody can perform.
 */

import { parseSections, type MarkdownSection } from './markdown-sections.js';

/** A named group of skills, addressable by `path`. */
export interface RegistryContext {
  /** The heading text. Never empty — that is what makes it a context. */
  title: string;
  /** 2 = context, 3 = sub-context. */
  level: 2 | 3;
  /** `"H2"` or `"H2/H3"` — the name a caller passes as `context`. */
  path: string;
  /** What the editors wrote about this group. Absent rather than empty. */
  instruction?: string;
  /** nodeIds declared here, in document order. */
  skills: string[];
  /**
   * Where this section sits in the document: from its heading to its end, so a
   * caller asking for one context gets that slice instead of the whole file.
   * An H2's range spans its sub-contexts, which is what someone asking for the
   * parent wants to read.
   */
  range: { start: number; end: number };
}

/** What belongs to no named context and therefore applies always. */
export interface RegistryGeneral {
  /** The prose before the first context, plus that of untitled top-level sections. */
  instruction?: string;
  /** nodeIds outside every named context. */
  skills: string[];
}

/**
 * Contexts one answer carries.
 *
 * Not a limit on what an editorial team may write — a document with more is
 * reported as capped rather than quietly shortened. 50 is far past any real
 * outline; the largest registry on staging has 28 sections, one per skill, and
 * that is the shape this feature exists to replace.
 */
export const REGISTRY_CONTEXT_MAX = 50;

/** One `::: ki-skill` block, as much of it as the outline needs to know. */
export interface ContextBlock {
  offset: number;
  /** Empty for a block that names no readable record — it still occupies a place. */
  nodeId: string;
}

export interface ContextLayout {
  contexts: RegistryContext[];
  general: RegistryGeneral;
  /** Parallel to the `blocks` argument: the path of each block's context. */
  paths: (string | undefined)[];
  /** Set when the document outlines more contexts than this answer lists. */
  truncated?: { listed: number; found: number };
}

const isNamed = (s: MarkdownSection): boolean =>
  (s.level === 2 || s.level === 3) && s.title !== '';

/**
 * @param blocks the SKILL blocks, in document order — `paths` comes back
 *   parallel to this list, so it must hold exactly what becomes a catalogue
 *   entry.
 * @param blockOffsets where prose stops, which is a different question: every
 *   `:::` block ends an instruction, including a `::: wlo-material` one that is
 *   no skill and one past the entry cap. Defaults to the skill blocks. Without
 *   it a material block between a heading and the first skill put its fence
 *   lines and its URL verbatim into the editors' instruction, spending the
 *   900-character budget on a link (measured 2026-08-18).
 */
export function layoutContexts(
  markdown: string,
  blocks: readonly ContextBlock[],
  blockOffsets: readonly number[] = blocks.map(b => b.offset),
): ContextLayout {
  const sections = parseSections(markdown);
  const named = sections.filter(isNamed);

  /**
   * The innermost named section spanning an offset.
   *
   * The last match in document order IS the innermost: a named H2 spans its H3s
   * (see `MarkdownSection.end`), so where both match, the H3 comes later.
   */
  const ownerAt = (offset: number): MarkdownSection | undefined => {
    let owner: MarkdownSection | undefined;
    for (const sec of named) if (sec.headingStart < offset && offset < sec.end) owner = sec;
    return owner;
  };

  const pathOf = (sec: MarkdownSection): string => {
    if (sec.level === 2) return sec.title;
    const parent = ownerAt(sec.headingStart);
    return parent ? `${parent.title}/${sec.title}` : sec.title;
  };

  /**
   * The prose a section contributes: from its body to whichever comes first —
   * its first skill block, the next heading of any level, or its end.
   *
   * The "next heading" bound keeps an H2 without a block of its own from pulling
   * its sub-context's heading and prose into its own instruction. The "first
   * block" bound is the editorial rule: text after a block belongs to the skill
   * it follows, not to the group.
   */
  const instructionSpan = (sec: MarkdownSection): string => {
    const nextHeading = sections.find(s => s.headingStart > sec.headingStart);
    const firstBlock = blockOffsets.find(o => o >= sec.bodyStart && o < sec.end);
    const limit = Math.min(
      sec.end,
      firstBlock ?? Number.POSITIVE_INFINITY,
      nextHeading?.headingStart ?? Number.POSITIVE_INFINITY,
    );
    return markdown.slice(sec.bodyStart, Math.max(sec.bodyStart, limit)).trim();
  };

  const harvest = (secs: MarkdownSection[]): string | undefined =>
    secs.map(instructionSpan).filter(Boolean).join('\n\n') || undefined;

  const owners = blocks.map(b => ownerAt(b.offset));
  const idsOwnedBy = (sec: MarkdownSection | undefined): string[] =>
    blocks.filter((b, i) => owners[i] === sec && b.nodeId).map(b => b.nodeId);

  // EVERY named section is a context, including one that holds no skill yet.
  //
  // The first draft required a block, on the argument that offering an empty
  // group promises a drill-down returning nothing. A live run against the real
  // Optik document on 2026-08-18 overturned it: the editors had written
  // `## Browserplugin` with its instruction and no skills yet — filling a group
  // after creating it is how they work. Under the old rule that heading was
  // absent from the catalogue AND answered "unknown" when named, which is a
  // false claim about a document anyone can read.
  //
  // It also settles a second way: a purely grouping parent (its skills sit in
  // its sub-contexts) is already listed with a count of zero. Listing that zero
  // and hiding a leaf's zero was the same number treated two ways.
  //
  // `skills` stays innermost-owned, so a parent and its child never count the
  // same skill twice — what a parent holds is listed one line below it.
  const listed = named.slice(0, REGISTRY_CONTEXT_MAX);

  const contexts: RegistryContext[] = listed.map(sec => {
    // The section's own prose plus that of every untitled section nested
    // directly in it — the transparency rule applied to text rather than skills.
    const nested = sections.filter(s => !isNamed(s) && ownerAt(s.headingStart) === sec);
    const instruction = harvest([sec, ...nested]);
    return {
      title: sec.title,
      level: sec.level === 3 ? 3 : 2,
      path: pathOf(sec),
      ...(instruction ? { instruction } : {}),
      skills: idsOwnedBy(sec),
      range: { start: sec.headingStart, end: sec.end },
    };
  });

  // Some documents open before any heading; that region has no section to hang
  // on, so it is read as a span of its own up to the first heading or block.
  const preamble = markdown.slice(0, Math.min(
    sections[0]?.headingStart ?? markdown.length,
    blocks[0]?.offset ?? Number.POSITIVE_INFINITY,
  )).trim();
  const loose = sections.filter(s => !isNamed(s) && !ownerAt(s.headingStart));
  const generalText = [preamble, harvest(loose) ?? ''].filter(Boolean).join('\n\n');

  return {
    contexts,
    general: {
      ...(generalText ? { instruction: generalText } : {}),
      skills: idsOwnedBy(undefined),
    },
    paths: owners.map(o => (o ? pathOf(o) : undefined)),
    ...(named.length > listed.length
      ? { truncated: { listed: listed.length, found: named.length } }
      : {}),
  };
}

/**
 * What a caller asked for, and what they get when the ask does not land.
 *
 * `unknown` and `ambiguous` are kept apart although every caller treats them the
 * same way — fall back to the full answer, then explain. Only the sentence
 * differs, and it differs in the one part that helps: which names exist versus
 * which two the guess could have meant.
 */
export type ContextResolution =
  | { kind: 'all' }
  | { kind: 'found'; context: RegistryContext; parent?: RegistryContext; children: RegistryContext[] }
  | { kind: 'unknown'; available: string[] }
  | { kind: 'ambiguous'; paths: string[] }
  /**
   * A name was given, but the document has no outline to match it against.
   *
   * Neither `unknown` (that would blame the caller for a document with no
   * headings) nor `all` (the caller did ask for something). It is its own
   * outcome because it used to be NEITHER: `resolveContext` answered `all`, and
   * both callers re-derived the difference themselves — with different
   * conditions. `get_skill_registry` excused the reserved word `all`,
   * `subjectRegistryText` did not, so `skillContext: "all"` on a flat registry
   * answered that "all" had failed. One decision, made once, is the fix.
   */
  | { kind: 'no_contexts'; asked: string };

/** Case, surrounding space and inner runs of space are not part of a name. */
const normalize = (s: string): string => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('de');

/**
 * Resolve the name a caller passed against a registry's outline.
 *
 * The one place this rule lives. Six tools accept a context name, and six copies
 * of the normalisation and the ambiguity rule are exactly the drift this corner
 * of the codebase already keeps five guards against.
 *
 * Never throws and never picks between candidates: a miss comes back named, and
 * the caller answers it with everything plus an explanation.
 */
export function resolveContext(
  contexts: readonly RegistryContext[],
  wanted: string | undefined,
): ContextResolution {
  const want = normalize(wanted ?? '');
  // `all` and the empty ask mean everything, outline or not — the reserved word
  // is never a miss.
  if (!want || want === 'all') return { kind: 'all' };
  // No outline means there is nothing to miss — but the caller did name
  // something, and an answer that cannot tell the two apart is one every caller
  // has to reconstruct.
  if (contexts.length === 0) return { kind: 'no_contexts', asked: (wanted ?? '').trim() };

  const byPath = contexts.filter(c => normalize(c.path) === want);
  // An exact path beats a title that repeats under several parents: someone who
  // types the full name means the context that carries it.
  const hits = byPath.length ? byPath : contexts.filter(c => normalize(c.title) === want);

  if (hits.length === 0) return { kind: 'unknown', available: contexts.map(c => c.path) };
  if (hits.length > 1) return { kind: 'ambiguous', paths: hits.map(c => c.path) };

  const context = hits[0]!;
  const cut = context.path.lastIndexOf('/');
  return {
    kind: 'found',
    context,
    // The parent comes along because its instruction governs this group too.
    ...(cut > 0
      ? (() => {
        const parent = contexts.find(c => c.path === context.path.slice(0, cut));
        return parent ? { parent } : {};
      })()
      : {}),
    children: contexts.filter(c => c.path.startsWith(`${context.path}/`)),
  };
}
