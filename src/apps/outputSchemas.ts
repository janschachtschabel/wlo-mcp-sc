/**
 * apps/outputSchemas.ts – zod `outputSchema`s = the structuredContent contracts.
 *
 * These mirror the plain-data envelopes the services already return
 * (`FormattedNode`, `SearchAllEnvelope`, `SwimlanePayload`, the browse tree), so
 * the model reads the same JSON a widget renders. They are deliberately NOT
 * `.strict()`: the MCP SDK validates `structuredContent` with `safeParseAsync`
 * and tolerates unknown extra keys, but throws on missing required keys / wrong
 * types — so every field here must match real `formatNode` output.
 *
 * WHY every field must still be DECLARED (measured against SDK 1.32.2,
 * 2026-11-07 — the earlier comments here said "zod strips unknown keys", which
 * is false): the SDK validates and then passes the ORIGINAL object on, so an
 * undeclared key does reach the client. But the schema the server ADVERTISES in
 * `tools/list` is generated with `additionalProperties: false`, so that key
 * violates the published contract — a client that validates strictly rejects
 * the answer, and one that generates types from the schema never sees the
 * field. "Undeclared" below means exactly that.
 */

import { z } from 'zod';

/** Mirrors `FormattedNode` (formatter.ts). Optional fields stay optional. */
export const formattedNodeSchema = z.object({
  nodeId: z.string(),
  /**
   * Present only when `nodeId` names a collection reference — declared here for
   * the same reason as `skillRegistry` below: undeclared, it breaks the
   * advertised schema (see the header) while nothing fails on our side.
   */
  originalId: z.string().optional(),
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
  /** Present exactly when the record is NOT publicly readable — the widget's
   *  cue that an anonymous <img> would fetch the permission shield. Literal
   *  false: the formatter never emits true (absence is the public case). */
  isPublic: z.literal(false).optional(),
  /** How many materials the collection holds — present only when the search
   *  DTO carried the number (declared: see the header). */
  contentsCount: z.number().int().optional(),
  mimeType: z.string(),
  fileSize: z.number(),
  license: z.string(),
  publisher: z.string(),
  nodeType: z.enum(['collection', 'content']),
  topicPageUrl: z.string(),
  textContent: z.string().optional(),
  compendiumText: z.string().optional(),
  // The signal that replaced the inline text on search hits (2026-08-20) —
  // undeclared, it would break the advertised schema (see the header).
  hasCompendium: z.literal(true).optional(),
  // Declared, not inferred: a field missing here breaks the advertised schema
  // (see the header) with nothing failing on our side.
  skillRegistry: z.object({
    nodeId: z.string(),
    title: z.string(),
    entries: z.array(z.object({ nodeId: z.string(), title: z.string(), context: z.string().optional() })),
    contexts: z.array(z.object({ path: z.string(), skills: z.number() })).optional(),
    truncated: z.object({ listed: z.number(), referenced: z.number() }).optional(),
  }).optional(),
});

/**
 * A filter label that did not resolve (`UnresolvedFilter`, filter-criteria.ts).
 * In `structuredContent` since 2026-11-07: before, only the text blocks and
 * `_queryMeta` carried it, so a client reading the contract alone never learned
 * that a filter did not apply. A licence among them EMPTIES the answer.
 */
const unresolvedFiltersSchema = z.array(z.object({
  field: z.string(), value: z.string(), suggestions: z.array(z.string()).optional(),
})).optional();

/** Facet counts per property (`includeFacets`) — the same values `_queryMeta.facets` carries. */
const facetsSchema = z.record(z.string(), z.array(z.object({
  label: z.string(), count: z.number(), uri: z.string(),
}))).optional();

/**
 * Which collection a `collection` TITLE was taken for (`tools/collection-arg.ts`)
 * — present only when a name was resolved, never when the caller gave the id.
 * `path`: ancestor titles from the subject portal down, absent when unread.
 */
export const resolvedCollectionSchema = z.object({
  nodeId: z.string(),
  title: z.string(),
  path: z.array(z.string()).optional(),
  /** The title matched only in a different spelling (ä/ae, ß/ss, separators) — worth a check. */
  matched: z.literal('loose').optional(),
  /** The narrowing subject did not resolve and narrowed nothing. */
  unresolvedDiscipline: z.object({ value: z.string(), suggestions: z.array(z.string()).optional() }).optional(),
}).optional();

/**
 * The two disclosures of a content search (`services/content-search.ts`),
 * declared once for both tools that carry them. `more`: the page came back
 * short although the catalogue holds more — continue at `nextSkipCount`.
 * `textContent…`: hits whose full text was not read (past the bound) or could
 * not be read; neither is "the record has no text" (that is `textContent: ''`).
 */
const contentSearchDisclosures = {
  more: z.object({ nextSkipCount: z.number() }).optional(),
  textContentSkipped: z.array(z.string()).optional(),
  textContentUnreadable: z.array(z.string()).optional(),
};

