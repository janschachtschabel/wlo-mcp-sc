/**
 * curation-tools.ts – Test helper (NOT a test file; excluded by the `*.test.ts`
 * glob). The names of the curation tools, in ONE place.
 *
 * Four test files need to tell a curation tool from a read tool, and since
 * 2026-08-05 they cannot do it by asking for two different servers — every
 * caller gets the same list. Four hand-maintained copies of the same thirteen
 * names would drift, and the first symptom would be a new write tool that one
 * of the checks silently stops covering.
 */

/** Every curation tool. A new one belongs here, or the checks skip it. */
export const CURATION_TOOLS = [
  'wlo_update_content', 'wlo_update_contents', 'wlo_attach_fulltext', 'wlo_attach_fulltexts', 'wlo_create_content', 'wlo_submit_content', 'wlo_submit_contents',
  'wlo_create_collection', 'wlo_rename_collection',
  'wlo_add_to_collection', 'wlo_remove_from_collection',
  'wlo_create_collection_tree', 'wlo_add_to_collections', 'wlo_remove_from_collections', 'wlo_order_collection', 'wlo_move_collection',
  // Proposals for a collection: listing is gated like the metadata suggestions.
  'wlo_list_collection_proposals', 'wlo_decide_collection_proposal',
  'wlo_update_compendium',
  'wlo_set_topic_page',
  // Reading proposals is gated too: they are curation workflow, not public data.
  'wlo_suggest_metadata', 'wlo_list_suggestions', 'wlo_decide_suggestion',
  'wlo_delete_content', 'wlo_delete_collection', 'wlo_delete_collections',
];

/**
 * The ones that change something — i.e. everything above except the one that
 * only READS proposals. `wlo_list_suggestions` is `readOnlyHint: true` and
 * `oauth2` at the same time, and both are true of it: it reads, but only for
 * someone who may curate.
 */
export const MUTATING_TOOLS = CURATION_TOOLS.filter(n => n !== 'wlo_list_suggestions' && n !== 'wlo_list_collection_proposals');

/**
 * The write tools that are TWO-STEP: a call without `confirmToken` only builds a
 * preview, the call with it writes. Today that is every mutating tool above —
 * named separately because a rule about wording ("the status copy must fit both
 * calls") is about this property, not about "changes something".
 */
export const TWO_STEP_TOOLS = MUTATING_TOOLS;

/**
 * The batch-upload tools (`WLO_BATCH_UPLOAD_ENABLED`). Curation tools too —
 * `registerCurationTool`, `oauth2` — but listed only behind the switch, and NOT
 * two-step: `wlo_store_batch_file`/`_manifest` write on their one call, by
 * redeeming the `batchToken` the person approved in `wlo_prepare_file_batch`.
 */
export const BATCH_TOOLS = ['wlo_prepare_file_batch', 'wlo_store_batch_file', 'wlo_store_batch_manifest', 'wlo_list_my_batches'];
