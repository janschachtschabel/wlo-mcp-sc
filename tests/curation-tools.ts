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
  'wlo_update_content', 'wlo_create_content', 'wlo_submit_content',
  'wlo_create_collection', 'wlo_rename_collection',
  'wlo_add_to_collection', 'wlo_remove_from_collection',
  'wlo_update_compendium',
  // Reading proposals is gated too: they are curation workflow, not public data.
  'wlo_suggest_metadata', 'wlo_list_suggestions', 'wlo_decide_suggestion',
  'wlo_delete_content', 'wlo_delete_collection',
];

/**
 * The ones that change something — i.e. everything above except the one that
 * only READS proposals. `wlo_list_suggestions` is `readOnlyHint: true` and
 * `oauth2` at the same time, and both are true of it: it reads, but only for
 * someone who may curate.
 */
export const MUTATING_TOOLS = CURATION_TOOLS.filter(n => n !== 'wlo_list_suggestions');
