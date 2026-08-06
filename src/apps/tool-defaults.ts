/**
 * apps/tool-defaults.ts – Uniform descriptor defaults for this server's tools.
 *
 * The reading tools — all but the curation ones — are public OER data with no
 * authentication, so they share two descriptor traits that the Apps-SDK wants
 * declared explicitly:
 *
 *   1. `_meta.securitySchemes: [{ type: 'noauth' }, { type: 'oauth2', … }]` —
 *      the "callable anonymously, and better with a login" declaration (F6),
 *      applied as a DEFAULT: a tool that sets its own scheme at the
 *      registration site keeps it, which is how the curation tools avoid
 *      claiming they are callable without an identity.
 *      The Apps-SDK auth doc shows a top-level
 *      `securitySchemes` descriptor field, but the SDK does not know or
 *      serialise that field (re-verified against @modelcontextprotocol/sdk
 *      1.30.0 on 2026-07-27 — still zero occurrences in the package), so
 *      `_meta.securitySchemes` is the maximum this SDK can emit. Re-check and
 *      emit the top-level field on the next SDK bump.
 *   2. The required tool annotations `destructiveHint` and `openWorldHint` — the
 *      Apps-SDK reference marks `readOnlyHint`/`destructiveHint`/`openWorldHint`
 *      as required (omitting them is a validation error). Every tool already
 *      sets `readOnlyHint: true`; here we fill the two remaining ones with the
 *      read-only defaults (`false`) WITHOUT overriding any explicit per-tool
 *      value (e.g. `get_wikipedia_summary`'s `openWorldHint: true`).
 *   3. The ChatGPT `openai/toolInvocation/invoking|invoked` status strings, by
 *      tool name (the copy table lives in `tool-status.ts`).
 *   4. A human-readable `title` for the plain `server.tool` registrations
 *      (that signature has no title parameter; the Apps SDK expects a title
 *      next to the machine name — TOOL_TITLES below).
 *
 * Applied in ONE place by wrapping the server's two tool-registration methods,
 * so the defaults land on ALL tools — both the `registerWloTool` seam (which
 * calls `registerTool`) and the plain `server.tool` registrations — without
 * churning the ~14 call sites. The wrap only augments the public
 * `RegisteredTool` fields, which `tools/list` reads back at list time.
 */

import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

import { SCOPES } from '../auth/oauth-metadata.js';
import { toolStatusMeta } from './tool-status.js';

/**
 * The declaration for a tool that works BOTH ways.
 *
 * Every read tool is callable anonymously — and a logged-in caller gets more out
 * of it, because the search runs with the rights of a person who also sees
 * material that is not public. `noauth` alone would state only half of that.
 *
 * The mixed form is what OpenAI's own mixed-auth example declares for exactly
 * this case (`authenticated_server_python`, read 2026-08-05): the array lists
 * the schemes a tool ACCEPTS, so naming both says "works without a login, works
 * better with one" rather than "needs a login".
 */
const MIXED_SECURITY_SCHEMES: ReadonlyArray<{ type: 'noauth' } | { type: 'oauth2'; scopes: string[] }> =
  [{ type: 'noauth' }, { type: 'oauth2', scopes: [...SCOPES] }];

/**
 * The declaration for a tool that needs an identity.
 *
 * Exactly two scheme types exist — `noauth` and `oauth2` (measured 2026-08-05
 * against developers.openai.com/apps-sdk/build/auth). The curation tools used
 * to declare `{ type: 'http' }`, borrowed from OpenAPI, and it cost a live
 * afternoon: ChatGPT connected anonymously and then refused every connection
 * that carried a login, because ONE unknown scheme type takes the whole tool
 * list down with it. Nothing appeared in our log — the request was answered
 * correctly; the client simply would not accept the answer.
 *
 * One constant rather than thirteen literals, and the scope comes from the
 * authorization server's own metadata so the two cannot drift apart.
 */
export const OAUTH_SECURITY_SCHEMES: ReadonlyArray<{ type: 'oauth2'; scopes: string[] }> =
  [{ type: 'oauth2', scopes: [...SCOPES] }];

/**
 * Human-readable titles for the tools registered via plain `server.tool`,
 * which has no title parameter (the Apps SDK expects a title next to the
 * machine name, and the submission scan reads it). The `registerWloTool` seam
 * sets its titles at the registration site — those win via the `??=` below, so
 * this table only needs the plain-registered tools.
 */
const TOOL_TITLES: Readonly<Record<string, string>> = {
  get_collection_contents: 'WLO Sammlungsinhalte',
  search_wlo_within_collection: 'WLO Suche in Sammlung',
  get_node_details: 'WLO Inhaltsdetails',
  get_nodes_details: 'WLO Inhaltsdetails (Bulk)',
  lookup_wlo_vocabulary: 'WLO Vokabular',
  search_wlo_topic_pages: 'WLO Themenseiten-Suche',
  wlo_health_check: 'WLO Verbindungstest',
  get_wikipedia_summary: 'Wikipedia-Zusammenfassung',
  get_compendium_text: 'WLO Kompendiumtext',
  get_wlo_content_text: 'WLO Volltext',
  get_url_text: 'Volltext einer Webseite',
  lookup_wlo_publishers: 'WLO Anbieter',
  get_related_content: 'WLO Verwandte Inhalte',
  get_node_breadcrumb: 'WLO Pfadnavigation',
  get_collection_stats: 'WLO Sammlungsstatistik',
  find_wlo_skills: 'WLO Skills',
  wlo_auth_status: 'WLO Anmeldestatus',
};

function applyDefaults(tool: RegisteredTool, name: unknown): RegisteredTool {
  const statusMeta = typeof name === 'string' ? toolStatusMeta(name) : {};
  // The mixed form is the default, not a rule: a curation tool declares its own
  // scheme at the registration site and must not be overwritten with a claim
  // that it is callable without an identity.
  const existing = (tool._meta as { securitySchemes?: unknown } | undefined)?.securitySchemes;
  tool._meta = {
    ...(tool._meta ?? {}),
    securitySchemes: existing ?? MIXED_SECURITY_SCHEMES,
    ...statusMeta,
  };
  if (typeof name === 'string') tool.title ??= TOOL_TITLES[name];
  // Defaults first, explicit per-tool annotations last so they win (readOnlyHint
  // on every tool, openWorldHint:true on get_wikipedia_summary).
  tool.annotations = {
    destructiveHint: false,
    openWorldHint: false,
    ...(tool.annotations ?? {}),
  };
  return tool;
}

/**
 * Patch `server.tool` and `server.registerTool` so every tool registered after
 * this call carries the uniform read-only defaults. Call once, right after the
 * server is constructed and before any tool is registered.
 */
export function applyReadOnlyToolDefaults(server: McpServer): void {
  // `tool`/`registerTool` are heavily overloaded generics; type the bound
  // originals as plain variadic functions so the wrappers forward `...args`
  // verbatim (runtime behaviour is unchanged — only descriptor defaults added).
  const origTool = server.tool.bind(server) as (...args: unknown[]) => RegisteredTool;
  const origRegisterTool = server.registerTool.bind(server) as (...args: unknown[]) => RegisteredTool;

  // args[0] is the tool name for both signatures — used to look up its status copy.
  server.tool = ((...args: unknown[]): RegisteredTool =>
    applyDefaults(origTool(...args), args[0])) as unknown as McpServer['tool'];

  server.registerTool = ((...args: unknown[]): RegisteredTool =>
    applyDefaults(origRegisterTool(...args), args[0])) as unknown as McpServer['registerTool'];
}
