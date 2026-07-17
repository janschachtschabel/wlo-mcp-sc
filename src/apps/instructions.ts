/**
 * apps/instructions.ts – The MCP server `instructions` block: cross-tool
 * guidance the model reads once (advertised at initialize). The first
 * paragraph is self-contained (the token-efficient fast path) so it stays
 * useful even if a host truncates. Model-facing → English.
 */

// Kept ≤ ~512 chars (Apps-SDK guidance), fast path first — a host may truncate,
// and each tool's own description carries its detail. Model-facing → English.
export const WLO_SERVER_INSTRUCTIONS = `WirLernenOnline (WLO): a read-only search index of curated German OER — materials, collections (Sammlungen) and topic pages (Themenseiten).

Fast path: call search_wlo_all ONCE for materials, collections AND topic pages together; enrich in the SAME call with includeWikipedia / includeCompendium / includeTopicPageContent / includeTextContent instead of extra calls. Use single-purpose tools only for one bucket. search + fetch follow the ChatGPT knowledge convention; filters take German labels or URIs.`;
