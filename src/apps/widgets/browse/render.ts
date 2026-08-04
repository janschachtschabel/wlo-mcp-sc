/**
 * browse/render.ts – W2 body: the STATIC pre-expanded tree.
 *
 * Pure `BrowseState → HTML string`. Nodes WITH children get an accessible
 * disclosure button (`aria-expanded` + `data-node-id`) whose toggle is purely
 * local; childless collections get — when the host supports it — a follow-up
 * button (`wlo-tree__ask`) that asks the CONVERSATION to open the collection
 * (the model then calls the tool and renders a fresh card). No in-widget
 * fetching, no loading states (see state.ts rationale). DOM-free, unit-tested.
 */

import { escapeHtml } from '../shared/escape.js';
import { followUpPrompt } from '../shared/follow-up.js';
import { safeHref } from '../shared/safe-url.js';
import { t, type Locale } from '../shared/strings.js';
import type { BrowseNode } from '../shared/types.js';
import type { BrowseState } from './state.js';

export interface BrowseRenderOptions {
  /** Host can inject a follow-up user message (ChatGPT extension) — only then
   *  are ask-buttons rendered; otherwise they would be dead controls. */
  canFollowUp?: boolean;
}

/**
 * The follow-up user message the "Inhalte anzeigen" button injects. Delegates
 * to the shared builder, which carries the nodeId (the tools resolve a
 * collection by id, not title), names the tool, and sanitises the title.
 */
export function askFollowUpPrompt(title: string, nodeId: string, locale: Locale): string {
  return followUpPrompt('contents', title, nodeId, locale);
}

function openLink(node: BrowseNode, locale: Locale): string {
  const href = safeHref(node.url || node.topicPageUrl || node.contentUrl);
  if (!href) return '';
  const label = `${t(locale, 'open')}: ${node.title || ''}`;
  return `<a class="wlo-tree__open" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(label)}">↗</a>`;
}

function askButton(node: BrowseNode, locale: Locale): string {
  const label = `${t(locale, 'askContents')}: ${node.title || ''}`;
  return (
    `<button type="button" class="wlo-tree__ask" data-node-id="${escapeHtml(node.nodeId)}" ` +
    `data-node-title="${escapeHtml(node.title || '')}" aria-label="${escapeHtml(label)}">` +
    `${escapeHtml(t(locale, 'askContents'))}</button>`
  );
}

function renderNode(node: BrowseNode, state: BrowseState, locale: Locale, opts: BrowseRenderOptions): string {
  const id = node.nodeId;
  const title = escapeHtml(node.title || '');

  // A leaf (content item) is just a titled open link — no disclosure.
  if (node.nodeType !== 'collection') {
    const href = safeHref(node.url || node.contentUrl);
    const titleHtml = href
      ? `<a class="wlo-tree__leaf" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${title}</a>`
      : `<span class="wlo-tree__leaf">${title}</span>`;
    return `<li class="wlo-tree__node">${titleHtml}</li>`;
  }

  const children = state.childrenById[id] ?? [];
  // The server capped this branch. Say so in the tree, not only in the text the
  // model reads — an unmarked branch reads as "this is everything".
  const more = node.hasMoreChildren
    ? `<span class="wlo-tree__more">${escapeHtml(t(locale, 'treeMore'))}</span>`
    : '';

  // Childless collection: no local toggle — offer the follow-up button (when
  // the host supports it) plus the external open link.
  if (children.length === 0) {
    return (
      `<li class="wlo-tree__node"><div class="wlo-tree__row">` +
      `<span class="wlo-tree__label">${title}</span>${more}` +
      `${opts.canFollowUp ? askButton(node, locale) : ''}${openLink(node, locale)}` +
      `</div></li>`
    );
  }

  const expanded = state.expanded.includes(id);
  // `aria-controls` is a SPACE-SEPARATED list of ids, so a node id carrying
  // whitespace (or any other character an id may not hold) would silently point
  // the toggle at two elements that do not exist. Escaping it for HTML is not
  // enough — the id has to be reduced to id-safe characters on both sides.
  const regionId = `wlo-region-${id.replace(/[^\w-]/g, '_')}`;
  // A branch node could only be unfolded, never opened: its own materials were
  // unreachable without typing. It now carries the same ask-button as a leaf.
  const row =
    `<div class="wlo-tree__row">` +
    `<button class="wlo-tree__toggle" type="button" aria-expanded="${expanded ? 'true' : 'false'}"` +
    `${expanded ? ` aria-controls="${escapeHtml(regionId)}"` : ''} data-node-id="${escapeHtml(id)}">` +
    `<span class="wlo-tree__caret" aria-hidden="true">${expanded ? '▾' : '▸'}</span>${title}` +
    `</button>${more}${opts.canFollowUp ? askButton(node, locale) : ''}${openLink(node, locale)}` +
    `</div>`;

  const region = expanded
    ? `<div class="wlo-tree__children" id="${escapeHtml(regionId)}">` +
      `<ul class="wlo-tree" role="list">${children.map(c => renderNode(c, state, locale, opts)).join('')}</ul>` +
      `</div>`
    : '';

  return `<li class="wlo-tree__node">${row}${region}</li>`;
}

export function renderBrowse(state: BrowseState, locale: Locale = 'de', opts: BrowseRenderOptions = {}): string {
  const label = state.rootLabel
    ? `<h1 class="wlo-browse__title">${escapeHtml(state.rootLabel)}</h1>`
    : '';

  if (state.roots.length === 0) {
    return `<div class="wlo-browse">${label}<p class="wlo-empty">${escapeHtml(t(locale, 'noResults'))}</p></div>`;
  }

  const tree = `<ul class="wlo-tree" role="list">${state.roots.map(n => renderNode(n, state, locale, opts)).join('')}</ul>`;
  return `<div class="wlo-browse">${label}${tree}</div>`;
}
