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
  search_wlo_content_many: { invoking: 'Mehrere Suchen laufen…', invoked: 'Suchen beantwortet' },
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
  get_node_collections: { invoking: 'Sammlungen werden ermittelt…', invoked: 'Sammlungen ermittelt' },
  get_collection_stats: { invoking: 'Statistik wird berechnet…', invoked: 'Statistik bereit' },
  get_collection_overview: { invoking: 'Sammlung wird zusammengefasst…', invoked: 'Sammlung zusammengefasst' },
  list_collection_tree: { invoking: 'Sammlungsbaum wird gelesen…', invoked: 'Sammlungsbaum gelesen' },
  count_wlo_content_matches: { invoking: 'Treffer werden gezählt…', invoked: 'Treffer gezählt' },
  lookup_wlo_vocabulary: { invoking: 'Vokabular wird geladen…', invoked: 'Vokabular geladen' },
  resolve_wlo_filters: { invoking: 'Filter werden aufgelöst…', invoked: 'Filter aufgelöst' },
  find_content_by_url: { invoking: 'Adressen werden geprüft…', invoked: 'Adressen geprüft' },
  lookup_wlo_publishers: { invoking: 'Anbieter werden ermittelt…', invoked: 'Anbieter ermittelt' },
  get_compendium_text: { invoking: 'Kompendiumtext wird geladen…', invoked: 'Text geladen' },
  get_wlo_content_text: { invoking: 'Volltext wird geladen…', invoked: 'Volltext geladen' },
  get_url_text: { invoking: 'Webseite wird gelesen…', invoked: 'Webseitentext bereit' },
  get_wikipedia_summary: { invoking: 'Wikipedia wird abgefragt…', invoked: 'Zusammenfassung bereit' },
  search_skill: { invoking: 'Skills werden gesucht…', invoked: 'Skills gefunden' },
  get_skill: { invoking: 'Skill-Anleitung wird geladen…', invoked: 'Skill-Anleitung bereit' },
  get_skill_registry: { invoking: 'Skill-Registry wird gelesen…', invoked: 'Skill-Registry bereit' },
  get_skill_for_task: { invoking: 'Passender Skill wird gesucht…', invoked: 'Skill-Anleitung bereit' },
  wlo_auth_status: { invoking: 'Anmeldestatus wird geprüft…', invoked: 'Anmeldestatus geprüft' },
  wlo_health_check: { invoking: 'Verbindung wird geprüft…', invoked: 'Status geprüft' },
  search: { invoking: 'WirLernenOnline wird durchsucht…', invoked: 'Ergebnisse bereit' },
  fetch: { invoking: 'Inhalt wird geladen…', invoked: 'Inhalt geladen' },

  // The curation tools. They have been listed for every caller since
  // 2026-08-05, so their status copy is no longer optional.
  //
  // Deliberately non-committal: the copy is stamped ONCE per tool
  // (`tool-defaults.ts`), so the same words stand over the preview call (writes
  // nothing) AND the confirmed call (writes, or deletes). "wird angelegt" was
  // false over the first, "wird vorbereitet" over the second — "… wird
  // bearbeitet" is true of both, and the reply text says what actually landed.
  // Pinned for every two-step tool by `tests/tool-status.test.ts`.
  wlo_update_content: { invoking: 'Änderung wird bearbeitet…', invoked: 'Ergebnis liegt vor' },
  wlo_create_content: { invoking: 'Anlage des Inhalts wird bearbeitet…', invoked: 'Ergebnis liegt vor' },
  wlo_submit_content: { invoking: 'Einreichung wird bearbeitet…', invoked: 'Ergebnis liegt vor' },
  wlo_delete_collections: { invoking: 'Löschung wird bearbeitet…', invoked: 'Ergebnis liegt vor' },
  wlo_remove_from_collections: { invoking: 'Herausnahme wird bearbeitet…', invoked: 'Ergebnis liegt vor' },
  wlo_order_collection: { invoking: 'Reihenfolge wird bearbeitet…', invoked: 'Ergebnis liegt vor' },
  wlo_submit_contents: { invoking: 'Einreichung wird bearbeitet…', invoked: 'Ergebnis liegt vor' },
  wlo_create_collection: { invoking: 'Anlage der Sammlung wird bearbeitet…', invoked: 'Ergebnis liegt vor' },
  wlo_rename_collection: { invoking: 'Umbenennung wird bearbeitet…', invoked: 'Ergebnis liegt vor' },
  wlo_add_to_collection: { invoking: 'Einordnung wird bearbeitet…', invoked: 'Ergebnis liegt vor' },
  wlo_remove_from_collection: { invoking: 'Herausnahme wird bearbeitet…', invoked: 'Ergebnis liegt vor' },
  wlo_create_collection_tree: { invoking: 'Sammlungsbaum wird bearbeitet…', invoked: 'Ergebnis liegt vor' },
  wlo_add_to_collections: { invoking: 'Einordnung wird bearbeitet…', invoked: 'Ergebnis liegt vor' },
  wlo_update_contents: { invoking: 'Metadaten-Änderung wird bearbeitet…', invoked: 'Ergebnis liegt vor' },
  wlo_attach_fulltext: { invoking: 'Volltext-Ablage wird bearbeitet…', invoked: 'Ergebnis liegt vor' },
  wlo_attach_fulltexts: { invoking: 'Volltext-Ablage wird bearbeitet…', invoked: 'Ergebnis liegt vor' },
  wlo_update_compendium: { invoking: 'Kompendialtext-Änderung wird bearbeitet…', invoked: 'Ergebnis liegt vor' },
  wlo_set_topic_page: { invoking: 'Themenseiten-Variante wird bearbeitet…', invoked: 'Ergebnis liegt vor' },
  wlo_suggest_metadata: { invoking: 'Vorschlag wird bearbeitet…', invoked: 'Ergebnis liegt vor' },
  wlo_list_suggestions: { invoking: 'Vorschläge werden geladen…', invoked: 'Vorschläge geladen' },
  wlo_decide_suggestion: { invoking: 'Entscheidung wird bearbeitet…', invoked: 'Ergebnis liegt vor' },
  wlo_delete_content: { invoking: 'Löschung wird bearbeitet…', invoked: 'Ergebnis liegt vor' },
  wlo_delete_collection: { invoking: 'Löschung wird bearbeitet…', invoked: 'Ergebnis liegt vor' },

  // The batch tools (`WLO_BATCH_UPLOAD_ENABLED`) are NOT two-step: the
  // preparation only prepares (its key is redeemed by the store calls), and the
  // two store calls write on their one call.
  wlo_prepare_file_batch: { invoking: 'Stapel-Ablage wird vorbereitet…', invoked: 'Vorschau liegt vor' },
  wlo_store_batch_file: { invoking: 'Datei wird abgelegt…', invoked: 'Ergebnis liegt vor' },
  wlo_store_batch_manifest: { invoking: 'Vorgang wird abgelegt…', invoked: 'Ergebnis liegt vor' },
  wlo_list_my_batches: { invoking: 'Ablagen werden geladen…', invoked: 'Ablagen geladen' },
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
