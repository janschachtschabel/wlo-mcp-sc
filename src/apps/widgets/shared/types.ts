/**
 * types.ts – Structural shapes the widgets render.
 *
 * These deliberately mirror the server's `FormattedNode` / envelope types
 * (formatter.ts, services/*, apps/outputSchemas.ts) as plain interfaces so the
 * widget bundle stays free of the server's `zod` runtime and edu-sharing
 * imports. The zod `outputSchema`s remain the authoritative wire contract; if a
 * field is added there, mirror it here. DOM-free.
 */

/** The `FormattedNode` fields the widgets read. */
export interface WidgetNode {
  nodeId: string;
  title: string;
  description: string;
  disciplines: string[];
  educationalContexts: string[];
  learningResourceTypes: string[];
  url: string;
  contentUrl: string;
  previewUrl: string;
  previewIsIcon: boolean;
  license: string;
  publisher: string;
  nodeType: 'collection' | 'content';
  topicPageUrl: string;
}

export interface NodeList {
  total: number;
  count: number;
  results: WidgetNode[];
}

export interface WikiSummary {
  title: string;
  extract: string;
  url: string;
  thumbnail?: string;
  lang: string;
}

/** `search_wlo_all` structuredContent (SearchAllEnvelope). */
export interface SearchAllPayload {
  query: string;
  content: NodeList;
  collections: NodeList;
  topicPages: NodeList;
  wikipedia?: WikiSummary;
}

export interface Swimlane {
  heading: string;
  type: string;
  items: WidgetNode[];
  hasMore: boolean;
}

/** `get_topic_page_content` structuredContent (SwimlanePayload). */
export interface SwimlanePayload {
  variantId: string;
  collectionId: string | null;
  variantTitle: string;
  topicPageUrl: string | null;
  swimlaneCount: number;
  swimlanesTotal: number;
  swimlanes: Swimlane[];
}

/** A browse-tree node (`browse_collection_tree` / `get_subject_portals`). */
export interface BrowseNode extends WidgetNode {
  fileCount?: number;
  subCollectionCount?: number;
  contentPreview?: WidgetNode[];
  children?: BrowseNode[];
}
