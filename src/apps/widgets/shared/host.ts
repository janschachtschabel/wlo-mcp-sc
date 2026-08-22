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

/**
 * How long a widget waits for its FIRST tool result before it gives up and lets
 * the renderer speak (ms).
 *
 * Same reasoning as CALL_TIMEOUT_MS: a host that never delivers must not leave
 * the widget in a skeleton for ever — and a tool that FAILS delivers nothing
 * either (`toolError` returns `isError` with no structuredContent), so this is
 * also how long a failed call would show a skeleton before falling back to what
 * the widget showed before this existed.
 *
 * Both directions therefore matter, and the number is measured rather than
 * guessed. Live against the deployed server, 2026-08-21, every widget-bound
 * tool: `get_topic_page_content` 2 240 ms is the slowest, `get_url_text` on a
 * heavy Wikipedia page 1 568 ms, a full `search_wlo_all` 1 287 ms. 30 s is
 * ~13× the slowest observed call and still comfortably inside one upstream
 * budget (`WLO_FETCH_TIMEOUT_MS`, 20 s), so it cannot expire mid-call — which
 * would put the false "Keine Treffer gefunden." back on screen for exactly the
 * slow calls the loading state exists for.
 */
const OUTPUT_GRACE_MS = 30_000;

export interface WidgetHost {
  /** Latest tool output (structuredContent) — from window.openai or the standard bridge. */
  toolOutput(): unknown;
  /**
   * The result's widget-only `_meta` (Apps-SDK `toolResponseMetadata`) — the
   * channel a host hands to the widget and never to the model. Carries the
   * server-inlined previews for restricted records. ChatGPT surface only:
   * the standard `ui/*` bridge defines no metadata notification, so there it
   * answers undefined and the widget degrades to the lock glyph.
   */
  toolMeta(): unknown;
  /**
   * Whether a first tool result is still expected — the shells' cue to render
   * the loading state rather than a renderer's empty state.
   *
   * "A result arrived" is a term of its own, never inferred from the payload
   * being empty: under the standard bridge it is the `tool-result` notification
   * (a result whose structuredContent is empty has still arrived). ChatGPT
   * offers no such event — `window.openai.toolOutput` is null until the call
   * completes — so there the value IS the only available signal.
   */
  awaitingOutput(): boolean;
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
  /** Whether the host can inject a follow-up user message (ChatGPT extension). */
  canFollowUp(): boolean;
  /** Ask the host to send a follow-up user message; no-op when unsupported. */
  sendFollowUp(prompt: string): void;
}

interface OpenAi {
  toolOutput?: unknown;
  toolResponseMetadata?: unknown;
  widgetState?: unknown;
  locale?: string;
  callTool?: (name: string, args: Record<string, unknown>) => Promise<{ structuredContent?: unknown; results?: unknown }>;
  setWidgetState?: (state: unknown) => void;
  sendFollowUpMessage?: (args: { prompt: string }) => unknown;
}

export function createHost(): WidgetHost {
  const w = window as unknown as { openai?: OpenAi; parent?: Window };
  const oai = (): OpenAi | undefined => w.openai;

  const updateCbs: Array<() => void> = [];
  const notify = (): void => { for (const cb of updateCbs) cb(); };

  // Standard-bridge state, only used when window.openai is absent.
  let stdOutput: unknown;
  /** Explicit "a tool-result notification arrived", independent of its value. */
  let stdReceived = false;
  /** Set once the grace window closes, so the wait cannot last for ever. */
  let graceExpired = false;
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
      if (inbound.kind === 'tool-result') { stdOutput = inbound.output; stdReceived = true; notify(); }
      else if (inbound.kind === 'call-response') {
        const entry = pending.get(inbound.id);
        if (entry) { pending.delete(inbound.id); settleCallResponse(inbound, entry); }
      }
    });
    // Announce readiness so a standard host starts delivering notifications.
    postToParent({ jsonrpc: '2.0', method: 'ui/initialize', params: {} }, true);
  }

  /**
   * Has NOTHING arrived yet? `!= null` on purpose: ChatGPT reports a pending
   * call as null and an absent property as undefined, and both mean "nothing
   * yet". The standard bridge answers from its explicit arrival flag instead.
   */
  const nothingArrived = (): boolean => (oai() ? oai()?.toolOutput == null : !stdReceived);

  // Close the wait even if nothing ever arrives. The repaint, however, only
  // when it changes something: notifying unconditionally rebuilt every widget's
  // DOM (innerHTML) 30 s after EVERY mount, destroying keyboard focus and any
  // selection on a screen that had long since rendered its results.
  setTimeout(() => {
    const wasWaiting = nothingArrived();
    graceExpired = true;
    if (wasWaiting) notify();
  }, OUTPUT_GRACE_MS);

  return {
    toolOutput: () => oai()?.toolOutput ?? stdOutput,
    toolMeta: () => oai()?.toolResponseMetadata,
    awaitingOutput: () => !graceExpired && nothingArrived(),
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
    canFollowUp: () => typeof oai()?.sendFollowUpMessage === 'function',
    sendFollowUp: (prompt) => {
      // ChatGPT-only extension: inject a follow-up USER message so the model
      // runs the next tool call itself (the stable alternative to in-widget
      // callTool, whose result echo reset widget state — live 2026-07-17).
      // The standard MCP-Apps bridge has no such method → deliberate no-op;
      // render layers must gate their buttons on canFollowUp().
      try { oai()?.sendFollowUpMessage?.({ prompt }); } catch { /* host without support */ }
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
