/**
 * search-results/selection.ts – The "use these" hand-off.
 *
 * Picking several results is only useful if the model can then act on them, so
 * the message names each material AND its nodeId: the content tools resolve a
 * material by id, and a title-only prompt made the model ask for one (live
 * 2026-07-17, browse widget). Pure and DOM-free; the click/state handling lives
 * in `main.ts`.
 */

import { sanitizeTitle } from '../shared/follow-up.js';
import { t, type Locale } from '../shared/strings.js';

export interface SelectedMaterial {
  nodeId: string;
  title: string;
}

/**
 * The user message the "use selected" button injects. Empty for an empty
 * selection, so the caller never sends a meaningless turn.
 */
export function selectionFollowUpPrompt(items: SelectedMaterial[], locale: Locale): string {
  if (items.length === 0) return '';
  const list = items
    .map(i => {
      // Titles are publisher-supplied and this message is injected AS THE USER,
      // so it carries more authority than tool output. Each entry is one line of
      // `- „title“ (nodeId: x)`, which means a line break in a title would forge
      // an extra entry naming an id nobody picked — the same sanitisation the
      // single-tile buttons have applied since 2026-07-28.
      const clean = sanitizeTitle(i.title);
      // Widget state persists ids, not titles; after a host re-mount a title can
      // be missing. The id alone is still actionable — an empty pair of quotes
      // would not be.
      const label = clean
        ? `${t(locale, 'quoteOpen')}${clean}${t(locale, 'quoteClose')} `
        : '';
      return `- ${label}(nodeId: ${i.nodeId})`;
    })
    .join('\n');
  const tail = t(locale, 'selectionPromptTail')
    .replace('{tool}', SELECTION_TOOL)
    .replace('{param}', SELECTION_PARAM);
  return `${t(locale, 'selectionPrompt')}\n${list}\n${tail}`;
}

/**
 * The batch tool the selection message points at. Every single-tile button
 * names its tool so the model continues the flow instead of guessing; this
 * message was the one that did not (audit 2026-07-30). `get_nodes_details`
 * takes `nodeIds` and reports per-id failures rather than failing the batch,
 * which is exactly what a hand-picked list needs.
 */
export const SELECTION_TOOL = 'get_nodes_details';
export const SELECTION_PARAM = 'nodeIds';
