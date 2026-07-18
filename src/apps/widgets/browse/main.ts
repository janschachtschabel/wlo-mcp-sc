/**
 * browse/main.ts – W2 browser entry (bundled+inlined by build.mjs).
 *
 * STATIC pre-expanded tree: seeds once from the tool output (nested children,
 * e.g. browse_collection_tree depth=2), toggles are purely local, and deeper
 * levels go through `host.sendFollowUp` — the conversation runs the next tool
 * call and renders a fresh card. Deliberately NO in-widget tool calls: ChatGPT
 * mirrors widget-initiated results back as new toolOutput (and may re-mount
 * the frame), which reset the tree on every drill-down (live 2026-07-17).
 * Collapse choices persist via the host's widget state. Excluded from tsc
 * (DOM globals + host bridge); behaviour pinned by source-level tests.
 */

import { renderBrowse, askFollowUpPrompt } from './render.js';
import { browseReducer, initialBrowseState, type BrowseState } from './state.js';
import { resolveLocale, t } from '../shared/strings.js';
import { createHost } from '../shared/host.js';
import type { BrowseNode } from '../shared/types.js';

const host = createHost();

let state: BrowseState = initialBrowseState();
let lastOutput: unknown;
// The toggle the user last clicked — re-focused after the innerHTML rebuild so
// keyboard/screen-reader users keep their place (WCAG 2.4.3); one-shot so
// host-driven repaints never steal focus.
let focusNodeId: string | null = null;

function toolOutput(): { parent?: string; results?: BrowseNode[] } | undefined {
  return host.toolOutput() as { parent?: string; results?: BrowseNode[] } | undefined;
}

function paint(): void {
  const root = document.getElementById('wlo-root');
  if (!root) return;
  const locale = resolveLocale(host.locale());
  root.innerHTML = renderBrowse(state, locale, { canFollowUp: host.canFollowUp() });
  if (focusNodeId) {
    const buttons = root.querySelectorAll('.wlo-tree__toggle');
    for (let i = 0; i < buttons.length; i++) {
      if (buttons[i].getAttribute('data-node-id') === focusNodeId) {
        // preventScroll: restore the a11y position WITHOUT scroll-into-view —
        // the default scroll jerked the host iframe (live 2026-07-17).
        (buttons[i] as HTMLElement).focus({ preventScroll: true });
        break;
      }
    }
    focusNodeId = null;
  }
}

function initFromOutput(): void {
  const out = toolOutput();
  const roots = out?.results ?? [];
  const rootLabel = out && !out.parent ? t(resolveLocale(host.locale()), 'subjectPortals') : '';
  const saved = (host.widgetState() as { expanded?: string[] } | undefined)?.expanded;
  state = browseReducer(initialBrowseState(), { type: 'init', roots, rootLabel, savedExpanded: saved });
  paint();
}

function onUpdate(): void {
  focusNodeId = null;
  document.documentElement.lang = resolveLocale(host.locale());
  const out = toolOutput();
  if (out !== lastOutput) {
    lastOutput = out;
    initFromOutput(); // genuinely new data (no self-calls exist) → re-seed
  } else {
    paint(); // theme/locale change only — keep the local expand state
  }
}

document.addEventListener('click', event => {
  const el = event.target as HTMLElement | null;

  // Follow-up button: ask the CONVERSATION to open this collection — the model
  // calls the tool and renders a fresh card (no in-widget fetch).
  const ask = el?.closest?.('.wlo-tree__ask');
  if (ask) {
    // Pass the nodeId (not just the title): the content tools resolve a
    // collection by id — a title-only prompt made the model ask for a Node ID.
    const id = ask.getAttribute('data-node-id') ?? '';
    const title = ask.getAttribute('data-node-title') ?? '';
    host.sendFollowUp(askFollowUpPrompt(title, id, resolveLocale(host.locale())));
    return;
  }

  const toggle = el?.closest?.('.wlo-tree__toggle');
  if (!toggle) return;
  const nodeId = toggle.getAttribute('data-node-id');
  if (!nodeId) return;
  focusNodeId = nodeId;
  state = browseReducer(state, { type: 'toggle', nodeId });
  paint();
  host.setWidgetState({ expanded: state.expanded });
});

host.onUpdate(onUpdate);
onUpdate();
