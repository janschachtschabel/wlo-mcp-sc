/**
 * host.ts – Portable widget↔host bridge (DOM glue; excluded from tsc, bundled by
 * esbuild, verified in a live host like the widget `main.ts` entries).
 *
 * `createHost()` hides the ChatGPT-vs-standard split behind one `WidgetHost`:
 *  - under ChatGPT it delegates to the proprietary `window.openai` surface
 *    (`toolOutput`/`widgetState`/`locale`/`callTool`/`setWidgetState`) and the
 *    `openai:set_globals` DOM event;
 *  - otherwise it speaks the MCP-Apps STANDARD `ui/*` bridge over postMessage —
 *    reading tool output from `ui/notifications/tool-result`, invoking tools with
 *    a `tools/call` JSON-RPC request to the parent frame, and pushing state via
 *    `ui/update-model-context`.
 * This keeps the same widget code portable across MCP-Apps hosts, not ChatGPT-only.
 * The pure request/response shaping lives in `host-bridge.ts` (unit-tested).
 */

import { parseInbound, rpcToolCall, settleCallResponse } from './host-bridge.js';

/** Fail an unanswered standard-bridge tool call after this long (ms) so the
 *  widget can show its error state instead of spinning forever. */
const CALL_TIMEOUT_MS = 15_000;

export interface WidgetHost {
  /** Latest tool output (structuredContent) — from window.openai or the standard bridge. */
  toolOutput(): unknown;
  /** Persisted widget state (window.openai only; undefined under the standard bridge). */
  widgetState(): unknown;
  /** Host locale hint, if any. */
  locale(): string | undefined;
  /** Register a callback fired whenever tool output / globals change. */
  onUpdate(cb: () => void): void;
  /** Invoke a tool from inside the widget (drill-down). Requires widgetAccessible. */
  callTool(name: string, args: Record<string, unknown>): Promise<{ structuredContent?: unknown; results?: unknown }>;
  /** Persist widget-scoped state across re-renders / reloads. */
  setWidgetState(state: unknown): void;
}

interface OpenAi {
  toolOutput?: unknown;
  widgetState?: unknown;
  locale?: string;
  callTool?: (name: string, args: Record<string, unknown>) => Promise<{ structuredContent?: unknown; results?: unknown }>;
  setWidgetState?: (state: unknown) => void;
}

export function createHost(): WidgetHost {
  const w = window as unknown as { openai?: OpenAi; parent?: Window };
  const oai = (): OpenAi | undefined => w.openai;

  const updateCbs: Array<() => void> = [];
  const notify = (): void => { for (const cb of updateCbs) cb(); };

  // Standard-bridge state, only used when window.openai is absent.
  let stdOutput: unknown;
  let nextId = 0;
  let hostOrigin: string | undefined; // pinned from the first accepted message
  const pending = new Map<number, { resolve: (result: unknown) => void; reject: (reason: unknown) => void }>();
  // Outbound messages (other than the initial ui/initialize) raised before the
  // host origin is known — held so a widget-state or tool-call payload is never
  // broadcast to '*' (any framing origin). Flushed once the origin is pinned.
  const outbox: object[] = [];

  const rawPost = (msg: object): void => {
    try { (w.parent ?? window).postMessage(msg, hostOrigin ?? '*'); } catch { /* no reachable parent */ }
  };

  const postToParent = (msg: object, isInitialize = false): void => {
    // ui/initialize is sent before any inbound message, so it must go with '*'.
    // Everything else waits for the pinned origin instead of leaking to '*'.
    if (hostOrigin === undefined && !isInitialize) { outbox.push(msg); return; }
    rawPost(msg);
  };

  if (oai()) {
    window.addEventListener('openai:set_globals', notify as EventListener);
  } else {
    window.addEventListener('message', (event: MessageEvent) => {
      // Trust only messages from the host (our parent frame); ignore any other
      // window/opener that holds a handle to this iframe — otherwise a framing
      // page could inject forged tool output or resolve a pending call.
      if (event.source !== w.parent) return;
      if (hostOrigin === undefined && event.origin && event.origin !== 'null') {
        hostOrigin = event.origin;
        for (const m of outbox.splice(0)) rawPost(m); // origin known → flush held messages
      }
      const inbound = parseInbound(event.data);
      if (inbound.kind === 'tool-result') { stdOutput = inbound.output; notify(); }
      else if (inbound.kind === 'call-response') {
        const entry = pending.get(inbound.id);
        if (entry) { pending.delete(inbound.id); settleCallResponse(inbound, entry); }
      }
    });
    // Announce readiness so a standard host starts delivering notifications.
    postToParent({ jsonrpc: '2.0', method: 'ui/initialize', params: {} }, true);
  }

  return {
    toolOutput: () => oai()?.toolOutput ?? stdOutput,
    widgetState: () => oai()?.widgetState,
    locale: () => oai()?.locale,
    onUpdate: (cb) => { updateCbs.push(cb); },
    setWidgetState: (state) => {
      const api = oai();
      if (api?.setWidgetState) { api.setWidgetState(state); return; }
      // Widget-state persistence is a ChatGPT-only extension (window.openai).
      // The standard MCP-Apps bridge has no state method — ui/update-model-context
      // expects model-visible `{content: […]}`, not widget state — so this is a
      // deliberate no-op there: UI state simply lives in memory for the mount.
    },
    callTool: (name, args) => {
      const api = oai();
      if (api?.callTool) return api.callTool(name, args);
      const id = ++nextId;
      const p = new Promise<{ structuredContent?: unknown; results?: unknown }>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (result: unknown) => void, reject });
        // Reject an unanswered call so the widget leaves its loading state.
        setTimeout(() => { if (pending.delete(id)) reject(new Error('Tool call timed out')); }, CALL_TIMEOUT_MS);
      });
      postToParent(rpcToolCall(id, name, args));
      return p;
    },
  };
}
