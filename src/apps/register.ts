/**
 * apps/register.ts – The single Apps-SDK registration seam.
 *
 * `registerWloTool` is the ONE place that attaches Apps-SDK metadata to a tool:
 * `outputSchema` (→ structuredContent contract), `annotations`, and the widget
 * `_meta` keys. It isolates all `_meta.ui.*` wiring (design Approach B, risk R2)
 * so the exact key names live in exactly one file. The handler returns BOTH
 * `content` (text, back-compat for non-Apps clients) AND `structuredContent`
 * (read by the model and by the widget).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';

/** Result shape a WLO tool handler returns (a CallToolResult subset). */
export interface WloToolResult {
  content: { type: 'text'; text: string }[];
  /** Required on a NON-error result when the tool defines an outputSchema. */
  structuredContent?: unknown;
  /** Widget-only metadata (never shown to the model). */
  _meta?: Record<string, unknown>;
  isError?: boolean;
}

/** MCP tool annotations (subset used here; mirrors the SDK `ToolAnnotations`). */
export interface WloToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  title?: string;
}

export interface WloToolDef {
  name: string;
  /** Human-readable title (Apps-SDK). */
  title: string;
  /** "Use this when… Do not use for…" — drives correct model selection. */
  description: string;
  inputSchema: z.ZodRawShape;
  /** zod schema → advertised `outputSchema` + structuredContent validation. */
  outputSchema?: z.ZodTypeAny;
  annotations?: WloToolAnnotations;
  /** `ui://…` widget resource this tool renders (when widgets are built). */
  widgetUri?: string;
  /**
   * Declare that the RENDERED widget may call this tool from inside the iframe
   * (e.g. the browse widget's drill-down). Emits the current MCP-Apps standard
   * `_meta.ui.visibility: ["model","app"]` (app-visible → callable from the
   * widget via `tools/call`, still model-visible) plus the legacy
   * `ui.widgetAccessible` / `openai/widgetAccessible` compatibility aliases, so
   * any MCP-Apps host — current or older ChatGPT — permits the widget→host call.
   */
  widgetAccessible?: boolean;
  handler: (args: any, extra: unknown) => Promise<WloToolResult>;
}

/**
 * Map a widget resource URI to the tool-descriptor `_meta` keys MCP-Apps hosts
 * read: the standard `ui.resourceUri` plus the ChatGPT `openai/outputTemplate`
 * compatibility alias (see the design doc's Apps-SDK References). When the tool
 * is widget-callable, the standard `ui.widgetAccessible` + its `openai/*` alias
 * are added on both paths.
 */
function widgetMeta(def: WloToolDef): Record<string, unknown> {
  const ui: Record<string, unknown> = { resourceUri: def.widgetUri };
  const meta: Record<string, unknown> = { ui, 'openai/outputTemplate': def.widgetUri };
  if (def.widgetAccessible) {
    // Current standard: app-visibility is what lets the widget `tools/call` this
    // tool; keep model-visibility so the model can still invoke it directly.
    ui.visibility = ['model', 'app'];
    // Legacy ChatGPT compatibility aliases (older runtimes).
    ui.widgetAccessible = true;
    meta['openai/widgetAccessible'] = true;
  }
  return meta;
}

export function registerWloTool(server: McpServer, def: WloToolDef): void {
  const config: Record<string, unknown> = {
    title: def.title,
    description: def.description,
    inputSchema: def.inputSchema,
  };
  if (def.outputSchema) config.outputSchema = def.outputSchema;
  if (def.annotations) config.annotations = def.annotations;
  if (def.widgetUri) config._meta = widgetMeta(def);

  // The SDK's registerTool is heavily generic; the WloToolDef contract keeps
  // handler args untyped (design decision), so the boundary is cast once here.
  server.registerTool(
    def.name,
    config as never,
    (async (args: unknown, extra: unknown) => def.handler(args, extra)) as never,
  );
}
