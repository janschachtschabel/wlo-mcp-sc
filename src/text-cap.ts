/**
 * text-cap.ts – One truncation rule, shared.
 *
 * Cutting a text for a model is not `slice()`: the caller must be told what it
 * is missing, and a cut mid-word reads as a typo rather than as an omission.
 * Extracted from the private `cap()` in `services/content-text.ts` when a second
 * caller needed the identical rule — two copies of a truncation marker drift
 * silently, and the drift is only ever visible to whoever reads the output.
 */

export interface CappedText {
  text: string;
  /** Length BEFORE truncation, so the caller can see what it is missing. */
  charCount: number;
  truncated: boolean;
}

/**
 * Exported because one caller cannot use `capText` at all: the anonymous file
 * download in `wlo-node-text.ts` caps BYTES on a stream, not characters on a
 * string. It still has to end with the same words — it had drifted to
 * `'\n\n…[gekürzt]'`, the ellipsis on the other side of the bracket, which is
 * the smallest possible illustration of why this module exists.
 */
export const TRUNCATION_MARKER = '\n\n[…gekürzt]';
/**
 * Only move a cut back to a word boundary when that boundary sits in the last
 * fifth. Honouring an earlier one would throw away most of what fits — a text
 * whose only space is near the start would come back nearly empty.
 */
const MIN_BOUNDARY_RATIO = 0.8;

/**
 * Cut to at most `maxChars`, preferring a word boundary — the cutting half of
 * the rule, without a marker.
 *
 * Exported because the marker is the part that depends on the medium: a text
 * block can afford `\n\n[…gekürzt]`, while the confirmation preview
 * (`services/write/change-set.ts`) is line-oriented and a newline there would
 * forge a second change line. Two markers, one cut — the alternative was a
 * second copy of the boundary logic, which is exactly how this module's own
 * docstring says truncation rules drift.
 */
export function cutAtWordBoundary(text: string, maxChars: number): string {
  const slice = text.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > maxChars * MIN_BOUNDARY_RATIO ? slice.slice(0, lastSpace) : slice;
  return cut.trimEnd();
}

/** Cut to `maxChars` at a word boundary where possible, and disclose that it happened. */
export function capText(text: string, maxChars: number): CappedText {
  const full = text.trim();
  if (full.length <= maxChars) {
    return { text: full, charCount: full.length, truncated: false };
  }
  return { text: `${cutAtWordBoundary(full, maxChars)}${TRUNCATION_MARKER}`, charCount: full.length, truncated: true };
}
