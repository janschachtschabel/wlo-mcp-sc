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

/** `**Titel**` → `Titel`; the editor bolds a material's title but not a skill's. */
function unwrapEmphasis(text: string): string {
  return text.replace(/^\*{1,2}(.*?)\*{1,2}$/s, '$1').trim();
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
      title: unwrapEmphasis(link[2] ?? ''),
      url: link[3] ?? '',
      nodeId: NODE_ID.exec(body)?.[1] ?? '',
    });
  }
  return refs;
}
