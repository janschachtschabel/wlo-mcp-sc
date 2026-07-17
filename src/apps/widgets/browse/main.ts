/**
 * browse/main.ts – W2 browser entry (bundled+inlined by build.mjs).
 *
 * Seeds the tree from the tool output (get_subject_portals or
 * browse_collection_tree), then drives the pure reducer: a disclosure click
 * expands/collapses; an expand that needs data calls
 * `browse_collection_tree` via the host bridge and dispatches the result. The
 * open path is persisted via the host's widget state and restored on reload.
 * Uses the portable `createHost` bridge (window.openai in ChatGPT, the standard
 * `ui/*` bridge elsewhere) so drill-down works across MCP-Apps hosts. Excluded
 * from tsc (uses DOM globals + the host bridge).
 */

import { renderBrowse } from './render.js';
import { browseReducer, initialBrowseState, type BrowseAction, type BrowseState } from './state.js';
import { resolveLocale, t } from '../shared/strings.js';
import { createHost } from '../shared/host.js';
import type { BrowseNode } from '../shared/types.js';

const host = createHost();

let state: BrowseState = initialBrowseState();
let lastOutput: unknown;
// The disclosure node the user last toggled — its button is re-focused after a
// re-render so a keyboard/screen-reader user does not lose their place in the
// tree when innerHTML is rebuilt (WCAG 2.4.3).
let focusNodeId: string | null = null;

function toolOutput(): { parent?: string; results?: BrowseNode[] } | undefined {
  return host.toolOutput() as { parent?: string; results?: BrowseNode[] } | undefined;
}

function paint(): void {
  const root = document.getElementById('wlo-root');
  if (!root) return;
  root.innerHTML = renderBrowse(state, resolveLocale(host.locale()));
  if (focusNodeId) {
    const buttons = root.querySelectorAll('.wlo-tree__toggle');
    for (let i = 0; i < buttons.length; i++) {
      if (buttons[i].getAttribute('data-node-id') === focusNodeId) {
        // preventScroll: focus restores the a11y position (WCAG 2.4.3) but must
        // NOT scroll-into-view — the default scroll jerks the host iframe on
        // every expand (flicker + viewport jump, live-observed in ChatGPT).
        (buttons[i] as HTMLElement).focus({ preventScroll: true });
        break;
      }
    }
  }
}

function persist(): void {
  host.setWidgetState({ expanded: state.expanded });
}

async function load(nodeId: string): Promise<void> {
  try {
    const res = await host.callTool('browse_collection_tree', { nodeId, outputFormat: 'json' });
    const sc = res?.structuredContent as { results?: BrowseNode[] } | undefined;
    const children = sc?.results ?? (res?.results as BrowseNode[] | undefined) ?? [];
    state = browseReducer(state, { type: 'loaded', nodeId, children });
  } catch {
    state = browseReducer(state, { type: 'error', nodeId });
  }
  paint();
  persist();
}

function dispatch(action: BrowseAction): void {
  state = browseReducer(state, action);
  paint();
  persist();
  if (action.type === 'expand' && state.loadingId === action.nodeId) void load(action.nodeId);
}

function initFromOutput(): void {
  const out = toolOutput();
  const roots = out?.results ?? [];
  const rootLabel = out && !out.parent ? t(resolveLocale(host.locale()), 'subjectPortals') : '';
  state = browseReducer(initialBrowseState(), { type: 'init', roots, rootLabel });

  // Best-effort restore of the previously open path (re-fetches children).
  const saved = (host.widgetState() as { expanded?: string[] } | undefined)?.expanded ?? [];
  for (const id of saved) state = browseReducer(state, { type: 'expand', nodeId: id });
  paint();
  for (const id of saved) if (state.childrenById[id] === undefined) void load(id);
}

function onUpdate(): void {
  // Host updates (new output, theme/locale) are NOT toggle interactions — a
  // stale focusNodeId here would steal the user's focus on every repaint
  // (WCAG 2.4.3 restore is only for the render the user's own click caused).
  focusNodeId = null;
  document.documentElement.lang = resolveLocale(host.locale());
  const out = toolOutput();
  if (out !== lastOutput) {
    lastOutput = out;
    initFromOutput();
  } else {
    paint(); // theme/locale change only — keep the drill-down state
  }
}

document.addEventListener('click', event => {
  const toggle = (event.target as HTMLElement | null)?.closest?.('.wlo-tree__toggle');
  if (!toggle) return;
  const nodeId = toggle.getAttribute('data-node-id');
  if (!nodeId) return;
  focusNodeId = nodeId; // restore focus to this toggle after the re-render
  const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
  dispatch({ type: isExpanded ? 'collapse' : 'expand', nodeId });
});

host.onUpdate(onUpdate);
onUpdate();
