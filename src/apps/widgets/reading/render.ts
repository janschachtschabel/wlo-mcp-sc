/**
 * reading/render.ts – W5 body: a readable long text (material full text or
 * editorial compendium prose).
 *
 * Pure `ReadingPayload → HTML string`. The text is rendered through the narrow
 * Markdown subset (untrusted publisher content, escaped first). Below it sit
 * follow-up buttons that hand the CONVERSATION a request about this exact
 * material — a widget must not call tools itself (ChatGPT mirrors the result
 * back as new toolOutput and re-mounts the frame; see browse/state.ts).
 * DOM-free and unit-tested.
 */

import { escapeHtml } from '../shared/escape.js';
import { followUpPrompt } from '../shared/follow-up.js';
import { renderMarkdown } from '../shared/markdown.js';
import { safeHref } from '../shared/safe-url.js';
import { t, type Locale, type StringKey } from '../shared/strings.js';

export interface ReadingPayload {
  nodeId?: string;
  title?: string;
  text?: string;
  /** 'repository' | 'external-extraction' | 'none' — provenance, always shown. */
  source?: string;
  sourceUrl?: string | null;
  charCount?: number;
  truncated?: boolean;
  reason?: string;
}

export interface ReadingRenderOptions {
  /** Only render follow-up buttons when the host can inject a user message. */
  canFollowUp?: boolean;
}

/** The follow-up actions offered under a text. Keys map to `strings.ts`. */
export const READING_ACTIONS = ['summarize', 'simplify', 'exercises'] as const;
export type ReadingAction = (typeof READING_ACTIONS)[number];

/**
 * The user message a follow-up button injects. Delegates to the shared builder,
 * which carries the nodeId (the content tools resolve a material by id) and
 * sanitises the publisher-supplied title.
 */
export function readingFollowUpPrompt(
  action: ReadingAction,
  title: string,
  nodeId: string,
  locale: Locale,
): string {
  return followUpPrompt(action, title, nodeId, locale);
}

/** Explicit action → button-label key, so a missing key is a compile error. */
const ACTION_LABEL_KEY: Readonly<Record<ReadingAction, StringKey>> = {
  summarize: 'actionLabel_summarize',
  simplify: 'actionLabel_simplify',
  exercises: 'actionLabel_exercises',
};

/** Explicit miss-reason → string key; an unknown reason gets the generic text. */
const REASON_KEY: Readonly<Record<string, StringKey>> = {
  access_denied: 'reasonAccessDenied',
  extraction_failed: 'reasonExtractionFailed',
  node_not_found: 'reasonNodeNotFound',
  no_text_no_url: 'reasonNoText',
};

function reasonText(reason: string | undefined, locale: Locale): string {
  return t(locale, REASON_KEY[reason ?? ''] ?? 'reasonNoText');
}

export function renderReading(
  payload: ReadingPayload | undefined,
  locale: Locale = 'de',
  opts: ReadingRenderOptions = {},
): string {
  const title = payload?.title || '';
  const head = title ? `<h1 class="wlo-reading__title">${escapeHtml(title)}</h1>` : '';

  // Provenance is a fact row, not a footnote: someone reusing the text needs to
  // know whether it came from the repository or from the linked page.
  const src = payload?.source;
  const href = safeHref(payload?.sourceUrl ?? '');
  const originLabel = src === 'repository'
    ? t(locale, 'originRepository')
    : src === 'external-extraction'
      ? t(locale, 'originExternal')
      : '';
  const origin = originLabel
    ? `<p class="wlo-reading__origin">${escapeHtml(t(locale, 'sourceLabel'))}: ${escapeHtml(originLabel)}` +
      (href ? ` — <a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t(locale, 'openContent'))}</a>` : '') +
      `</p>`
    : '';

  if (!payload?.text) {
    // Empty state names the cause and what it means — never a blank panel.
    return (
      `<article class="wlo-reading">${head}` +
      `<p class="wlo-empty">${escapeHtml(reasonText(payload?.reason, locale))}</p>` +
      `</article>`
    );
  }

  const truncated = payload.truncated
    ? `<p class="wlo-reading__note">${escapeHtml(t(locale, 'truncatedNote'))}</p>`
    : '';

  const actions = opts.canFollowUp && payload.nodeId
    ? `<div class="wlo-reading__actions">` +
      `<h2 class="wlo-reading__actionsTitle">${escapeHtml(t(locale, 'actionsTitle'))}</h2>` +
      `<ul class="wlo-reading__actionList" role="list">` +
      READING_ACTIONS.map(a =>
        `<li><button type="button" class="wlo-reading__action" data-action="${a}" ` +
        `data-node-id="${escapeHtml(payload.nodeId ?? '')}" data-node-title="${escapeHtml(title)}">` +
        `${escapeHtml(t(locale, ACTION_LABEL_KEY[a]))}</button></li>`,
      ).join('') +
      `</ul></div>`
    : '';

  return (
    `<article class="wlo-reading">${head}${origin}${truncated}` +
    `<div class="wlo-reading__body">${renderMarkdown(payload.text)}</div>` +
    `${actions}</article>`
  );
}
