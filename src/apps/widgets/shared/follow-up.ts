/**
 * follow-up.ts – The ONE place a widget button becomes a chat message.
 *
 * A widget must not call tools itself: ChatGPT mirrors a widget-initiated
 * result back as new toolOutput and may re-mount the frame, which resets local
 * state (live 2026-07-17, browse tree). Buttons therefore inject a user
 * message, and every such message needs two things to continue a flow:
 *   - the NODE ID, because the content tools resolve a material by id (a
 *     title-only prompt made the model answer "I need a Node ID"), and
 *   - the TOOL NAME, where a tool performs the action, so the model continues
 *     the flow instead of guessing. Model tasks (summarize, simplify, derive
 *     exercises) name none, because none exists.
 *
 * All four widgets build their messages here. Three separate builders had
 * already drifted — the same German sentence lived under two string keys — and
 * each additional copy would have needed its own sanitisation.
 *
 * Pure, DOM-free, unit-tested.
 */

import { t, type Locale, type StringKey } from './strings.js';

/** Actions a TOOL performs — what a result tile can offer. */
export type ToolFollowUpAction = 'contents' | 'topicPage' | 'text' | 'related';
/** Actions the MODEL performs on a text already on screen — the reading view. */
export type ModelFollowUpAction = 'summarize' | 'simplify' | 'exercises';
/** What a button offers to do next. */
export type FollowUpAction = ToolFollowUpAction | ModelFollowUpAction;

/** The tool that performs an action, where one does. Pinned by test. */
export const FOLLOW_UP_TOOLS: Readonly<Record<ToolFollowUpAction, string>> = {
  contents: 'get_collection_contents',
  topicPage: 'get_topic_page_content',
  text: 'get_wlo_content_text',
  related: 'get_related_content',
};

/**
 * Explicit action → string key. A template literal with `as never` compiled
 * even when a key was missing and rendered the word "undefined" into the
 * prompt; this table makes a missing key a compile error.
 */
const ASK_KEY: Readonly<Record<FollowUpAction, StringKey>> = {
  contents: 'followUp_contents',
  topicPage: 'followUp_topicPage',
  text: 'followUp_text',
  related: 'followUp_related',
  summarize: 'followUp_summarize',
  simplify: 'followUp_simplify',
  exercises: 'followUp_exercises',
};

/** Cap on the title inside a prompt — long enough to identify, short enough
 *  that it cannot crowd out the id or flood the turn. */
const TITLE_MAX = 120;

/** True for C0/C1 control characters — line breaks and tabs among them. */
function isControl(codePoint: number): boolean {
  return codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f);
}

/**
 * Make a publisher-supplied title safe to embed in an injected USER message.
 *
 * Titles come from spidered external sources (`ccm:replicationsource`), and the
 * message is injected with more authority than tool output. Line breaks and
 * control characters would let a title pose as a separate instruction block, so
 * they collapse to spaces and the length is capped (audit finding 2026-07-28).
 *
 * Written as a codepoint check rather than a regex character class so no
 * control character has to appear in this source file.
 */
export function sanitizeTitle(raw: string): string {
  let flat = '';
  for (const ch of raw ?? '') {
    flat += isControl(ch.codePointAt(0) ?? 0) ? ' ' : ch;
  }
  flat = flat.replace(/\s+/g, ' ').trim();
  return flat.length > TITLE_MAX ? `${flat.slice(0, TITLE_MAX).trimEnd()}…` : flat;
}

/** The user message a follow-up button injects. */
export function followUpPrompt(
  action: FollowUpAction,
  title: string,
  nodeId: string,
  locale: Locale,
): string {
  const clean = sanitizeTitle(title);
  // Without a usable title the id alone still identifies the material; empty
  // quotes would say nothing.
  const what = clean
    ? `${t(locale, 'quoteOpen')}${clean}${t(locale, 'quoteClose')} (nodeId: ${nodeId})`
    : `(nodeId: ${nodeId})`;
  const ask = `${t(locale, ASK_KEY[action])} ${what}`;
  // Model tasks name no tool — none performs them.
  const tool = (FOLLOW_UP_TOOLS as Partial<Record<FollowUpAction, string>>)[action];
  return tool ? `${ask}. ${t(locale, 'followUpTool').replace('{tool}', tool)}` : ask;
}
