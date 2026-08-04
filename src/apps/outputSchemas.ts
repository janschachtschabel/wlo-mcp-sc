/**
 * apps/outputSchemas.ts – zod `outputSchema`s = the structuredContent contracts.
 *
 * These mirror the plain-data envelopes the services already return
 * (`FormattedNode`, `SearchAllEnvelope`, `SwimlanePayload`, the browse tree), so
 * the model reads the same JSON a widget renders. They are deliberately NOT
 * `.strict()`: the MCP SDK validates `structuredContent` with `safeParseAsync`
 * and tolerates unknown extra keys, but throws on missing required keys / wrong
 * types — so every field here must match real `formatNode` output.
 */

import { z } from 'zod';

/** Mirrors `FormattedNode` (formatter.ts). Optional fields stay optional. */
export const formattedNodeSchema = z.object({
  nodeId: z.string(),
  title: z.string(),
  description: z.string(),
  keywords: z.array(z.string()),
  disciplines: z.array(z.string()),
  educationalContexts: z.array(z.string()),
  userRoles: z.array(z.string()),
  learningResourceTypes: z.array(z.string()),
  url: z.string(),
  downloadUrl: z.string(),
  contentUrl: z.string(),
  previewUrl: z.string(),
  previewIsIcon: z.boolean(),
  mimeType: z.string(),
  fileSize: z.number(),
  license: z.string(),
  publisher: z.string(),
  nodeType: z.enum(['collection', 'content']),
  topicPageUrl: z.string(),
  textContent: z.string().optional(),
  compendiumText: z.string().optional(),
});

/** `{ total, count, results }` — search_wlo_content / search_wlo_collections. */
export const nodeListSchema = z.object({
  total: z.number(),
  count: z.number(),
  results: z.array(formattedNodeSchema),
});

/** Mirrors `ResolvedSwimlane` (services/topic-page.ts). */
const resolvedSwimlaneSchema = z.object({
  heading: z.string(),
  type: z.string(),
  items: z.array(formattedNodeSchema),
  hasMore: z.boolean(),
});

/** Mirrors `SwimlanePayload` — get_topic_page_content, search_wlo_topic_pages. */
export const swimlanePayloadSchema = z.object({
  variantId: z.string(),
  collectionId: z.string().nullable(),
  variantTitle: z.string(),
  collectionTitle: z.string().optional(),
  description: z.string().optional(),
  topicPageUrl: z.string().nullable(),
  swimlaneCount: z.number(),
  swimlanesTotal: z.number(),
  swimlanes: z.array(resolvedSwimlaneSchema),
  /** Only on an empty result: which of the five miss causes it was. */
  reason: z.string().optional(),
});

/** Mirrors `ContentText` (services/content-text.ts) — get_wlo_content_text. */
export const contentTextSchema = z.object({
  nodeId: z.string(),
  title: z.string(),
  text: z.string(),
  source: z.enum(['repository', 'external-extraction', 'none']),
  sourceUrl: z.string().nullable(),
  /** Length BEFORE truncation, so the caller sees what it is missing. */
  charCount: z.number(),
  truncated: z.boolean(),
  /** Only when there is no text: which of the three causes it was. */
  reason: z.string().optional(),
});

/** Mirrors `UrlText` (services/url-text.ts). */
export const urlTextSchema = z.object({
  /** The NORMALISED url that was requested — not necessarily the string passed in. */
  url: z.string(),
  text: z.string(),
  /** Length BEFORE truncation, so the caller sees what it is missing. */
  charCount: z.number(),
  truncated: z.boolean(),
  /** Only when there is no text: which of the five causes it was. */
  reason: z.string().optional(),
});

/** Mirrors `WikiSummary` (wikipedia-api.ts). */
const wikiSummarySchema = z.object({
  title: z.string(),
  extract: z.string(),
  thumbnail: z.string().optional(),
  url: z.string(),
  lang: z.string(),
  // Declared, not merely tolerated: a zod object drops unknown keys, so leaving
  // this out would strip the resolution quality before it reaches a host that
  // attributes the text to the article. Required, because the producer always
  // sets it — optional would let a regression that stops setting it pass.
  match: z.enum(['exact', 'fuzzy']),
});

/** A topic-page result may carry its resolved swimlane content (`TopicPageResult`). */
const topicPageResultSchema = formattedNodeSchema.extend({
  topicPageContent: swimlanePayloadSchema.optional(),
});

/** Mirrors `SearchAllEnvelope` (services/search.ts) — search_wlo_all. */
export const searchAllEnvelopeSchema = z.object({
  query: z.string(),
  content: z.object({ total: z.number(), count: z.number(), results: z.array(formattedNodeSchema) }),
  collections: z.object({ total: z.number(), count: z.number(), results: z.array(formattedNodeSchema) }),
  topicPages: z.object({ total: z.number(), count: z.number(), results: z.array(topicPageResultSchema) }),
  wikipedia: wikiSummarySchema.optional(),
});

/**
 * A node in the browse tree = a FormattedNode plus optional counts, a content
 * preview and recursive children (browse_collection_tree depth=2).
 */
export type BrowseTreeNode = z.infer<typeof formattedNodeSchema> & {
  fileCount?: number;
  contentPreview?: z.infer<typeof formattedNodeSchema>[];
  children?: BrowseTreeNode[];
  /** Upstream holds more sub-collections than this listing shows. */
  hasMoreChildren?: boolean;
};

const browseTreeNodeSchema: z.ZodType<BrowseTreeNode> = z.lazy(() =>
  formattedNodeSchema.extend({
    fileCount: z.number().optional(),
    contentPreview: z.array(formattedNodeSchema).optional(),
    children: z.array(browseTreeNodeSchema).optional(),
    hasMoreChildren: z.boolean().optional(),
  }),
);

/** `{ parent, depth, total, results, truncated }` — browse_collection_tree. */
export const browseTreeSchema = z.object({
  parent: z.string(),
  depth: z.number(),
  total: z.number(),
  results: z.array(browseTreeNodeSchema),
  /** True when any branch holds more sub-collections than shown. */
  truncated: z.boolean().optional(),
});

/** `{ total, results }` — get_subject_portals (portals carry an optional count). */
export const subjectPortalListSchema = z.object({
  total: z.number(),
  results: z.array(formattedNodeSchema.extend({ subCollectionCount: z.number().optional() })),
});

// ── ChatGPT knowledge convention (fixed shapes) ─────────────────────────────

/** `search` → lightweight hits (ChatGPT knowledge convention). */
export const searchKnowledgeSchema = z.object({
  results: z.array(z.object({ id: z.string(), title: z.string(), url: z.string() })),
});

/** `fetch` → one full document (ChatGPT knowledge convention). */
export const fetchDocumentSchema = z.object({
  id: z.string(),
  title: z.string(),
  text: z.string(),
  url: z.string(),
  metadata: z.object({
    disciplines: z.array(z.string()),
    educationalContexts: z.array(z.string()),
    learningResourceTypes: z.array(z.string()),
    license: z.string(),
    publisher: z.string(),
    nodeType: z.string(),
  }).optional(),
});
