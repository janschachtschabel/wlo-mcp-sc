/**
 * browse/render.ts – W2 body: the interactive drill-down tree.
 *
 * Pure `BrowseState → HTML string`. Expandable collections are rendered as
 * accessible disclosure buttons (`aria-expanded` + `data-node-id`); `main.ts`
 * delegates their clicks to the reducer and `browse_collection_tree`. A
 * disclosure pattern (buttons) is used rather than a full ARIA tree so keyboard
 * operability is correct by default. DOM-free and unit-tested.
 */

import { escapeHtml } from '../shared/escape.js';
import { safeHref } from '../shared/safe-url.js';
import { t, type Locale } from '../shared/strings.js';
import type { BrowseNode } from '../shared/types.js';
import type { BrowseState } from './state.js';

function openLink(node: BrowseNode, locale: Locale): string {
  const href = safeHref(node.url || node.topicPageUrl || node.contentUrl);
  if (!href) return '';
  const label = `${t(locale, 'open')}: ${node.title || ''}`;
  return `<a class="wlo-tree__open" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(label)}">↗</a>`;
}

function renderNode(node: BrowseNode, state: BrowseState, locale: Locale): string {
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

  const expanded = state.expanded.includes(id);
  const loading = state.loadingId === id;
  const children = state.childrenById[id];
  const regionId = `wlo-region-${id}`;

  const row =
    `<div class="wlo-tree__row">` +
    `<button class="wlo-tree__toggle" type="button" aria-expanded="${expanded ? 'true' : 'false'}"` +
    `${expanded ? ` aria-controls="${escapeHtml(regionId)}"` : ''} data-node-id="${escapeHtml(id)}">` +
    `<span class="wlo-tree__caret" aria-hidden="true">${expanded ? '▾' : '▸'}</span>${title}` +
    `</button>${openLink(node, locale)}` +
    `</div>`;

  let region = '';
  if (expanded) {
    let inner: string;
    if (loading) {
      inner = `<p class="wlo-tree__loading">${escapeHtml(t(locale, 'loading'))}</p>`;
    } else if (children && children.length) {
      inner = `<ul class="wlo-tree" role="list">${children.map(c => renderNode(c, state, locale)).join('')}</ul>`;
    } else if (children) {
      inner = `<p class="wlo-empty">${escapeHtml(t(locale, 'noResults'))}</p>`;
    } else {
      inner = '';
    }
    region = `<div class="wlo-tree__children" id="${escapeHtml(regionId)}">${inner}</div>`;
  }

  return `<li class="wlo-tree__node">${row}${region}</li>`;
}

export function renderBrowse(state: BrowseState, locale: Locale = 'de'): string {
  const label = state.rootLabel
    ? `<h1 class="wlo-browse__title">${escapeHtml(state.rootLabel)}</h1>`
    : '';

  if (state.roots.length === 0) {
    return `<div class="wlo-browse">${label}<p class="wlo-empty">${escapeHtml(t(locale, 'noResults'))}</p></div>`;
  }

  const tree = `<ul class="wlo-tree" role="list">${state.roots.map(n => renderNode(n, state, locale)).join('')}</ul>`;
  return `<div class="wlo-browse">${label}${tree}</div>`;
}
