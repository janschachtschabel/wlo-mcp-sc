/**
 * tools/curation-public.ts – "filed, but not visible yet" (chatbot team, S9,
 * 2026-11-14).
 *
 * Filing a material in a public collection does not make the material public.
 * A person who files an upload and then looks at the collection as a visitor
 * finds nothing — and concludes the filing failed. The filing previews say it
 * before the key: which of the materials are not public, in a sentence and as
 * data.
 *
 * What is known is the NEGATIVE: `isPublic: false` on the DTO means nobody but
 * its owner (and whoever was granted) reads the record. `true` is not a
 * promise of the opposite (measured 2026-11-14: a collection shared with ONE
 * account reports `true` to that account), so nothing is said about it.
 *
 * No tool sets permissions: making a material public stays with the editors,
 * through the submission.
 */

import type { WloToolResult } from '../apps/register.js';

/** The one sentence, for one material or several. `total` = how many materials the call files. */
export function notPublicNote(notPublic: number, total: number): string {
  if (total === 1) {
    return 'Das Material ist noch nicht öffentlich: in der Sammlung sehen es andere erst nach der Freigabe durch die Redaktion '
      + '(einreichen mit wlo_submit_content). An diesem Vorgang ändert das nichts.';
  }
  return `${notPublic} der ${total} Materialien sind noch nicht öffentlich: in der Sammlung sehen andere sie erst nach der Freigabe `
    + 'durch die Redaktion (einreichen mit wlo_submit_contents). An diesem Vorgang ändert das nichts.';
}

/** The same as data, beside the preview a client renders itself: `confirm.preview.notPublic: [{nodeId, public: false}]`. */
export function withNotPublic(reply: WloToolResult, nodeIds: string[]): WloToolResult {
  const sc = reply.structuredContent as { confirm?: { preview?: Record<string, unknown> } | null } | undefined;
  if (!nodeIds.length || !sc?.confirm?.preview) return reply;
  return {
    ...reply,
    structuredContent: {
      ...sc,
      confirm: { ...sc.confirm, preview: { ...sc.confirm.preview, notPublic: nodeIds.map(nodeId => ({ nodeId, public: false as const })) } },
    },
  };
}
