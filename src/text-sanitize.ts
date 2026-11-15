/**
 * text-sanitize.ts – make foreign text safe to embed in model-facing output.
 *
 * Extracted from `apps/widgets/shared/follow-up.ts` when the server side needed
 * the same rule: a widget module must not be imported by server code (wrong
 * direction, and it would drag the widget i18n table into the server), while
 * duplicating the check would leave two versions to keep in step.
 *
 * The threat is the same wherever the text comes from someone other than the
 * operator: a line break lets a value end the surrounding sentence and open
 * what reads like a fresh instruction block.
 */

/** Cap for an embedded value — long enough to stay readable, short enough not to flood. */
const TEXT_MAX = 120;

/** True for C0/C1 control characters — line breaks and tabs among them. */
function isControl(codePoint: number): boolean {
  return codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f);
}

/**
 * True for characters that render as nothing yet still reach the model, or that
 * reorder what a human sees away from what the model reads. A line break is the
 * loud version of this attack; these are the quiet one — the Unicode tag block
 * in particular encodes a full ASCII sentence that is invisible in every editor
 * and review dialog, so a reviewer approving a title cannot see what they are
 * approving.
 *
 * Only characters with no orthographic job are listed. ZWNJ/ZWJ (U+200C/D) are
 * deliberately absent: Persian and several Indic scripts need them to spell
 * words correctly, and emoji sequences are built from ZWJ. LRM/RLM (U+200E/F)
 * are absent too — they hint direction for mixed-direction text, they cannot
 * override it the way U+202A–U+202E can.
 */
function isInvisible(codePoint: number): boolean {
  return (
    codePoint === 0x200b ||                                 // zero-width space
    (codePoint >= 0x202a && codePoint <= 0x202e) ||         // bidi embedding/override
    (codePoint >= 0x2060 && codePoint <= 0x2064) ||         // word joiner, invisible operators
    (codePoint >= 0x2066 && codePoint <= 0x2069) ||         // bidi isolates
    (codePoint >= 0xfff9 && codePoint <= 0xfffb) ||         // interlinear annotation
    (codePoint >= 0xe0000 && codePoint <= 0xe007f)          // tag block (invisible ASCII)
  );
}

/**
 * Drop invisible characters, flatten control characters to spaces and collapse
 * runs of whitespace — the safety rule, without any length limit.
 *
 * Invisibles are DROPPED rather than turned into spaces: unlike a newline they
 * separate nothing, so replacing them would insert word breaks that were never
 * there.
 *
 * For a SENTENCE assembled from parts that were each capped already — a
 * confirmation preview's action line, say. Capping such a sentence a second time
 * spends the budget on its fixed German prose and truncates the facts the reader
 * is being asked to agree to. For a single foreign VALUE use `sanitizeText`.
 *
 * Written as codepoint checks rather than regex character classes so no control
 * or invisible character has to appear in this source file.
 */
export function flattenText(raw: string): string {
  let flat = '';
  for (const ch of raw ?? '') {
    const cp = ch.codePointAt(0) ?? 0;
    if (isInvisible(cp)) continue;
    flat += isControl(cp) ? ' ' : ch;
  }
  return flat.replace(/\s+/g, ' ').trim();
}

/**
 * `flattenText` plus a length cap (ellipsis when truncated) — for ONE foreign
 * value on its way into model-facing output.
 *
 * The cap comes after the flattening, so padding a value with invisible
 * characters cannot push the readable part past the limit.
 */
export function sanitizeText(raw: string): string {
  const flat = flattenText(raw);
  return flat.length > TEXT_MAX ? `${flat.slice(0, TEXT_MAX).trimEnd()}…` : flat;
}
