/**
 * server.ts – MCP Server factory with all WLO tools registered.
 * Transport-agnostic: connect stdio or Streamable HTTP outside this file.
 *
 * The tool implementations live in `src/tools/*`, grouped by responsibility;
 * this file only assembles them. Registration order = display order in
 * tools/list (matches the original single-file order).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerCollectionTools } from './tools/collections.js';
import { registerContentSearchTools } from './tools/content-search.js';
import { registerNodeDetailTools } from './tools/node-details.js';
import { registerVocabularyTool, registerPublisherTool } from './tools/vocabulary.js';
import { registerTopicPageSearchTool } from './tools/topic-pages.js';
import { registerTopicPageContentTool } from './tools/topic-page-content.js';
import { registerBrowseTools } from './tools/browse.js';
import { registerHealthTool } from './tools/health.js';
import { registerWikipediaTool } from './tools/wikipedia.js';
import { registerCompendiumTool } from './tools/compendium.js';
import { registerContentTextTool } from './tools/content-text.js';
import { registerUrlTextTool } from './tools/url-text.js';
import { registerKnowledgeTools } from './tools/knowledge.js';
import { registerNodeRelationTools } from './tools/node-relations.js';
import { registerCollectionStatsTool } from './tools/collection-stats.js';
import { registerSkillsTool } from './tools/skills.js';
import { WLO_SKILLS_COLLECTION_ID } from './wlo-api.js';
import { registerAuthTools } from './tools/auth.js';
import { registerCurationContentTools } from './tools/curation-content.js';
import { registerCurationCollectionTools } from './tools/curation-collections.js';
import { registerCurationCompendiumTool } from './tools/curation-compendium.js';
import { registerCurationDeleteTools } from './tools/curation-delete.js';
import { registerCurationSuggestionTools } from './tools/curation-suggestions.js';
import { registerCurationDecisionTool } from './tools/curation-decide.js';
import { writeMode, type WriteMode } from './services/write/credential-gate.js';
import { registerWidgets } from './apps/resources.js';
import { applyReadOnlyToolDefaults } from './apps/tool-defaults.js';
import { WLO_SERVER_INSTRUCTIONS } from './apps/instructions.js';

export type { QueryMeta } from './tools/shared.js';
export type { LabeledCriterion } from './filter-criteria.js';

/**
 * @param mode – whether this server may offer curation (write) tools. Resolved
 *   by the caller, because the HTTP entry point knows the request's credential
 *   before it builds the server, while stdio has only the environment. Omitted
 *   ⇒ derived from whatever credential is in scope, which is `none` when there
 *   is none — the safe default for a surface that forgot to pass it.
 */
export function createMcpServer(mode: WriteMode = writeMode()): McpServer {
  // The repository URL comes globally from the ``WLO_REPOSITORY_URL`` env (see
  // ``wlo-api.ts``). Each server instance addresses a single edu-sharing
  // endpoint — switching between prod/staging happens via a separate
  // deployment with a different env variable.

  const server = new McpServer(
    {
      name: 'wlo-mcp',
      version: '1.0.0',
    },
    { instructions: WLO_SERVER_INSTRUCTIONS },
  );

  // Declare the READ-ONLY defaults once — this wraps the two registration
  // methods so all tools below (seam + plain) carry `_meta.securitySchemes`
  // (F6) and the required `destructiveHint`/`openWorldHint` annotations.
  //
  // Defaults, not a rule about the server: the reading tools serve public OER
  // data with no authentication, while the curation tools registered at the
  // bottom of this function declare their own `securitySchemes` and keep them
  // (see `apps/tool-defaults.ts`). Claiming `noauth` for those would tell the
  // host something untrue about when they can be called.
  applyReadOnlyToolDefaults(server);

  // Register the built Apps-SDK widget resources (if any) and get their `ui://`
  // URIs. Skipped gracefully when `dist-widgets/` is absent (e.g. tests / a
  // build without `build:widgets`) — tools then simply carry no widget _meta.
  const widgets = registerWidgets(server);

  registerCollectionTools(server, widgets['search-results']);   // search_wlo_collections, get_collection_contents (W1), search_wlo_within_collection
  registerContentSearchTools(server, widgets['search-results']); // search_wlo_content, search_wlo_all (W1)
  registerNodeDetailTools(server, widgets['search-results']); // get_node_details (W1), get_nodes_details
  registerVocabularyTool(server);       // lookup_wlo_vocabulary
  registerTopicPageSearchTool(server, widgets['search-results']); // search_wlo_topic_pages (W1)
  registerBrowseTools(server, widgets['browse']);          // get_subject_portals, browse_collection_tree (W2)
  registerHealthTool(server);           // wlo_health_check
  registerTopicPageContentTool(server, widgets['topic-page']); // get_topic_page_content (W4)
  registerWikipediaTool(server);        // get_wikipedia_summary
  registerCompendiumTool(server, widgets['reading']); // get_compendium_text (W5)
  registerContentTextTool(server, widgets['reading']); // get_wlo_content_text (W5)
  // Next to its sibling: both answer "what does this text say", one for WLO
  // material by nodeId, one for an arbitrary URL. UNSAFE — registered by
  // default, removable with WLO_DISABLE_UNSAFE_TOOLS.
  registerUrlTextTool(server);          // get_url_text
  registerKnowledgeTools(server);       // search, fetch (ChatGPT knowledge convention)
  registerPublisherTool(server);        // lookup_wlo_publishers
  registerNodeRelationTools(server, widgets['search-results']); // get_related_content (W1), get_node_breadcrumb
  registerCollectionStatsTool(server);  // get_collection_stats
  // Only when a skills collection is configured: unconfigured, every call failed
  // with an operator-facing message a model cannot act on.
  if (WLO_SKILLS_COLLECTION_ID) registerSkillsTool(server, WLO_SKILLS_COLLECTION_ID); // find_wlo_skills
  registerAuthTools(server);            // wlo_auth_status

  // Curation tools are registered ONLY when this call has an identity that may
  // write. A model cannot misuse a tool it cannot see — and each of them also
  // refuses at call time, because a host may serve a cached tool list.
  if (mode !== 'none') {
    registerCurationContentTools(server);    // wlo_update_content, wlo_create_content, wlo_submit_content
    registerCurationCollectionTools(server); // create/rename collection, add/remove material
    registerCurationCompendiumTool(server);  // wlo_update_compendium
    registerCurationSuggestionTools(server); // wlo_suggest_metadata, wlo_list_suggestions — proposals only
    registerCurationDecisionTool(server);    // wlo_decide_suggestion — the one that applies a proposal
    // Deleting comes last, so the destructive pair sits at the end of the list
    // rather than next to the tools that merely change a field.
    registerCurationDeleteTools(server);     // wlo_delete_content, wlo_delete_collection
  }

  return server;
}
