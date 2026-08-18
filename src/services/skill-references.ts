/**
 * services/skill-references.ts – what a SKILL.md points at, read out of the
 * document itself.
 *
 * The WLO editor writes referenced material and follow-up skills into the
 * Markdown as fenced blocks:
 *
 *     ::: wlo-material
 *     ![Titel](…/preview?nodeId=<uuid>)
 *     [**Titel**](<Quelle>) — Lizenz: [CC BY-SA 3.0](…)
 *     :::
 *
 *     ::: ki-skill
 *     [Titel](…/components/render/<uuid>)
 *     :::
 *
 * That is already a manifest — it just sits inside prose. Parsing it HERE rather
 * than leaving it to the model is the whole point: a node id inside a URL inside
 * a Markdown link inside a fenced block is an extraction task, and an extraction
 * task has a failure rate. The block also does not say which id belongs to what
 * — the title link of a material points at the SOURCE, so its id has to come
 * from the preview image, while a skill's id is in the title link. Getting that
 * wrong yields a plausible id for the wrong thing.
 *
 * Costs nothing: the text is already in hand when `get_skill` has read it.
 */

/** A reference a SKILL.md makes to another record. */
export interface SkillReference {
  /** `wlo-material` = teaching material, `ki-skill` = another skill. */
  kind: 'wlo-material' | 'ki-skill';
  title: string;
  /** The title link's target: the source for material, the render page for a skill. */
  url: string;
  /** Empty when the block carries no repository URL (an external link without a preview). */
  nodeId: string;
  /**
   * Character offset of the opening `:::` fence in the document it was parsed
   * from.
   *
   * The one coordinate this parser shares with `markdown-sections.ts`, which is
   * how `skill-registry.ts` decides which section — and therefore which context
   * — a block belongs to. Without it that assignment would need its own block
   * parser, and a second copy of the grammar is the drift this module exists to
   * prevent.
   */
  offset: number;
}

/** `::: <kind>` … `:::`, both fences on their own line. An unclosed block does not match. */
const BLOCK = /^:::[ \t]*(wlo-material|ki-skill)[ \t]*\r?$([\s\S]*?)^:::[ \t]*\r?$/gm;

/**
 * The three URL shapes that carry a node id. Order does not matter — the FIRST
 * occurrence in the block wins, and for a material that is the preview image,
 * which is the record itself rather than the external source.
 */
const NODE_ID = /(?:[?&]nodeId=|\/components\/render\/)([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/;

/** A Markdown link that is NOT an image — the first one is the title link. */
const TITLE_LINK = /(^|[^!])\[([^\]]+)\]\(([^)\s]+)/;

/**
 * A Markdown backslash escape: a backslash before ASCII punctuation means that
 * character literally. Everywhere else the backslash IS the text — `C:\pfad`
 * keeps its slash, `50\%` loses the backslash.
 */
const ESCAPED = /\\([!-/:-@[-`{-~])/g;

/**
 * `**Titel**` → `Titel`, then `Skill\_X` → `Skill_X`.
 *
 * The order is load-bearing. Resolving escapes first turns `\*kein Stern\*` into
 * `*kein Stern*`, and the emphasis pass then strips the very asterisks the
 * author marked as text.
 *
 * The unescape pass was added 2026-08-18 after a live run: the real Optik
 * registry names a skill `Skill\_Qualitätscheck\_Sachrichtigkeit` — the editor
 * escapes the underscores because `_so_` would be italic — and the backslashes
 * reached the output. It matters most in the CHEAP tier, where no record title
 * overrides the block's, which is exactly the tier every collection hit uses.
 */
function plainTitle(text: string): string {
  return text.replace(/^\*{1,2}(.*?)\*{1,2}$/s, '$1').trim().replace(ESCAPED, '$1');
}

export function parseSkillReferences(markdown: string): SkillReference[] {
  const refs: SkillReference[] = [];
  // A regex with /g carries lastIndex between calls; a fresh one per call keeps
  // this function pure for concurrent callers.
  const blocks = new RegExp(BLOCK.source, BLOCK.flags);
  for (let m = blocks.exec(markdown); m; m = blocks.exec(markdown)) {
    const kind = m[1] as SkillReference['kind'];
    const body = m[2] ?? '';
    const link = TITLE_LINK.exec(body);
    if (!link) continue;                       // a block with no link references nothing
    refs.push({
      kind,
      title: plainTitle(link[2] ?? ''),
      url: link[3] ?? '',
      nodeId: NODE_ID.exec(body)?.[1] ?? '',
      offset: m.index,
    });
  }
  return refs;
}
