/**
 * search-results/selection.ts – The "use these" hand-off.
 *
 * Picking several results is only useful if the model can then act on them, so
 * the message names each material AND its nodeId: the content tools resolve a
 * material by id, and a title-only prompt made the model ask for one (live
 * 2026-07-17, browse widget). Pure and DOM-free; the click/state handling lives
 * in `main.ts`.
 */

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
      // Widget state persists ids, not titles; after a host re-mount a title can
      // be missing. The id alone is still actionable — an empty pair of quotes
      // would not be.
      const label = i.title
        ? `${t(locale, 'quoteOpen')}${i.title}${t(locale, 'quoteClose')} `
        : '';
      return `- ${label}(nodeId: ${i.nodeId})`;
    })
    .join('\n');
  return `${t(locale, 'selectionPrompt')}\n${list}\n${t(locale, 'selectionPromptTail')}`;
}
