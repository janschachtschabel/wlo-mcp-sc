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
  topicPageUrl: z.string().nullable(),
  swimlaneCount: z.number(),
  swimlanesTotal: z.number(),
  swimlanes: z.array(resolvedSwimlaneSchema),
});

/** Mirrors `WikiSummary` (wikipedia-api.ts). */
const wikiSummarySchema = z.object({
  title: z.string(),
  extract: z.string(),
  thumbnail: z.string().optional(),
  url: z.string(),
  lang: z.string(),
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
};

const browseTreeNodeSchema: z.ZodType<BrowseTreeNode> = z.lazy(() =>
  formattedNodeSchema.extend({
    fileCount: z.number().optional(),
    contentPreview: z.array(formattedNodeSchema).optional(),
    children: z.array(browseTreeNodeSchema).optional(),
  }),
);

/** `{ parent, depth, total, results }` — browse_collection_tree. */
export const browseTreeSchema = z.object({
  parent: z.string(),
  depth: z.number(),
  total: z.number(),
  results: z.array(browseTreeNodeSchema),
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
