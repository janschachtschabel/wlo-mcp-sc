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
import { registerKnowledgeTools } from './tools/knowledge.js';
import { registerNodeRelationTools } from './tools/node-relations.js';
import { registerCollectionStatsTool } from './tools/collection-stats.js';
import { registerSkillsTool } from './tools/skills.js';
import { registerWidgets } from './apps/resources.js';
import { applyReadOnlyToolDefaults } from './apps/tool-defaults.js';
import { WLO_SERVER_INSTRUCTIONS } from './apps/instructions.js';

export type { LabeledCriterion, QueryMeta } from './tools/shared.js';

export function createMcpServer(): McpServer {
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

  // Every WLO tool is public, read-only OER data with no authentication. Declare
  // the uniform read-only defaults once — this wraps the two registration
  // methods so all tools below (seam + plain) carry `_meta.securitySchemes`
  // (F6) and the required `destructiveHint`/`openWorldHint` annotations.
  applyReadOnlyToolDefaults(server);

  // Register the built Apps-SDK widget resources (if any) and get their `ui://`
  // URIs. Skipped gracefully when `dist-widgets/` is absent (e.g. tests / a
  // build without `build:widgets`) — tools then simply carry no widget _meta.
  const widgets = registerWidgets(server);

  registerCollectionTools(server);      // search_wlo_collections, get_collection_contents, search_wlo_within_collection
  registerContentSearchTools(server, widgets['search-results']); // search_wlo_content, search_wlo_all (W1)
  registerNodeDetailTools(server);      // get_node_details, get_nodes_details
  registerVocabularyTool(server);       // lookup_wlo_vocabulary
  registerTopicPageSearchTool(server);  // search_wlo_topic_pages
  registerBrowseTools(server, widgets['browse']);          // get_subject_portals, browse_collection_tree (W2)
  registerHealthTool(server);           // wlo_health_check
  registerTopicPageContentTool(server, widgets['topic-page']); // get_topic_page_content (W4)
  registerWikipediaTool(server);        // get_wikipedia_summary
  registerCompendiumTool(server);       // get_compendium_text
  registerKnowledgeTools(server);       // search, fetch (ChatGPT knowledge convention)
  registerPublisherTool(server);        // lookup_wlo_publishers
  registerNodeRelationTools(server);    // get_related_content, get_node_breadcrumb
  registerCollectionStatsTool(server);  // get_collection_stats
  registerSkillsTool(server);           // find_wlo_skills

  return server;
}
