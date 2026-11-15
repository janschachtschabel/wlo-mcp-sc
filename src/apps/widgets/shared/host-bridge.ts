/**
 * host-bridge.ts – Pure message helpers for the standard MCP-Apps `ui/*` bridge.
 *
 * A widget must run in ChatGPT (proprietary `window.openai`) AND any other
 * MCP-Apps host (the standard `ui/*` JSON-RPC bridge over postMessage). This file
 * holds the DOM-FREE, unit-tested parts of that bridge: building a `tools/call`
 * request and classifying an inbound host message. The DOM/postMessage glue that
 * uses them lives in `host.ts` (excluded from tsc, verified in a live host).
 */

/** A JSON-RPC 2.0 `tools/call` request for the standard bridge. */
export function rpcToolCall(id: number, name: string, args: Record<string, unknown>): {
  jsonrpc: '2.0'; id: number; method: 'tools/call'; params: { name: string; arguments: Record<string, unknown> };
} {
  return { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } };
}

export type Inbound =
  | { kind: 'tool-result'; output: unknown }
  | { kind: 'tool-input'; input: unknown }
  | { kind: 'call-response'; id: number; result: unknown; error?: unknown }
  | { kind: 'unknown' };

/**
 * Settle a pending `tools/call` promise from its JSON-RPC response: reject on a
 * JSON-RPC error (so the widget shows its error state instead of treating an
 * error as an empty result), otherwise resolve with the result. Pure, so the
 * DOM glue in `host.ts` stays a thin dispatcher.
 */
export function settleCallResponse(
  response: { result?: unknown; error?: unknown },
  settlers: { resolve: (result: unknown) => void; reject: (reason: unknown) => void },
): void {
  if (response.error !== undefined) settlers.reject(new Error(errorMessage(response.error)));
  else settlers.resolve(response.result);
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === 'string' && m) return m;
  }
  return 'Tool call failed';
}

/**
 * Classify an inbound postMessage from a standard `ui/*` host: a tool-result or
 * tool-input notification (carrying `structuredContent`), or a JSON-RPC response
 * to a `tools/call` we sent (matched later by `id`). Anything else → `unknown`.
 */
export function parseInbound(data: unknown): Inbound {
  if (!data || typeof data !== 'object') return { kind: 'unknown' };
  const m = data as {
    method?: string;
    params?: { structuredContent?: unknown; toolOutput?: unknown; toolInput?: unknown };
    id?: number; result?: unknown; error?: unknown;
  };
  if (m.method === 'ui/notifications/tool-result') {
    return { kind: 'tool-result', output: m.params?.structuredContent ?? m.params?.toolOutput ?? m.params };
  }
  if (m.method === 'ui/notifications/tool-input') {
    return { kind: 'tool-input', input: m.params?.structuredContent ?? m.params?.toolInput ?? m.params };
  }
  if (typeof m.id === 'number' && (m.result !== undefined || m.error !== undefined)) {
    return { kind: 'call-response', id: m.id, result: m.result, error: m.error };
  }
  return { kind: 'unknown' };
}
