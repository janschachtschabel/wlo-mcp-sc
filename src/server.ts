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
import { registerSkillTools } from './tools/skills.js';
import { WLO_SKILLS_COLLECTION_ID, WLO_SKILL_TOOL_MODE, WLO_SEARCH_OUTPUT_MODE } from './wlo-api.js';
import { registerAuthTools } from './tools/auth.js';
import { registerCurationContentTools } from './tools/curation-content.js';
import { registerCurationCollectionTools } from './tools/curation-collections.js';
import { registerCurationCompendiumTool } from './tools/curation-compendium.js';
import { registerCurationTopicPageTool } from './tools/curation-topic-page.js';
import { registerCurationDeleteTools } from './tools/curation-delete.js';
import { registerCurationSuggestionTools } from './tools/curation-suggestions.js';
import { registerCurationDecisionTool } from './tools/curation-decide.js';
import { writeAuthChallenge } from './auth/oauth-metadata.js';
import { registerWidgets } from './apps/resources.js';
import { applyReadOnlyToolDefaults } from './apps/tool-defaults.js';
import { WLO_SERVER_INSTRUCTIONS } from './apps/instructions.js';

export type { QueryMeta } from './tools/shared.js';
export type { LabeledCriterion } from './filter-criteria.js';

export interface McpServerOptions {
  /**
   * This deployment's public origin, used for the `resource_metadata` pointer a
   * curation tool sends when the caller may not write. Resolved by the caller
   * (see `auth/oauth-metadata.ts`) — the HTTP entry point knows the request, and
   * under `TRUST_PROXY` the origin is per-request, so it must not be cached in a
   * module variable shared by concurrent calls. Absent ⇒ no pointer, which is
   * the honest answer when the origin is unknown.
   */
  issuer?: string | null;
}

export function createMcpServer({ issuer = null }: McpServerOptions = {}): McpServer {
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

  // Declare the defaults once — this wraps the two registration methods so all
  // tools below (seam + plain) carry `_meta.securitySchemes` (F6) and the
  // required `destructiveHint`/`openWorldHint` annotations.
  //
  // Defaults, not a rule about the server: a read tool accepts both `noauth`
  // and `oauth2` (it works anonymously and sees more with a login), while the
  // curation tools registered at the bottom of this function declare `oauth2`
  // alone and keep it (see `apps/tool-defaults.ts`). Claiming `noauth` for
  // those would tell the host something untrue about when they can be called.
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
  // search, fetch (ChatGPT knowledge convention). Under
  // WLO_SEARCH_OUTPUT_MODE=rich, `search` also carries the search_wlo_all
  // buckets and renders the same widget — see resolveSearchOutputMode for why
  // that is off by default.
  registerKnowledgeTools(server, {
    mode: WLO_SEARCH_OUTPUT_MODE,
    widgetUri: widgets['search-results'],
  });
  registerPublisherTool(server);        // lookup_wlo_publishers
  registerNodeRelationTools(server, widgets['search-results']); // get_related_content (W1), get_node_breadcrumb
  registerCollectionStatsTool(server);  // get_collection_stats
  // Registered unconditionally: the skill search no longer NEEDS a configured
  // collection — without one it filters the whole repository by the `ai_prompt`
  // content type. `WLO_SKILLS_COLLECTION_ID` narrows it to a subtree when set.
  registerSkillTools(server, {                 // search_skill + get_skill, or get_skill_for_task
    collectionId: WLO_SKILLS_COLLECTION_ID,
    mode: WLO_SKILL_TOOL_MODE,
  });
  registerAuthTools(server);            // wlo_auth_status

  // Curation tools are registered ALWAYS, including for a caller with no
  // identity — and each refuses at call time with the OAuth challenge that asks
  // the host to offer a login (`tools/curation-shared.ts`).
  //
  // This reverses the earlier rule "write tools are absent in anonymous mode",
  // deliberately and with the user's decision (2026-08-05). Hiding them looked
  // safer and was the reason the login never started: a model that never sees a
  // write tool never calls one, so nothing ever asks the host to authenticate,
  // and the connector stayed anonymous forever. It is also what OpenAI's own
  // mixed-auth example does — the protected tool is always listed and refuses
  // on invocation. The refusal itself is unchanged and absolute; only the
  // invisibility is gone.
  const challenge = writeAuthChallenge(issuer);
  registerCurationContentTools(server, challenge);    // wlo_update_content, wlo_create_content, wlo_submit_content
  registerCurationCollectionTools(server, challenge); // create/rename collection, add/remove material
  registerCurationCompendiumTool(server, challenge);  // wlo_update_compendium
  registerCurationTopicPageTool(server, challenge);   // wlo_set_topic_page — the one whose result is immediately public
  registerCurationSuggestionTools(server, challenge); // wlo_suggest_metadata, wlo_list_suggestions — proposals only
  registerCurationDecisionTool(server, challenge);    // wlo_decide_suggestion — the one that applies a proposal
  // Deleting comes last, so the destructive pair sits at the end of the list
  // rather than next to the tools that merely change a field.
  registerCurationDeleteTools(server, challenge);     // wlo_delete_content, wlo_delete_collection

  return server;
}
