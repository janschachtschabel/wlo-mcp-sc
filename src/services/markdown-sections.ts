/**
 * services/markdown-sections.ts – which headings does this Markdown have, and
 * which range of the document belongs to each.
 *
 * Separate from `skill-references.ts` on purpose: that module answers "which
 * `:::` blocks are in here", this one "which sections are in here". Neither
 * knows about skills or registries — the two results are joined by OFFSET in
 * `skill-registry.ts`, which is the only place that knows a block inside a
 * section means the skill belongs to that context.
 *
 * Pure, no I/O, no dependencies. A Markdown library for this would be a package
 * for two regular expressions.
 *
 * What it deliberately does NOT support:
 *
 * - **Setext headings** (`Titel` over `=====`). Not in use in the WLO editor,
 *   and a `-----` under a line is indistinguishable at a glance from a thematic
 *   break — a rule that surprises a curator is worse than one that ignores a
 *   form nobody writes.
 * - **Guessing where an unclosed fence was meant to end.** It swallows the rest
 *   of the document, so a malformed document yields FEWER contexts, never wrong
 *   ones. Inventing structure is the failure that cannot be noticed.
 */

/** One ATX heading and the span of document that belongs under it. */
export interface MarkdownSection {
  /** 1–6, from the number of leading hashes. */
  level: number;
  /** The heading text: closing hash sequence removed, trimmed. May be empty. */
  title: string;
  /** Offset of the `#` that opens the heading line. */
  headingStart: number;
  /** Offset just past the heading line's terminator — where the body begins. */
  bodyStart: number;
  /**
   * Offset of the next heading of the SAME OR HIGHER level, else the end of the
   * document. A lower level does not close a section, so an H2 contains its H3s
   * — which is what makes a sub-context a part of its context rather than its
   * successor.
   */
  end: number;
}

/** `#` to `######`, at most three of indent, and a space is required after the hashes. */
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;

/** An opening code fence, with its optional info string. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * CommonMark's closing sequence: a run of hashes at the end, preceded by a
 * space or by the start of the text. The guard matters — `C#` keeps its hash
 * while `Material ##` does not, and a context nobody can name by the title they
 * see is unaddressable.
 */
const CLOSING_HASHES = /(^|[ \t])#+[ \t]*$/;

export function parseSections(markdown: string): MarkdownSection[] {
  const found: Omit<MarkdownSection, 'end'>[] = [];
  let fenceChar = '';
  let fenceLen = 0;
  let pos = 0;

  for (;;) {
    const nl = markdown.indexOf('\n', pos);
    const lineEnd = nl === -1 ? markdown.length : nl;
    const next = nl === -1 ? markdown.length : nl + 1;
    const line = markdown.slice(pos, lineEnd).replace(/\r$/, '');

    const fence = FENCE.exec(line);
    if (fenceChar) {
      // Only the same character closes, and only at least as long — otherwise a
      // ``` example inside a ~~~ block would end the block it illustrates.
      if (fence && fence[1]![0] === fenceChar && fence[1]!.length >= fenceLen
        && line.slice(line.indexOf(fence[1]!) + fence[1]!.length).trim() === '') {
        fenceChar = '';
        fenceLen = 0;
      }
    } else if (fence) {
      fenceChar = fence[1]![0]!;
      fenceLen = fence[1]!.length;
    } else {
      const heading = HEADING.exec(line);
      if (heading) {
        found.push({
          level: heading[1]!.length,
          title: (heading[2] ?? '').replace(CLOSING_HASHES, '$1').trim(),
          headingStart: pos + line.indexOf('#'),
          bodyStart: next,
        });
      }
    }

    if (nl === -1) break;
    pos = next;
  }

  return found.map((sec, i) => {
    const closer = found.slice(i + 1).find(later => later.level <= sec.level);
    return { ...sec, end: closer ? closer.headingStart : markdown.length };
  });
}
