/**
 * apps/tool-status.ts – Per-tool invocation status strings (ChatGPT UX polish).
 *
 * ChatGPT shows a short label while a tool runs and after it finishes, read from
 * the OpenAI-extension `_meta` keys `openai/toolInvocation/invoking` and
 * `openai/toolInvocation/invoked` (each ≤ 64 chars; no MCP-standard equivalent).
 * They are stamped onto every tool by name via `applyReadOnlyToolDefaults`
 * (`tool-defaults.ts`), so the copy lives in one readable table here.
 *
 * German copy — WLO's audience is German-speaking (matching the widget/launcher
 * copy). A host that is not ChatGPT ignores these `openai/*` keys.
 */

/** Max length the Apps-SDK allows for each status string. */
export const TOOL_STATUS_MAX = 64;

interface ToolStatus {
  invoking: string;
  invoked: string;
}

/** Tool name → {invoking, invoked}. Keep each string ≤ TOOL_STATUS_MAX. */
export const TOOL_STATUS: Readonly<Record<string, ToolStatus>> = {
  search_wlo_all: { invoking: 'WirLernenOnline wird durchsucht…', invoked: 'Ergebnisse bereit' },
  search_wlo_content: { invoking: 'Inhalte werden gesucht…', invoked: 'Inhalte gefunden' },
  search_wlo_collections: { invoking: 'Sammlungen werden gesucht…', invoked: 'Sammlungen gefunden' },
  search_wlo_within_collection: { invoking: 'Sammlung wird durchsucht…', invoked: 'Ergebnisse bereit' },
  search_wlo_topic_pages: { invoking: 'Themenseiten werden gesucht…', invoked: 'Themenseiten gefunden' },
  get_collection_contents: { invoking: 'Sammlung wird geladen…', invoked: 'Sammlung geladen' },
  get_subject_portals: { invoking: 'Fachportale werden geladen…', invoked: 'Fachportale geladen' },
  browse_collection_tree: { invoking: 'Sammlung wird geöffnet…', invoked: 'Geladen' },
  get_topic_page_content: { invoking: 'Themenseite wird geladen…', invoked: 'Themenseite geladen' },
  get_node_details: { invoking: 'Details werden geladen…', invoked: 'Details geladen' },
  get_nodes_details: { invoking: 'Details werden geladen…', invoked: 'Details geladen' },
  get_related_content: { invoking: 'Verwandte Inhalte werden gesucht…', invoked: 'Verwandte Inhalte gefunden' },
  get_node_breadcrumb: { invoking: 'Pfad wird ermittelt…', invoked: 'Pfad ermittelt' },
  get_collection_stats: { invoking: 'Statistik wird berechnet…', invoked: 'Statistik bereit' },
  lookup_wlo_vocabulary: { invoking: 'Vokabular wird geladen…', invoked: 'Vokabular geladen' },
  lookup_wlo_publishers: { invoking: 'Anbieter werden ermittelt…', invoked: 'Anbieter ermittelt' },
  get_compendium_text: { invoking: 'Kompendiumtext wird geladen…', invoked: 'Text geladen' },
  get_wikipedia_summary: { invoking: 'Wikipedia wird abgefragt…', invoked: 'Zusammenfassung bereit' },
  find_wlo_skills: { invoking: 'Skills werden gesucht…', invoked: 'Skills gefunden' },
  wlo_health_check: { invoking: 'Verbindung wird geprüft…', invoked: 'Status geprüft' },
  search: { invoking: 'WirLernenOnline wird durchsucht…', invoked: 'Ergebnisse bereit' },
  fetch: { invoking: 'Inhalt wird geladen…', invoked: 'Inhalt geladen' },
};

/**
 * The `_meta` status keys for a tool, or `{}` when the tool has no entry (so the
 * caller can spread it unconditionally).
 */
export function toolStatusMeta(name: string): Record<string, string> {
  const status = TOOL_STATUS[name];
  if (!status) return {};
  return {
    'openai/toolInvocation/invoking': status.invoking,
    'openai/toolInvocation/invoked': status.invoked,
  };
}