/** `{ total, count, results }` — search_wlo_content / search_wlo_collections. */
export const nodeListSchema = z.object({
  total: z.number(),
  count: z.number(),
  results: z.array(formattedNodeSchema),
  ...contentSearchDisclosures,
  /** search_wlo_collections: a collection index did not answer — the list may lack hits (K-3). */
  incomplete: z.literal(true).optional(),
  /**
   * Content type derived from a medium word in the query (never set for an
   * explicit `learningResourceType`). Declared here because an undeclared key
   * breaks the advertised schema (see the header) — and this is the machine-readable half of the disclosure whose prose
   * half is `derivedResourceTypeNotice`.
   */
  derivedResourceType: z.string().optional(),
  unresolvedFilters: unresolvedFiltersSchema,
  facets: facetsSchema,
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
  /** The source was larger than what is read of it: `charCount` is a lower bound. */
  charCountIsLowerBound: z.literal(true).optional(),
  truncated: z.boolean(),
  /** Only when there is no text: which of the three causes it was. */
  reason: z.string().optional(),
  /**
   * This payload is working MATERIAL for the model, not a document a person is
   * meant to read. `get_compendium_text` sets it: its answer is editorial prose
   * cut into paragraph chunks, and read straight off the screen those are
   * disjointed fragments (user decision 2026-08-21). The reading widget shows
   * a handover line instead; what the model receives is unchanged.
   */
  forModel: z.boolean().optional(),
  /** How many passages a `query` answer carried. Absent ⇒ it was the whole text. */
  passageCount: z.number().int().optional(),
  /**
   * Search terms the text does not contain at all. Present only for a `query`
   * answer, and only alongside `forModel`: the document view carries this in
   * its prose, but a handover renders no prose — and "Lehrplan Thüringen
   * Regelschule" answered with Rheinland-Pfalz plans reads as an answer to the
   * question that was asked unless the miss is named.
   */
  unmatchedTerms: z.array(z.string()).optional(),
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
  content: z.object({
    total: z.number(),
    count: z.number(),
    results: z.array(formattedNodeSchema),
    /**
     * Only when a licence was requested AND the content leg ran (`include`) —
     * see `LicenseFilterCounts`. Its presence is the gate every renderer uses to
     * decide whether to explain an empty or shortened result.
     */
    licenseFilter: z.object({ checked: z.number(), kept: z.number() }).optional(),
    /** Same placement rule as `licenseFilter`: a content-leg disclosure lives
     *  in the content bucket. See `nodeListSchema.derivedResourceType`. */
    derivedResourceType: z.string().optional(),
    ...contentSearchDisclosures,
  }),
  // `registryChecked` declared for the same reason as `skillRegistry` above:
  // an undeclared field breaks the advertised schema (see the header).
  collections: z.object({
    total: z.number(), count: z.number(), results: z.array(formattedNodeSchema),
    registryChecked: z.literal(true).optional(),
    // A source of this bucket did not answer: the list may lack hits (K-3).
    incomplete: z.literal(true).optional(),
  }),
  // `registryChecked` here too: a Themenseite IS a collection and carries the
  // same disclosure since 2026-08-19 — undeclared, it would break the
  // advertised schema (see the header) while the text kept it.
  topicPages: z.object({
    total: z.number(), count: z.number(), results: z.array(topicPageResultSchema),
    registryChecked: z.literal(true).optional(),
    incomplete: z.literal(true).optional(),
  }),
  wikipedia: wikiSummarySchema.optional(),
  wikipediaUnreachable: z.literal(true).optional(),
  // Call-level, not per bucket: the filters are the call's (only the content
  // leg applies them; `_queryMeta` repeats them per leg for the same reason).
  unresolvedFilters: unresolvedFiltersSchema,
  facets: facetsSchema,
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
  /** The listing of this node's sub-collections did not answer. */
  childrenUnread?: boolean;
};

const browseTreeNodeSchema: z.ZodType<BrowseTreeNode> = z.lazy(() =>
  formattedNodeSchema.extend({
    fileCount: z.number().optional(),
    contentPreview: z.array(formattedNodeSchema).optional(),
    children: z.array(browseTreeNodeSchema).optional(),
    hasMoreChildren: z.boolean().optional(),
    childrenUnread: z.boolean().optional(),
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
  /** The first node, in listing order, whose children were cut. */
  truncatedAt: z.string().optional(),
  resolvedCollection: resolvedCollectionSchema,
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

/**
 * `search` under `WLO_SEARCH_OUTPUT_MODE=rich` — the convention's `results`
 * plus the whole `search_wlo_all` envelope, so the results widget renders from
 * the identical shape it already knows. `results` stays exactly as above: the
 * enrichment may only ADD keys beside it, never reshape it.
 */
export const searchKnowledgeRichSchema = searchKnowledgeSchema.merge(searchAllEnvelopeSchema);

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

/**
 * `fetch` under `WLO_SEARCH_OUTPUT_MODE=rich` — the convention's document plus
 * the node in the `nodeListSchema` shape that `get_node_details` renders with,
 * so the second step of the search→fetch flow shows the same interface as the
 * first. Measured 2026-08-09: the lean document drops 11 fields the detail tool
 * carries, `previewUrl` (the preview image) and `downloadUrl` among them.
 */
export const fetchDocumentRichSchema = fetchDocumentSchema.merge(nodeListSchema);
