/**
 * text-line.ts – keeping repository-supplied values from forging lines in
 * the line-oriented text answers.
 *
 * Split out of `formatter.ts` (audit 2026-11-05) so the skill-catalogue
 * renderer can use `oneLine` without importing the formatter that imports it.
 */

/**
 * Collapse line breaks so a value cannot break out of its line.
 *
 * The text format below is line-oriented — `## title` opens a record, `Key: value`
 * carries a field — and every value in it is repository-supplied: titles,
 * descriptions, publisher names, server-side `_DISPLAYNAME` labels, URLs. A
 * newline in any of them opened a second, fabricated record with its own nodeId
 * and its own `Lizenz:` line, and a forged licence is precisely the claim a
 * teacher acts on. This is not sanitizing (the text stays as it is, it is data —
 * see `text-sanitize.ts` for the elevated-authority boundary); it is the renderer
 * protecting its own delimiters.
 *
 * Exported because several tools render their own line-oriented text instead of
 * going through `renderToText` (the collection tree, the Fachportal list, the
 * Themenseiten listing, the swimlane outline). They have the same delimiters and
 * therefore need the same protection — one implementation, not four.
 */
export function oneLine(value: string): string {
  // NEL, LINE SEPARATOR and PARAGRAPH SEPARATOR too: many readers break a line
  // there, and a title carrying one forged the next line just the same
  // (chatbot team, 2026-11-14).
  return value.replace(/\s*[\r\n\u0085\u2028\u2029]+\s*/g, ' ');
}

/**
 * The `nodeId:` line, saying when the id names a REFERENCE rather than a record.
 *
 * Both ids are stated, because both are needed and for different things: either
 * one loads the material, only the original may be written to, and only the
 * original resolves a skill's companion files without a second lookup.
 *
 * Shared rather than repeated: the skill tools have rendered this sentence since
 * before ordinary results could, and one wording for one fact is the point — a
 * caller should not have to learn that "(Verknüpfung; Original: …)" and some
 * second phrasing mean the same thing.
 *
 * `originalId` equal to `nodeId` is treated as no reference at all. Search
 * results carry the DTO field, which is simply absent on an original, while the
 * skill catalogue derives its own from `ccm:original`, which points at the
 * record itself. One rule absorbs both.
 */
export function nodeIdLine(nodeId: string, originalId?: string): string {
  return originalId && originalId !== nodeId
    ? `nodeId: ${nodeId} (Verknüpfung; Original: ${originalId})`
    : `nodeId: ${nodeId}`;
}
