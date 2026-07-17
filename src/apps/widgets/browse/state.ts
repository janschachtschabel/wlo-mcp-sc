/**
 * browse/state.ts – Pure state reducer for the W2 interactive browse widget.
 *
 * The widget lazily drills into the collection tree: expanding a not-yet-loaded
 * node marks it `loading`, which signals the browser entry (`main.ts`) to call
 * `browse_collection_tree` and dispatch `loaded` (or `error`) with the result.
 * Keeping this logic pure makes the drill-down deterministic and unit-testable;
 * `main.ts` owns only the DOM + `window.openai` glue. DOM-free.
 */

import type { BrowseNode } from '../shared/types.js';

export interface BrowseState {
  /** Optional heading (e.g. "Fachportale") shown above the tree. */
  rootLabel: string;
  /** Top-level nodes currently shown. */
  roots: BrowseNode[];
  /** nodeIds on the open path. */
  expanded: string[];
  /** Lazily fetched children, keyed by parent nodeId. */
  childrenById: Record<string, BrowseNode[]>;
  /** nodeId whose children are being fetched (drives the spinner + the fetch). */
  loadingId: string | null;
}

export type BrowseAction =
  | { type: 'init'; roots: BrowseNode[]; rootLabel?: string }
  | { type: 'expand'; nodeId: string }
  | { type: 'collapse'; nodeId: string }
  | { type: 'loaded'; nodeId: string; children: BrowseNode[] }
  | { type: 'error'; nodeId: string };

export function initialBrowseState(): BrowseState {
  return { rootLabel: '', roots: [], expanded: [], childrenById: {}, loadingId: null };
}

/**
 * True when a toolOutput update is the ECHO of a drill-down THIS widget
 * requested itself. ChatGPT mirrors a widget-initiated `callTool` result back
 * as a new toolOutput (openai:set_globals, live-observed 2026-07-17); treating
 * that echo as a fresh seed re-initialised — and visibly reset — the whole
 * tree. `browse_collection_tree` output carries `parent` = the requested
 * nodeId, so an output whose parent is in the widget's own-loads set is an
 * echo: keep the tree state, never re-init.
 */
export function isOwnDrilldownEcho(output: unknown, selfLoaded: ReadonlySet<string>): boolean {
  const parent = (output as { parent?: unknown } | undefined)?.parent;
  return typeof parent === 'string' && selfLoaded.has(parent);
}

export function browseReducer(state: BrowseState, action: BrowseAction): BrowseState {
  switch (action.type) {
    case 'init':
      return {
        rootLabel: action.rootLabel ?? '',
        roots: action.roots,
        expanded: [],
        childrenById: {},
        loadingId: null,
      };

    case 'expand': {
      const expanded = state.expanded.includes(action.nodeId)
        ? state.expanded
        : [...state.expanded, action.nodeId];
      // Only trigger a fetch when this node's children are not cached yet.
      const needsLoad = state.childrenById[action.nodeId] === undefined;
      return { ...state, expanded, loadingId: needsLoad ? action.nodeId : state.loadingId };
    }

    case 'collapse':
      return {
        ...state,
        expanded: state.expanded.filter(id => id !== action.nodeId),
        loadingId: state.loadingId === action.nodeId ? null : state.loadingId,
      };

    case 'loaded': {
      const expanded = state.expanded.includes(action.nodeId)
        ? state.expanded
        : [...state.expanded, action.nodeId];
      return {
        ...state,
        childrenById: { ...state.childrenById, [action.nodeId]: action.children },
        loadingId: state.loadingId === action.nodeId ? null : state.loadingId,
        expanded,
      };
    }

    case 'error':
      return {
        ...state,
        expanded: state.expanded.filter(id => id !== action.nodeId),
        loadingId: state.loadingId === action.nodeId ? null : state.loadingId,
      };

    default:
      return state;
  }
}
