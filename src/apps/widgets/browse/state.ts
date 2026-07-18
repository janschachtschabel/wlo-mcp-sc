/**
 * browse/state.ts – Pure state for the STATIC browse tree.
 *
 * Redesigned 2026-07-17 (user-approved): the widget no longer fetches inside
 * the iframe. ChatGPT mirrors widget-initiated `callTool` results back as new
 * toolOutput (and may re-mount the frame), which reset the tree on every
 * drill-down — live-observed as flicker + vanishing expansions, and not
 * fixable without depending on undocumented host behaviour. Instead the tree
 * renders PRE-EXPANDED from the data the tool call already delivered
 * (nested `children`, e.g. browse_collection_tree depth=2); toggles are purely
 * local, and deeper levels are reached via a follow-up-message button so the
 * MODEL runs the next tool call and renders a fresh card. DOM-free.
 */

import type { BrowseNode } from '../shared/types.js';

export interface BrowseState {
  /** Optional heading (e.g. "Fachportale") shown above the tree. */
  rootLabel: string;
  /** Top-level nodes currently shown. */
  roots: BrowseNode[];
  /** nodeIds currently open (local UI state only). */
  expanded: string[];
  /** Children per parent nodeId, seeded once from the nested tool output. */
  childrenById: Record<string, BrowseNode[]>;
}

export type BrowseAction =
  | { type: 'init'; roots: BrowseNode[]; rootLabel?: string; savedExpanded?: string[] }
  | { type: 'toggle'; nodeId: string };

export function initialBrowseState(): BrowseState {
  return { rootLabel: '', roots: [], expanded: [], childrenById: {} };
}

/** Walk nested `children` into the flat map; returns every parent id found. */
function collectChildren(nodes: BrowseNode[], into: Record<string, BrowseNode[]>): string[] {
  const parents: string[] = [];
  for (const n of nodes) {
    const kids = n.children ?? [];
    if (kids.length && n.nodeId) {
      into[n.nodeId] = kids;
      parents.push(n.nodeId, ...collectChildren(kids, into));
    }
  }
  return parents;
}

export function browseReducer(state: BrowseState, action: BrowseAction): BrowseState {
  switch (action.type) {
    case 'init': {
      const childrenById: Record<string, BrowseNode[]> = {};
      const parents = collectChildren(action.roots, childrenById);
      // Pre-expanded by default (an opened tree, per the design decision); the
      // user's own saved collapse choices (widget state) win when present.
      const expanded = action.savedExpanded
        ? action.savedExpanded.filter(id => parents.includes(id))
        : parents;
      return { rootLabel: action.rootLabel ?? '', roots: action.roots, expanded, childrenById };
    }

    case 'toggle': {
      const expanded = state.expanded.includes(action.nodeId)
        ? state.expanded.filter(id => id !== action.nodeId)
        : [...state.expanded, action.nodeId];
      return { ...state, expanded };
    }

    default:
      return state;
  }
}
